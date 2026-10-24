import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { decidirInicio, type EstadoInicio, type ViajeAsignado } from './inicio_viaje';
import { armarInstrucciones, puertosAsignacionReales, SIN_DATOS } from './conductor/asignacion';
import { preguntarGastosAlAceptar } from './conductor/gastos_etc';
import { cargarViajeContexto, leerConfigConductor } from './conductor/repo';
import { telefonoJefeDe } from './contactos';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';

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
//
// ── ACEPTAR POR TEXTO O POR FOTO TAMBIÉN MANDA LAS INSTRUCCIONES ─────────
//
// T-A5-47 (`conductor/asignacion.ts`) le puso instrucciones (caja, cita,
// rutas) y la pregunta de gastos/ETC a la aceptación por BOTÓN, pero esos dos
// caminos — éste y `aceptarPorActividad` — seguían marcando `aceptado_en` y
// callándose: un chofer con la perilla `asignacionBotonesActiva` encendida que
// ignora el botón y escribe "sí" (o manda su primer ticket) quedaba con el
// viaje aceptado y SIN caja, SIN cita, SIN rutas y SIN la pregunta de gastos —
// nada en el log lo delataba, porque "aceptado" sí quedó escrito.
// `enviarInstruccionesSiBotonesActivo` (abajo) cierra ese hueco llamando a las
// MISMAS `armarInstrucciones`/`preguntarGastosAlAceptar` que usa el botón, con
// el MISMO guardia: solo corre cuando la llamada de ESTE turno fue la que
// marcó `aceptado_en` (el `is('aceptado_en', null)` de `marcarAceptado`), así
// que un segundo "sí" o una segunda foto del mismo viaje no reenvían nada.
//
// Sin la perilla, nada cambia: `armarInstrucciones` nació detrás de ella (fase
// 2, apagada por omisión) y aquí sigue igual — no se le inventa una
// instrucción a una flota que no pidió el flujo de botones.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que hace `responderAsignacion` al aceptar por BOTÓN (`conductor/asignacion.ts`), para la aceptación por TEXTO
 * o por FOTO: instrucciones + pregunta de gastos/ETC. Nunca lanza — el viaje YA quedó aceptado, así que esto fallar
 * no le puede costar la confirmación al chofer. No hace nada si la flota no tiene `asignacionBotonesActiva` (el
 * comportamiento de siempre) o si no se pudo leer el viaje o su teléfono.
 */
async function enviarInstruccionesSiBotonesActivo(tenantId: string, viajeId: string, ahora: Date): Promise<void> {
  try {
    const config = await leerConfigConductor(tenantId);
    if (config.asignacionBotonesActiva !== true) return;

    const v = await cargarViajeContexto(tenantId, viajeId);
    if (!v) {
      logger.warn('viaje.instrucciones_fuera_de_boton_sin_viaje', { viajeId });
      return;
    }
    if (!v.operadorTelefono) {
      logger.warn('viaje.instrucciones_fuera_de_boton_sin_telefono', { viajeId });
      return;
    }

    const p = puertosAsignacionReales();
    let datos = SIN_DATOS;
    try {
      datos = await p.datos(v);
    } catch (err) {
      // Sin caja/rutas no se retiene nada: las instrucciones salen diciendo «por confirmar» (mismo criterio que el botón).
      logger.warn('conductor.asignacion_datos_fallo', { viaje: v.id, err: err instanceof Error ? err.message : String(err) });
    }
    const m = armarInstrucciones(v, datos, config.patioQueManda, ahora);
    await p.enviar(v.operadorTelefono, m, 'conductor.asignacion_instrucciones', tenantId, ahora);
    await p.convenio(tenantId, viajeId).catch((err) => logger.warn('conductor.asignacion_convenio_fallo', { viaje: viajeId, err: err instanceof Error ? err.message : String(err) }));
    await preguntarGastosAlAceptar(p.enviar, config, v, v.operadorTelefono, ahora);
  } catch (err) {
    logger.warn('viaje.instrucciones_fuera_de_boton_fallo', { viajeId, err: err instanceof Error ? err.message : String(err) });
  }
}

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
 * Deja constancia de que el chofer dijo EXPLÍCITAMENTE que no.
 *
 * AUDITORÍA A8 ESCALACIÓN (hallazgo confirmado, la otra mitad del hueco del
 * "sí"): `armarRecordatorioChofer` (escalar_viaje.ts) le promete al chofer
 * "con cualquiera de las dos [sí o no] le aviso a tu encargado", pero hasta
 * esta migración (0855) nada escribía NADA cuando contestaba que no — ni un
 * campo en la base, ni un evento — y la escalación de las 5 h lo trataba como
 * "no contestó", perdiendo que SÍ contestó y dijo que no.
 *
 * `viajeIds` son los que trae `viajesPorConfirmar` al momento del "no": uno
 * si solo tenía uno asignado, varios si "niega" los que se le enseñaron
 * (`inicio_viaje.ts`: "entonces ninguno de esos").
 *
 * MISMO CANDADO QUE `marcarAceptado`: `is('aceptado_en', null)` evita que una
 * carrera entre el "no" que acaba de llegar y una aceptación que ganó por
 * otro camino (p. ej. `aceptarPorActividad` con una foto que se cruzó) marque
 * como rechazado un viaje que de hecho ya se aceptó. `is('rechazado_en',
 * null)` lo hace idempotente: un segundo "no" del mismo chofer no reescribe
 * la hora.
 *
 * Devuelve los ids que SÍ se marcaron (pueden ser menos que `viajeIds` si
 * alguno ya estaba aceptado o ya rechazado).
 */
