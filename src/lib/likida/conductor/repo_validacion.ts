import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { acotada } from '../presupuesto';
import { exigir, traerPorIds } from '../pg';
import { COLUMNAS_HITO, filaAHito } from './repo';
import { coordenadasValidas } from './geo';
import { COLUMNAS_POLIGONO, conPoligonoOCirculo, geometriaDeFila } from './geometria_datos';
import type { ErrorCsv, SitioCsv, TipoSitio } from './sitios';
import type { PosicionComparada, SitioValidable, Veredicto, ResultadoValidacion, MotivoSinDato, FuenteUbicacion } from './validacion';
import { TIPOS_HITO, type HitoFila, type TipoEvidencia, type TipoHito } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL ACCESO A DATOS DE LA SEGUNDA ENTREGA DEL AGENTE 5 (0385): sitios, veredictos
// de ubicación, evidencia, acciones de oficina, indicadores y las lecturas del
// tablero y de las estadías.
//
// Va APARTE de `repo.ts` (que ya junta lo de la 0380) para no volverlo un archivo
// de mil líneas, pero con las MISMAS reglas: toda consulta acotada por tenant
// (la vigila `consultas_admin_filtran_tenant.test.ts`), todo con `acotada`, y los
// errores se comprueban POR VALOR. Las lecturas LANZAN (una base caída no es «no
// hay nada»); las escrituras devuelven un estado para no fingir lo que no pasó.
// Lo que CRUZA flotas (los barridos del cron) vive en `trabajo.ts`.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── El catálogo de sitios ───────────────────────────────────────────────────

export interface SitioFila {
  id: string;
  nombre: string;
  tipo: string;
  codigo: string | null;
  direccion: string | null;
  lat: number;
  lng: number;
  radioM: number;
  activa: boolean;
  fuente: 'manual' | 'csv';
  clienteId: string | null;
  clienteNombre: string | null;
  padreId: string | null;
}

const COLUMNAS_SITIO = 'id, nombre, tipo, codigo, direccion, lat, lng, radio_m, activa, fuente, cliente_id, padre_id';

function filaASitio(f: Fila, clientes?: ReadonlyMap<string, string>): SitioFila {
  const clienteId = s(f.cliente_id);
  return {
    id: String(f.id), nombre: String(f.nombre), tipo: String(f.tipo), codigo: s(f.codigo), direccion: s(f.direccion),
    lat: Number(f.lat), lng: Number(f.lng), radioM: Number(f.radio_m), activa: f.activa !== false,
    fuente: f.fuente === 'csv' ? 'csv' : 'manual', clienteId, clienteNombre: clienteId ? clientes?.get(clienteId) ?? null : null,
    padreId: s(f.padre_id),
  };
}

/** Los tipos que el catálogo de sitios maneja (el resto de `geocerca` —restringida, origen, destino— es de otras pantallas). */
const TIPOS_DEL_CATALOGO = ['cliente', 'planta', 'anden', 'patio', 'punto_interes'] as const;

export async function listarSitios(
  tenantId: string, o: { busqueda?: string; tipo?: TipoSitio; limite?: number } = {},
): Promise<{ sitios: SitioFila[]; hayMas: boolean }> {
  const limite = Math.min(Math.max(o.limite ?? 200, 1), 500);
  let q = supabaseAdmin().from('geocerca').select(COLUMNAS_SITIO).eq('tenant_id', tenantId).eq('catalogo', 'conductor').in('tipo', o.tipo ? [o.tipo] : [...TIPOS_DEL_CATALOGO]);
  const b = (o.busqueda ?? '').replace(/[%,()*\\]/g, ' ').trim().slice(0, 60);
  if (b) q = q.or(`nombre.ilike.%${b}%,codigo.ilike.%${b}%`);
  const res = await acotada(q.order('nombre', { ascending: true }).order('id').limit(limite + 1), 'sitios.listar');
  const filas = (exigir(res as never, 'sitios.listar') ?? []) as unknown as Fila[];
  const pagina = filas.slice(0, limite);
  const clienteIds = [...new Set(pagina.map((f) => s(f.cliente_id)).filter((x): x is string => !!x))];
  const clientes = new Map<string, string>();
  if (clienteIds.length > 0) {
    const rc = await traerPorIds<Fila>(clienteIds, (t) => acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).in('id', t), 'sitios.clientes') as never, 'sitios.clientes');
    for (const c of rc) clientes.set(String(c.id), String(c.nombre));
  }
  return { sitios: pagina.map((f) => filaASitio(f, clientes)), hayMas: filas.length > limite };
}

export interface DatosSitio {
  id?: string;
  nombre: string;
  tipo: TipoSitio;
  codigo: string | null;
  direccion: string | null;
  lat: number;
  lng: number;
  radioM: number;
  clienteId: string | null;
  padreId: string | null;
}

