// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — acceso a datos (tablas de la 0370).
//
// Reglas que aplican a TODO este archivo (las de `CLAUDE.md`):
//   · service_role salta RLS, así que CADA consulta lleva `.eq('tenant_id')`;
//   · supabase-js reporta errores POR VALOR: se revisa `error` siempre y se
//     LANZA. «No pude leer» jamás se vuelve «no hay nada» (por eso `exigir`);
//   · una escritura condicional (`estado` en el WHERE) es el candado: dos
//     invocaciones concurrentes no pueden pisarse el estado.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { exigir } from '../pg';
import { DatoInvalido } from '../errores';
import { destinatarioWhatsApp } from '@/lib/meta/client';
import { validarFormato, type FormatoFlota } from './formato_flota';
import { PATRON_FOLIO } from '../orquestador/escalamiento';
import { ESTADOS, type EstadoLiquidacionExterna, type ConceptoExterno, type LiquidacionExternaNormalizada, type MonedaExterna } from './esquema';

export { ESTADOS };
export type { EstadoLiquidacionExterna };
export type ViaEntrega = 'sesion' | 'plantilla';
export type TipoAcuse = 'recibida' | 'no_coincide';

export type TipoEvento =
  | 'recibida' | 'encolada' | 'enviada' | 'fallback_plantilla' | 'fallida'
  | 'reintento_manual' | 'acuse_recibida' | 'acuse_no_coincide' | 'acuse_confirmado' | 'aviso_oficina';

export interface LiquidacionExterna {
  id: string;
  tenantId: string;
  claveExterna: string;
  huella: string;
  sistemaOrigen: string | null;
  operadorId: string;
  operadorNombre: string | null;
  operadorTelefono: string | null;
  foliosViaje: string[];
  viajeIds: string[];
  periodoDesde: string;
  periodoHasta: string;
  conceptos: ConceptoExterno[];
  total: number;
  moneda: MonedaExterna;
  pdfRuta: string | null;
  pdfOrigen: 'adjunto' | 'generado';
  estado: EstadoLiquidacionExterna;
  via: ViaEntrega | null;
  generacion: number;
  intentos: number;
  proximoIntentoEn: string;
  ultimoError: string | null;
  wamid: string | null;
  enviadaEn: string | null;
  acuseTipo: TipoAcuse | null;
  acuseEn: string | null;
  /** Cuándo el sistema del cliente confirmó que ya leyó el acuse (0561). */
  acuseConfirmadoEn: string | null;
  creadaEn: string;
}

export const COLUMNAS =
  'id, tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids, '
  + 'periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_ruta, pdf_origen, estado, via, '
  + 'generacion, intentos, proximo_intento_en, ultimo_error, wamid, enviada_en, acuse_tipo, acuse_en, acuse_confirmado_en, '
  + 'created_at, operador:operador_id(nombre, telefono)';

export type Fila = Record<string, unknown> & { operador?: { nombre?: string | null; telefono?: string | null } | null };

export function aLiquidacionExterna(r: Fila): LiquidacionExterna {
  const conceptos = Array.isArray(r.conceptos) ? (r.conceptos as ConceptoExterno[]) : [];
  return {
    id: String(r.id),
    tenantId: String(r.tenant_id),
    claveExterna: String(r.clave_externa),
    huella: String(r.huella),
    sistemaOrigen: (r.sistema_origen as string | null) ?? null,
    operadorId: String(r.operador_id),
    operadorNombre: r.operador?.nombre ?? null,
    operadorTelefono: r.operador?.telefono ?? null,
    foliosViaje: Array.isArray(r.folios_viaje) ? (r.folios_viaje as string[]) : [],
    viajeIds: Array.isArray(r.viaje_ids) ? (r.viaje_ids as string[]) : [],
    periodoDesde: String(r.periodo_desde),
    periodoHasta: String(r.periodo_hasta),
    conceptos,
    total: Number(r.total),
    moneda: r.moneda as MonedaExterna,
    pdfRuta: (r.pdf_ruta as string | null) ?? null,
    pdfOrigen: r.pdf_origen as 'adjunto' | 'generado',
    estado: r.estado as EstadoLiquidacionExterna,
    via: (r.via as ViaEntrega | null) ?? null,
    generacion: Number(r.generacion),
    intentos: Number(r.intentos),
    proximoIntentoEn: String(r.proximo_intento_en),
    ultimoError: (r.ultimo_error as string | null) ?? null,
    wamid: (r.wamid as string | null) ?? null,
    enviadaEn: (r.enviada_en as string | null) ?? null,
    acuseTipo: (r.acuse_tipo as TipoAcuse | null) ?? null,
    acuseEn: (r.acuse_en as string | null) ?? null,
    acuseConfirmadoEn: (r.acuse_confirmado_en as string | null) ?? null,
    creadaEn: String(r.created_at),
  };
}

// ── Storage, outbox y datos de la flota ─────────────────────────────────────
// Viven aquí —y no en un módulo cada uno— porque este es el ÚNICO archivo del
// módulo con acceso directo a Supabase: el guardia de la frontera de datos
// (`frontera_datos_guardiana.test.ts`) cuenta archivos, y la regla es juntar el
// acceso, no repartirlo.

const BUCKET = 'liquidaciones';

export const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function subirArchivoExterno(ruta: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET)
    .upload(ruta, Buffer.from(bytes), { contentType, upsert: true }), 'liqext.subir');
  if (res.error) throw new Error(`liquidacion_externa subir ${contentType === TIPO_XLSX ? 'Excel' : 'PDF'}: ${res.error.message}`);
}

