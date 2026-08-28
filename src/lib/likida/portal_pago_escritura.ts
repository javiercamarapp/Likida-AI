import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { acotada } from '@/lib/likida/presupuesto';
import { anotarBitacora, type EntidadBitacora } from './bitacora_escritura';
import { DatoInvalido } from './errores';
import { esUuidValido } from './intake/cfdi';
import { registrarPago } from './facturacion_escritura';
import { expiracionDesde, generarTokenPortal, diasDeVigencia } from './portal_pago';

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
    throw new DatoInvalido('No se reconoce esa factura. Recarga la pantalla.');
  }

  const { data: fac, error: errF } = await acotada(supabaseAdmin().from('factura_emitida')
    .select('id, estatus')
    .eq('id', facturaId).eq('tenant_id', tenantId).maybeSingle(), 'crearLigaPago.factura');
  if (errF) throw new Error(`crearLigaPago: ${errF.message}`);
  if (!fac) throw new DatoInvalido('Esa factura no es de tu flota. Recarga la pantalla.');

  const estatus = String((fac as { estatus: unknown }).estatus);
  if (estatus === 'borrador') {
    throw new DatoInvalido('Esa factura es un borrador: todavía no tiene UUID del CFDI y no le cobra a nadie. Márcala como emitida antes de mandarle el enlace a tu cliente.');
  }
  if (estatus === 'cancelada') {
    throw new DatoInvalido('Esa factura está cancelada. No se puede abrir un enlace de pago sobre ella.');
  }

  const token = generarTokenPortal();
  const expiraEn = expiracionDesde(new Date(), diasDeVigencia());

  const { data, error } = await acotada(supabaseAdmin().from('portal_pago_liga').insert({
    tenant_id: tenantId,
    factura_id: facturaId,
    // SOLO el sha256. `token.enClaro` no entra a esta fila ni a ninguna otra.
    token_hash: token.hash,
    token_prefijo: token.prefijo,
    expira_en: expiraEn,
    creada_por: actor?.id ?? null,
  }).select('id').single(), 'crearLigaPago');

  if (error) {
    if (error.code === CHOQUE_UNICO) {
      throw new DatoInvalido('Esa factura ya tiene un enlace vigente. Revócalo antes de generar uno nuevo — así no quedan dos enlaces vivos y solo uno a la vista.');
    }
    throw new Error(`crearLigaPago: ${error.message}`);
  }
  const id = (data as { id?: unknown } | null)?.id;
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
    throw new DatoInvalido('No se reconoce ese enlace. Recarga la pantalla.');
  }

  const { data, error } = await acotada(supabaseAdmin().from('portal_pago_liga')
    .update({ revocada_en: new Date().toISOString(), revocada_por: actor?.id ?? null })
    .eq('id', ligaId).eq('tenant_id', tenantId)
    .is('revocada_en', null)
    .select('id'), 'revocarLigaPago');

  if (error) throw new Error(`revocarLigaPago: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) {
    throw new DatoInvalido('Ese enlace no está vivo en tu flota. Puede que ya estuviera revocado — recarga la pantalla.');
  }

  await anotar(tenantId, 'portal_pago.liga_revocada', 'portal_pago_liga', ligaId, {}, actor);
}

// ── 3. LA CONCILIACIÓN (el humano confirma) ────────────────────────────────

/**
 * Convierte una propuesta en un pago de verdad.
 *
 * EL ORDEN IMPORTA Y ESTÁ ESCRITO: primero nace el pago (por
 * `registrar_pago_tx`, con la factura trabada, que es quien puede rechazar el
 * sobrepago y quien pone `estatus = 'pagada'` en la misma transacción), y solo
 * DESPUÉS se sella la propuesta. Al revés, una propuesta diría "conciliada"
 * mientras el abono se rechaza por sobrepago, y el contralor tendría una
 * factura que se ve cobrada sin un peso encima.
 *
 * El sello de la propuesta va condicionado a `estado = 'pendiente'`: dos
 * pestañas conciliando la misma fila dejan que la segunda toque 0 filas y lo
 * diga, en vez de crear dos abonos por el mismo depósito.
 */
export async function conciliarPropuesta(
  tenantId: string,
  propuestaId: string,
  actor?: { id?: string; email?: string },
): Promise<{ pagoId: string; monto: number }> {
  if (!esUuidValido(propuestaId)) {
    throw new DatoInvalido('No se reconoce ese registro. Recarga la pantalla.');
  }

  const { data: p, error: errP } = await acotada(supabaseAdmin().from('portal_pago_propuesta')
    .select('id, factura_id, fecha, monto, referencia, metodo, estado')
    .eq('id', propuestaId).eq('tenant_id', tenantId).maybeSingle(), 'conciliarPropuesta.leer');
  if (errP) throw new Error(`conciliarPropuesta: ${errP.message}`);
  if (!p) throw new DatoInvalido('Ese registro no es de tu flota. Recarga la pantalla.');

  const fila = p as Record<string, unknown>;
  if (String(fila.estado) !== 'pendiente') {
    throw new DatoInvalido('Ese registro ya estaba resuelto. Recarga la pantalla para ver en qué quedó.');
  }

  // ── EL CANDADO DE LA CARRERA, ANTES DE CREAR EL PAGO ──────────────────
  // Se toma el turno marcando la propuesta como conciliada SIN pago todavía —
  // no se puede, el CHECK de la 0228 lo prohíbe. Así que el turno se toma al
  // revés: `registrarPago` primero, y el UPDATE condicionado a 'pendiente'
  // después. Si dos pestañas llegan a la vez, las DOS crean un abono y la
  // segunda no puede sellar. Por eso la segunda pasada COMPENSA: deja dicho en
  // la bitácora que hubo un abono huérfano, con su id, para que el contralor
  // lo pueda cancelar a mano. Nada se borra en silencio.
  const monto = Number(fila.monto);
  const pagoId = await registrarPago(tenantId, {
    facturaId: String(fila.factura_id),
    fecha: String(fila.fecha),
    monto,
    metodo: (fila.metodo as string | null) ?? null,
    referencia: (fila.referencia as string | null) ?? null,
  }, actor);

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
    await anotar(tenantId, 'portal_pago.conciliacion_duplicada', 'pago_recibido', pagoId, {
      propuestaId, monto,
      nota: 'Otra sesión concilió esta propuesta primero. Este abono quedó registrado y SIN dueño: revísalo y cancélalo si duplica al otro.',
    }, actor);
    throw new DatoInvalido(`Alguien más concilió este registro primero, y el abono de ${monto} que acabas de crear quedó DUPLICADO sobre la factura. Está anotado en la bitácora con el id ${pagoId} — revísalo antes de seguir.`);
  }

  await anotar(tenantId, 'portal_pago.propuesta_conciliada', 'portal_pago_propuesta', propuestaId, {
    pagoId, monto, facturaId: String(fila.factura_id),
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
    throw new DatoInvalido('No se reconoce ese registro. Recarga la pantalla.');
  }
  const nota = motivo.trim();
  if (nota.length < 5) {
    throw new DatoInvalido('Escribe por qué lo descartas. Tu cliente puede preguntar, y "sin motivo" no es una respuesta.');
  }
  if (nota.length > 500) {
    throw new DatoInvalido('El motivo no puede pasar de 500 caracteres.');
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
    throw new DatoInvalido('Ese registro ya estaba resuelto o no es de tu flota. Recarga la pantalla.');
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
  if (!esUuidValido(c.facturaId)) throw new DatoInvalido('No se reconoce esa factura. Recarga la pantalla.');
  if (!esUuidValido(c.pagoId)) throw new DatoInvalido('No se reconoce ese pago. Recarga la pantalla.');

  const cfdiUuid = c.cfdiUuid.trim().toLowerCase();
  if (!RE_UUID.test(cfdiUuid)) {
    throw new DatoInvalido('El folio fiscal (UUID) del complemento no tiene la forma que da el SAT. Cópialo tal cual del acuse de tu PAC.');
  }
  const fechaPago = c.fechaPago.trim();
  if (!RE_FECHA.test(fechaPago) || Number.isNaN(Date.parse(`${fechaPago}T00:00:00Z`))) {
    throw new DatoInvalido('La fecha del pago del complemento no se entiende.');
  }
  const imp = Math.round(Number(c.impPagado.replace(/[$\s,]/g, '')) * 100) / 100;
  if (!Number.isFinite(imp) || imp <= 0) {
    throw new DatoInvalido('El importe pagado del complemento tiene que ser mayor que cero.');
  }
  const forma = c.formaPago.trim();
  if (forma !== '' && !/^[0-9]{2}$/.test(forma)) {
    throw new DatoInvalido('La forma de pago del SAT son dos dígitos (03 transferencia, 01 efectivo…). Déjala vacía si no la tienes.');
  }
  const xml = c.xml.trim();
  if (xml.length > XML_MAX) {
    throw new DatoInvalido('Ese XML es demasiado grande. Registra el complemento sin archivo y compártelo por tu canal de siempre.');
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
      throw new DatoInvalido('Ese folio fiscal ya está registrado en tu flota. Un mismo complemento no se anota dos veces.');
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
 * SELLO TRAS EL HECHO: cuándo el cliente vio su complemento por primera vez.
 *
 * `.is('entregado_en', null)` para que sea el PRIMER momento y no el último —
 * la constancia de entrega es una fecha, no un contador de visitas. Best-effort
 * y nunca lanza: no poder anotar el sello no puede impedirle al cliente ver su
 * REP, que es justo lo que el sello está registrando.
 */
export async function sellarRepEntregado(tenantId: string, facturaId: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin().from('rep_emitido')
      .update({ entregado_en: new Date().toISOString() })
      .eq('tenant_id', tenantId).eq('factura_id', facturaId)
      .is('entregado_en', null);
    if (error) logger.warn('portal_pago.sello_rep', { err: error.message });
  } catch (e) {
    logger.warn('portal_pago.sello_rep', { err: e instanceof Error ? e.message : String(e) });
  }
}
