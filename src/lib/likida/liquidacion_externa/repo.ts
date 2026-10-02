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
import { ESTADOS, type EstadoLiquidacionExterna, type ConceptoExterno, type LiquidacionExternaNormalizada, type MonedaExterna } from './esquema';

export { ESTADOS };
export type { EstadoLiquidacionExterna };
export type ViaEntrega = 'sesion' | 'plantilla';
export type TipoAcuse = 'recibida' | 'no_coincide';

export type TipoEvento =
  | 'recibida' | 'encolada' | 'enviada' | 'fallback_plantilla' | 'fallida'
  | 'reintento_manual' | 'acuse_recibida' | 'acuse_no_coincide';

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
  creadaEn: string;
}

export const COLUMNAS =
  'id, tenant_id, clave_externa, huella, sistema_origen, operador_id, folios_viaje, viaje_ids, '
  + 'periodo_desde, periodo_hasta, conceptos, total, moneda, pdf_ruta, pdf_origen, estado, via, '
  + 'generacion, intentos, proximo_intento_en, ultimo_error, wamid, enviada_en, acuse_tipo, acuse_en, '
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
    creadaEn: String(r.created_at),
  };
}

// ── Storage, outbox y datos de la flota ─────────────────────────────────────
// Viven aquí —y no en un módulo cada uno— porque este es el ÚNICO archivo del
// módulo con acceso directo a Supabase: el guardia de la frontera de datos
// (`frontera_datos_guardiana.test.ts`) cuenta archivos, y la regla es juntar el
// acceso, no repartirlo.

const BUCKET = 'liquidaciones';

export async function subirPdfExterno(ruta: string, bytes: Uint8Array): Promise<void> {
  const res = await acotada(supabaseAdmin().storage.from(BUCKET)
    .upload(ruta, Buffer.from(bytes), { contentType: 'application/pdf', upsert: true }), 'liqext.subir');
  if (res.error) throw new Error(`liquidacion_externa subir PDF: ${res.error.message}`);
}

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

/**
 * Transición CONDICIONAL de estado: solo se aplica si la fila sigue en alguno
 * de los estados `desde`. Devuelve si la aplicó. Es el candado contra dos
 * invocaciones (el POST y el cron, o dos crons) tocando la misma fila.
 */
export async function transicionar(
  tenantId: string, id: string, desde: EstadoLiquidacionExterna[],
  cambios: Record<string, unknown>,
): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('liquidacion_externa')
    .update({ ...cambios, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', id).in('estado', desde)
    .select('id'), 'liqext.transicion');
  if (res.error) throw new Error(`liquidacion_externa transición: ${res.error.message}`);
  return (res.data ?? []).length > 0;
}