export const subirPdfExterno = (ruta: string, bytes: Uint8Array): Promise<void> => subirArchivoExterno(ruta, bytes, 'application/pdf');

/** Firma la ruta. Lanza si no puede: una URL ausente NO se reemplaza por nada,
 *  porque un mensaje sin documento diría «el detalle va en el PDF» sin PDF. */
export async function firmarPdfExterno(ruta: string, ttlSegundos: number, descarga?: string): Promise<string> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET)
    .createSignedUrl(ruta, ttlSegundos, descarga ? { download: descarga } : undefined), 'liqext.firmar');
  if (res.error || !res.data?.signedUrl) {
    throw new Error(`liquidacion_externa firmar PDF: ${res.error?.message ?? 'sin URL'}`);
  }
  return res.data.signedUrl;
}

/** La razón social de la flota, para el encabezado del PDF que Likida genera.
 *  Un nombre NUNCA se inventa: si no se pudo leer (o no está capturado),
 *  `null`, y el PDF lleva «Likida». */
export async function leerRazonSocial(tenantId: string): Promise<string | null> {
  const res = await acotada(supabaseAdmin().from('tenant')
    .select('razon_social').eq('id', tenantId).maybeSingle(), 'liqext.razon');
  if (res.error) return null;
  return (res.data as { razon_social?: string | null } | null)?.razon_social?.trim() || null;
}

// ── el formato de la flota (0564) ───────────────────────────────────────────

export interface ConfigFormatoFlota {
  formato: FormatoFlota;
  nombreMuestra: string | null;
  /** E.164 sin «+»: quién recibe COPIA de cada liquidación entregada. */
  copiaTelefonos: string[];
  /** E.164 sin «+»: quién es AVISADO cuando un chofer responde «No coincide». */
  discrepanciaTelefonos: string[];
}

/** La tabla de la 0564 todavía no existe en esta base (el código corre sin migrar). */
const tablaAusente = (e: { code?: string; message?: string }): boolean =>
  e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? '');

/**
 * El formato de la flota, o `null` si no tiene (o la base aún no trae la 0564):
 * entonces todo sigue como siempre (PDF genérico, sin copia). Un error de LECTURA
 * distinto LANZA: caer en silencio al formato genérico entregaría un documento con
 * otro aspecto y sin copia al jefe, y nadie lo sabría. Una plantilla guardada que ya
 * no valida se grita y se trata como ausente (no tumba la recepción de todas las
 * liquidaciones de la flota).
 */
