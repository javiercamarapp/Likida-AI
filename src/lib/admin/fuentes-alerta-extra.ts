// ═══════════════════════════════════════════════════════════════════════════
// FUENTES DE ALERTA EXTRA para `requiereAccion` (auditoría admin, 10-nov-2026).
//
// La campana de /admin solo sumaba las 6 fuentes de la bandeja de escalaciones.
// Lo que `/api/health` ya sabe (un cron sin latido, un cron con resultado no
// sano) y lo que apaga a TODA la IA (el crédito de OpenRouter agotado, 402) no
// aparecía en ninguna: el dueño se enteraba por un correo o por nadie.
//
// Esta es la parte PURA: recibe lo ya leído y devuelve alertas con la misma
// forma que `Alerta` de `calcular-alertas.ts` (`tipo`, `texto`, `href`), más un
// `id` estable y los `items` que la componen. NO consulta nada y NO está
// conectada a `requiere-accion.ts`: el integrador la enchufa. Para juntar la
// entrada hay `leerEntradaAlertasExtra()` (tolerante a fallos, nunca lanza).
//
// Reglas que replica de `/api/health` (para que campana y health no discrepen):
//   · muerto = `vencido` o `sin_latido`;
//   · no sano = latido al día pero `ultimoEstado !== 'ok'`;
//   · lo apagado A PROPÓSITO por palanca (`esApagadoPorInterruptor`) no es alerta;
//   · un hueco de configuración YA declarado (`esHuecoDeConfiguracion`) no es
//     una regresión y no suena aquí (tiene su propio canal semanal).
// `latidos === null` significa «no se pudo leer»: se DICE como alerta, nunca se
// convierte en «todo bien».
// ═══════════════════════════════════════════════════════════════════════════

import { alertasIaDeDetalle } from './alertas-ia';
import { esApagadoPorInterruptor, esHuecoDeConfiguracion, type EstadoLatido } from './salud';

export interface LatidoParaAlerta {
  estado: 'ok' | 'vencido' | 'sin_latido';
  haceMin: number | null;
  ultimoEstado: EstadoLatido | null;
  detalle: Record<string, unknown>;
}

export interface CredencialParaAlerta {
  abierto: boolean;
  clase: 'llave_invalida' | 'sin_saldo' | 'sin_permiso' | null;
}

export interface EntradaAlertasExtra {
  /** `null` = no se pudo leer `cron_latido`. */
  latidos: Readonly<Record<string, LatidoParaAlerta>> | null;
  /** Estado del circuito de credencial del proveedor de IA (por proceso), o `null` = sin dato. */
  credencial?: CredencialParaAlerta | null;
  /** Resultado de `sondearLlave()` si el integrador la corrió (más fiable que el circuito, que es por instancia). */
  sonda?: { estado: 'ok' | 'llave_invalida' | 'sin_saldo' | 'sin_llave' | 'inalcanzable' } | null;
}

export type IdAlertaExtra = 'cron_sin_latido' | 'cron_estado_no_ok' | 'crons_ilegibles' | 'ia_credito_agotado' | 'ia_sin_registro' | 'ia_respaldo_alto' | 'diagnostico_tope' | 'diagnostico_sin_gasto';

export interface AlertaExtra {
  id: IdAlertaExtra;
  tipo: 'atencion';
  texto: string;
  href: string;
  /** Qué la compone (ids de cron), para el detalle y para contar. */
  items: string[];
}

const HREF_CRONS = '/admin/crons';
const HREF_SALUD = '/admin/salud-sistema';

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

/** El texto del motivo del runner cuando la contrapresión lo frena (lo deja `evaluarLatidoRunner`). */
function motivoRunner(l: LatidoParaAlerta): string | null {
  const m = l.detalle.motivo;
  return typeof m === 'string' && m.trim() !== '' ? m.trim().slice(0, 200) : null;
}