export async function marcarRechazados(
  tenantId: string,
  viajeIds: string[],
  operadorId?: string,
): Promise<string[]> {
  if (viajeIds.length === 0) return [];

  let q = supabaseAdmin()
    .from('viaje')
    .update({ rechazado_en: new Date().toISOString() })
    .in('id', viajeIds)
    .eq('tenant_id', tenantId);

  if (operadorId) q = q.eq('operador_id', operadorId);

  const { data, error } = await q.is('aceptado_en', null).is('rechazado_en', null).select('id');

  if (error) {
    logger.warn('viaje.no_se_marcó_rechazado', { viajeIds, err: error.message });
    return [];
  }
  return (data ?? []).map((v) => v.id as string);
}

/** A dónde manda el aviso al jefe el panel de despacho (mismo destino que las
 *  plantillas N08-N10 del Agente 5 Conductor, `plantillas_catalogo.ts`). */
const LIGA_DESPACHO = 'https://app.likida.ai/dashboard/despacho';

/**
 * CASO "SÍ" del hueco de A8: el jefe se quedaba con el aviso viejo de "no ha
 * confirmado, conviene reasignarlo" sin que nadie le dijera que el chofer SÍ
 * confirmó — con riesgo real de reasignar un viaje que ya va en curso.
 *
 * BEST-EFFORT Y SILENCIOSO: el viaje YA quedó aceptado (lo hace el llamador
 * antes de llamar aquí); que este aviso falle no le puede costar la
 * confirmación al chofer. Mismo canal que usa el resto del repo para avisos
 * que LIKIDA INICIA hacia la oficina (`avisarOficina`, el selector
 * texto→plantilla de `aviso_oficina.ts`: `aviso_operacion_v1` fuera de la
 * ventana de 24 h), no `sendText` directo.
 */