export async function leerFormatoFlota(tenantId: string): Promise<ConfigFormatoFlota | null> {
  const res = await acotada(supabaseAdmin().from('liquidacion_formato_flota')
    .select('formato, nombre_muestra, copia_telefonos, discrepancia_telefonos')
    .eq('tenant_id', tenantId).maybeSingle(), 'liqext.formato_leer');
  if (res.error) {
    if (tablaAusente(res.error)) return null;
    throw new Error(`liquidacion_formato_flota leer: ${res.error.message}`);
  }
  const f = res.data as { formato: unknown; nombre_muestra: string | null; copia_telefonos: string[] | null; discrepancia_telefonos: string[] | null } | null;
  // Fila SOLO de teléfonos (0645, formato nulo): no hay formato; los teléfonos salen por `leerTelefonosFlota`.
  if (!f || f.formato === null) return null;
  try {
    return {
      formato: validarFormato(f.formato),
      nombreMuestra: f.nombre_muestra,
      copiaTelefonos: f.copia_telefonos ?? [],
      discrepanciaTelefonos: f.discrepancia_telefonos ?? [],
    };
  } catch (e) {
    logger.error('liqext.formato_invalido', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export interface TelefonosFlota {
  /** E.164 sin «+»: quién recibe COPIA de cada liquidación entregada. */
  copia: string[];
  /** E.164 sin «+»: quién es AVISADO cuando un chofer responde «No coincide». */
  discrepancia: string[];
}

/**
 * Los teléfonos de la copia y del aviso de discrepancia, CON O SIN formato de Excel (la fila puede traer solo teléfonos,
 * 0645). `null` = la flota no ha designado a nadie (o la base aún no trae la 0564). Un error de lectura distinto LANZA: caer
 * en «nadie designado» mandaría el aviso a quien ve dinero en vez de a la persona responsable.
 */
export async function leerTelefonosFlota(tenantId: string): Promise<TelefonosFlota | null> {
  const res = await acotada(supabaseAdmin().from('liquidacion_formato_flota')
    .select('copia_telefonos, discrepancia_telefonos').eq('tenant_id', tenantId).maybeSingle(), 'liqext.telefonos_leer');
  if (res.error) {
    if (tablaAusente(res.error)) return null;
    throw new Error(`liquidacion_formato_flota leer teléfonos: ${res.error.message}`);
  }
  const f = res.data as { copia_telefonos: string[] | null; discrepancia_telefonos: string[] | null } | null;
  return f ? { copia: f.copia_telefonos ?? [], discrepancia: f.discrepancia_telefonos ?? [] } : null;
}

export async function guardarFormatoFlota(tenantId: string, c: ConfigFormatoFlota, por: string): Promise<void> {
  const res = await acotada(supabaseAdmin().from('liquidacion_formato_flota').upsert({
    tenant_id: tenantId, formato: c.formato, nombre_muestra: c.nombreMuestra,
    copia_telefonos: c.copiaTelefonos, discrepancia_telefonos: c.discrepanciaTelefonos,
    actualizado_en: new Date().toISOString(), actualizado_por: por.slice(0, 120),
  }, { onConflict: 'tenant_id' }), 'liqext.formato_guardar');
  if (res.error) throw new Error(`liquidacion_formato_flota guardar: ${res.error.message}`);
}

export async function borrarFormatoFlota(tenantId: string): Promise<void> {
  const res = await acotada(supabaseAdmin().from('liquidacion_formato_flota').delete().eq('tenant_id', tenantId), 'liqext.formato_borrar');
  if (res.error) throw new Error(`liquidacion_formato_flota borrar: ${res.error.message}`);
}

export interface FilaOutbox {
  dedupe_key: string;
  estado: 'pending' | 'sending' | 'sent' | 'dead';
  provider_message_id: string | null;
  ultimo_error: string | null;
}

/** El estado de los mensajes que ESTA liquidación tiene en la cola de WhatsApp.
 *  `wa_outbox` no tiene tenant_id: se lee por llaves de deduplicación que
 *  contienen el id de la liquidación, y quien llama ya validó el tenant de esa
 *  liquidación antes de armarlas. LANZA ante error: no se decide a ciegas entre
 *  encolar y no encolar. */
export async function leerFilasOutbox(llaves: string[]): Promise<Map<string, FilaOutbox>> {
  const res = await acotada(supabaseAdmin().from('wa_outbox')
    .select('dedupe_key, estado, provider_message_id, ultimo_error').in('dedupe_key', llaves), 'liqext.outbox');
  const filas = (exigir(res, 'liqext.outbox') ?? []) as FilaOutbox[];
  return new Map(filas.map((f) => [f.dedupe_key, f]));
}

// ── operador ────────────────────────────────────────────────────────────────

export interface OperadorDestino { id: string; nombre: string; telefono: string; activo: boolean }

/**
 * Resuelve al chofer DENTRO de la flota. Si el cuerpo trae más de una forma de
 * identificarlo (`id` y `telefono`, por ejemplo) TODAS tienen que apuntar al
 * mismo chofer: dos formas que discrepan son un dato que el cliente tiene mal,
 * y entregar la liquidación a uno de los dos adivinando sería mandarle el pago
 * a la persona equivocada.
 */
export async function resolverOperadorDestino(
  tenantId: string,
  ref: LiquidacionExternaNormalizada['operador'],
): Promise<OperadorDestino> {
  const noEncontrado = () => new DatoInvalido(
    'No encontré a ese operador en tu flota. Manda `operador.id`, `operador.telefono` o `operador.numeroEmpleado` de un chofer dado de alta en Likida.',
  );
  const lecturas: Array<Promise<OperadorDestino[]>> = [];
  const leer = async (columna: 'id' | 'telefono' | 'numero_empleado', valor: string): Promise<OperadorDestino[]> => {
    const res = await acotada(supabaseAdmin().from('operador')
      .select('id, nombre, telefono, activo')
      .eq('tenant_id', tenantId).eq(columna, valor).order('id').limit(5), 'liqext.operador');
    const filas = (exigir(res, 'liqext.operador') ?? []) as Array<{ id: string; nombre: string; telefono: string; activo: boolean }>;
    return filas.map((f) => ({ id: String(f.id), nombre: String(f.nombre), telefono: String(f.telefono), activo: f.activo === true }));
  };
  if (ref.id) lecturas.push(leer('id', ref.id));
  if (ref.numeroEmpleado) lecturas.push(leer('numero_empleado', ref.numeroEmpleado));
  if (ref.telefono) {
    // El teléfono se guarda con las variantes de México (52…/521…): se busca
    // por las dos formas, igual que `resolveOperador`.
    const base = destinatarioWhatsApp(ref.telefono);
    const mx = /^52(\d{10})$/.exec(base);
    const variantes = mx ? [base, `521${mx[1]}`, `+${base}`, mx[1]] : [base];
    lecturas.push((async () => {
      const res = await acotada(supabaseAdmin().from('operador')
        .select('id, nombre, telefono, activo')
        .eq('tenant_id', tenantId).in('telefono', variantes).order('id').limit(5), 'liqext.operador_tel');
      const filas = (exigir(res, 'liqext.operador_tel') ?? []) as Array<{ id: string; nombre: string; telefono: string; activo: boolean }>;
      return filas.map((f) => ({ id: String(f.id), nombre: String(f.nombre), telefono: String(f.telefono), activo: f.activo === true }));
    })());
  }

  const resultados = await Promise.all(lecturas);
  const conjuntos = resultados.map((r) => new Set(r.map((o) => o.id)));
  if (conjuntos.some((c) => c.size === 0)) throw noEncontrado();
  // Intersección: el chofer que cumple TODAS las formas mandadas.
  const comunes = [...conjuntos[0]].filter((id) => conjuntos.every((c) => c.has(id)));
  if (comunes.length === 0) {
    throw new DatoInvalido('Los datos del operador no coinciden entre sí: `id`, `telefono` y `numeroEmpleado` apuntan a choferes distintos. No se entrega la liquidación a quien no se sabe.');
  }
  if (comunes.length > 1) {
    throw new DatoInvalido('Esos datos identifican a más de un operador de tu flota. Usa `operador.id`, que es único.');
  }
  const operador = resultados.flat().find((o) => o.id === comunes[0]);
  if (!operador) throw noEncontrado();
  if (!operador.activo) {
    throw new DatoInvalido('Ese operador está dado de baja: no se le entrega una liquidación por WhatsApp. Reactívalo en Likida o corrige el operador.');
  }
  return operador;
}

/** Los viajes de Likida que coinciden con los folios del cliente. Vacío no es
 *  error: el viaje puede vivir solo en su TMS. */
export async function resolverViajeIds(tenantId: string, folios: string[]): Promise<string[]> {
  if (folios.length === 0) return [];
  const res = await acotada(supabaseAdmin().from('viaje')
    .select('id').eq('tenant_id', tenantId).in('folio', folios).order('id').limit(200), 'liqext.viajes');
  return ((exigir(res, 'liqext.viajes') ?? []) as Array<{ id: string }>).map((v) => String(v.id));
}

// ── lectura ─────────────────────────────────────────────────────────────────

export async function buscarPorClave(tenantId: string, claveExterna: string): Promise<LiquidacionExterna | null> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select(COLUMNAS).eq('tenant_id', tenantId).eq('clave_externa', claveExterna).maybeSingle(), 'liqext.buscar');
  const fila = exigir(res, 'liqext.buscar') as unknown as Fila | null;
  return fila ? aLiquidacionExterna(fila) : null;
}

export async function leerPorId(tenantId: string, id: string): Promise<LiquidacionExterna | null> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select(COLUMNAS).eq('tenant_id', tenantId).eq('id', id).maybeSingle(), 'liqext.leer');
  const fila = exigir(res, 'liqext.leer') as unknown as Fila | null;
  return fila ? aLiquidacionExterna(fila) : null;
}

