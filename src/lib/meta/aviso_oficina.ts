import { enviarTexto, sendTemplate, motivoDeFalloWhatsApp } from './client';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE LIKIDA INICIA HACIA LA OFICINA sale por AQUÍ, no por `sendText`.
//
// AUDITORÍA 24 · AGEN-5 / WA-4 (ALTO). El jefe de una flota de 800 tractos
// RECIBE, no escribe: despacha desde el panel y su número puede llevar días
// sin mandarle nada al de Likida. Fuera de la ventana de 24 h, Meta rechaza
// el texto libre con 131047 («Re-engagement message»); `sendText` lo traga
// con un `logger.error` y devuelve `null`; `esReintentableMeta(131047)` es
// `false`, así que tampoco entra al outbox. Resultado: la ubicación del chofer
// varado a las 02:00, el «sigue reportando LESIONADOS» y el «esta liquidación
// requiere tu decisión» se apagaban en silencio — mientras al chofer se le
// afirmaba «ya se la pasé a tu jefe».
//
// `escalar_viaje.ts` y `facturacion/avisar.ts` ya aprendieron la lección
// (texto → si falla, plantilla). Esto es ese mismo patrón en UN solo lugar,
// para que los caminos escritos después no lo vuelvan a olvidar.
//
// ── QUÉ DEVUELVE ─────────────────────────────────────────────────────────
// Nunca lanza. `ok:true` solo si Meta ACEPTÓ el texto o la plantilla; con
// `via` para el log. `ok:false` trae el motivo en palabras y `fueraDeVentana`
// cuando el texto rebotó por la ventana y la plantilla tampoco salió — es lo
// que el llamador necesita para NO decirle al chofer «ya se la pasé».
//
// ── LA PLANTILLA ─────────────────────────────────────────────────────────
// `aviso_operacion_v1` (utility): {{1}} = chofer, {{2}} = resumen ≤ 60 chars,
// {{3}} = liga (panel o mapa). Es UNA plantilla genérica para todos los avisos
// operativos que Likida inicia hacia la oficina, para no pedirle a Meta una
// por evento. Hasta que esté aprobada, Meta contesta 132001 y esto devuelve
// `ok:false` con ese motivo: fail-closed y dicho, nunca «ya se la pasé».
// Se puede apuntar a otro nombre con `WHATSAPP_PLANTILLA_AVISO_OFICINA`.
//
// Si la PLANTILLA rebota por un motivo reintentable (429, plantilla pausada),
// `sendTemplate` ya la deja en `wa_outbox` con su payload de plantilla: el
// cron la reintenta con backoff. El texto rechazado por 131047 NO se encola
// a propósito — reintentar texto fuera de ventana falla igual siempre.
// ═══════════════════════════════════════════════════════════════════════════

/** Rechazos de Meta que significan «fuera de la ventana de 24 h / el
 *  destinatario no abrió conversación»: solo una plantilla los atraviesa.
 *  Mismo trío que ya usa `enviarRespuestaArco` (`client.ts`). */
export const CODIGOS_FUERA_VENTANA: readonly number[] = [131047, 131026, 131042];

export function esFueraDeVentana(codigo?: number): boolean {
  return codigo !== undefined && CODIGOS_FUERA_VENTANA.includes(codigo);
}

export const PLANTILLA_AVISO_OFICINA_DEFAULT = 'aviso_operacion_v1';

export function plantillaAvisoOficina(): string {
  const v = process.env.WHATSAPP_PLANTILLA_AVISO_OFICINA?.trim();
  return v || PLANTILLA_AVISO_OFICINA_DEFAULT;
}

/** Tope del {{2}} de la plantilla: Meta rechaza parámetros largos y el
 *  cuerpo aprobado está pensado para una línea. */
export const MAX_RESUMEN_PLANTILLA = 60;

/** Los tres parámetros de `aviso_operacion_v1`, con el resumen recortado. */
export function parametrosAvisoOficina(chofer: string, resumen: string, liga: string): [string, string, string] {
  const r = resumen.replace(/\s+/g, ' ').trim();
  const corto = r.length > MAX_RESUMEN_PLANTILLA ? `${r.slice(0, MAX_RESUMEN_PLANTILLA - 1)}…` : r;
  return [chofer.trim() || 'Tu chofer', corto || 'aviso de operación', liga];
}

export type ResultadoAvisoOficina =
  | { ok: true; via: 'texto' | 'plantilla'; id: string | null }
  | { ok: false; motivo: string; codigo?: number; fueraDeVentana: boolean };

/**
 * Texto libre al jefe; si Meta lo rechaza por ventana cerrada, la plantilla.
 *
 * `parametros` son los de `parametrosAvisoOficina`. `plantilla` se puede
 * sobrescribir para los caminos que ya tienen la suya aprobada.
 */
export async function avisarOficina(
  telefono: string,
  texto: string,
  opciones: { parametros: [string, string, string]; plantilla?: string; contexto?: Record<string, unknown> },
): Promise<ResultadoAvisoOficina> {
  const ctx = opciones.contexto ?? {};
  const t = await enviarTexto(telefono, texto);
  if (t.ok) return { ok: true, via: 'texto', id: t.id };

  if (!esFueraDeVentana(t.codigo)) {
    // Rechazo que NO es de ventana (rate limit, número inválido, red): si es
    // reintentable ya quedó en el outbox; una plantilla no lo arreglaría.
    return { ok: false, motivo: t.codigo !== undefined ? motivoDeFalloWhatsApp(t.error, t.codigo) : t.error, codigo: t.codigo, fueraDeVentana: false };
  }

  const plantilla = opciones.plantilla ?? plantillaAvisoOficina();
  logger.info('aviso_oficina.fuera_de_ventana', { ...ctx, codigo: t.codigo, plantilla });
  const p = await sendTemplate(telefono, plantilla, { parametros: opciones.parametros });
  if (p.ok) return { ok: true, via: 'plantilla', id: p.id };

  const motivo = motivoDeFalloWhatsApp(p.error, p.codigo);
  logger.error('aviso_oficina.no_entregado', { ...ctx, codigoTexto: t.codigo, codigoPlantilla: p.codigo, plantilla, motivo });
  return { ok: false, motivo, codigo: p.codigo, fueraDeVentana: true };
}
