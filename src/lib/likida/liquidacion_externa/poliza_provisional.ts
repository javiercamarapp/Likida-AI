// ═══════════════════════════════════════════════════════════════════════════
// PÓLIZA PROVISIONAL (decisión del dueño, 10-nov-2026, punto 3).
//
// La muestra real del cliente no trae póliza. Por omisión un desglose sin póliza NO se guarda (`sin_poliza`). Esta perilla, POR FLOTA y
// apagada por omisión (`liquidacion_correo_config.poliza_provisional`, migración 1001), cambia solo eso:
//
//   · El desglose se guarda con la póliza `POLIZA_PROVISIONAL` (nunca se inventa una póliza real).
//   · SIEMPRE nace RETENIDO (sin entregas al operador/coordinador/RH): una persona que administra lo revisa y lo libera
//     (`liberarEnvio`). Nunca sale solo.
//   · Lleva la marca «póliza provisional» en el Excel, en el asunto y en el cuerpo del correo y en el encabezado (pantalla).
//   · Cuando llegue la póliza real, el desglose se reemplaza con una corrección (`-R<n>`).
//
// Falla cerrado: si la columna no existe o la lectura falla, la perilla vale `false` (todo sigue reteniéndose como antes).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { datoInvalido } from '../errores';

/** Lo que se guarda en `liquidacion_desglose.poliza` mientras no haya póliza real. Visible tal cual en pantalla. */
export const POLIZA_PROVISIONAL = 'PROVISIONAL';
/** Texto de la marca en pantalla, correo y Excel. */
export const MARCA_POLIZA_PROVISIONAL = 'póliza provisional';
/** Motivo de retención que se guarda en el encabezado (empieza por la marca para reconocerlo). */
export const MOTIVO_POLIZA_PROVISIONAL = 'Póliza provisional: pendiente de revisión humana antes de enviar.';

export const esPolizaProvisional = (poliza: string | null | undefined): boolean => poliza === POLIZA_PROVISIONAL;

type ErrorPg = { message?: string; code?: string } | null;
const faltaColumna = (e: ErrorPg): boolean => !!e && /poliza_provisional/.test(e.message ?? '');

/**
 * Lectura medida: `true`/`false`, o `null` si NO se pudo leer (el asistente «¿estoy listo?» dice «sin dato»). Una base sin la columna
 * (migración 1001 pendiente) es `false`: la perilla no puede estar encendida.
 */
export async function medirPolizaProvisional(tenantId: string): Promise<boolean | null> {
  try {
    const res = await acotada(supabaseAdmin().from('liquidacion_correo_config')
      .select('poliza_provisional').eq('tenant_id', tenantId).maybeSingle(), 'liqcorreo.poliza_provisional_leer');
    const r = res as unknown as { data: { poliza_provisional?: unknown } | null; error: ErrorPg };
    if (r.error) {
      if (faltaColumna(r.error)) return false;
      logger.warn('liqcorreo.poliza_provisional_lectura_fallo', { codigo: r.error.code ?? null });
      return null;
    }
    return r.data?.poliza_provisional === true;
  } catch (e) {
    logger.warn('liqcorreo.poliza_provisional_lectura_fallo', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** ¿La flota liberó las liquidaciones sin póliza como «provisionales»? Cualquier duda ⇒ `false` (se sigue reteniendo). */
export async function leerPolizaProvisional(tenantId: string): Promise<boolean> {
  return (await medirPolizaProvisional(tenantId)) === true;
}

/** Enciende o apaga la perilla. Requiere que la flota ya tenga su fila de configuración de correo. Queda en el log con el actor. */
export async function guardarPolizaProvisional(tenantId: string, valor: boolean, por: string | null): Promise<void> {
  const res = await acotada(supabaseAdmin().from('liquidacion_correo_config')
    .update({ poliza_provisional: valor }).eq('tenant_id', tenantId).select('tenant_id'), 'liqcorreo.poliza_provisional_guardar');
  const r = res as unknown as { data: unknown[] | null; error: ErrorPg };
  if (r.error) {
    if (faltaColumna(r.error)) throw datoInvalido('poliza_provisi.falta_aplicar_la_migracion_1001');
    throw new Error(`liqcorreo.poliza_provisional_guardar: ${r.error.message ?? 'error'}`);
  }
  if (!r.data || r.data.length === 0) throw datoInvalido('poliza_provisi.esta_flota_aun_no_tiene');
  logger.info('liqcorreo.poliza_provisional_cambio', { tenantId, valor, por });
}