/** Pura. Las alertas extra que hoy esperan a un humano; `[]` solo si se leyó todo y no hay nada. */
export function alertasExtra(e: EntradaAlertasExtra): AlertaExtra[] {
  const out: AlertaExtra[] = [];

  if (e.latidos === null) {
    out.push({
      id: 'crons_ilegibles', tipo: 'atencion', href: HREF_CRONS, items: [],
      texto: 'No se pudo leer el latido de los crons: no se sabe si alguno está caído.',
    });
  } else {
    const ids = Object.keys(e.latidos).sort();
    const vencidos = ids.filter((c) => e.latidos![c].estado === 'vencido');
    const sinLatido = ids.filter((c) => e.latidos![c].estado === 'sin_latido');
    const muertos = [...vencidos, ...sinLatido];
    if (muertos.length > 0) {
      const partes = [
        ...vencidos.map((c) => `${c} (hace ${e.latidos![c].haceMin ?? '?'} min)`),
        ...sinLatido.map((c) => `${c} (nunca latió)`),
      ];
      out.push({
        id: 'cron_sin_latido', tipo: 'atencion', href: HREF_CRONS, items: muertos,
        texto: `${plural(muertos.length, 'cron sin latido', 'crons sin latido')}: ${partes.join(', ')}.`,
      });
    }

    const noOk = ids.filter((c) => e.latidos![c].estado === 'ok' && e.latidos![c].ultimoEstado !== 'ok');
    const regresiones = noOk.filter((c) => {
      const l = e.latidos![c];
      if (esApagadoPorInterruptor(l.ultimoEstado, l.detalle)) return false;
      if (esHuecoDeConfiguracion(l.detalle)) return false;
      return true;
    });
    if (regresiones.length > 0) {
      const partes = regresiones.map((c) => {
        const l = e.latidos![c];
        const m = c === 'runner' ? motivoRunner(l) : null;
        return `${c} (${l.ultimoEstado ?? 'sin estado'})${m ? `: ${m}` : ''}`;
      });
      out.push({
        id: 'cron_estado_no_ok', tipo: 'atencion', href: HREF_CRONS, items: regresiones,
        texto: `${plural(regresiones.length, 'cron con resultado no sano', 'crons con resultado no sano')}: ${partes.join('; ')}.`,
      });
    }
  }

  const sinSaldo = e.sonda?.estado === 'sin_saldo' || (e.credencial?.abierto === true && e.credencial.clase === 'sin_saldo');
  if (sinSaldo) {
    out.push({
      id: 'ia_credito_agotado', tipo: 'atencion', href: HREF_SALUD, items: ['openrouter'],
      texto: 'Crédito de IA agotado (402): el proveedor rechaza toda llamada y la IA está caída. Recarga el saldo en OpenRouter.',
    });
  }

  // F16: lo que la guardia evaluó de la IA en su última pasada (solo existe con ALERTAS_IA_GUARDIA=encendido).
  const ia = e.latidos ? alertasIaDeDetalle(e.latidos.guardia?.detalle) : null;
  if (ia?.sinRegistro.estado === 'alerta') {
    out.push({
      id: 'ia_sin_registro', tipo: 'atencion', href: HREF_SALUD, items: ['llm_costo'],
      texto: `Sin una sola llamada de IA registrada en las últimas ${ia.sinRegistro.horas} h con ${plural(ia.sinRegistro.viajesAbiertos ?? 0, 'viaje abierto', 'viajes abiertos')}: la IA puede estar caída o el registro de costo roto.`,
    });
  }
  if (ia?.respaldo.estado === 'alerta') {
    out.push({
      id: 'ia_respaldo_alto', tipo: 'atencion', href: HREF_SALUD, items: Object.keys(ia.respaldo.porFase),
      texto: `${Math.round((ia.respaldo.tasa ?? 0) * 1000) / 10} % de las ${ia.respaldo.muestra} llamadas de IA de la última hora corrieron en el modelo de respaldo: el primario puede estar fallando.`,
    });
  }
  // F14-C: el diagnóstico de solo lectura se detuvo (tope mensual de IA o gasto ilegible). Solo existe con DIAGNOSTICO_ALERTAS=encendido.
  const dg = e.latidos?.guardia?.detalle?.diagnostico;
  const estadoDg = dg && typeof dg === 'object' ? (dg as Record<string, unknown>).estado : null;
  if (estadoDg === 'tope') {
    out.push({ id: 'diagnostico_tope', tipo: 'atencion', href: HREF_SALUD, items: ['diagnostico'], texto: 'El diagnóstico automático de alertas llegó a su tope mensual de IA y dejó de llamar al modelo hasta el mes siguiente.' });
  } else if (estadoDg === 'gasto_ilegible') {
    out.push({ id: 'diagnostico_sin_gasto', tipo: 'atencion', href: HREF_SALUD, items: ['diagnostico'], texto: 'El diagnóstico automático no puede medir su gasto de IA y por eso no llama al modelo (falla cerrado).' });
  }
  return out;
}

/** Cuántas alertas extra suman a la campana (cada alerta cuenta una vez, sin importar cuántos crons la componen). */
export function contarAlertasExtra(a: ReadonlyArray<AlertaExtra>): number {
  return a.length;
}

/**
 * La entrada, leída. NUNCA lanza: lo que no se pudo leer viaja como `null`
 * (y `alertasExtra` lo dice). `sondear: true` corre la sonda de la llave
 * (GET sin costo) — el circuito de credencial es por instancia de Vercel y
 * puede estar cerrado en la que atiende esta página aunque la llave esté muerta.
 */
export async function leerEntradaAlertasExtra(opts: { sondear?: boolean } = {}): Promise<EntradaAlertasExtra> {
  let latidos: EntradaAlertasExtra['latidos'] = null;
  try {
    const { detalleLatidos } = await import('./salud');
    latidos = await detalleLatidos();
  } catch { latidos = null; }

  let credencial: CredencialParaAlerta | null = null;
  let sonda: EntradaAlertasExtra['sonda'] = null;
  try {
    const m = await import('@/lib/llm/credencial');
    const c = m.estadoCredencial();
    credencial = { abierto: c.abierto, clase: c.clase };
    if (opts.sondear) sonda = await m.sondearLlave();
  } catch { /* sin dato: la alerta de crédito no suena, y tampoco afirma que todo esté bien */ }
  return { latidos, credencial, sonda };
}