async function avisarJefeConfirmo(tenantId: string, viajeId: string, ahora: Date): Promise<void> {
  try {
    // A37-S39-06: el viaje se lee primero para avisar al jefe de SU patio.
    const v = await cargarViajeContexto(tenantId, viajeId);
    const tel = await telefonoJefeDe(tenantId, v?.terminalId ?? null);
    if (!tel) return;
    const chofer = v?.operadorNombre ?? 'Tu chofer';
    const folio = v?.folio ?? 'sin folio';
    const texto = `${chofer} ya confirmó el viaje ${folio}: va en curso. No hace falta reasignarlo.`;
    await avisarOficina(tel, texto, {
      parametros: parametrosAvisoOficina(chofer, `confirmó ${folio}: ya va en curso`, LIGA_DESPACHO),
      contexto: { tenantId, agente: 'conductores.confirmacion' },
      ahora,
    });
  } catch (e) {
    logger.warn('viaje.aviso_jefe_confirmo_fallo', { viajeId, err: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * CASO "NO" del hueco de A8: el chofer contestó EXPLÍCITAMENTE que no le
 * toca. Sin esto el jefe no se entera hasta que el reloj de 5 h lo trata como
 * "no contestó" — perdiendo que SÍ contestó y dijo que no. Avisar de
 * inmediato le deja reasignar ahora, no cinco horas después.
 *
 * Mismo criterio best-effort/silencioso y mismo canal que `avisarJefeConfirmo`.
 */
async function avisarJefeRechazo(tenantId: string, viajes: ViajeAsignado[], ahora: Date): Promise<void> {
  if (viajes.length === 0) return;
  try {
    // El operador es el mismo para todos los de esta lista (viene de
    // `viajesPorConfirmar`, acotada por operador); el nombre se lee del primero.
    // A37-S39-06: el patio también se toma del primero, para avisar al jefe de ese patio.
    const v = await cargarViajeContexto(tenantId, viajes[0].id);
    const tel = await telefonoJefeDe(tenantId, v?.terminalId ?? null);
    if (!tel) return;
    const chofer = v?.operadorNombre ?? 'Tu chofer';
    const folios = viajes.map((x) => x.folio ?? x.id.slice(0, 8));
    const texto = viajes.length === 1
      ? `${chofer} dijo que NO le toca el viaje ${folios[0]}. Puedes reasignarlo desde ahora.`
      : `${chofer} dijo que NO le tocan estos viajes: ${folios.join(', ')}. Puedes reasignarlos desde ahora.`;
    const resumen = viajes.length === 1
      ? `dijo que NO le toca ${folios[0]}: reasígnalo`
      : `dijo que no le tocan ${viajes.length} viajes: reasígnalos`;
    await avisarOficina(tel, texto, {
      parametros: parametrosAvisoOficina(chofer, resumen, LIGA_DESPACHO),
      contexto: { tenantId, agente: 'conductores.rechazo' },
      ahora,
    });
  } catch (e) {
    logger.warn('viaje.aviso_jefe_rechazo_fallo', { viajes: viajes.map((x) => x.id), err: e instanceof Error ? e.message : String(e) });
  }
}

// T-A5-47: el botón «Acepto el viaje» de la plantilla N01. Vive en `conductor/repo.ts` (la frontera de datos del Conductor); se reexporta aquí
// porque es la otra mitad de «confirmar el viaje» (esta función es la aceptación por texto; aquélla, por botón).
export { aceptarPorBoton, type ResultadoAceptarPorBoton } from './conductor/repo';

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
    if (marcado) {
      logger.info('viaje.aceptado_por_actividad', { viajeId });
      // Mismo cierre del hueco que atenderConfirmacion, para quien acepta mandando la foto (ver el bloque de arriba).
      await enviarInstruccionesSiBotonesActivo(tenantId, viajeId, new Date());
    }
  } catch (e) {
    logger.warn('viaje.aceptar_por_actividad_falló', { viajeId, err: e instanceof Error ? e.message : String(e) });
  }
}

export interface ResultadoConfirmacion {
  /** Qué contestarle. `null` = no había nada que confirmar; sigue su camino. */
  mensaje: string | null;
  /** El viaje que quedó arrancado, si lo hubo. */
  viajeConfirmado?: string;
  /**
   * En qué quedó la máquina de `inicio_viaje.ts`. `undefined` = no se llegó a
   * consultar (no había nada que confirmar).
   *
   * SE DEVUELVE PARA QUE EL LLAMADOR PUEDA CONTAR LOS INTENTOS. Sin esto, la
   * única forma de saber si se le volvió a preguntar era mirar el TEXTO del
   * mensaje con un regex — y ese regex no empataba con ninguno de los mensajes
   * reales, así que el contador nunca subía y el freno del segundo intento
   * (`dudar`, `intento >= 2`) era inalcanzable: el chofer recibía "Perdón, no te
   * entendí" indefinidamente. El estado es un dato, no una lectura del texto.
   */
  estado?: EstadoInicio;
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
    if (ok) {
      // Mismo cierre del hueco que aceptarPorActividad, para quien acepta escribiendo "sí" / "va" (ver el bloque de arriba).
      await enviarInstruccionesSiBotonesActivo(args.tenantId, d.viajeElegido, new Date());
      // AUDITORÍA A8 ESCALACIÓN (hallazgo confirmado, caso "SÍ"): sin esto el
      // jefe se queda con el aviso viejo de "no ha confirmado, conviene
      // reasignarlo" sin saber que SÍ confirmó. Solo la PRIMERA vez (`ok`
      // viene del `is('aceptado_en', null)` de `marcarAceptado`): un segundo
      // "sí" del mismo chofer no manda un segundo aviso.
      await avisarJefeConfirmo(args.tenantId, d.viajeElegido, new Date());
    }
    return { mensaje: d.mensaje, viajeConfirmado: d.viajeElegido, estado: d.estado };
  }

  // ── DIJO QUE NO (AUDITORÍA A8 ESCALACIÓN, hallazgo confirmado, caso "NO") ──
  //
  // `viajes.length === 0` ya se filtró arriba (return temprano), así que
  // `d.estado === 'sin_viaje'` AQUÍ solo puede venir de la rama `niega` de
  // `decidirInicio` — es la única que lo devuelve con la lista no vacía
  // (`inicio_viaje.ts`). Antes NADA pasaba: ni se escribía un campo en la
  // base ni se avisaba al jefe, y la escalación de las 5 h lo trataba como
  // "no contestó", perdiendo que SÍ contestó y dijo que no.
  if (d.estado === 'sin_viaje') {
    const ids = viajes.map((v) => v.id);
    const marcados = await marcarRechazados(args.tenantId, ids, args.operadorId);
    logger.info('viaje.rechazado_por_chofer', { viajes: marcados, total: ids.length });
    // Solo si ALGUNO se marcó de verdad (primera vez): evita un segundo aviso
    // al jefe si el chofer repite el "no" sobre lo mismo.
    if (marcados.length > 0) await avisarJefeRechazo(args.tenantId, viajes, new Date());
    return { mensaje: d.mensaje, estado: d.estado };
  }

  logger.info('viaje.confirmacion', { estado: d.estado, asignados: viajes.length });
  return { mensaje: d.mensaje, estado: d.estado };
}
