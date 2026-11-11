import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { mxn, round2, TOLERANCIA_ABONO_MXN } from '@/lib/formato';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora, type EntidadBitacora } from './bitacora_escritura';
import { AbonoYaRegistrado, datoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';
import { parseCfdiXml, leerPagosRep } from './intake/cfdi_xml';
import { parseRepXml } from './intake/rep';
import { abonoEquivalente } from './portal_pago_propuesta';
import { registrarPago } from './facturacion_escritura';
import { expiracionDesde, generarTokenPortal, diasDeVigencia, montoTecleado } from './portal_pago';

// ═══════════════════════════════════════════════════════════════════════════
// EL PORTAL DE PAGO — LAS ESCRITURAS DEL CONTRALOR.
//
// Cinco verbos en total, y la línea que los parte en dos archivos es quién los
// dispara. AQUÍ viven los cuatro que exigen sesión y rol:
//
//     · `crearLigaPago`   — emite el link. El token se enseña UNA vez.
//     · `revocarLigaPago` — lo mata.
//     · `conciliarPropuesta` / `descartarPropuesta` — decide sobre lo que el
//       cliente dijo. Conciliar es lo único que mueve la cartera, y lo hace
//       por `registrarPago` → `registrar_pago_tx` (0159): mismo camino, mismo
//       `for update`, mismo rechazo por sobrepago que el pago tecleado a mano.
//       Un segundo camino a `pago_recibido` sería una segunda regla de dinero.
//     · `registrarRepEmitido` — anota el complemento que timbró su PAC.
//
// El quinto —`registrarPropuesta`, el ÚNICO que alcanza una petición anónima—
// vive en `portal_pago_propuesta.ts`, y esa separación se midió: la cadena de
// `registrarPago`/`esUuidValido` arrastra `sharp` y `zxing-wasm`, y con los
// cinco juntos la página pública de pago los cargaba en cada arranque en frío
// (265 archivos contra los 169 de una ruta mínima). Ver la cabecera de ese
// archivo para el detalle.
//
// Que el verbo del cliente esté FÍSICAMENTE en otro módulo también hace
// visible la garantía: desde `/api/pago/registrar` no se importa nada de aquí,
// así que no existe ruta desde una petición anónima hacia `pago_recibido`.
// ═══════════════════════════════════════════════════════════════════════════

/** El código que Postgres devuelve al chocar contra un índice único. */
const CHOQUE_UNICO = '23505';

async function anotar(
  tenantId: string, accion: string, entidad: EntidadBitacora, entidadId: string,
  detalle: Record<string, unknown>, actor?: { id?: string; email?: string },
): Promise<void> {
  await anotarBitacora(
    { tenantId, actor: actor ?? {}, accion, entidad, entidadId, detalle },
    { evento: 'portal_pago.bitacora_no_escribio' },
  );
}

// ── 1. LA LIGA ─────────────────────────────────────────────────────────────

export interface LigaEmitida {
  id: string;
  /** El link COMPLETO, con el token en claro. Se enseña UNA vez: no se puede
   *  volver a leer de la base, porque la base solo tiene su sha256. */
  url: string;
  prefijo: string;
  expiraEn: string;
}

/**
 * Emite el link de una factura.
 *
 * NO SE EMITE SOBRE UN BORRADOR. Un borrador «no le cobra a nadie hasta que
 * llegue su UUID del CFDI» —es el contrato que la pantalla de facturación ya
 * le dice al contralor—, así que mandarle a un cliente el link de uno sería
 * cobrarle por un papel que el SAT no conoce. Tampoco sobre una cancelada, por
 * la razón espejo.
 *
 * Y no se emiten dos vivas a la vez. El índice parcial de la 0228 lo impide, y
 * aquí se traduce a un mensaje: si "generar link" tuviera efecto silencioso
 * cinco veces, revocar el que el contralor ve en pantalla dejaría cuatro
 * tokens vivos que ya nadie sabe que existen.
 */
export async function crearLigaPago(
  tenantId: string,
  facturaId: string,
  actor?: { id?: string; email?: string },
): Promise<LigaEmitida> {
  if (!esUuidValido(facturaId)) {
    throw datoInvalido('portal_pago_es.no_se_reconoce_esa_factura');
  }

  const { data: fac, error: errF } = await acotada(supabaseAdmin().from('factura_emitida')
    .select('id, estatus')
    .eq('id', facturaId).eq('tenant_id', tenantId).maybeSingle(), 'crearLigaPago.factura');
  if (errF) throw new Error(`crearLigaPago: ${errF.message}`);
  if (!fac) throw datoInvalido('portal_pago_es.esa_factura_no_es_de');

  const estatus = String((fac as { estatus: unknown }).estatus);
  if (estatus === 'borrador') {
    throw datoInvalido('portal_pago_es.esa_factura_es_un_borrador');
  }
  if (estatus === 'cancelada') {
    throw datoInvalido('portal_pago_es.esa_factura_esta_cancelada_no');
  }

  // ── LA LIGA CADUCADA NO OCUPA EL LUGAR DE LA VIVA (`c7-26`) ──────────────
  //
  // `portal_pago_liga_viva_unica` es `unique (factura_id) where revocada_en is
  // null`: no mira `expira_en`. Una liga generada el 1-may y caducada el 30-jul
  // sigue ocupando el lugar en agosto, así que «generar link» rebotaba con
  // «Esa factura ya tiene un enlace vigente. Revócalo antes de generar uno
  // nuevo» — un mensaje FALSO sobre un enlace que el propio `estadoLiga` ya
  // clasifica como `expirada` y que `resolverLiga` ya rechaza. El contralor
  // tenía que revocar un cadáver, guiado por una afirmación que el código sabía
  // que no era cierta.
  //
  // El índice no se puede arreglar (`now()` no es IMMUTABLE y Postgres no
  // admite un predicado que dependa del reloj — ver la 0237), así que se
  // arregla aquí: la caducada se revoca SOLA, con su constancia en la bitácora,
  // y el lugar queda libre. Es la misma decisión que ya tomó `estadoLiga` —
  // caducada es caducada—, ahora también en la tabla.
  //
  // `revocada_por` queda NULL a propósito: no lo revocó una persona, lo revocó
  // el calendario. El CHECK `portal_pago_liga_revocacion_coherente` lo permite
  // (exige lo contrario: autor sin fecha es lo que no puede existir).
  const ahora = new Date();
  const { data: caducadas, error: errCad } = await acotada(supabaseAdmin().from('portal_pago_liga')
    .update({ revocada_en: ahora.toISOString() })
    .eq('tenant_id', tenantId).eq('factura_id', facturaId)
    .is('revocada_en', null).lte('expira_en', ahora.toISOString())
    .select('id'), 'crearLigaPago.caducadas');
  // No se traga: si esta limpieza falla, el insert de abajo puede rebotar con
  // el mensaje equivocado, y prefiero decir que no se pudo a mentir.
  if (errCad) throw new Error(`crearLigaPago: no se pudieron revisar los enlaces caducados: ${errCad.message}`);
  for (const c of (caducadas ?? []) as Array<{ id: unknown }>) {
    await anotar(tenantId, 'portal_pago.liga_caducada_revocada', 'portal_pago_liga', String(c.id), {
      facturaId, nota: 'La liga ya había caducado por fecha. Se revocó sola para dejar sitio a la nueva; nadie la revocó a mano.',
    }, actor);
  }

  const token = generarTokenPortal();
  const expiraEn = expiracionDesde(ahora, diasDeVigencia());

  const { data, error } = await acotada(supabaseAdmin().from('portal_pago_liga').insert({
    tenant_id: tenantId,
    factura_id: facturaId,
    // SOLO el sha256. `token.enClaro` no entra a esta fila ni a ninguna otra.
    token_hash: token.hash,
    token_prefijo: token.prefijo,
    expira_en: expiraEn,
    creada_por: actor?.id ?? null,
  }).select('id').single(), 'crearLigaPago');

  let idInsertado = (data as { id?: unknown } | null)?.id;
  if (error) {
    if (error.code === CHOQUE_UNICO) {
      throw datoInvalido('portal_pago_es.esa_factura_ya_tiene_un');
    }
    // A37-S54-07: un timeout (`acotada`) o un corte de red NO prueba que el insert no ocurrió. Si la liga existe con
    // NUESTRO hash, el insert sí se completó y el token en claro lo tenemos: se devuelve esa liga. Si no, o si la
    // relectura también falla, sube el error original (nunca se inventa un éxito).
    idInsertado = await ligaYaInsertada(tenantId, facturaId, token.hash);
    if (!idInsertado) throw new Error(`crearLigaPago: ${error.message}`);
    logger.warn('portal_pago.liga_insert_recuperada', { facturaId, err: error.message });
  }
  const id = idInsertado;
  if (!id) throw new Error('crearLigaPago: el insert no devolvió id');

  await anotar(tenantId, 'portal_pago.liga_creada', 'portal_pago_liga', String(id), {
    facturaId, prefijo: token.prefijo, expiraEn,
  }, actor);

  return {
    id: String(id),
    url: `${appUrl()}/pago/${token.enClaro}`,
    prefijo: token.prefijo,
    expiraEn,
  };
}

/** ¿Quedó escrita la liga con este hash a pesar del error del insert? Su id, o `null` si no (o si no se pudo leer). */
async function ligaYaInsertada(tenantId: string, facturaId: string, tokenHash: string): Promise<string | null> {
  try {
    const { data, error } = await acotada(supabaseAdmin().from('portal_pago_liga')
      .select('id')
      .eq('tenant_id', tenantId).eq('factura_id', facturaId).eq('token_hash', tokenHash)
      .is('revocada_en', null).maybeSingle(), 'crearLigaPago.relectura');
    if (error) return null;
    const id = (data as { id?: unknown } | null)?.id;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Mata una liga. El `.is('revocada_en', null)` no es cosmético: revocar dos
 * veces pisaría el sello original y la respuesta a "¿desde cuándo dejó de
 * valer?" mentiría — misma decisión que `revocarLlaveApi`.
 */
export async function revocarLigaPago(
  tenantId: string,
  ligaId: string,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(ligaId)) {
    throw datoInvalido('portal_pago_es.no_se_reconoce_ese_enlace');
  }

  const { data, error } = await acotada(supabaseAdmin().from('portal_pago_liga')
    .update({ revocada_en: new Date().toISOString(), revocada_por: actor?.id ?? null })
    .eq('id', ligaId).eq('tenant_id', tenantId)
    .is('revocada_en', null)
    .select('id'), 'revocarLigaPago');

  if (error) throw new Error(`revocarLigaPago: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw datoInvalido('portal_pago_es.ese_enlace_no_esta_vivo');
  }

  await anotar(tenantId, 'portal_pago.liga_revocada', 'portal_pago_liga', ligaId, {}, actor);
}

// ── 3. LA CONCILIACIÓN (el humano confirma) ────────────────────────────────

/**
 * Convierte una propuesta en un pago de verdad. IDEMPOTENTE POR RESTRICCIÓN.
 *
 * EL ORDEN IMPORTA Y ESTÁ ESCRITO: primero nace el pago (por
 * `registrar_pago_tx`, con la factura trabada, que es quien puede rechazar el
 * sobrepago y quien pone `estatus = 'pagada'` en la misma transacción), y solo
 * DESPUÉS se sella la propuesta. Al revés, una propuesta diría "conciliada"
 * mientras el abono se rechaza por sobrepago, y el contralor tendría una
 * factura que se ve cobrada sin un peso encima.
 *
 * ── LO QUE ESTABA MAL, Y POR QUÉ UN `if` NO PODÍA ARREGLARLO (`c7-5`) ────
 *
 * Aquí se leía la propuesta, se comprobaba `estado === 'pendiente'` y DESPUÉS
 * se llamaba a `registrarPago`. Entre la lectura y el insert cabe el segundo
 * clic: dos pestañas del contralor sobre la misma propuesta de $5,000 contra un
 * saldo de $34,800 pasaban las dos —ninguna es sobrepago, así que el `for
 * update` de la RPC no rechaza ninguna— y `pago_recibido` acababa con DOS
 * abonos por UN depósito. La cartera del cliente quedaba $5,000 abajo de la
 * realidad. El código lo sabía: tenía escrita la compensación («deja dicho que
 * hubo un abono huérfano para que el contralor lo cancele a mano»), que es la
 * confesión de que la carrera existía.
 *
 * Un "consulto y luego inserto" NO es idempotencia. La de esta casa es un
 * índice único: `pago_recibido_propuesta_unica` (0237), sobre la propuesta que
 * originó el abono, y `registrar_pago_tx` escribe esa columna DENTRO de la
 * misma transacción que traba la factura. La segunda pestaña ya no crea nada:
 * choca con un 23505 y este código lo lee como «ese abono ya existe», se cuelga
 * del que está y termina de sellar. Conciliar dos veces es exactamente
 * conciliar una vez, y no hay ventana porque no hay dos pasos.
 *
 * El `if` de arriba se queda, pero cambia de oficio: ya no es el candado —es el
 * mensaje amable para el caso normal («recarga, ya estaba resuelto»). El
 * candado es la base.
 */
export async function conciliarPropuesta(
  tenantId: string,
  propuestaId: string,
  actor?: { id?: string; email?: string },
): Promise<{ pagoId: string; monto: number }> {
  if (!esUuidValido(propuestaId)) {
    throw datoInvalido('portal_pago_es.no_se_reconoce_ese_registro');
  }

  const { data: p, error: errP } = await acotada(supabaseAdmin().from('portal_pago_propuesta')
    .select('id, factura_id, fecha, monto, referencia, metodo, estado')
    .eq('id', propuestaId).eq('tenant_id', tenantId).maybeSingle(), 'conciliarPropuesta.leer');
  if (errP) throw new Error(`conciliarPropuesta: ${errP.message}`);
  if (!p) throw datoInvalido('portal_pago_es.ese_registro_no_es_de');

  const fila = p as Record<string, unknown>;
  if (String(fila.estado) !== 'pendiente') {
    throw datoInvalido('portal_pago_es.ese_registro_ya_estaba_resuelto');
  }

  const monto = Number(fila.monto);
  const facturaId = String(fila.factura_id);

  // A37-S54-02: la idempotencia de abajo es por `propuestaId`; no ve un abono hermano de OTRA propuesta (o capturado a mano) del
  // mismo depósito. Antes de crear dinero se pregunta, FAIL-CLOSED: si no se puede preguntar, no se concilia.
  const hermano = await abonoEquivalente(tenantId, {
    facturaId, fecha: String(fila.fecha), monto, referencia: String(fila.referencia ?? ''),
  }, propuestaId);
  if (hermano !== null) {
    throw datoInvalido('portal_pago_es.esta_factura_ya_tiene_un');
  }

  // El abono, con la propuesta como llave de idempotencia. Si otra sesión ya lo
  // creó, `registrarPago` lanza `AbonoYaRegistrado` en vez de duplicarlo.
  let pagoId: string;
  let yaExistia = false;
  try {
    pagoId = await registrarPago(tenantId, {
      facturaId,
      fecha: String(fila.fecha),
      monto,
      metodo: (fila.metodo as string | null) ?? null,
      referencia: (fila.referencia as string | null) ?? null,
    }, actor, propuestaId);
  } catch (e) {
    if (!(e instanceof AbonoYaRegistrado)) throw e;
    // El abono de esta propuesta ya está en la base. NO se crea otro: se busca
    // el que hay y se sigue como si lo hubiéramos creado nosotros, que es lo
    // que hace que esta función sea idempotente de verdad y no solo "reporta
    // bonito el destrozo". Este camino también rescata el caso feo: una sesión
    // que se murió DESPUÉS de crear el abono y ANTES de sellar la propuesta —
    // sin esto, esa propuesta se quedaba pendiente para siempre con su dinero
    // ya registrado, y ningún reintento podía cerrarla.
    yaExistia = true;
    const { data: existente, error: errE } = await acotada(supabaseAdmin().from('pago_recibido')
      .select('id')
      .eq('tenant_id', tenantId).eq('propuesta_id', propuestaId)
      .limit(1), 'conciliarPropuesta.abono_existente');
    if (errE) throw new Error(`conciliarPropuesta: el abono de esta propuesta ya existe, pero no se pudo leer su id: ${errE.message}`);
    const id = (Array.isArray(existente) ? existente[0] : null) as { id?: unknown } | null;
    if (!id?.id) {
      // La base dijo que ya existe y no aparece: no se inventa un id ni se
      // reintenta el abono. Se dice qué pasó.
      throw new Error('conciliarPropuesta: la base rechazó el abono por duplicado pero no encuentro el original. No se creó nada; revisa `pago_recibido` de esta propuesta antes de reintentar.');
    }
    pagoId = String(id.id);
  }

  const { data, error } = await acotada(supabaseAdmin().from('portal_pago_propuesta')
    .update({
      estado: 'conciliada',
      pago_id: pagoId,
      resuelta_en: new Date().toISOString(),
      resuelta_por: actor?.id ?? null,
    })
    .eq('id', propuestaId).eq('tenant_id', tenantId).eq('estado', 'pendiente')
    .select('id'), 'conciliarPropuesta.sellar');

  if (error) throw new Error(`conciliarPropuesta: el pago ${pagoId} SÍ se registró, pero el sello falló: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    // El sello no tocó nada. Ya NO puede ser un abono duplicado —de eso se
    // encarga el índice—, así que solo quedan dos casos y los dos son ciertos:
    // otra sesión selló primero con ESTE MISMO abono (nada que arreglar), o
    // alguien descartó la propuesta entre medias. Se lee el estado real en vez
    // de suponer cuál de los dos fue.
    const { data: ahora } = await acotada(supabaseAdmin().from('portal_pago_propuesta')
      .select('estado, pago_id')
      .eq('id', propuestaId).eq('tenant_id', tenantId).maybeSingle(), 'conciliarPropuesta.releer');
    const f2 = (ahora ?? {}) as { estado?: unknown; pago_id?: unknown };
    if (String(f2.estado) === 'conciliada' && String(f2.pago_id) === pagoId) {
      // Idempotencia completa: el resultado es el mismo que si hubiéramos
      // ganado la carrera, y el dinero se registró UNA vez.
      await anotar(tenantId, 'portal_pago.conciliacion_repetida', 'portal_pago_propuesta', propuestaId, {
        pagoId, monto, facturaId,
        nota: 'Otra sesión concilió esta misma propuesta con este mismo abono. No se duplicó nada.',
      }, actor);
      return { pagoId, monto };
    }
    await anotar(tenantId, 'portal_pago.conciliacion_sin_sello', 'pago_recibido', pagoId, {
      propuestaId, monto, estadoAhora: String(f2.estado ?? 'ilegible'), abonoYaExistia: yaExistia,
      nota: 'El abono está registrado pero la propuesta cambió de estado antes de sellarla (la descartaron, o no se pudo releer). Revisa a mano antes de tocar la cartera.',
    }, actor);
    throw datoInvalido('portal_pago_es.el_abono_de_quedo_registrado', { v: mxn(monto), pagoId });
  }

  await anotar(tenantId, 'portal_pago.propuesta_conciliada', 'portal_pago_propuesta', propuestaId, {
    pagoId, monto, facturaId, abonoYaExistia: yaExistia,
  }, actor);

  return { pagoId, monto };
}

/**
 * Descarta una propuesta: el depósito no apareció, la referencia no cuadra, o
 * es un duplicado de otro abono ya capturado.
 *
 * El motivo es OBLIGATORIO. Una propuesta descartada sin razón escrita es una
 * afirmación del cliente que alguien tiró, y el día que llame preguntando por
 * qué su pago "no cuenta" no hay nada que contestarle.
 */
export async function descartarPropuesta(
  tenantId: string,
  propuestaId: string,
  motivo: string,
  actor?: { id?: string; email?: string },
): Promise<void> {
  if (!esUuidValido(propuestaId)) {
    throw datoInvalido('portal_pago_es.no_se_reconoce_ese_registro');
  }
  const nota = motivo.trim();
  if (nota.length < 5) {
    throw datoInvalido('portal_pago_es.escribe_por_que_lo_descartas');
  }
  if (nota.length > 500) {
    throw datoInvalido('portal_pago_es.el_motivo_no_puede_pasar');
  }

  const { data, error } = await acotada(supabaseAdmin().from('portal_pago_propuesta')
    .update({
      estado: 'descartada',
      nota,
      resuelta_en: new Date().toISOString(),
      resuelta_por: actor?.id ?? null,
    })
    .eq('id', propuestaId).eq('tenant_id', tenantId).eq('estado', 'pendiente')
    .select('id'), 'descartarPropuesta');

  if (error) throw new Error(`descartarPropuesta: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw datoInvalido('portal_pago_es.ese_registro_ya_estaba_resuelto_2');
  }

  await anotar(tenantId, 'portal_pago.propuesta_descartada', 'portal_pago_propuesta', propuestaId, { nota }, actor);
}

// ── 4. EL REP QUE LA FLOTA EMITE ───────────────────────────────────────────

export interface RepCrudo {
  facturaId: string;
  pagoId: string;
  cfdiUuid: string;
  fechaPago: string;
  impPagado: string;
  formaPago: string;
  xml: string;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const XML_MAX = 500_000;

/** ¿El XML pegado ES el complemento de pago que se está registrando? Lanza `DatoInvalido` con el motivo. PURA. */
function verificarXmlDeRep(xml: string, cfdiUuid: string, fechaPago: string, imp: number): void {
  const cfdi = parseCfdiXml(xml);
  if (!cfdi) throw datoInvalido('portal_pago.xml_no_cfdi');
  if (cfdi.tipoComprobante !== 'P') {
    throw datoInvalido('portal_pago.xml_tipo', { tipo: cfdi.tipoComprobante ?? 'desconocido' });
  }
  if (!cfdi.uuid) throw datoInvalido('portal_pago.xml_sin_timbre');
  if (cfdi.uuid !== cfdiUuid) {
    throw datoInvalido('portal_pago.xml_otro_uuid', { uuid: cfdi.uuid, capturado: cfdiUuid });
  }
  const pagos = leerPagosRep(xml);
  if (pagos.length === 0) throw datoInvalido('portal_pago.xml_sin_pagos');
  const cuadra = (n: number | undefined) => n !== undefined && Math.abs(round2(n) - imp) <= TOLERANCIA_ABONO_MXN;
  const delDia = pagos.filter((p) => p.fechaPago === fechaPago);
  if (delDia.length === 0) {
    throw datoInvalido('portal_pago.xml_sin_fecha', { fechaPago });
  }
  const importeOk = delDia.some((p) => cuadra(p.monto) || p.impPagadoDoctos.some(cuadra) || cuadra(round2(p.impPagadoDoctos.reduce((a, b) => a + b, 0))));
  if (!importeOk) {
    throw datoInvalido('portal_pago.xml_otro_importe', { importe: mxn(imp) });
  }
}

/**
 * Registra el complemento de pago que el PAC de la flota ya timbró.
 *
 * Likida NO TIMBRA — mismo contrato que `factura_emitida` (0049). Aquí solo se
 * anota el hecho, con su folio fiscal, para que el portal se lo pueda entregar
 * al cliente. El XML es OPCIONAL: sin él, el portal enseña el UUID citable y
 * DICE que el archivo hay que pedírselo a la flota, en vez de ofrecer una
 * descarga que no bajaría nada.
 */
export async function registrarRepEmitido(
  tenantId: string,
  c: RepCrudo,
  actor?: { id?: string; email?: string },
): Promise<string> {
  if (!esUuidValido(c.facturaId)) throw datoInvalido('portal_pago_es.no_se_reconoce_esa_factura');
  if (!esUuidValido(c.pagoId)) throw datoInvalido('portal_pago_es.no_se_reconoce_ese_pago');

  const cfdiUuid = c.cfdiUuid.trim().toLowerCase();
  if (!RE_UUID.test(cfdiUuid)) {
    throw datoInvalido('portal_pago_es.el_folio_fiscal_uuid_del');
  }
  const fechaPago = c.fechaPago.trim();
  if (!RE_FECHA.test(fechaPago) || Number.isNaN(Date.parse(`${fechaPago}T00:00:00Z`))) {
    throw datoInvalido('portal_pago_es.la_fecha_del_pago_del');
  }
  // El MISMO lector de montos que el formulario del cliente, y por la misma
  // razón (`c7-14`/`c7-33`): esto era `Math.round(Number(crudo.replace(...)))`
  // y un «1.234,50» pegado del acuse del PAC entraba como `imp_pagado = 1.23`.
  // El portal se lo enseñaba al cliente junto a su complemento fiscal.
  const imp = montoTecleado(c.impPagado, 'el importe pagado del complemento');
  if (imp <= 0) {
    throw datoInvalido('portal_pago_es.el_importe_pagado_del_complemento');
  }
  const forma = c.formaPago.trim();
  if (forma !== '' && !/^[0-9]{2}$/.test(forma)) {
    throw datoInvalido('portal_pago_es.la_forma_de_pago_del');
  }
  const xml = c.xml.trim();
  if (xml.length > XML_MAX) {
    throw datoInvalido('portal_pago_es.ese_xml_es_demasiado_grande');
  }
  // A37-S18-07: el XML que se guarda es el que el portal le ENTREGA al contador del cliente como «el complemento» con este
  // folio. Antes solo se medía su longitud: cualquier texto —o el XML de OTRO complemento— quedaba rotulado con el UUID
  // tecleado. Ahora tiene que ser un CFDI tipo P cuyo timbre sea ESTE folio y cuyo pago coincida en fecha e importe. Si no
  // se puede comprobar, no se guarda: el complemento se puede registrar sin archivo (el campo es opcional).
  if (xml !== '') verificarXmlDeRep(xml, cfdiUuid, fechaPago, imp);

  // ── EL ABONO QUE AMPARA TIENE QUE SER DE ESTA FACTURA (`c7-25`) ──────────
  //
  // El formulario manda `facturaId` y `pagoId` como dos cadenas independientes,
  // y las FK compuestas de la 0228 solo garantizaban que las dos fueran de la
  // MISMA FLOTA. Un contralor con dos facturas del mismo cliente en pestañas
  // pegaba el `pagoId` de la otra y el portal enseñaba «Importe pagado
  // $12,000.00» sobre un abono que fue a otra factura, con un XML que decía
  // otra cosa.
  //
  // La 0237 lo cierra por esquema (FK de tres columnas contra
  // `pago_recibido (id, factura_id, tenant_id)`), y eso es lo que de verdad lo
  // impide. Esta lectura existe para dos cosas que una FK no puede dar: DECIR
  // qué pasó con palabras en vez de un mensaje de Postgres, y comparar el
  // IMPORTE — que no es una llave y que ninguna restricción puede vigilar.
  const { data: pago, error: errPago } = await acotada(supabaseAdmin().from('pago_recibido')
    .select('id, factura_id, monto')
    .eq('id', c.pagoId).eq('tenant_id', tenantId).maybeSingle(), 'registrarRepEmitido.pago');
  if (errPago) throw new Error(`registrarRepEmitido: no se pudo leer el abono que ampara: ${errPago.message}`);
  if (!pago) {
    throw datoInvalido('portal_pago_es.ese_abono_no_existe_en');
  }
  const filaPago = pago as { factura_id: unknown; monto: unknown };
  if (String(filaPago.factura_id) !== c.facturaId) {
    throw datoInvalido('portal_pago_es.ese_abono_es_de_otra');
  }
  const montoPago = round2(Number(filaPago.monto));
  if (!Number.isFinite(montoPago)) {
    throw new Error('registrarRepEmitido: el abono no trae un monto legible; no se registra un complemento contra una cifra que no se pudo leer.');
  }
  if (Math.abs(montoPago - imp) > TOLERANCIA_ABONO_MXN) {
    throw datoInvalido('portal_pago_es.el_importe_del_complemento_no', { v: mxn(imp), v2: mxn(montoPago) });
  }

  // ── A37-S54-03: EL XML TIENE QUE SER DE ESTA FACTURA Y DE SU CLIENTE ─────────────────────────────────────────────────────
  // `verificarXmlDeRep` (A37-S18-07, arriba) ya comprobó que es un REP tipo P, que su timbre es el UUID tecleado y que fecha e importe
  // coinciden. Falta lo que ata el archivo a ESTA factura: un REP de otro pago —con la misma fecha e importe— se guardaba y el portal
  // PÚBLICO se lo ofrecía al cliente como «el complemento» de esta factura. Se coteja que uno de sus documentos relacionados sea el
  // UUID de la factura (el importe ya lo comprobó `verificarXmlDeRep`) y, si ambos dicen RFC del receptor, que sea el del cliente de la factura.
  if (xml !== '') {
    const rep = parseRepXml(xml);
    const { data: fac, error: errFac } = await acotada(supabaseAdmin().from('factura_emitida')
      .select('id, cfdi_uuid, cliente:cliente_id(rfc)')
      .eq('id', c.facturaId).eq('tenant_id', tenantId).maybeSingle(), 'registrarRepEmitido.factura');
    if (errFac) throw new Error(`registrarRepEmitido: no se pudo leer la factura para cotejar el XML: ${errFac.message}`);
    const filaFac = fac as { cfdi_uuid?: unknown; cliente?: { rfc?: unknown } | Array<{ rfc?: unknown }> | null } | null;
    const uuidFactura = typeof filaFac?.cfdi_uuid === 'string' ? filaFac.cfdi_uuid.trim().toLowerCase() : '';
    if (uuidFactura === '') {
      throw datoInvalido('portal_pago_es.la_factura_aun_no_tiene');
    }
    const amparaEsta = (rep?.pagos ?? []).flatMap((p) => p.doctos).filter((d) => d.idDocumento === uuidFactura);
    if (amparaEsta.length === 0) {
      throw datoInvalido('portal_pago_es.ese_xml_no_ampara_esta');
    }
    const cliente = Array.isArray(filaFac?.cliente) ? filaFac?.cliente[0] : filaFac?.cliente;
    const rfcCliente = typeof cliente?.rfc === 'string' ? cliente.rfc.trim().toUpperCase() : '';
    if (rep?.rfcReceptor && rfcCliente !== '' && rep.rfcReceptor !== rfcCliente) {
      throw datoInvalido('portal_pago_es.el_receptor_del_xml_no', { rfcReceptor: rep.rfcReceptor, rfcCliente });
    }
  }

  const { data, error } = await acotada(supabaseAdmin().from('rep_emitido').insert({
    tenant_id: tenantId,
    factura_id: c.facturaId,
    pago_id: c.pagoId,
    cfdi_uuid: cfdiUuid,
    fecha_pago: fechaPago,
    imp_pagado: imp,
    forma_pago_p: forma === '' ? null : forma,
    xml: xml === '' ? null : xml,
    registrado_por: actor?.id ?? null,
  }).select('id').single(), 'registrarRepEmitido');

  if (error) {
    if (error.code === CHOQUE_UNICO) {
      throw datoInvalido('portal_pago_es.ese_folio_fiscal_ya_esta');
    }
    // Las FK compuestas de la 0228 son las que rechazan un pago o una factura
    // de OTRA flota. No se traducen a "revisa los datos": se dice qué pasó.
    throw new Error(`registrarRepEmitido: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
  if (!id) throw new Error('registrarRepEmitido: el insert no devolvió id');

  await anotar(tenantId, 'rep.registrado', 'rep_emitido', String(id), {
    facturaId: c.facturaId, pagoId: c.pagoId, cfdiUuid, impPagado: imp, conXml: xml !== '',
  }, actor);

  return String(id);
}

/**
 * SELLO TRAS EL HECHO: cuándo el cliente vio SUS complementos por primera vez.
 *
 * `.is('entregado_en', null)` para que sea el PRIMER momento y no el último —
 * la constancia de entrega es una fecha, no un contador de visitas. Best-effort
 * y nunca lanza: no poder anotar el sello no puede impedirle al cliente ver su
 * REP, que es justo lo que el sello está registrando.
 *
 * ── SE SELLAN LOS QUE SE ENSEÑARON, UNO POR UNO (`c7-16`) ────────────────
 *
 * Antes esto sellaba TODOS los REP de la factura sin mirar cuál se había
 * enseñado, mientras la página solo era capaz de mostrar el más reciente. En
 * una factura pagada en tres parcialidades, abrir el enlace dejaba escrito
 * «entregado» sobre dos documentos que nadie vio y que ninguna ruta podía
 * entregar. La 0228 dice de esa columna que es «la constancia de entrega, no
 * una intención de entregar»: una constancia falsa es peor que ninguna.
 *
 * Ahora recibe los folios que de verdad se pusieron delante del cliente. Lista
 * vacía = no hay nada que sellar, y no se toca la tabla.
 */
export async function sellarRepEntregado(
  tenantId: string, facturaId: string, cfdiUuids: string[],
): Promise<void> {
  const uuids = [...new Set(cfdiUuids.map((u) => u.trim().toLowerCase()).filter((u) => u !== ''))];
  if (uuids.length === 0) return;
  try {
    const { error } = await supabaseAdmin().from('rep_emitido')
      .update({ entregado_en: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('factura_id', facturaId)
      .in('cfdi_uuid', uuids)
      .is('entregado_en', null);
    if (error) logger.warn('portal_pago.sello_rep', { err: error.message });
  } catch (e) {
    logger.warn('portal_pago.sello_rep', { err: e instanceof Error ? e.message : String(e) });
  }
}
