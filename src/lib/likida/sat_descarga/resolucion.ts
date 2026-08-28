// ═══════════════════════════════════════════════════════════════════════════
// LOS CUATRO ACTOS DEL CONTRALOR SOBRE UN CFDI BAJADO DEL SAT (0243).
//
//   · LIGAR    — «este comprobante es de este gasto». Es la afirmación que
//                mueve dinero deducible, y por eso es un ACTO HUMANO FIRMADO:
//                el motor propone candidatos y se calla.
//   · IGNORAR  — «este comprobante no me interesa», con motivo. No se borra:
//                se archiva diciendo por qué.
//   · REVERTIR — deshacer un ligado o un ignorado. La reversión SE ANOTA
//                (quién y cuándo), no se borra: corregir es anotar, mismo
//                criterio que `jornada_asiento` (0241).
//   · (y el cuarto no es de nadie: 'degradado', el que escribe la base cuando
//      el gasto se borra — trigger de la 0236, ampliado por la 0243.)
//
// ─────────────────────────────────────────────────────────────────────────
// LO QUE ESTE ARCHIVO NO HACE, Y ES DELIBERADO
//
//  · NO INVENTA UN GASTO. Un CFDI 'disponible' sin gasto que le corresponda es
//    un hallazgo —alguien gastó y nadie lo reportó—, no un formulario de alta.
//    Desde aquí se liga a un gasto QUE YA EXISTE o se archiva; crear el gasto
//    es otro acto, en otra pantalla, con otro dueño.
//  · NO AFLOJA `sat_cfdi_descargado_casado_coherente`. Ese CHECK es lo que
//    impide afirmar un cruce que no existe. Cada escritura de aquí mueve
//    `estatus` y `gasto_id` EN EL MISMO UPDATE, así que la fila nunca pasa por
//    el estado intermedio que el CHECK prohíbe.
//  · NO PISA UN COMPROBANTE QUE YA ESTABA. Ligar reusa la misma guardia
//    optimista del camino automático (`.is('cfdi_uuid', null)`): si entre que
//    la pantalla se pintó y el botón se apretó alguien más le pegó su XML a
//    ese ticket, el update no afecta ninguna fila y SE DICE.
//
// LA CARRERA ENTRE DOS CONTRALORES la decide la base, no un `if`: todos los
// UPDATE van anclados al estatus que se leyó (`.eq('estatus', anterior)`), así
// que el segundo no encuentra fila y vuelve «alguien lo resolvió antes»
// —jamás un éxito silencioso que pisa al primero—. Mismo patrón que
// `resolverLineaAMano` (0076) y `aprobarPieza` (0120).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import { correoDelUsuario } from '@/lib/likida/jornada/firma';
import { DatoInvalido } from '../errores';
import { candidatosAnotados, type EstatusCfdi } from './bandeja';

/** Quién firma. El correo NO se recibe del navegador: se resuelve del uuid de
 *  la sesión (`correoDelUsuario`), porque una firma que el cliente puede
 *  dictar no es una firma. */
export interface ActorResolucion {
  id: string;
  /** Se resuelve aquí si no viene; el llamador puede pasarlo si ya lo tiene. */
  email?: string | null;
}

export type MotivoFalla =
  | 'no_encontrado'
  | 'ya_resuelto'
  | 'candidato_no_ofrecido'
  | 'gasto_no_encontrado'
  | 'gasto_ya_tiene_cfdi'
  | 'gasto_de_viaje_liquidado'
  | 'nada_que_revertir'
  | 'sin_firma'
  | 'error_bd';

export interface ResultadoResolucion {
  ok: boolean;
  /** El texto que se le enseña al contralor. Siempre presente: un rechazo sin
   *  explicación es un botón que no funciona. */
  mensaje: string;
  motivo?: MotivoFalla;
}

/** El código de `gasto_no_tras_liquidar` (0036/0037): el viaje ya se liquidó
 *  y pegarle un comprobante ahora cambiaría una liquidación EMITIDA. */
