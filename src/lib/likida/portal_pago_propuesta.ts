import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from './bitacora_escritura';
import type { PropuestaValida } from './portal_pago';

// ═══════════════════════════════════════════════════════════════════════════
// EL ÚNICO VERBO QUE ALCANZA UNA PETICIÓN ANÓNIMA.
//
// ── POR QUÉ VIVE SOLO, Y NO EN `portal_pago_escritura.ts` ────────────────
//
// Por lo mismo que `llave-api.ts` vive aparte de `llave-api-escritura.ts`: el
// camino caliente no puede depender de que la pantalla del panel no se haya
// desestabilizado. Aquí, además, se midió el costo de mezclarlos.
//
// `portal_pago_escritura.ts` importa `registrarPago` (para conciliar) y
// `esUuidValido` (de `intake/cfdi`), y esa cadena arrastra **sharp** y
// **zxing-wasm** — el OCR de comprobantes y el lector de códigos QR. Con los
// dos verbos en el mismo archivo, la ruta pública `/api/pago/registrar` los
// cargaba también, porque un `import` de ESM trae el módulo entero:
//
//     ruta mínima (`/api/marketing/evento`)   169 archivos · sin pesados
//     con todo junto                          265 archivos · sharp, zxing-wasm
//
// Noventa y seis archivos y dos binarios nativos de arranque en frío, en la
// única página que abre un tercero desde su teléfono para pagarle a la flota.
// La latencia de ese primer render es la diferencia entre que el cliente pague
// y que cierre la pestaña.
//
// Separarlos no es estética: `registrarPropuesta` no necesita NADA de eso —
// recibe una liga ya resuelta, así que ni siquiera valida un UUID.
//
// ── LA IDEMPOTENCIA ES DEL ÍNDICE, NO DE UN `if` ──────────────────────────
//
// No se pregunta "¿ya existe?" antes de insertar: entre la pregunta y el
// insert cabe el segundo clic. Se inserta, y si la base contesta 23505 sobre
// `portal_pago_propuesta_unica` (0228) se contesta "ya lo tenemos" en vez de un
// error. La ventana no existe porque no hay dos pasos.
//
// ── Y LO QUE NO HACE ──────────────────────────────────────────────────────
//
// No toca `pago_recibido`, no toca el estatus de la factura, no resta del
// saldo. Escribe en una tabla que la cartera, `factura_saldo` y el auditor de
// cobranza no leen. Lo que entra aquí es un DICHO del cliente, y espera a que
// un humano lo cruce contra su estado de cuenta.
// ═══════════════════════════════════════════════════════════════════════════

/** El código que Postgres devuelve al chocar contra un índice único. */
const CHOQUE_UNICO = '23505';

export type ResultadoPropuesta =
  | { ok: true; id: string; repetida: false }
  /** La misma fecha, monto y referencia ya estaban. No es un error: es el
   *  segundo clic, o el cliente comprobando que sí quedó. */
  | { ok: true; id: null; repetida: true }
  /** `limite: true` = se rebasó el tope de propuestas por hora (A37-L-06): la ruta contesta 429, no 503. */
  | { ok: false; motivo: string; limite?: true };

/** A37-L-06: tope de propuestas por LIGA y por FLOTA en la última hora (cada una manda un correo al contralor). */
export const TOPE_PROPUESTAS_LIGA_HORA = 5;
export const TOPE_PROPUESTAS_FLOTA_HORA = 60;

/**
 * Guarda lo que el cliente dice que pagó.
 *
 * NUNCA LANZA: quien la llama es una página pública, y una excepción ahí se
 * convierte en una pantalla de error genérica que no le dice al cliente si su
 * pago quedó registrado o no — que es la única pregunta que trae.
 */
export async function registrarPropuesta(
  liga: { ligaId: string; tenantId: string; facturaId: string },
  v: PropuestaValida,
): Promise<ResultadoPropuesta> {
  try {
    // El tope va ANTES del insert y del correo. Sin poder contar, no se registra (falla cerrado):
    // el cliente reintenta; lo que no se permite es un correo al contralor sin tope.
    const desde = new Date(Date.now() - 3_600_000).toISOString();
    const reciente = await acotada(supabaseAdmin().from('portal_pago_propuesta').select('liga_id')
      .eq('tenant_id', liga.tenantId).gte('registrada_en', desde).order('id').limit(TOPE_PROPUESTAS_FLOTA_HORA + 1), 'registrarPropuesta.tope');
    if (reciente.error) {
      logger.error('portal_pago.propuesta_tope', { err: reciente.error.message });
      return { ok: false, motivo: 'No pudimos registrar tu pago en este momento. Vuelve a intentarlo en unos minutos.' };
    }
    const filas = Array.isArray(reciente.data) ? (reciente.data as Array<{ liga_id?: unknown }>) : [];
    const deLaLiga = filas.filter((f) => String(f.liga_id) === liga.ligaId).length;
    if (deLaLiga >= TOPE_PROPUESTAS_LIGA_HORA || filas.length >= TOPE_PROPUESTAS_FLOTA_HORA) {
      logger.warn('portal_pago.propuesta_tope_rebasado', { tenant: liga.tenantId, deLaLiga, deLaFlota: filas.length });
      return { ok: false, limite: true, motivo: 'Ya hay varios pagos registrados por confirmar en esta factura. Espera a que quien te la emitió los revise, o escríbele directamente.' };
    }

    const { data, error } = await acotada(supabaseAdmin().from('portal_pago_propuesta').insert({
      tenant_id: liga.tenantId,
      liga_id: liga.ligaId,
      factura_id: liga.facturaId,
      fecha: v.fecha,
      monto: v.monto,
      referencia: v.referencia,
      metodo: v.metodo,
      estado: 'pendiente',
    }).select('id').single(), 'registrarPropuesta');

    if (error) {
      if (error.code === CHOQUE_UNICO) return { ok: true, id: null, repetida: true };
      logger.error('portal_pago.propuesta', { err: error.message });
      return { ok: false, motivo: 'No pudimos registrar tu pago en este momento. Vuelve a intentarlo en unos minutos.' };
    }
    const id = (data as { id?: unknown } | null)?.id;
    if (!id) {
      logger.error('portal_pago.propuesta', { err: 'el insert no devolvió id' });
      return { ok: false, motivo: 'No pudimos registrar tu pago en este momento. Vuelve a intentarlo en unos minutos.' };
    }

    // La bitácora del panel: el contralor tiene que poder ver el hecho aunque
    // el correo del aviso se pierda. El actor es `'sistema'` a propósito —no
    // hay una cuenta detrás, hay un tercero con un token.
    await anotarBitacora(
      {
        tenantId: liga.tenantId, actor: 'sistema',
        accion: 'portal_pago.propuesta_registrada',
        entidad: 'portal_pago_propuesta', entidadId: String(id),
        detalle: { facturaId: liga.facturaId, fecha: v.fecha, monto: v.monto, metodo: v.metodo },
      },
      { evento: 'portal_pago.bitacora_no_escribio' },
    );

    return { ok: true, id: String(id), repetida: false };
  } catch (e) {
    logger.error('portal_pago.propuesta', { err: e instanceof Error ? e.message : String(e) });
    return { ok: false, motivo: 'No pudimos registrar tu pago en este momento. Vuelve a intentarlo en unos minutos.' };
  }
}
