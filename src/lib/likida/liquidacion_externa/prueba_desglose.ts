// ═══════════════════════════════════════════════════════════════════════════
// PRUEBA REAL DE UN CORREO DE DESGLOSE A UN BUZÓN (T-A1-35). La dispara Javier con
// `~/likida-loop/cinco-agentes/enviar-prueba-desglose.sh`, nunca el cron ni un operador.
//
// Manda el FIXTURE SINTÉTICO (ninguna cifra real) con el renderer real (`generarDesgloseXlsx`), el correo real
// (`armarCorreoDesglose`) y el envío real (`enviarCorreo`, sobrio) a UNA dirección dada. Devuelve una sola línea corta:
//   · `ok resend_id=<id>`
//   · `correo no configurado` (sin RESEND_API_KEY o sin RESEND_EMAIL_DOMAIN): jamás falla en silencio
//   · `error: <motivo>` con el detalle recortado y sin la llave ni direcciones completas
// La llave NUNCA se imprime ni se incluye en el resultado.
// ═══════════════════════════════════════════════════════════════════════════

import { correoConfigurado, enviarCorreo } from '@/lib/correo/enviar';
import { generarDesgloseXlsx, type DatosDesglose } from './desglose_xlsx';
import { DESGLOSE_SINTETICO, type DesgloseFixture } from './desglose.fixture';
import { armarCorreoDesglose, type EnvioCorreoPuerto } from './entrega_correo';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface ResultadoPruebaDesglose {
  ok: boolean;
  /** Una línea, lista para imprimir. Nunca contiene la API key. */
  linea: string;
  resendId?: string;
}

export interface DependenciasPruebaDesglose {
  enviar: EnvioCorreoPuerto;
  configurado: () => boolean;
  /** Valor de la llave, solo para REDACTARLA de cualquier detalle. */
  llave?: string;
}

export const DEPENDENCIAS_REALES: DependenciasPruebaDesglose = {
  enviar: enviarCorreo,
  configurado: correoConfigurado,
  llave: process.env.RESEND_API_KEY,
};

export function datosDeFixture(f: DesgloseFixture): DatosDesglose {
  return {
    operador: f.operador.nombre, unidad: f.unidad, bitacora: f.bitacora, desde: f.desde, hasta: f.hasta, dias: f.dias,
    percepciones: f.percepciones.map((r) => ({ concepto: r.descripcion, monto: r.monto })),
    deducciones: f.deducciones.map((r) => ({ concepto: r.descripcion, monto: r.monto, ...(r.vale ? { vale: r.vale } : {}) })),
    totalPercepciones: f.esperado.percepciones, totalDeducciones: f.esperado.deducciones, neto: f.esperado.neto,
  };
}

/** Quita la llave y enmascara cualquier correo (`a***@dominio`) de un texto que viene del proveedor. */
export function depurarDetalle(texto: string, llave?: string): string {
  let t = texto;
  if (llave && llave.length >= 6) t = t.split(llave).join('[llave]');
  t = t.replace(/re_[A-Za-z0-9_]{8,}/g, '[llave]');
  t = t.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2');
  return t.replace(/\s+/g, ' ').trim().slice(0, 160);
}

const DESTINO_VALIDO = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]{2,}$/;

export async function enviarPruebaDesglose(
  para: string,
  deps: DependenciasPruebaDesglose = DEPENDENCIAS_REALES,
): Promise<ResultadoPruebaDesglose> {
  const destino = (para ?? '').trim();
  if (!DESTINO_VALIDO.test(destino)) return { ok: false, linea: 'error: la dirección de destino no parece un correo' };
  if (!deps.configurado()) return { ok: false, linea: 'correo no configurado' };

  const bytes = generarDesgloseXlsx(datosDeFixture(DESGLOSE_SINTETICO));
  const { correo, nombreAdjunto } = armarCorreoDesglose({
    claveExterna: `BIT-PRUEBA-${DESGLOSE_SINTETICO.bitacora}`,
    periodoDesde: DESGLOSE_SINTETICO.desde,
    periodoHasta: DESGLOSE_SINTETICO.hasta,
  });
  const res = await deps.enviar(destino, { ...correo, asunto: `PRUEBA — ${correo.asunto}` }, {
    sobrio: true,
    adjuntos: [{ filename: nombreAdjunto, content: Buffer.from(bytes).toString('base64'), contentType: TIPO_XLSX }],
  });

  if (res.ok) return { ok: true, linea: `ok resend_id=${res.id}`, resendId: res.id };
  if (res.motivo === 'sin_configurar') return { ok: false, linea: 'correo no configurado' };
  const detalle = depurarDetalle(res.detalle, deps.llave);
  if (res.motivo === 'rechazado') {
    return { ok: false, linea: `error: rechazado${res.status ? ` (HTTP ${res.status})` : ''}${detalle ? ` — ${detalle}` : ''}` };
  }
  return { ok: false, linea: `error: red — ${detalle}` };
}