const SQLSTATE_YA_LIQUIDADO = 'CU001';

function codigoDe(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '') || undefined
    : undefined;
}

/**
 * A qué estatus vuelve un comprobante cuando se deshace lo que se le hizo.
 *
 * PURA A PROPÓSITO: es la única decisión de esta bandeja que se puede
 * equivocar en silencio, y se prueba sin base de datos.
 *
 * Si el motor había dejado DOS O MÁS candidatos, deshacer devuelve el
 * comprobante a 'ambiguo' — que es donde estaba esperando: seguir teniendo
 * varios gastos que empatan. Devolverlo a 'disponible' borraría la pregunta
 * («¿cuál de estos?») y lo dejaría en la cola equivocada, la de «nadie reportó
 * este gasto», que es una afirmación distinta y falsa.
 *
 * Con un candidato o ninguno, 'disponible': no hay nada que elegir.
 */
export function estatusAlRevertir(candidatos: unknown): EstatusCfdi {
  return candidatosAnotados(candidatos).length >= 2 ? 'ambiguo' : 'disponible';
}

/** El comprobante tal como está AHORA, para decidir sobre él. */
interface CfdiActual {
  id: string;
  cfdiUuid: string;
  estatus: EstatusCfdi;
  gastoId: string | null;
  candidatos: unknown;
  total: number | null;
}

async function leerCfdi(tenantId: string, cfdiId: string): Promise<CfdiActual | null> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .select('id, cfdi_uuid, estatus, gasto_id, candidatos, total')
    .eq('tenant_id', tenantId)
    .eq('id', cfdiId)
    .maybeSingle(), 'sat_descarga.leer_cfdi');
  // UN ERROR DE LA BASE NO ES «NO EXISTE»: se propaga para que el llamador
  // conteste «no se pudo leer» en vez de «ese comprobante no es de tu flota».
  if (error) throw new Error(error.message);
  if (data === null) return null;
  return {
    id: data.id as string,
    cfdiUuid: data.cfdi_uuid as string,
    estatus: data.estatus as EstatusCfdi,
    gastoId: (data.gasto_id as string) || null,
    candidatos: data.candidatos ?? null,
    total: data.total === null || data.total === undefined ? null : Number(data.total),
  };
}

/** El correo de quien firma, o `null`. FALLA CERRADO: sin firma no se escribe
 *  —el CHECK `sat_cfdi_descargado_firma_coherente` de la 0243 lo exige, y una
 *  resolución anónima sobre dinero deducible no vale como expediente—. */
async function firmaDe(actor: ActorResolucion): Promise<string | null> {
  const dado = actor.email?.trim();
  if (dado) return dado;
  return correoDelUsuario(actor.id);
}

/** El renglón del expediente. Best-effort SOLO en el sentido de que no tumba
 *  el acto que YA ocurrió (mismo criterio que `anotarBitacora`): si falla, se
 *  grita en el log — nunca se traga en silencio. */
async function anotarActo(fila: {
  tenantId: string; cfdiId: string; acto: 'ligado' | 'ignorado' | 'revertido';
  gastoId: string | null; estatusAntes: string; estatusDespues: string;
  motivo: string | null; actorId: string; actorEmail: string;
}): Promise<void> {
  const { error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_resolucion')
    .insert({
      tenant_id: fila.tenantId, cfdi_id: fila.cfdiId, acto: fila.acto,
      gasto_id: fila.gastoId, estatus_antes: fila.estatusAntes,
      estatus_despues: fila.estatusDespues, motivo: fila.motivo,
      actor_id: fila.actorId, actor_email: fila.actorEmail,
    }), 'sat_descarga.anotar_acto');
  if (error) {
    logger.error('sat_descarga.expediente_no_escrito', {
      tenantId: fila.tenantId, cfdi: fila.cfdiId, acto: fila.acto, err: error.message,
    });
  }
}

// ── LIGAR ──────────────────────────────────────────────────────────────────