export type ResultadoGuardarSitio = 'ok' | 'duplicado' | 'no_encontrado' | 'referencia_ajena' | 'datos_invalidos';

/** Alta o edición MANUAL de un sitio (la captura humana del editor). Valida de nuevo: la base es la última palabra, pero esto la ahorra. */
export async function guardarSitio(tenantId: string, d: DatosSitio): Promise<ResultadoGuardarSitio> {
  if (!coordenadasValidas(d.lat, d.lng) || !Number.isInteger(d.radioM) || d.radioM < 25 || d.radioM > 100_000) return 'datos_invalidos';
  if (d.id !== undefined && !UUID.test(d.id)) return 'datos_invalidos';
  const fila = {
    nombre: d.nombre, tipo: d.tipo, codigo: d.codigo, direccion: d.direccion, lat: d.lat, lng: d.lng, radio_m: d.radioM,
    cliente_id: d.clienteId, padre_id: d.padreId, fuente: 'manual',
  };
  // Catálogo propio (0480): la edición solo toca filas del Conductor (`.eq('catalogo')`) y el alta se declara suyo,
  // para que un patio o punto de interés sin código no caiga en el catálogo de peajes.
  const res = d.id
    ? await acotada(supabaseAdmin().from('geocerca').update(fila).eq('id', d.id).eq('tenant_id', tenantId).eq('catalogo', 'conductor').select('id'), 'sitios.editar')
    : await acotada(supabaseAdmin().from('geocerca').insert({ ...fila, tenant_id: tenantId, catalogo: 'conductor' }).select('id'), 'sitios.crear');
  if (res.error) {
    const code = (res.error as { code?: string }).code;
    if (code === '23505') return 'duplicado';
    if (code === '23503') return 'referencia_ajena';
    if (code === '23514') return 'datos_invalidos';
    throw new Error(`sitios.guardar: ${res.error.message}`);
  }
  return !res.data || res.data.length === 0 ? 'no_encontrado' : 'ok';
}

export async function cambiarEstadoSitio(tenantId: string, id: string, activa: boolean): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const res = await acotada(supabaseAdmin().from('geocerca').update({ activa }).eq('id', id).eq('tenant_id', tenantId).eq('catalogo', 'conductor').select('id'), 'sitios.estado');
  const filas = exigir(res as never, 'sitios.estado') as unknown[] | null;
  return Boolean(filas && filas.length > 0);
}

export type ResultadoImportacion = { ok: true; creados: number; actualizados: number } | { ok: false; errores: ErrorCsv[] };

/** El importador TODO-O-NADA de la 0385 (la base revisa clientes, padres y nombres). */
export async function importarSitios(tenantId: string, filas: readonly SitioCsv[]): Promise<ResultadoImportacion> {
  const { data, error } = await acotada(supabaseAdmin().rpc('importar_sitios_conductor', { p_tenant: tenantId, p_filas: filas }), 'sitios.importar');
  if (error) throw new Error(`sitios.importar: ${error.message}`);
  const r = data as { ok?: boolean; creados?: number; actualizados?: number; errores?: Array<{ linea: number; mensaje: string }> } | null;
  if (r?.ok === true) return { ok: true, creados: Number(r.creados ?? 0), actualizados: Number(r.actualizados ?? 0) };
  return { ok: false, errores: (r?.errores ?? []).map((e) => ({ linea: Number(e.linea), mensaje: String(e.mensaje) })) };
}

/** Un viaje apunta a su sitio de carga y de descarga. Cada lado es id, código del sitio o null (desasignar); `undefined` = no tocar. */
export async function asignarSitiosViaje(
  tenantId: string, viajeId: string, cambio: { origen?: string | null; destino?: string | null },
): Promise<'ok' | 'viaje_no_encontrado' | 'sitio_no_encontrado'> {
  const columnas: Record<string, string | null> = {};
  for (const [lado, columna] of [['origen', 'origen_geocerca_id'], ['destino', 'destino_geocerca_id']] as const) {
    const v = cambio[lado];
    if (v === undefined) continue;
    if (v === null) { columnas[columna] = null; continue; }
    // Id o código, SIEMPRE dentro de la flota.
    const campo = UUID.test(v) ? 'id' : 'codigo';
    const r = await acotada(supabaseAdmin().from('geocerca').select('id').eq('tenant_id', tenantId).eq('catalogo', 'conductor').eq(campo, UUID.test(v) ? v.toLowerCase() : v).order('id').limit(1), 'sitios.resolver');
    const f = (exigir(r as never, 'sitios.resolver') ?? []) as unknown as Fila[];
    if (f.length === 0) return 'sitio_no_encontrado';
    columnas[columna] = String(f[0].id);
  }
  const res = await acotada(supabaseAdmin().from('viaje').update(columnas).eq('id', viajeId).eq('tenant_id', tenantId).select('id'), 'sitios.asignar');
  const filas = exigir(res as never, 'sitios.asignar') as unknown[] | null;
  return filas && filas.length > 0 ? 'ok' : 'viaje_no_encontrado';
}