export interface FiltroListado {
  estado?: EstadoLiquidacionExterna;
  /** Lo que apretó el chofer. Filtra por `acuse_tipo` (y por sí solo ya implica
   *  `estado = acusada`: un acuse solo existe en una acusada). */
  acuseTipo?: TipoAcuse;
  operadorId?: string;
  claveExterna?: string;
  /** Día de México, inclusivo. Filtra por `created_at`. */
  desde?: string;
  hasta?: string;
}

export interface Cursor { creadoEn: string; id: string }

/**
 * Una página de liquidaciones, del tenant, de la más nueva a la más vieja, con
 * cursor keyset `(created_at, id)` — el mismo que `/v1/viajes`: una fila nueva
 * a media paginación no desplaza a nadie. Pide UNA de más para saber `hayMas`.
 */
export async function listarLiquidacionesExternas(
  tenantId: string, filtro: FiltroListado, limite: number, despues: Cursor | null, conConteo: boolean,
): Promise<{ filas: LiquidacionExterna[]; hayMas: boolean; total: number | null }> {
  let q = supabaseAdmin().from('liquidacion_externa')
    .select(COLUMNAS, conConteo ? { count: 'exact' } : {})
    .eq('tenant_id', tenantId);
  if (filtro.estado) q = q.eq('estado', filtro.estado);
  if (filtro.acuseTipo) q = q.eq('acuse_tipo', filtro.acuseTipo);
  if (filtro.operadorId) q = q.eq('operador_id', filtro.operadorId);
  if (filtro.claveExterna) q = q.eq('clave_externa', filtro.claveExterna);
  if (filtro.desde) q = q.gte('created_at', `${filtro.desde}T00:00:00-06:00`);
  if (filtro.hasta) {
    const sig = new Date(`${filtro.hasta}T00:00:00Z`);
    sig.setUTCDate(sig.getUTCDate() + 1);
    q = q.lt('created_at', `${sig.toISOString().slice(0, 10)}T00:00:00-06:00`);
  }
  if (despues) {
    q = q.or(`created_at.lt.${despues.creadoEn},and(created_at.eq.${despues.creadoEn},id.lt.${despues.id})`);
  }
  q = q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, limite);
  const res = await acotada(q, 'liqext.listar');
  const filas = ((exigir(res, 'liqext.listar') ?? []) as unknown as Fila[]);
  return {
    filas: filas.slice(0, limite).map(aLiquidacionExterna),
    hayMas: filas.length > limite,
    total: typeof res.count === 'number' ? res.count : null,
  };
}

/** Cuántas hay por estado — para las fichas del tablero. Un conteo EXACTO por
 *  estado (no el largo de una página): `null` en un estado = no se pudo contar. */
export async function contarPorEstado(tenantId: string): Promise<Record<EstadoLiquidacionExterna, number | null>> {
  const salida = {} as Record<EstadoLiquidacionExterna, number | null>;
  await Promise.all(ESTADOS.map(async (estado) => {
    const res = await acotada(supabaseAdmin().from('liquidacion_externa')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('estado', estado), 'liqext.contar');
    salida[estado] = res.error || typeof res.count !== 'number' ? null : res.count;
  }));
  return salida;
}

/** Cuántas respondió el chofer «No coincide». Es el número que la oficina tiene
 *  que mirar primero, y por eso se cuenta aparte: dentro de `acusada` se perdería.
 *  `null` = no se pudo contar (jamás un 0 que nadie midió). */
export async function contarNoCoincide(tenantId: string): Promise<number | null> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('estado', 'acusada').eq('acuse_tipo', 'no_coincide'), 'liqext.contar_no_coincide');
  return res.error || typeof res.count !== 'number' ? null : res.count;
}

// ── escritura ───────────────────────────────────────────────────────────────

export interface NuevaLiquidacionExterna {
  tenantId: string;
  datos: LiquidacionExternaNormalizada;
  huella: string;
  operadorId: string;
  viajeIds: string[];
  pdfRuta: string | null;
  pdfOrigen: 'adjunto' | 'generado';
  pdfSha256: string | null;
}