/**
 * Liga un comprobante a un gasto: el acto que deja el gasto facturado.
 *
 * Sirve para los DOS caminos, y la diferencia está en la validación:
 *
 *  · desde 'ambiguo'    — el gasto tiene que ser UNO DE LOS CANDIDATOS que el
 *    motor ofreció. No es un buscador libre: el motor ya calculó qué empataba
 *    y elegir fuera de esa lista sería resolver una pregunta distinta de la
 *    que la fila hace. Mismo criterio que `resolverLineaAMano` (0076).
 *  · desde 'disponible' — elección libre entre los gastos SIN comprobante de
 *    la flota, porque ahí el motor no ofreció nada: no encontró ninguno.
 *
 * Los `candidatos` NO SE BORRAN al ligar: se conservan y se les añade quién
 * eligió qué. Es lo que permite que deshacer devuelva el comprobante a la cola
 * en la que estaba (ver `estatusAlRevertir`) en vez de dejarlo en otra.
 */
export async function ligarComprobante(
  tenantId: string,
  cfdiId: string,
  gastoId: string,
  actor: ActorResolucion,
): Promise<ResultadoResolucion> {
  if (!gastoId.trim()) throw new DatoInvalido('Falta decir con qué gasto se liga.');
  const email = await firmaDe(actor);
  if (email === null) {
    return { ok: false, motivo: 'sin_firma', mensaje: 'No se pudo leer tu correo para firmar el cruce, así que no se hizo nada. Un cruce sin firma no queda en el expediente — vuelve a entrar y reinténtalo.' };
  }

  const cfdi = await leerCfdi(tenantId, cfdiId);
  if (cfdi === null) {
    return { ok: false, motivo: 'no_encontrado', mensaje: 'Ese comprobante no está en el buzón descargado de tu flota.' };
  }
  if (cfdi.estatus === 'casado') {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Ese comprobante ya está casado con un gasto. Si el cruce está mal, deshazlo primero: corregir es anotar, no volver a ligar encima.' };
  }
  if (cfdi.estatus === 'ignorado') {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Ese comprobante está archivado. Devuélvelo a la bandeja primero (deshacer) y después lígalo.' };
  }
  if (cfdi.estatus === 'ambiguo') {
    const ofrecidos = candidatosAnotados(cfdi.candidatos);
    if (!ofrecidos.some((c) => c.gastoId === gastoId)) {
      return {
        ok: false, motivo: 'candidato_no_ofrecido',
        mensaje: 'Ese gasto no es uno de los candidatos que el cruce encontró para este comprobante. Recarga la bandeja: puede que alguien más lo haya resuelto.',
      };
    }
  }

  // El gasto TIENE que ser de esta flota y estar sin comprobante. La FK
  // compuesta `(gasto_id, tenant_id)` de la 0231 lo garantiza en la base;
  // preguntarlo antes es lo que permite contestar POR QUÉ no se pudo, en vez
  // de devolver un 23503 que no le dice nada a nadie.
  const { data: gasto, error: errGasto } = await acotada(supabaseAdmin()
    .from('gasto')
    .select('id, cfdi_uuid, monto')
    .eq('tenant_id', tenantId)
    .eq('id', gastoId)
    .maybeSingle(), 'sat_descarga.leer_gasto_a_ligar');
  if (errGasto) throw new Error(errGasto.message);
  if (gasto === null) {
    return { ok: false, motivo: 'gasto_no_encontrado', mensaje: 'Ese gasto ya no existe en tu flota (puede que se haya borrado el viaje del que colgaba).' };
  }
  if (gasto.cfdi_uuid) {
    return { ok: false, motivo: 'gasto_ya_tiene_cfdi', mensaje: 'Ese gasto ya tiene comprobante: le llegó por otro camino. Likida no pisa un CFDI que ya estaba.' };
  }

  // ── El cruce, en dos escrituras y en este orden ──────────────────────────
  // Primero el GASTO (con la guardia optimista que decide la carrera), después
  // el comprobante. Al revés, un comprobante podría quedar diciendo «casé» con
  // un gasto que otro se llevó.
  const { data: ligado, error: errLigar } = await acotada(supabaseAdmin()
    .from('gasto')
    .update({ cfdi_uuid: cfdi.cfdiUuid, cfdi_orden: 1, xml_verificado: true })
    .eq('tenant_id', tenantId)
    .eq('id', gastoId)
    .is('cfdi_uuid', null)
    .select('id'), 'sat_descarga.ligar_a_mano');
  if (errLigar) {
    // `gasto_no_tras_liquidar` (0036/0037) bloquea tocar el CFDI de un gasto
    // cuyo viaje YA se liquidó. No es un fallo del sistema: es el candado que
    // impide cambiar una liquidación emitida, y el contralor tiene que leerlo
    // con esas palabras para saber qué hacer (refacturar, no reintentar).
    if (codigoDe(errLigar) === SQLSTATE_YA_LIQUIDADO) {
      return {
        ok: false, motivo: 'gasto_de_viaje_liquidado',
        mensaje: 'Ese gasto pertenece a un viaje que YA se liquidó: pegarle un comprobante ahora cambiaría una liquidación emitida, y la base no lo permite. El comprobante se queda en la bandeja.',
      };
    }
    logger.error('sat_descarga.ligar_a_mano_fallo', { tenantId, cfdi: cfdiId, err: errLigar.message });
    return { ok: false, motivo: 'error_bd', mensaje: `No se pudo ligar el gasto, así que no se cambió nada: ${errLigar.message}` };
  }
  if ((ligado ?? []).length !== 1) {
    return { ok: false, motivo: 'gasto_ya_tiene_cfdi', mensaje: 'Alguien le pegó un comprobante a ese gasto mientras decidías. No se pisó nada — recarga la bandeja.' };
  }

  const candidatosConEleccion = {
    ...(cfdi.candidatos !== null && typeof cfdi.candidatos === 'object' && !Array.isArray(cfdi.candidatos)
      ? (cfdi.candidatos as Record<string, unknown>) : {}),
    elegido: gastoId,
    elegido_por: email,
    elegido_en: new Date().toISOString(),
  };

  const { data: marcado, error: errMarcar } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .update({
      estatus: 'casado',
      gasto_id: gastoId,
      candidatos: candidatosConEleccion,
      resuelto_por: actor.id,
      resuelto_por_email: email,
      resuelto_en: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', cfdiId)
    // ANCLADO AL ESTATUS QUE SE LEYÓ: si otro contralor lo resolvió mientras
    // tanto, cero filas y se deshace lo del gasto.
    .eq('estatus', cfdi.estatus)
    .select('id'), 'sat_descarga.marcar_casado_a_mano');

  if (errMarcar || (marcado ?? []).length !== 1) {
    // El gasto YA quedó ligado y el comprobante no. Aquí SÍ se puede deshacer
    // sin adivinar —a diferencia de `resolverLineaAMano`, que documentó no
    // poder— porque se sabe exactamente qué folio se acaba de escribir: el
    // `.eq('cfdi_uuid', …)` garantiza que solo se suelta lo que este mismo
    // acto puso, nunca un comprobante ajeno.
    const { error: errSoltar } = await acotada(supabaseAdmin()
      .from('gasto')
      .update({ cfdi_uuid: null, xml_verificado: null })
      .eq('tenant_id', tenantId)
      .eq('id', gastoId)
      .eq('cfdi_uuid', cfdi.cfdiUuid), 'sat_descarga.deshacer_ligado_parcial');
    if (errSoltar) {
      // Quedó inconsistente y NO se esconde: el gasto tiene folio y el
      // comprobante no dice que casó. Se grita para que se repare a mano.
      logger.error('sat_descarga.ligado_parcial_sin_deshacer', {
        tenantId, cfdi: cfdiId, gasto: gastoId, err: errSoltar.message,
      });
      return {
        ok: false, motivo: 'error_bd',
        mensaje: `El gasto quedó con el folio pegado pero el comprobante no se pudo marcar, y tampoco se pudo deshacer: ${errSoltar.message}. Revísalo antes de volver a intentarlo.`,
      };
    }
    if (errMarcar) {
      logger.error('sat_descarga.marcar_casado_fallo', { tenantId, cfdi: cfdiId, err: errMarcar.message });
      return { ok: false, motivo: 'error_bd', mensaje: `No se pudo marcar el comprobante, así que se deshizo el cruce y no cambió nada: ${errMarcar.message}` };
    }
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Alguien resolvió ese comprobante mientras decidías. No se pisó nada — recarga la bandeja.' };
  }

  await anotarActo({
    tenantId, cfdiId, acto: 'ligado', gastoId,
    estatusAntes: cfdi.estatus, estatusDespues: 'casado',
    motivo: null, actorId: actor.id, actorEmail: email,
  });
  await anotarBitacora({
    tenantId, actor: { id: actor.id, email },
    accion: 'sat_descarga.cfdi_ligado',
    entidad: 'sat_cfdi_descargado', entidadId: cfdiId,
    detalle: { cfdiUuid: cfdi.cfdiUuid, gastoId, desde: cfdi.estatus },
  });

  return { ok: true, mensaje: 'Ligado. El gasto quedó facturado con este comprobante y el cruce está firmado con tu correo — si estaba mal, se deshace desde aquí y queda anotado.' };
}

// ── IGNORAR ────────────────────────────────────────────────────────────────

/**
 * Archiva un comprobante que no corresponde a ningún gasto de la flota.
 *
 * NO ES UN BORRADO: la fila se queda, con su folio fiscal, su importe y ahora
 * también con quién decidió archivarla y por qué. El motivo es obligatorio
 * —igual que en `rechazarPieza` (0120) y en la anulación de un asiento de
 * jornada (0241)— porque un archivado sin motivo es indistinguible de un
 * descuido, y estos comprobantes son los que sostienen (o no) una deducción.
 */
export async function ignorarComprobante(
  tenantId: string,
  cfdiId: string,
  motivo: string,
  actor: ActorResolucion,
): Promise<ResultadoResolucion> {
  const m = motivo.trim();
  if (m === '') {
    throw new DatoInvalido('Archivar exige un motivo: sin él, dentro de seis meses nadie va a poder distinguir un comprobante que no correspondía de uno que se dejó pasar por descuido.');
  }
  const email = await firmaDe(actor);
  if (email === null) {
    return { ok: false, motivo: 'sin_firma', mensaje: 'No se pudo leer tu correo para firmar el archivado, así que no se hizo nada.' };
  }

  const cfdi = await leerCfdi(tenantId, cfdiId);
  if (cfdi === null) {
    return { ok: false, motivo: 'no_encontrado', mensaje: 'Ese comprobante no está en el buzón descargado de tu flota.' };
  }
  if (cfdi.estatus === 'ignorado') {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Ese comprobante ya estaba archivado.' };
  }
  if (cfdi.estatus === 'casado') {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Ese comprobante está casado con un gasto: archivarlo dejaría el gasto facturado por un CFDI que dice no interesar. Deshaz el cruce primero.' };
  }

  const { data, error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .update({
      estatus: 'ignorado',
      // `gasto_id` sigue en NULL — el CHECK `casado_coherente` lo exige para
      // todo estatus que no sea 'casado', y aquí no hay cruce que afirmar.
      candidatos: {
        ...(cfdi.candidatos !== null && typeof cfdi.candidatos === 'object' && !Array.isArray(cfdi.candidatos)
          ? (cfdi.candidatos as Record<string, unknown>) : {}),
        ignorado_motivo: m,
        ignorado_por: email,
        ignorado_en: new Date().toISOString(),
      },
      resuelto_por: actor.id,
      resuelto_por_email: email,
      resuelto_en: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', cfdiId)
    .eq('estatus', cfdi.estatus)
    .select('id'), 'sat_descarga.ignorar_a_mano');
  if (error) {
    logger.error('sat_descarga.ignorar_fallo', { tenantId, cfdi: cfdiId, err: error.message });
    return { ok: false, motivo: 'error_bd', mensaje: `No se pudo archivar, así que no cambió nada: ${error.message}` };
  }
  if ((data ?? []).length !== 1) {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Alguien resolvió ese comprobante mientras decidías. Recarga la bandeja.' };
  }

  await anotarActo({
    tenantId, cfdiId, acto: 'ignorado', gastoId: null,
    estatusAntes: cfdi.estatus, estatusDespues: 'ignorado',
    motivo: m, actorId: actor.id, actorEmail: email,
  });
  await anotarBitacora({
    tenantId, actor: { id: actor.id, email },
    accion: 'sat_descarga.cfdi_ignorado',
    entidad: 'sat_cfdi_descargado', entidadId: cfdiId,
    detalle: { cfdiUuid: cfdi.cfdiUuid, desde: cfdi.estatus, motivo: m.slice(0, 300) },
  });
  return { ok: true, mensaje: 'Archivado con tu motivo. No se borró: sigue en el buzón descargado, con quién lo archivó y por qué — y se puede devolver a la bandeja cuando haga falta.' };
}

// ── REVERTIR ───────────────────────────────────────────────────────────────

/**
 * Deshace un cruce o un archivado. LA REVERSIÓN SE ANOTA, NO SE BORRA.
 *
 * Un cruce mal hecho tiene que poder revertirse —si no, el miedo a
 * equivocarse convierte la bandeja en una cola que nadie toca— pero el rastro
 * de que se hizo NO desaparece: queda el renglón 'ligado' de antes y se suma
 * el renglón 'revertido' con quién y por qué. El expediente cuenta las dos
 * versiones, como `jornada_asiento` (0241).
 *
 * Al deshacer un cruce, el gasto se suelta CON EL FOLIO EN LA MANO
 * (`.eq('cfdi_uuid', …)`): solo se desliga lo que ESTE comprobante había
 * pegado. Si el gasto tiene otro folio —porque alguien lo cambió— no se toca y
 * se dice, en vez de dejar un ticket sin comprobante que nadie pidió soltar.
 */
export async function revertirResolucion(
  tenantId: string,
  cfdiId: string,
  motivo: string,
  actor: ActorResolucion,
): Promise<ResultadoResolucion> {
  const m = motivo.trim();
  if (m === '') {
    throw new DatoInvalido('Deshacer exige un motivo: es lo que distingue una corrección de un borrado, y esta bandeja no borra nada.');
  }
  const email = await firmaDe(actor);
  if (email === null) {
    return { ok: false, motivo: 'sin_firma', mensaje: 'No se pudo leer tu correo para firmar la reversión, así que no se hizo nada.' };
  }

  const cfdi = await leerCfdi(tenantId, cfdiId);
  if (cfdi === null) {
    return { ok: false, motivo: 'no_encontrado', mensaje: 'Ese comprobante no está en el buzón descargado de tu flota.' };
  }
  if (cfdi.estatus !== 'casado' && cfdi.estatus !== 'ignorado') {
    return {
      ok: false, motivo: 'nada_que_revertir',
      mensaje: 'Ese comprobante no tiene nada que deshacer: sigue esperando decisión. Solo se deshace un cruce hecho o un archivado.',
    };
  }

  const gastoSoltado = cfdi.gastoId;
  if (cfdi.estatus === 'casado' && gastoSoltado !== null) {
    const { data: soltado, error: errSoltar } = await acotada(supabaseAdmin()
      .from('gasto')
      // `xml_verificado` vuelve a NULL —no a `false`—: «no se ha verificado»
      // no es «se verificó y no cuadró». `cfdi_orden` se queda en 1, que es su
      // default NOT NULL: sin folio, el orden no afirma nada.
      .update({ cfdi_uuid: null, xml_verificado: null })
      .eq('tenant_id', tenantId)
      .eq('id', gastoSoltado)
      .eq('cfdi_uuid', cfdi.cfdiUuid)
      .select('id'), 'sat_descarga.soltar_gasto');
    if (errSoltar) {
      if (codigoDe(errSoltar) === SQLSTATE_YA_LIQUIDADO) {
        return {
          ok: false, motivo: 'gasto_de_viaje_liquidado',
          mensaje: 'El viaje de ese gasto YA se liquidó: quitarle el comprobante ahora cambiaría una liquidación emitida, y la base no lo permite. El cruce se queda como está.',
        };
      }
      logger.error('sat_descarga.soltar_gasto_fallo', { tenantId, cfdi: cfdiId, err: errSoltar.message });
      return { ok: false, motivo: 'error_bd', mensaje: `No se pudo soltar el gasto, así que no se deshizo nada: ${errSoltar.message}` };
    }
    if ((soltado ?? []).length !== 1) {
      // El gasto ya no trae ESTE folio (lo cambiaron, o el gasto se borró).
      // Se sigue adelante con el comprobante —que es lo que se está
      // revirtiendo— y se deja constancia de que el gasto no se tocó.
      logger.warn('sat_descarga.soltar_gasto_sin_efecto', { tenantId, cfdi: cfdiId, gasto: gastoSoltado });
    }
  }

  // Deshacer un cruce Y deshacer un archivado van al MISMO sitio: la cola en
  // la que el comprobante estaba esperando antes de que alguien decidiera.
  const destino = estatusAlRevertir(cfdi.candidatos);

  const { data, error } = await acotada(supabaseAdmin()
    .from('sat_cfdi_descargado')
    .update({
      // ESTATUS Y GASTO EN EL MISMO UPDATE: así la fila nunca pasa por el
      // estado que `sat_cfdi_descargado_casado_coherente` prohíbe. Y como
      // `estatus` deja de ser 'casado', el trigger de la 0236 no se dispara
      // —esto es una reversión humana, no la de la base—.
      estatus: destino,
      gasto_id: null,
      candidatos: {
        ...(cfdi.candidatos !== null && typeof cfdi.candidatos === 'object' && !Array.isArray(cfdi.candidatos)
          ? (cfdi.candidatos as Record<string, unknown>) : {}),
        elegido: null,
        revertido_motivo: m,
        revertido_por: email,
        revertido_en: new Date().toISOString(),
      },
      // La firma se conserva y ahora describe LA REVERSIÓN: quién dejó este
      // comprobante como está. Quién lo había ligado sigue en el expediente.
      resuelto_por: actor.id,
      resuelto_por_email: email,
      resuelto_en: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', cfdiId)
    .eq('estatus', cfdi.estatus)
    .select('id'), 'sat_descarga.revertir');
  if (error) {
    logger.error('sat_descarga.revertir_fallo', { tenantId, cfdi: cfdiId, err: error.message });
    return { ok: false, motivo: 'error_bd', mensaje: `No se pudo deshacer: ${error.message}` };
  }
  if ((data ?? []).length !== 1) {
    return { ok: false, motivo: 'ya_resuelto', mensaje: 'Alguien cambió ese comprobante mientras decidías. Recarga la bandeja.' };
  }

  await anotarActo({
    tenantId, cfdiId, acto: 'revertido', gastoId: gastoSoltado,
    estatusAntes: cfdi.estatus, estatusDespues: destino,
    motivo: m, actorId: actor.id, actorEmail: email,
  });
  await anotarBitacora({
    tenantId, actor: { id: actor.id, email },
    accion: 'sat_descarga.cfdi_revertido',
    entidad: 'sat_cfdi_descargado', entidadId: cfdiId,
    detalle: { cfdiUuid: cfdi.cfdiUuid, desde: cfdi.estatus, hacia: destino, gastoSoltado, motivo: m.slice(0, 300) },
  });

  return {
    ok: true,
    mensaje: destino === 'ambiguo'
      ? 'Deshecho. El comprobante vuelve a la cola de los que tienen varios candidatos, y quedó anotado quién lo deshizo y por qué — lo anterior no se borró.'
      : 'Deshecho. El comprobante vuelve a esperar decisión, y quedó anotado quién lo deshizo y por qué — lo anterior no se borró.',
  };
}