/** El sitio que el viaje espera para ese hito (carga: origen; descarga: destino). `null` = sin sitio asignado o archivado. */
export async function sitioDelHito(tenantId: string, viajeId: string, tipo: TipoHito): Promise<SitioValidable | null> {
  const columna = tipo === 'llegada_carga' || tipo === 'salida_carga' ? 'origen_geocerca_id' : 'destino_geocerca_id';
  const rv = await acotada(supabaseAdmin().from('viaje').select(columna).eq('id', viajeId).eq('tenant_id', tenantId).maybeSingle(), 'validacion.viaje');
  const v = exigir(rv as never, 'validacion.viaje') as Fila | null;
  const sitioId = v ? s(v[columna]) : null;
  if (!sitioId) return null;
  const rs = await conPoligonoOCirculo((conPoligono) => acotada(supabaseAdmin().from('geocerca')
    .select(conPoligono ? `id, nombre, lat, lng, radio_m, ${COLUMNAS_POLIGONO}` : 'id, nombre, lat, lng, radio_m')
    .eq('id', sitioId).eq('tenant_id', tenantId).eq('activa', true).maybeSingle(), 'validacion.sitio'));
  const g = exigir(rs as never, 'validacion.sitio') as Fila | null;
  return g ? { id: String(g.id), nombre: String(g.nombre), lat: Number(g.lat), lng: Number(g.lng), radioM: Number(g.radio_m), ...geometriaDeFila(g) } : null;
}

// ── La validación ───────────────────────────────────────────────────────────

/** Las posiciones de la unidad en la ventana. El pin de WhatsApp (proveedor `whatsapp`) es `pin`; el resto, GPS. */
export async function posicionesDeUnidad(tenantId: string, unidadId: string, desde: Date, hasta: Date): Promise<PosicionComparada[]> {
  const res = await acotada(supabaseAdmin()
    .from('posicion').select('lat, lng, medida_en, proveedor')
    .eq('tenant_id', tenantId).eq('unidad_id', unidadId)
    .gte('medida_en', desde.toISOString()).lte('medida_en', hasta.toISOString())
    .order('medida_en', { ascending: false }).order('id').limit(200), 'validacion.posiciones');
  const filas = (exigir(res as never, 'validacion.posiciones') ?? []) as unknown as Fila[];
  return filas.map((f) => ({
    lat: Number(f.lat), lng: Number(f.lng), medidaEn: new Date(String(f.medida_en)),
    fuente: (f.proveedor === 'whatsapp' ? 'pin' : 'gps') as FuenteUbicacion,
  }));
}

/** ¿La unidad tiene alguna muestra de un GPS de verdad (no un pin de WhatsApp) desde `desde`? LANZA si la base falla. */
export async function unidadReportaGps(tenantId: string, unidadId: string, desde: Date): Promise<boolean> {
  const res = await acotada(supabaseAdmin()
    .from('posicion').select('id')
    .eq('tenant_id', tenantId).eq('unidad_id', unidadId).neq('proveedor', 'whatsapp')
    .gte('medida_en', desde.toISOString()).order('id').limit(1), 'validacion.unidad_con_gps');
  return ((exigir(res as never, 'validacion.unidad_con_gps') ?? []) as unknown[]).length > 0;
}

export type ResultadoVeredicto = 'nuevo' | 'mejorado' | 'igual' | 'hito_cambio' | 'fallo';

export async function aplicarVeredicto(tenantId: string, hito: HitoFila, v: Veredicto, ahora: Date): Promise<ResultadoVeredicto> {
  const { data, error } = await acotada(supabaseAdmin().rpc('aplicar_validacion_hito', {
    p_tenant: tenantId, p_hito: hito.id, p_ciclo: hito.ciclo, p_resultado: v.resultado, p_motivo: v.motivo, p_fuente: v.fuente,
    p_distancia: v.distanciaM, p_tolerancia: v.toleranciaM, p_radio: v.radioM, p_sitio: v.sitioId,
    p_medida_en: v.medidaEn ? v.medidaEn.toISOString() : null, p_ahora: ahora.toISOString(),
  }), 'validacion.aplicar');
  if (error) { logger.error('conductor.veredicto_fallo', { hito: hito.id, err: error.message }); return 'fallo'; }
  return (['nuevo', 'mejorado', 'igual', 'hito_cambio'].includes(String(data)) ? data : 'fallo') as ResultadoVeredicto;
}

/** La llegada que el chofer acaba de reportar (la más reciente, ≤ `ventanaMin`): el hito al que se compara un pin. */
export async function hitoLlegadaReciente(tenantId: string, viajeId: string, ahora: Date, ventanaMin: number): Promise<HitoFila | null> {
  const desde = new Date(ahora.getTime() - ventanaMin * 60_000).toISOString();
  const res = await acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO)
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).in('tipo', ['llegada_carga', 'llegada_descarga']).eq('estado', 'recibido')
    .gte('recibido_en', desde).order('recibido_en', { ascending: false }).order('id').limit(1), 'validacion.hito_reciente');
  const filas = (exigir(res as never, 'validacion.hito_reciente') ?? []) as unknown as Fila[];
  return filas.length > 0 ? filaAHito(filas[0]) : null;
}