export async function insertarLiquidacionExterna(n: NuevaLiquidacionExterna): Promise<LiquidacionExterna> {
  const d = n.datos;
  const res = await acotada(supabaseAdmin().from('liquidacion_externa').insert({
    tenant_id: n.tenantId,
    clave_externa: d.claveExterna,
    huella: n.huella,
    sistema_origen: d.sistemaOrigen,
    operador_id: n.operadorId,
    folios_viaje: d.viajes,
    viaje_ids: n.viajeIds,
    periodo_desde: d.periodo.desde,
    periodo_hasta: d.periodo.hasta,
    conceptos: d.conceptos,
    total: d.total,
    moneda: d.moneda,
    pdf_ruta: n.pdfRuta,
    pdf_origen: n.pdfOrigen,
    pdf_sha256: n.pdfSha256,
  }).select(COLUMNAS).single(), 'liqext.insertar');
  if (res.error) throw new Error(`liquidacion_externa insertar: ${res.error.message}`);
  return aLiquidacionExterna(res.data as unknown as Fila);
}

export async function registrarEvento(
  tenantId: string, liquidacionId: string, tipo: TipoEvento, detalle: Record<string, unknown> = {},
): Promise<void> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa_evento')
    .insert({ tenant_id: tenantId, liquidacion_externa_id: liquidacionId, tipo, detalle }), 'liqext.evento');
  // La bitácora NO tumba la operación que describe (el mensaje ya salió o el
  // estado ya cambió), pero tampoco se calla: queda en el log.
  if (res.error) {
    logger.warn('liqext.evento_sin_escribir', { tipo, err: res.error.message });
  }
}

export async function eventosDe(tenantId: string, liquidacionId: string): Promise<Array<{ tipo: string; detalle: Record<string, unknown>; creadoEn: string }>> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa_evento')
    .select('tipo, detalle, created_at').eq('tenant_id', tenantId).eq('liquidacion_externa_id', liquidacionId)
    .order('id', { ascending: true }).limit(200), 'liqext.eventos');
  return ((exigir(res, 'liqext.eventos') ?? []) as Array<{ tipo: string; detalle: Record<string, unknown> | null; created_at: string }>)
    .map((e) => ({ tipo: e.tipo, detalle: e.detalle ?? {}, creadoEn: e.created_at }));
}

// ── copia al jefe: reclamo atómico por teléfono (mig. 0620) ─────────────────

export interface ReclamoCopia { token: string }

/** La función RPC o la tabla de la 0620 todavía no existen en esta base. */
const rpcAusente = (e: { code?: string; message?: string }): boolean =>
  e.code === '42883' || e.code === 'PGRST202' || tablaAusente(e) || /could not find the function/i.test(e.message ?? '');

/**
 * Reclama el envío de la copia a UN teléfono. `ReclamoCopia` = te toca mandar;
 * `null` = ya salió o lo está mandando otro; `'sin_candado'` = la base no trae la
 * 0620 (el código sigue con la bitácora, sin candado atómico). Un error distinto
 * LANZA: no se manda un mensaje con cifras sin saber si otro ya lo mandó.
 */
export async function reclamarCopiaJefe(
  tenantId: string, liquidacionId: string, generacion: number, telefono: string,
): Promise<ReclamoCopia | null | 'sin_candado'> {
  const res = await acotada(supabaseAdmin().rpc('reclamar_copia_jefe', {
    p_tenant: tenantId, p_liquidacion: liquidacionId, p_generacion: generacion, p_telefono: telefono,
  }), 'liqext.copia_reclamar');
  if (res.error) {
    if (rpcAusente(res.error)) return 'sin_candado';
    throw new Error(`reclamar_copia_jefe: ${res.error.message}`);
  }
  return typeof res.data === 'string' && res.data ? { token: res.data } : null;
}

