import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { decidirInicio, type ViajeAsignado } from './inicio_viaje';

// ═══════════════════════════════════════════════════════════════════════════
// EL PEGAMENTO ENTRE "SE LE AVISÓ" Y "DIJO QUE SÍ".
//
// `inicio_viaje.ts` decide qué significa lo que contestó el chofer y es PURO —
// no toca base ni WhatsApp, y por eso se pudo probar con 161 casos. Aquí va lo
// otro: buscar qué viajes tiene sin confirmar y dejar constancia cuando acepta.
//
// ── ACEPTAR NO SIEMPRE ES CONTESTAR ──────────────────────────────────────
//
// El hueco que cierra `aceptarPorActividad`: un chofer que ignora la pregunta y
// se pone a mandar fotos ESTÁ trabajando el viaje. Sin esto, a las 5 h la
// escalación le dice al jefe "tu chofer no confirmó" mientras el chofer lleva
// ocho tickets mandados — y el jefe le habla para regañarlo por algo que sí
// hizo. Una foto es una aceptación más fuerte que un "va": es trabajo hecho.
//
// ── POR QUÉ NO SE ELIGE POR ÉL ───────────────────────────────────────────
//
// Con dos viajes asignados y un "sí" pelón, `decidirInicio` devuelve `ambiguo`
// a propósito y aquí no se corrige. Arrancar el que no era mete los
// comprobantes de una ruta en la liquidación de otra, y eso se descubre hasta
// el cuadre, con el papel ya entregado.
// ═══════════════════════════════════════════════════════════════════════════

/** Los viajes que se le avisaron y todavía no acepta. */
export async function viajesPorConfirmar(tenantId: string, operadorId: string): Promise<ViajeAsignado[]> {
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('id, folio, origen, destino')
    .eq('tenant_id', tenantId)
    .eq('operador_id', operadorId)
    .eq('estatus', 'abierto')
    .is('aceptado_en', null)
    .not('avisado_en', 'is', null)
    .order('avisado_en', { ascending: true })
    .limit(10);

  // FALLA CERRADO. Si esto devolviera [] ante un error, el chofer que contesta
  // "va" recibiría "no tienes viajes asignados" teniendo uno — y el operador
  // lee eso como que la oficina no lo dio de alta.
  if (error) throw new Error(`viajesPorConfirmar: ${error.message}`);

  return (data ?? []).map((v) => ({
    id: v.id as string,
    folio: (v.folio as string) ?? null,
    origen: (v.origen as string) ?? null,
    destino: (v.destino as string) ?? null,
  }));
}

/**
 * Deja constancia de que aceptó. `false` = ya estaba aceptado o no se pudo.
 *
 * El `is('aceptado_en', null)` no es paranoia: dos mensajes seguidos del chofer
 * ("va" y luego una foto) llegan como dos invocaciones del webhook, y sin el
 * guardia la segunda reescribiría la hora de aceptación. La hora que vale es la
 * primera — es la que mide cuánto tardó en contestar.
 *
 * ── `operadorId` ES OPCIONAL EN LA FIRMA Y OBLIGATORIO EN LA PRÁCTICA ─────
 *
 * Corre con `supabaseAdmin()` (salta RLS) y hasta ahora filtraba por
 * `(id, tenant_id)` y nada más. Eso le bastaba a su único llamador —el
 * webhook, donde el viaje ya lo eligió `viajesPorConfirmar` a partir del
 * TELÉFONO de quien escribió, así que el uuid nunca viene de fuera—, pero
 * deja la función lista para el error caro: el día que un formulario web
 * mande el `viajeId`, un chofer marcaría como aceptado el viaje de un
 * compañero cambiando un uuid, y la escalación de las 5 h dejaría de avisarle
 * al jefe que ESE otro nunca contestó.
 *
 * Se acota por operador SIEMPRE que se sepa quién es. `atenderConfirmacion`
 * ya lo tiene en sus args y desde hoy lo pasa; `aceptarPorActividad` lo
 * acepta y lo reenvía, aunque su llamador de `processor.ts` todavía no se lo
 * dé —ese archivo no se toca en esta tarea—, así que ahí el filtro sigue sin
 * aplicarse y sigue estando bien: el viaje viene de `getOpenViaje(tenantId,
 * operadorId)`, no de la red.
 *
 * Opcional en el TIPO para no romper a ese llamador. Un `undefined` NO se
 * traduce a `.eq('operador_id', undefined)`: la rama se salta entera, porque
 * un `.eq()` contra undefined no filtra menos, filtra mal.
 */