export interface VeredictoFila {
  hitoId: string;
  ciclo: number;
  resultado: ResultadoValidacion;
  motivo: MotivoSinDato | null;
  fuente: FuenteUbicacion | null;
  distanciaM: number | null;
  radioM: number | null;
  toleranciaM: number;
  sitioId: string | null;
  medidaEn: string | null;
}

export async function leerVeredictos(tenantId: string, viajeIds: string[]): Promise<VeredictoFila[]> {
  if (viajeIds.length === 0) return [];
  const filas = await traerPorIds<Fila>(viajeIds, (t) => acotada(supabaseAdmin()
    .from('viaje_hito_validacion').select('viaje_hito_id, ciclo, resultado, motivo, fuente, distancia_m, radio_m, tolerancia_m, sitio_id, medida_en')
    .eq('tenant_id', tenantId).in('viaje_id', t), 'tablero.veredictos') as never, 'tablero.veredictos');
  return filas.map((f) => ({
    hitoId: String(f.viaje_hito_id), ciclo: Number(f.ciclo), resultado: f.resultado as ResultadoValidacion,
    motivo: s(f.motivo) as MotivoSinDato | null, fuente: s(f.fuente) as FuenteUbicacion | null, distanciaM: n(f.distancia_m),
    radioM: n(f.radio_m), toleranciaM: Number(f.tolerancia_m), sitioId: s(f.sitio_id), medidaEn: s(f.medida_en),
  }));
}

// ── La evidencia ────────────────────────────────────────────────────────────

export interface EvidenciaFila {
  id: string;
  hitoId: string;
  ciclo: number;
  tipo: TipoEvidencia;
  ruta: string | null;
  creadaEn: string;
}

/** Registra una evidencia ya subida a Storage. `duplicada` = ese mensaje o esa foto ya estaban (reintento del webhook). */
export async function guardarEvidencia(a: {
  tenantId: string; hito: HitoFila; tipo: TipoEvidencia; ruta: string; sha256: string; waMessageId: string | null; ahora: Date;
}): Promise<'ok' | 'duplicada' | 'hito_cambio' | 'fallo'> {
  // La ruta TIENE que colgar de la flota: es la única defensa contra firmar o borrar el archivo de otra.
  if (!a.ruta.startsWith(`${a.tenantId}/`) || a.ruta.length > 300) return 'fallo';
  const { error } = await acotada(supabaseAdmin().from('viaje_hito_evidencia').insert({
    tenant_id: a.tenantId, viaje_id: a.hito.viajeId, viaje_hito_id: a.hito.id, ciclo: a.hito.ciclo, tipo: a.tipo, ruta: a.ruta,
    sha256: a.sha256, wa_message_id: a.waMessageId,
  }), 'evidencia.guardar');
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505') return 'duplicada';
    if (code === '23503') return 'hito_cambio';
    logger.error('conductor.evidencia_fallo', { hito: a.hito.id, err: error.message });
    return 'fallo';
  }
  const { error: e2 } = await acotada(supabaseAdmin().from('viaje_hito')
    .update({ evidencia_ruta: a.ruta, updated_at: a.ahora.toISOString() }).eq('id', a.hito.id).eq('tenant_id', a.tenantId).eq('ciclo', a.hito.ciclo), 'evidencia.ruta_hito');
  if (e2) logger.warn('conductor.evidencia_ruta_no_anotada', { hito: a.hito.id, err: e2.message });
  return 'ok';
}

export async function leerEvidencias(tenantId: string, viajeIds: string[]): Promise<EvidenciaFila[]> {
  if (viajeIds.length === 0) return [];
  const filas = await traerPorIds<Fila>(viajeIds, (t) => acotada(supabaseAdmin()
    .from('viaje_hito_evidencia').select('id, viaje_hito_id, ciclo, tipo, ruta, created_at')
    .eq('tenant_id', tenantId).in('viaje_id', t).order('created_at', { ascending: true }), 'tablero.evidencias') as never, 'tablero.evidencias');
  return filas.map((f) => ({
    id: String(f.id), hitoId: String(f.viaje_hito_id), ciclo: Number(f.ciclo), tipo: f.tipo as TipoEvidencia, ruta: s(f.ruta), creadaEn: String(f.created_at),
  }));
}