/** Cierra el reclamo: aceptada = true no se repite; false lo suelta para reintentar. No lanza. */
export async function cerrarCopiaJefe(
  tenantId: string, liquidacionId: string, generacion: number, telefono: string, reclamo: ReclamoCopia, aceptada: boolean,
): Promise<boolean> {
  try {
    const res = await acotada(supabaseAdmin().rpc('cerrar_copia_jefe', {
      p_tenant: tenantId, p_liquidacion: liquidacionId, p_generacion: generacion, p_telefono: telefono,
      p_claim: reclamo.token, p_aceptada: aceptada,
    }), 'liqext.copia_cerrar');
    if (res.error) {
      logger.warn('liqext.copia_cerrar_fallo', { err: res.error.message });
      return false;
    }
    return res.data === true;
  } catch (e) {
    logger.warn('liqext.copia_cerrar_fallo', { err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

// ── el aviso de discrepancia: estado, reclamo y reintento (mig. 0643 + 0644) ─
// La tabla y las RPC son de las migraciones 0643/0644. Contra una base SIN ellas el código sigue como antes (avisa una sola
// vez y deja el resultado en la bitácora), así que desplegar no exige aplicarlas: cada función lo declara con 'sin_rpc'.

export type EstadoAvisoDiscrepancia = 'pendiente' | 'enviando' | 'enviado' | 'fallido';

export interface AvisoDiscrepancia {
  liquidacionId: string;
  tenantId: string;
  ciclo: number;
  estado: EstadoAvisoDiscrepancia;
  intentos: number;
  proximoIntentoEn: string;
  ultimoError: string | null;
  /** A quién YA le llegó (o quedó en el outbox): un reintento va solo a los faltantes. */
  telefonosAceptados: string[];
  /** La tarea que se abrió para una persona en la cola del orquestador (0650), si ya se abrió. */
  tareaId: string | null;
  enviadoEn: string | null;
}

const COLUMNAS_AVISO =
  'liquidacion_externa_id, tenant_id, ciclo, estado, intentos, proximo_intento_en, ultimo_error, telefonos_aceptados, tarea_id, enviado_en';

export function aAvisoDiscrepancia(r: Record<string, unknown>): AvisoDiscrepancia {
  return {
    liquidacionId: String(r.liquidacion_externa_id),
    tenantId: String(r.tenant_id),
    ciclo: Number(r.ciclo),
    estado: r.estado as EstadoAvisoDiscrepancia,
    intentos: Number(r.intentos),
    proximoIntentoEn: String(r.proximo_intento_en),
    ultimoError: (r.ultimo_error as string | null) ?? null,
    telefonosAceptados: Array.isArray(r.telefonos_aceptados) ? (r.telefonos_aceptados as string[]) : [],
    tareaId: (r.tarea_id as string | null) ?? null,
    enviadoEn: (r.enviado_en as string | null) ?? null,
  };
}

/** Cuántos intentos tiene el aviso antes de quedar `fallido` a la vista del panel (donde «Reavisar» lo rearma). */
export const MAX_INTENTOS_AVISO = 5;

export interface ReclamoAviso { token: string }

/**
 * «No coincide» ATÓMICO: una sola sentencia condicional que, en la misma transacción, deja el aviso pendiente.
 * `{ ciclo }` = esta llamada hizo la transición (y es la ÚNICA que debe avisar); `{ ciclo: null }` = ya era «No coincide»,
 * o la liquidación no es de ese operador/flota; `'sin_rpc'` = la base no trae la 0644 (el llamador usa la ruta de siempre).
 */
export async function registrarNoCoincideAtomico(
  tenantId: string, liquidacionId: string, operadorId: string, ahoraIso: string,
): Promise<{ ciclo: number | null } | 'sin_rpc'> {
  const res = await acotada(supabaseAdmin().rpc('registrar_acuse_no_coincide', {
    p_tenant: tenantId, p_liquidacion: liquidacionId, p_operador: operadorId, p_ahora: ahoraIso,
  }), 'liqext.no_coincide_atomico');
  if (res.error) {
    if (rpcAusente(res.error)) return 'sin_rpc';
    throw new Error(`registrar_acuse_no_coincide: ${res.error.message}`);
  }
  return { ciclo: typeof res.data === 'number' ? res.data : null };
}

/** Reclama el envío del aviso. `null` = ya salió, no toca todavía o lo manda otra invocación. LANZA ante un error real. */
export async function reclamarAvisoDiscrepancia(
  tenantId: string, liquidacionId: string, ciclo: number, ahoraIso: string,
): Promise<ReclamoAviso | null> {
  const res = await acotada(supabaseAdmin().rpc('reclamar_aviso_discrepancia', {
    p_tenant: tenantId, p_liquidacion: liquidacionId, p_ciclo: ciclo, p_ahora: ahoraIso,
  }), 'liqext.aviso_reclamar');
  if (res.error) throw new Error(`reclamar_aviso_discrepancia: ${res.error.message}`);
  return typeof res.data === 'string' && res.data ? { token: res.data } : null;
}

export interface CierreAviso {
  resultado: 'enviado' | 'reintentar' | 'fallido';
  /** Los teléfonos que aceptaron AHORA (se suman a los de antes). */
  aceptados: string[];
  error?: string | null;
  /** Cuándo toca el próximo intento (solo con `reintentar`). */
  proximoIso?: string;
}

/** Cierra el reclamo con el token vigente. Devuelve el estado resultante, o `null` si ya no era vigente. No lanza. */
export async function cerrarAvisoDiscrepancia(
  tenantId: string, liquidacionId: string, ciclo: number, reclamo: ReclamoAviso, c: CierreAviso, ahoraIso: string,
): Promise<EstadoAvisoDiscrepancia | null> {
  try {
    const res = await acotada(supabaseAdmin().rpc('cerrar_aviso_discrepancia', {
      p_tenant: tenantId, p_liquidacion: liquidacionId, p_ciclo: ciclo, p_claim: reclamo.token, p_resultado: c.resultado,
      p_aceptados: c.aceptados, p_error: c.error ?? null, p_proximo: c.proximoIso ?? null,
      p_max_intentos: MAX_INTENTOS_AVISO, p_ahora: ahoraIso,
    }), 'liqext.aviso_cerrar');
    if (res.error) {
      logger.error('liqext.aviso_cerrar_fallo', { id: liquidacionId, err: res.error.message });
      return null;
    }
    return typeof res.data === 'string' ? (res.data as EstadoAvisoDiscrepancia) : null;
  } catch (e) {
    logger.error('liqext.aviso_cerrar_fallo', { id: liquidacionId, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** «Reavisar»: devuelve el aviso fallido o pendiente a pendiente-ya. `{ ciclo: null }` = ya salió, lo manda alguien o no hay «No coincide». */
export async function rearmarAvisoDiscrepancia(
  tenantId: string, liquidacionId: string, ahoraIso: string,
): Promise<{ ciclo: number | null } | 'sin_rpc'> {
  const res = await acotada(supabaseAdmin().rpc('rearmar_aviso_discrepancia', {
    p_tenant: tenantId, p_liquidacion: liquidacionId, p_ahora: ahoraIso,
  }), 'liqext.aviso_rearmar');
  if (res.error) {
    if (rpcAusente(res.error)) return 'sin_rpc';
    throw new Error(`rearmar_aviso_discrepancia: ${res.error.message}`);
  }
  return { ciclo: typeof res.data === 'number' ? res.data : null };
}

/** Un aviso por (liquidación, ciclo). `null` = no existe (o la tabla aún no está en la base). LANZA ante otro error. */
export async function leerAvisoDiscrepancia(tenantId: string, liquidacionId: string, ciclo: number): Promise<AvisoDiscrepancia | null> {
  const res = await acotada(supabaseAdmin().from('liquidacion_aviso_discrepancia').select(COLUMNAS_AVISO)
    .eq('tenant_id', tenantId).eq('liquidacion_externa_id', liquidacionId).eq('ciclo', ciclo).maybeSingle(), 'liqext.aviso_leer');
  if (res.error) {
    if (tablaAusente(res.error)) return null;
    throw new Error(`liquidacion_aviso_discrepancia leer: ${res.error.message}`);
  }
  return res.data ? aAvisoDiscrepancia(res.data as unknown as Record<string, unknown>) : null;
}

/**
 * El aviso más reciente de cada liquidación dada (para pintar el panel). `null` = la tabla aún no está en la base o no se
 * pudo leer: la pantalla no muestra rótulo de aviso, jamás inventa uno.
 */
export async function avisosDiscrepanciaDe(tenantId: string, ids: string[]): Promise<Map<string, AvisoDiscrepancia> | null> {
  if (ids.length === 0) return new Map();
  const res = await acotada(supabaseAdmin().from('liquidacion_aviso_discrepancia').select(COLUMNAS_AVISO)
    .eq('tenant_id', tenantId).in('liquidacion_externa_id', ids)
    .order('liquidacion_externa_id').order('ciclo', { ascending: false }).limit(ids.length * 5), 'liqext.avisos_panel');
  if (res.error) {
    if (!tablaAusente(res.error)) logger.warn('liqext.avisos_panel_fallo', { err: res.error.message });
    return null;
  }
  const mapa = new Map<string, AvisoDiscrepancia>();
  for (const f of (res.data ?? []) as unknown as Array<Record<string, unknown>>) {
    const a = aAvisoDiscrepancia(f);
    if (!mapa.has(a.liquidacionId)) mapa.set(a.liquidacionId, a); // el primero es el ciclo más reciente
  }
  return mapa;
}

/** Guarda la tarea que se abrió para este aviso (para no abrir otra si la primera ya se atendió). Mejor esfuerzo. */
export async function marcarTareaAviso(tenantId: string, liquidacionId: string, ciclo: number, tareaId: string): Promise<void> {
  const res = await acotada(supabaseAdmin().from('liquidacion_aviso_discrepancia').update({ tarea_id: tareaId })
    .eq('tenant_id', tenantId).eq('liquidacion_externa_id', liquidacionId).eq('ciclo', ciclo), 'liqext.aviso_tarea');
  if (res.error) logger.warn('liqext.aviso_tarea_fallo', { id: liquidacionId, err: res.error.message });
}

export interface TareaDiferencia {
  /** Texto ya limpio (sin números largos, correos ni ligas): viaja a una persona. */
  resumen: string;
  viajeFolio: string | null;
  viajeId: string | null;
}

/**
 * La tarea durable en la cola del orquestador (0650): destino liquidación, motivo `diferencia_liquidacion`, UNA abierta por
 * liquidación (el índice único parcial de la 0650 hace que un reintento no abra otra). No manda mensajes ni toca dinero.
 * `no_disponible` = la base aún no trae la 0650. LANZA ante cualquier otro error: no se da por abierta una tarea que no se abrió.
 */
export async function crearTareaDiferenciaLiquidacion(
  tenantId: string, liquidacionId: string, t: TareaDiferencia,
): Promise<{ estado: 'creada' | 'ya_abierta'; id: string } | { estado: 'no_disponible' }> {
  const db = supabaseAdmin();
  const folio = t.viajeFolio && PATRON_FOLIO.test(t.viajeFolio) ? t.viajeFolio : null;
  const dedupe = `liquidacion|diferencia_liquidacion|liq:${liquidacionId}`;
  const ins = await acotada(db.from('orquestador_escalacion').insert({
    tenant_id: tenantId, destino: 'liquidacion', motivo: 'diferencia_liquidacion', viaje_id: t.viajeId, viaje_folio: folio,
    resumen: t.resumen, pedida_por_rol: 'sistema', pedida_por_usuario: null, dedupe_key: dedupe,
  }).select('id').single(), 'liqext.tarea_crear');
  if (ins.error) {
    if (tablaAusente(ins.error)) return { estado: 'no_disponible' };
    if (ins.error.code === '23505') {
      const previa = await acotada(db.from('orquestador_escalacion').select('id')
        .eq('tenant_id', tenantId).eq('dedupe_key', dedupe).eq('estado', 'abierta').order('creada_en', { ascending: false }).order('id').limit(1), 'liqext.tarea_previa');
      const f = ((previa.data ?? []) as Array<{ id: string }>)[0];
      if (f) return { estado: 'ya_abierta', id: String(f.id) };
    }
    throw new Error(`orquestador_escalacion crear: ${ins.error.message}`);
  }
  return { estado: 'creada', id: String((ins.data as { id: string }).id) };
}

/**
 * Transición CONDICIONAL de estado: solo se aplica si la fila sigue en alguno
 * de los estados `desde`. Devuelve si la aplicó. Es el candado contra dos
 * invocaciones (el POST y el cron, o dos crons) tocando la misma fila.
 */
export async function transicionar(
  tenantId: string, id: string, desde: EstadoLiquidacionExterna[],
  cambios: Record<string, unknown>,
  /** Además del estado, la fila NO debe traer ya ese acuse: dos entregas del mismo botón no aplican las dos
   *  (la primera lo cambia; la segunda ve el acuse igual y no transiciona, con lo que tampoco repite su aviso). */
  opciones: { acuseDistintoDe?: TipoAcuse } = {},
): Promise<boolean> {
  let q = supabaseAdmin().from('liquidacion_externa')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', desde);
  if (opciones.acuseDistintoDe) q = q.or(`acuse_tipo.is.null,acuse_tipo.neq.${opciones.acuseDistintoDe}`);
  const res = await acotada(q.select('id'), 'liqext.transicion');
  if (res.error) throw new Error(`liquidacion_externa transición: ${res.error.message}`);
  return (res.data ?? []).length > 0;
}

// ── salida hacia el sistema del cliente (SAP/TMS), por pull ─────────────────

/** Los acuses de los choferes que el sistema del cliente aún NO confirmó
 *  haber leído, en el orden en que se leen (`acuse_en`, `id`). */
export async function listarAcusesPendientes(
  tenantId: string, limite: number, despues: { acuseEn: string; id: string } | null,
): Promise<{ filas: LiquidacionExterna[]; hayMas: boolean }> {
  let q = supabaseAdmin().from('liquidacion_externa').select(COLUMNAS)
    .eq('tenant_id', tenantId).not('acuse_en', 'is', null).is('acuse_confirmado_en', null);
  if (despues) {
    q = q.or(`acuse_en.gt.${despues.acuseEn},and(acuse_en.eq.${despues.acuseEn},id.gt.${despues.id})`);
  }
  q = q.order('acuse_en', { ascending: true }).order('id', { ascending: true }).range(0, limite);
  const res = await acotada(q, 'liqext.acuses_pendientes');
  const filas = ((exigir(res, 'liqext.acuses_pendientes') ?? []) as unknown as Fila[]);
  return { filas: filas.slice(0, limite).map(aLiquidacionExterna), hayMas: filas.length > limite };
}

export interface ResultadoConfirmacion {
  /** Ids que pasaron de «por leer» a «confirmado» en esta llamada. */
  confirmadas: string[];
  /** Ya estaban confirmadas (reintento del integrador). */
  yaConfirmadas: string[];
  /** No existen en esta flota o todavía no tienen acuse del chofer. */
  noAplican: string[];
}

/**
 * El sistema del cliente confirma que ya leyó estos acuses. IDEMPOTENTE: un
 * reintento deja las ya confirmadas en `yaConfirmadas` sin tocarlas. Un id de
 * OTRA flota o sin acuse cae en `noAplican` sin decir cuál de las dos cosas es.
 */
export async function confirmarAcuses(tenantId: string, ids: string[], ahoraIso: string): Promise<ResultadoConfirmacion> {
  const leidas = await acotada(supabaseAdmin().from('liquidacion_externa')
    .select('id, acuse_en, acuse_confirmado_en').eq('tenant_id', tenantId).in('id', ids).order('id'), 'liqext.confirmar_leer');
  const filas = (exigir(leidas, 'liqext.confirmar_leer') ?? []) as Array<{ id: string; acuse_en: string | null; acuse_confirmado_en: string | null }>;
  const porId = new Map(filas.map((f) => [f.id, f]));
  const noAplican = ids.filter((id) => !porId.get(id)?.acuse_en);
  const yaConfirmadas = ids.filter((id) => porId.get(id)?.acuse_en && porId.get(id)?.acuse_confirmado_en);
  const porConfirmar = ids.filter((id) => porId.get(id)?.acuse_en && !porId.get(id)?.acuse_confirmado_en);
  const confirmadas: string[] = [];
  if (porConfirmar.length > 0) {
    // Condicional a «sin confirmar»: dos confirmaciones simultáneas no cuentan dos veces.
    const upd = await acotada(supabaseAdmin().from('liquidacion_externa')
      .update({ acuse_confirmado_en: ahoraIso, updated_at: ahoraIso })
      .eq('tenant_id', tenantId).in('id', porConfirmar).not('acuse_en', 'is', null).is('acuse_confirmado_en', null)
      .select('id'), 'liqext.confirmar');
    if (upd.error) throw new Error(`liquidacion_externa confirmar acuses: ${upd.error.message}`);
    const ganadas = new Set(((upd.data ?? []) as Array<{ id: string }>).map((f) => f.id));
    for (const id of porConfirmar) (ganadas.has(id) ? confirmadas : yaConfirmadas).push(id);
  }
  return { confirmadas, yaConfirmadas, noAplican };
}

/** Las liquidaciones para exportar a SAP/CSV (mismos filtros que el listado),
 *  más viejas primero y con tope duro. */
export async function listarParaExportacion(
  tenantId: string, filtro: FiltroListado & { sinConfirmar?: boolean }, tope: number,
): Promise<{ filas: LiquidacionExterna[]; truncado: boolean }> {
  let q = supabaseAdmin().from('liquidacion_externa').select(COLUMNAS).eq('tenant_id', tenantId);
  if (filtro.estado) q = q.eq('estado', filtro.estado);
  if (filtro.acuseTipo) q = q.eq('acuse_tipo', filtro.acuseTipo);
  if (filtro.operadorId) q = q.eq('operador_id', filtro.operadorId);
  if (filtro.claveExterna) q = q.eq('clave_externa', filtro.claveExterna);
  if (filtro.sinConfirmar) q = q.not('acuse_en', 'is', null).is('acuse_confirmado_en', null);
  if (filtro.desde) q = q.gte('created_at', `${filtro.desde}T00:00:00-06:00`);
  if (filtro.hasta) {
    const sig = new Date(`${filtro.hasta}T00:00:00Z`);
    sig.setUTCDate(sig.getUTCDate() + 1);
    q = q.lt('created_at', `${sig.toISOString().slice(0, 10)}T00:00:00-06:00`);
  }
  q = q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, tope);
  const res = await acotada(q, 'liqext.exportar');
  const filas = ((exigir(res, 'liqext.exportar') ?? []) as unknown as Fila[]);
  return { filas: filas.slice(0, tope).map(aLiquidacionExterna), truncado: filas.length > tope };
}