export async function marcarAceptado(
  tenantId: string,
  viajeId: string,
  operadorId?: string,
): Promise<boolean> {
  let q = supabaseAdmin()
    .from('viaje')
    .update({ aceptado_en: new Date().toISOString() })
    .eq('id', viajeId)
    .eq('tenant_id', tenantId);

  if (operadorId) q = q.eq('operador_id', operadorId);

  const { data, error } = await q.is('aceptado_en', null).select('id');

  if (error) {
    logger.warn('viaje.no_se_marcó_aceptado', { viajeId, err: error.message });
    return false;
  }
  return (data ?? []).length > 0;
}

/**
 * Mandar un comprobante ES aceptar el viaje.
 *
 * Best-effort y silencioso: el gasto ya está guardado y el chofer ya tuvo su
 * acuse. Que esto falle no puede costarle el comprobante.
 *
 * `operadorId` es opcional porque `processor.ts` (que no se toca aquí) llama
 * con dos argumentos. Cuando llegue, se reenvía y el UPDATE queda acotado
 * también por chofer; mientras tanto, ahí el `viajeId` sale de
 * `getOpenViaje(tenantId, operadorId)` y no de un formulario.
 */
export async function aceptarPorActividad(
  tenantId: string,
  viajeId: string,
  operadorId?: string,
): Promise<void> {
  try {
    const marcado = await marcarAceptado(tenantId, viajeId, operadorId);
    if (marcado) logger.info('viaje.aceptado_por_actividad', { viajeId });
  } catch (e) {
    logger.warn('viaje.aceptar_por_actividad_falló', { viajeId, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface ResultadoConfirmacion {
  /** Qué contestarle. `null` = no había nada que confirmar; sigue su camino. */
  mensaje: string | null;
  /** El viaje que quedó arrancado, si lo hubo. */
  viajeConfirmado?: string;
}

/**
 * Atiende la respuesta del chofer a la pregunta de inicio.
 *
 * Devuelve `mensaje: null` cuando NO hay viajes por confirmar — y ese caso es la
 * mayoría: la inmensa mayoría de los mensajes de un chofer llegan con su viaje
 * ya arrancado. Este atajo tiene que quitarse del camino sin costar nada.
 */
export async function atenderConfirmacion(args: {
  tenantId: string;
  operadorId: string;
  texto: string;
  /**
   * El viaje que el chofer ya trae andando, si hay uno.
   *
   * ES UN GUARDIA, no un adorno. Sin él, a un chofer que va a la mitad del
   * viaje A y recibe la asignación del viaje B se le secuestraría CADA mensaje
   * con la pregunta de confirmación de B — incluido su "ya terminé" del A. Se
   * confirma solo cuando el viaje sin aceptar es el que tiene enfrente, o
   * cuando no trae ninguno.
   */
  viajeActual?: string | null;
  /** 1 = primera respuesta. Ver `ArgsInicio.intento`. */
  intento?: number;
}): Promise<ResultadoConfirmacion> {
  const viajes = await viajesPorConfirmar(args.tenantId, args.operadorId);
  if (viajes.length === 0) return { mensaje: null };
  if (args.viajeActual && !viajes.some((v) => v.id === args.viajeActual)) {
    return { mensaje: null };
  }

  const d = decidirInicio({
    viajesAsignados: viajes,
    respuesta: args.texto,
    intento: args.intento,
  });

  if (d.estado === 'confirmado' && d.viajeElegido) {
    // `args.operadorId` va al UPDATE aunque `viajesPorConfirmar` ya filtró por
    // él: si un día `decidirInicio` devolviera un id que no salió de esa lista,
    // el filtro de la base es lo que impide que se marque el viaje de otro.
    const ok = await marcarAceptado(args.tenantId, d.viajeElegido, args.operadorId);
    logger.info('viaje.confirmado_por_chofer', { viajeId: d.viajeElegido, primeraVez: ok });
    return { mensaje: d.mensaje, viajeConfirmado: d.viajeElegido };
  }

  logger.info('viaje.confirmacion', { estado: d.estado, asignados: viajes.length });
  return { mensaje: d.mensaje };
}