/** La ruta de UNA evidencia de ESA flota (para firmar su URL). `null` = no existe, es de otra flota o ya se purgó. */
export async function rutaDeEvidencia(tenantId: string, evidenciaId: string): Promise<string | null> {
  if (!UUID.test(evidenciaId)) return null;
  const res = await acotada(supabaseAdmin().from('viaje_hito_evidencia').select('ruta').eq('tenant_id', tenantId).eq('id', evidenciaId.toLowerCase()).maybeSingle(), 'evidencia.por_id');
  const f = exigir(res as never, 'evidencia.por_id') as Fila | null;
  return f ? s(f.ruta) : null;
}

/** URL firmada de corta vida (10 min) para ver una evidencia. Solo firma rutas de ESTA flota. */
export async function urlFirmadaEvidencia(tenantId: string, ruta: string): Promise<string | null> {
  if (!ruta.startsWith(`${tenantId}/`) || ruta.includes('..')) return null;
  const { data, error } = await acotada(supabaseAdmin().storage.from('comprobantes').createSignedUrl(ruta, 600), 'evidencia.firmar');
  if (error || !data?.signedUrl) { logger.warn('conductor.evidencia_no_firmada', { err: error?.message ?? 'sin url' }); return null; }
  return data.signedUrl;
}

/** Un hito DE ESA FLOTA (lo mínimo para decidir si se puede validar). `null` = no existe o es de otra flota. */
export async function hitoDeFlota(tenantId: string, hitoId: string): Promise<{ id: string; viajeId: string; tipo: TipoHito; estado: string } | null> {
  if (!UUID.test(hitoId)) return null;
  const res = await acotada(supabaseAdmin().from('viaje_hito').select('id, viaje_id, tipo, estado').eq('tenant_id', tenantId).eq('id', hitoId.toLowerCase()).maybeSingle(), 'oficina.hito_de_flota');
  const f = exigir(res as never, 'oficina.hito_de_flota') as Fila | null;
  return f ? { id: String(f.id), viajeId: String(f.viaje_id), tipo: f.tipo as TipoHito, estado: String(f.estado) } : null;
}

// ── Las acciones de la oficina (RPC atómicas con bitácora) ──────────────────

export interface Actor {
  usuarioId: string | null;
  email: string;
}

export type ResultadoAccion = 'ok' | 'hito_cambio' | 'hora_invalida' | 'fallo';

export async function capturarHitoOficina(
  tenantId: string, hitoId: string, hora: Date, actor: Actor, motivo: string, ahora: Date,
): Promise<ResultadoAccion> {
  const { data, error } = await acotada(supabaseAdmin().rpc('capturar_hito_oficina', {
    p_tenant: tenantId, p_hito: hitoId, p_hora: hora.toISOString(), p_usuario: actor.usuarioId, p_email: actor.email, p_motivo: motivo, p_ahora: ahora.toISOString(),
  }), 'oficina.capturar');
  if (error) { logger.error('conductor.captura_oficina_fallo', { hito: hitoId, err: error.message }); return 'fallo'; }
  return (['ok', 'hito_cambio', 'hora_invalida'].includes(String(data)) ? data : 'fallo') as ResultadoAccion;
}

export async function validarHitoOficina(tenantId: string, hitoId: string, actor: Actor, motivo: string, ahora: Date): Promise<ResultadoAccion> {
  const { data, error } = await acotada(supabaseAdmin().rpc('validar_hito_oficina', {
    p_tenant: tenantId, p_hito: hitoId, p_usuario: actor.usuarioId, p_email: actor.email, p_motivo: motivo, p_ahora: ahora.toISOString(),
  }), 'oficina.validar');
  if (error) { logger.error('conductor.validar_oficina_fallo', { hito: hitoId, err: error.message }); return 'fallo'; }
  return (['ok', 'hito_cambio'].includes(String(data)) ? data : 'fallo') as ResultadoAccion;
}

/** Devuelve cuántos hitos se marcaron atendidos (0 = ya estaba atendido), o `null` si falló. */
export async function atenderEscalacionOficina(tenantId: string, viajeId: string, actor: Actor, motivo: string, ahora: Date): Promise<number | null> {
  const { data, error } = await acotada(supabaseAdmin().rpc('atender_escalacion_oficina', {
    p_tenant: tenantId, p_viaje: viajeId, p_usuario: actor.usuarioId, p_email: actor.email, p_motivo: motivo, p_ahora: ahora.toISOString(),
  }), 'oficina.atender');
  if (error) { logger.error('conductor.atender_oficina_fallo', { viaje: viajeId, err: error.message }); return null; }
  return Number(data ?? 0);
}

export interface AccionOficinaFila {
  hitoId: string;
  viajeId: string;
  accion: 'captura_manual' | 'validar' | 'atender';
  usuarioEmail: string;
  motivo: string;
  horaDeclarada: string | null;
  creadaEn: string;
}

export async function leerAccionesOficina(tenantId: string, viajeIds: string[]): Promise<AccionOficinaFila[]> {
  if (viajeIds.length === 0) return [];
  const filas = await traerPorIds<Fila>(viajeIds, (t) => acotada(supabaseAdmin()
    .from('conductor_accion_oficina').select('viaje_hito_id, viaje_id, accion, usuario_email, motivo, hora_declarada, created_at')
    .eq('tenant_id', tenantId).in('viaje_id', t).order('id', { ascending: false }).limit(500), 'tablero.acciones') as never, 'tablero.acciones');
  return filas.map((f) => ({
    hitoId: String(f.viaje_hito_id), viajeId: String(f.viaje_id), accion: f.accion as AccionOficinaFila['accion'],
    usuarioEmail: String(f.usuario_email), motivo: String(f.motivo), horaDeclarada: s(f.hora_declarada), creadaEn: String(f.created_at),
  }));
}

// ── El tablero ──────────────────────────────────────────────────────────────

export interface FiltrosTablero {
  terminalId?: string;
  clienteId?: string;
  operadorId?: string;
}

export interface ViajeTablero {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  estatus: string;
  operadorId: string;
  operadorNombre: string | null;
  terminalId: string | null;
  terminalNombre: string | null;
  clienteId: string | null;
  clienteNombre: string | null;
  unidadId: string | null;
  aceptadoEn: string | null;
  citaOrigenEn: string | null;
  citaDestinoEn: string | null;
  etaOrigenEn: string | null;
  etaDestinoEn: string | null;
  origenSitioId: string | null;
  destinoSitioId: string | null;
}

const COLUMNAS_VIAJE_TABLERO =
  'id, folio, origen, destino, estatus, operador_id, terminal_id, cliente_id, unidad_id, aceptado_en, cita_origen_en, cita_destino_en, eta_origen_en, eta_destino_en, origen_geocerca_id, destino_geocerca_id, ' +
  'operador:operador_id(nombre), terminal:terminal_id(nombre), cliente:cliente_id(nombre)';

const nombreDe = (rel: unknown): string | null => {
  const r = Array.isArray(rel) ? rel[0] : rel;
  return r && typeof r === 'object' && typeof (r as { nombre?: unknown }).nombre === 'string' ? (r as { nombre: string }).nombre : null;
};

export function filaAViajeTablero(f: Fila): ViajeTablero {
  return {
    id: String(f.id), folio: s(f.folio), origen: s(f.origen), destino: s(f.destino), estatus: String(f.estatus ?? ''),
    operadorId: String(f.operador_id), operadorNombre: nombreDe(f.operador), terminalId: s(f.terminal_id), terminalNombre: nombreDe(f.terminal),
    clienteId: s(f.cliente_id), clienteNombre: nombreDe(f.cliente), unidadId: s(f.unidad_id), aceptadoEn: s(f.aceptado_en),
    citaOrigenEn: s(f.cita_origen_en), citaDestinoEn: s(f.cita_destino_en), etaOrigenEn: s(f.eta_origen_en), etaDestinoEn: s(f.eta_destino_en),
    origenSitioId: s(f.origen_geocerca_id), destinoSitioId: s(f.destino_geocerca_id),
  };
}

export const TOPE_VIAJES_TABLERO = 400;

export interface DatosTablero {
  viajes: ViajeTablero[];
  /** Hay más viajes activos que los listados (el tablero lo dice; no esconde el resto). */
  hayMas: boolean;
  hitos: HitoFila[];
  veredictos: VeredictoFila[];
  evidencias: EvidenciaFila[];
  acciones: AccionOficinaFila[];
  sitios: Map<string, string>;
}

/** Los viajes activos de la flota con todo lo que el tablero necesita. Un solo tenant, siempre. */
export async function leerDatosTablero(tenantId: string, f: FiltrosTablero = {}): Promise<DatosTablero> {
  let q = supabaseAdmin().from('viaje').select(COLUMNAS_VIAJE_TABLERO).eq('tenant_id', tenantId).eq('estatus', 'abierto').not('aceptado_en', 'is', null);
  if (f.terminalId && UUID.test(f.terminalId)) q = q.eq('terminal_id', f.terminalId);
  if (f.clienteId && UUID.test(f.clienteId)) q = q.eq('cliente_id', f.clienteId);
  if (f.operadorId && UUID.test(f.operadorId)) q = q.eq('operador_id', f.operadorId);
  const rv = await acotada(q.order('aceptado_en', { ascending: true }).order('id').limit(TOPE_VIAJES_TABLERO + 1), 'tablero.viajes');
  const filas = (exigir(rv as never, 'tablero.viajes') ?? []) as unknown as Fila[];
  const hayMas = filas.length > TOPE_VIAJES_TABLERO;
  const viajes = filas.slice(0, TOPE_VIAJES_TABLERO).map(filaAViajeTablero);
  const ids = viajes.map((v) => v.id);

  const hitosCrudos = ids.length === 0 ? [] : await traerPorIds<Fila>(ids, (t) => acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO).eq('tenant_id', tenantId).in('viaje_id', t), 'tablero.hitos') as never, 'tablero.hitos');
  const [veredictos, evidencias, acciones] = await Promise.all([
    leerVeredictos(tenantId, ids), leerEvidencias(tenantId, ids), leerAccionesOficina(tenantId, ids),
  ]);
  const sitioIds = [...new Set(viajes.flatMap((v) => [v.origenSitioId, v.destinoSitioId]).filter((x): x is string => !!x))];
  const sitios = new Map<string, string>();
  if (sitioIds.length > 0) {
    const rs = await traerPorIds<Fila>(sitioIds, (t) => acotada(supabaseAdmin().from('geocerca').select('id, nombre').eq('tenant_id', tenantId).in('id', t), 'tablero.sitios') as never, 'tablero.sitios');
    for (const g of rs) sitios.set(String(g.id), String(g.nombre));
  }
  return { viajes, hayMas, hitos: hitosCrudos.map(filaAHito), veredictos, evidencias, acciones, sitios };
}

export interface CatalogosFiltro {
  terminales: Array<{ id: string; nombre: string }>;
  clientes: Array<{ id: string; nombre: string }>;
  operadores: Array<{ id: string; nombre: string }>;
}

export async function leerCatalogosFiltro(tenantId: string): Promise<CatalogosFiltro> {
  const [t, c, o] = await Promise.all([
    acotada(supabaseAdmin().from('terminal').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(300), 'tablero.terminales'),
    acotada(supabaseAdmin().from('cliente').select('id, nombre').eq('tenant_id', tenantId).eq('activo', true).order('nombre').order('id').limit(500), 'tablero.clientes'),
    acotada(supabaseAdmin().from('operador').select('id, nombre').eq('tenant_id', tenantId).order('nombre').order('id').limit(1000), 'tablero.operadores'),
  ]);
  const lista = (r: unknown, q: string) => ((exigir(r as never, q) ?? []) as unknown as Fila[]).map((x) => ({ id: String(x.id), nombre: String(x.nombre) }));
  return { terminales: lista(t, 'tablero.terminales'), clientes: lista(c, 'tablero.clientes'), operadores: lista(o, 'tablero.operadores') };
}

export interface IndicadoresCrudos {
  recibidos: number;
  sinInsistencia: number;
  conRespuestaMedida: number;
  minutosRespuestaPromedio: number | null;
  escalados: number;
  omitidos: number;
  validadosUbicacion: number;
  sinCoincidencia: number;
  capturadosOficina: number;
}

export async function leerIndicadores(tenantId: string, desde: Date, hasta: Date, f: FiltrosTablero = {}): Promise<IndicadoresCrudos> {
  const { data, error } = await acotada(supabaseAdmin().rpc('conductor_indicadores', {
    p_tenant: tenantId, p_desde: desde.toISOString(), p_hasta: hasta.toISOString(),
    p_terminal: f.terminalId && UUID.test(f.terminalId) ? f.terminalId : null,
    p_cliente: f.clienteId && UUID.test(f.clienteId) ? f.clienteId : null,
    p_operador: f.operadorId && UUID.test(f.operadorId) ? f.operadorId : null,
  }), 'tablero.indicadores');
  if (error) throw new Error(`tablero.indicadores: ${error.message}`);
  const r = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    recibidos: num(r.recibidos), sinInsistencia: num(r.sin_insistencia), conRespuestaMedida: num(r.con_respuesta_medida),
    minutosRespuestaPromedio: typeof r.minutos_respuesta_promedio === 'number' ? r.minutos_respuesta_promedio : null,
    escalados: num(r.escalados), omitidos: num(r.omitidos), validadosUbicacion: num(r.validados_ubicacion),
    sinCoincidencia: num(r.sin_coincidencia), capturadosOficina: num(r.capturados_oficina),
  };
}

// ── Las estadías en andén: lectura de un periodo ────────────────────────────

export const TOPE_VIAJES_ESTADIAS = 1500;

export interface DatosEstadias {
  viajes: ViajeTablero[];
  hitos: HitoFila[];
  veredictos: VeredictoFila[];
  evidencias: EvidenciaFila[];
  sitios: Map<string, string>;
  /** Hay más viajes con llegada en el periodo que los leídos: el export lo declara en vez de callarlo. */
  truncada: boolean;
}

/** Los viajes con una llegada (carga o descarga) cuyo MENSAJE cae en [desde, hasta). */
export async function leerDatosEstadias(tenantId: string, desde: Date, hasta: Date, f: FiltrosTablero = {}): Promise<DatosEstadias> {
  const rl = await acotada(supabaseAdmin()
    .from('viaje_hito').select('viaje_id')
    .eq('tenant_id', tenantId).in('tipo', ['llegada_carga', 'llegada_descarga']).in('estado', ['recibido', 'validado'])
    .gte('mensaje_en', desde.toISOString()).lt('mensaje_en', hasta.toISOString())
    .order('mensaje_en', { ascending: true }).order('id').limit(TOPE_VIAJES_ESTADIAS * 2 + 1), 'estadias.llegadas');
  const llegadas = (exigir(rl as never, 'estadias.llegadas') ?? []) as unknown as Fila[];
  const todos = [...new Set(llegadas.map((x) => String(x.viaje_id)))];
  const truncada = todos.length > TOPE_VIAJES_ESTADIAS || llegadas.length > TOPE_VIAJES_ESTADIAS * 2;
  const ids = todos.slice(0, TOPE_VIAJES_ESTADIAS);

  const viajesCrudos = ids.length === 0 ? [] : await traerPorIds<Fila>(ids, (t) => {
    let q = supabaseAdmin().from('viaje').select(COLUMNAS_VIAJE_TABLERO).eq('tenant_id', tenantId).in('id', t);
    if (f.terminalId && UUID.test(f.terminalId)) q = q.eq('terminal_id', f.terminalId);
    if (f.clienteId && UUID.test(f.clienteId)) q = q.eq('cliente_id', f.clienteId);
    if (f.operadorId && UUID.test(f.operadorId)) q = q.eq('operador_id', f.operadorId);
    return acotada(q, 'estadias.viajes') as never;
  }, 'estadias.viajes');
  const viajes = viajesCrudos.map(filaAViajeTablero);
  const idsFiltrados = viajes.map((v) => v.id);
  const hitosCrudos = idsFiltrados.length === 0 ? [] : await traerPorIds<Fila>(idsFiltrados, (t) => acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO).eq('tenant_id', tenantId).in('viaje_id', t), 'estadias.hitos') as never, 'estadias.hitos');
  const [veredictos, evidencias] = await Promise.all([leerVeredictos(tenantId, idsFiltrados), leerEvidencias(tenantId, idsFiltrados)]);
  const sitioIds = [...new Set(viajes.flatMap((v) => [v.origenSitioId, v.destinoSitioId]).filter((x): x is string => !!x))];
  const sitios = new Map<string, string>();
  if (sitioIds.length > 0) {
    const rs = await traerPorIds<Fila>(sitioIds, (t) => acotada(supabaseAdmin().from('geocerca').select('id, nombre').eq('tenant_id', tenantId).in('id', t), 'estadias.sitios') as never, 'estadias.sitios');
    for (const g of rs) sitios.set(String(g.id), String(g.nombre));
  }
  return { viajes, hitos: hitosCrudos.map(filaAHito), veredictos, evidencias, sitios, truncada };
}

/** Para `estatusViaje`: un viaje de ESA flota (activo o no) con sus hitos. */
export async function leerViajeConHitos(tenantId: string, viajeId: string): Promise<{ viaje: ViajeTablero; hitos: HitoFila[] } | null> {
  const rv = await acotada(supabaseAdmin().from('viaje').select(COLUMNAS_VIAJE_TABLERO).eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'estatus.viaje');
  const f = exigir(rv as never, 'estatus.viaje') as Fila | null;
  if (!f) return null;
  const rh = await acotada(supabaseAdmin().from('viaje_hito').select(COLUMNAS_HITO).eq('tenant_id', tenantId).eq('viaje_id', viajeId), 'estatus.hitos');
  const hitos = ((exigir(rh as never, 'estatus.hitos') ?? []) as unknown as Fila[]).map(filaAHito);
  hitos.sort((a, b) => TIPOS_HITO.indexOf(a.tipo) - TIPOS_HITO.indexOf(b.tipo));
  return { viaje: filaAViajeTablero(f), hitos };
}


/**
 * Los hitos resueltos de un chofer cuyo MENSAJE cae en [desde, hasta): de cualquier viaje suyo (abierto o cerrado).
 * Para la evidencia de jornada: el último hito del día. Acotado por flota Y por chofer.
 */
export async function leerHitosDeOperador(tenantId: string, operadorId: string, desde: Date, hasta: Date): Promise<HitoFila[]> {
  if (!UUID.test(operadorId)) return [];
  const rv = await acotada(supabaseAdmin().from('viaje').select('id')
    .eq('tenant_id', tenantId).eq('operador_id', operadorId)
    .gte('created_at', new Date(desde.getTime() - 14 * 86_400_000).toISOString()).order('id').limit(500), 'jornada.viajes');
  const ids = ((exigir(rv as never, 'jornada.viajes') ?? []) as unknown as Fila[]).map((f) => String(f.id));
  if (ids.length === 0) return [];
  const filas = await traerPorIds<Fila>(ids, (t) => acotada(supabaseAdmin()
    .from('viaje_hito').select(COLUMNAS_HITO).eq('tenant_id', tenantId).in('viaje_id', t).in('estado', ['recibido', 'validado'])
    .gte('mensaje_en', desde.toISOString()).lt('mensaje_en', hasta.toISOString()), 'jornada.hitos') as never, 'jornada.hitos');
  return filas.map(filaAHito);
}
