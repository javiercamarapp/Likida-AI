import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { hoyMx } from '@/lib/formato';
import { acotada } from '../presupuesto';
import { conteo, traerTodo } from '../pg';
import { violaIndice } from '../pg_errores';
import type { ComercialImportado, ConvenioExportable, ConvenioImportado, ErrorFila } from './importador';
import { elegirConvenio, type ConvenioCandidato, type EleccionConvenio, type ViajeParaLigar } from './seleccion';
import { esCategoria, esLugar, esMomento, leerFoto, type Instruccion } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL ACCESO A DATOS DE LOS CONVENIOS (0580). Toda consulta ancla `tenant_id`; el tenant sale de la sesión o del viaje
// ya resuelto, nunca del formulario. Las lecturas LANZAN (una base ciega no es «sin convenios»); la tabla sin migrar
// se dice aparte (`ConveniosNoDisponibles`): el despacho de viajes sigue como siempre y las pantallas dicen «falta
// aplicar 0580» en vez de fingir una lista vacía.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;

/** La base todavía no tiene la 0580 (o su `lugar`): código tolerante a base sin migrar. */
export class ConveniosNoDisponibles extends Error {
  constructor() { super('Los convenios no están disponibles: falta aplicar la migración 0580.'); this.name = 'ConveniosNoDisponibles'; }
}

const FALTA_ESQUEMA = new Set(['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205']);
/** `traerTodo` relanza solo el mensaje (sin el código): se reconoce por el texto de Postgres/PostgREST. */
const MENSAJE_FALTA_ESQUEMA = /relation .* does not exist|column .* does not exist|schema cache/i;

/** Un error de base por esquema ausente se vuelve `ConveniosNoDisponibles`; cualquier otro pasa igual. */
export function traducirFaltaDeEsquema(e: unknown): unknown {
  return e instanceof Error && !(e instanceof ConveniosNoDisponibles) && MENSAJE_FALTA_ESQUEMA.test(e.message) ? new ConveniosNoDisponibles() : e;
}

async function leerTodo(pagina: Parameters<typeof traerTodo<Fila>>[0], etiqueta: string): Promise<Fila[]> {
  try {
    return await traerTodo<Fila>(pagina, etiqueta);
  } catch (e) {
    if (e instanceof Error && MENSAJE_FALTA_ESQUEMA.test(e.message)) throw new ConveniosNoDisponibles();
    throw e;
  }
}

/** Desenvuelve la respuesta de PostgREST: error por valor → excepción; esquema ausente → `ConveniosNoDisponibles`. */
function ok<T>(res: { data: T | null; error: { message: string; code?: string } | null }, consulta: string): T | null {
  if (res.error) {
    if ((res.error.code && FALTA_ESQUEMA.has(res.error.code)) || MENSAJE_FALTA_ESQUEMA.test(res.error.message)) throw new ConveniosNoDisponibles();
    throw new Error(`${consulta}: ${res.error.message}`);
  }
  return res.data;
}

const s = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const llave = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const COLS_CONVENIO = 'id, cliente_id, nombre, origen, destino, origen_sitio_id, destino_sitio_id, vigente_desde, vigente_hasta, activo, notas';
const COLS_INSTRUCCION = 'id, convenio_id, categoria, texto, momento, lugar, orden';

function filaAInstruccion(f: Fila): Instruccion | null {
  if (!esCategoria(f.categoria) || typeof f.texto !== 'string') return null;
  return {
    categoria: f.categoria, texto: f.texto,
    momento: esMomento(f.momento) ? f.momento : 'ambos',
    lugar: esLugar(f.lugar) ? f.lugar : 'ambos',
    orden: typeof f.orden === 'number' ? f.orden : 0,
  };
}

export interface ConvenioFila extends ConvenioExportable {
  id: string;
  clienteId: string;
  activo: boolean;
  origenSitioId: string | null;
  destinoSitioId: string | null;
  sitioOrigenNombre: string | null;
  sitioDestinoNombre: string | null;
}

// ── LECTURA ─────────────────────────────────────────────────────────────────

/** Los convenios de la flota con sus instrucciones. El dinero SOLO viene si `conFinanzas` (la base también lo niega). */
export async function listarConvenios(tenantId: string, opciones: { conFinanzas: boolean }): Promise<ConvenioFila[]> {
  const admin = supabaseAdmin();
  const convenios = await leerTodo((d, h) => acotada(admin.from('cliente_convenio').select(COLS_CONVENIO, conteo(d))
    .eq('tenant_id', tenantId).order('nombre').order('id').range(d, h), 'convenios.lista') as never, 'convenios.lista');
  if (convenios.length === 0) return [];

  const [instrucciones, clientes, sitios, comerciales] = await Promise.all([
    leerTodo((d, h) => acotada(admin.from('convenio_instruccion').select(COLS_INSTRUCCION, conteo(d))
      .eq('tenant_id', tenantId).eq('activa', true).order('orden').order('id').range(d, h), 'convenios.instrucciones') as never, 'convenios.instrucciones'),
    leerTodo((d, h) => acotada(admin.from('cliente').select('id, nombre', conteo(d))
      .eq('tenant_id', tenantId).order('id').range(d, h), 'convenios.clientes') as never, 'convenios.clientes'),
    leerTodo((d, h) => acotada(admin.from('geocerca').select('id, nombre', conteo(d))
      .eq('tenant_id', tenantId).order('id').range(d, h), 'convenios.sitios') as never, 'convenios.sitios'),
    opciones.conFinanzas
      ? leerTodo((d, h) => acotada(admin.from('convenio_comercial').select('convenio_id, tarifa_modo, tarifa_precio, tarifa_moneda, requisitos_cobro', conteo(d))
        .eq('tenant_id', tenantId).order('convenio_id').range(d, h), 'convenios.comercial') as never, 'convenios.comercial')
      : Promise.resolve([] as Fila[]),
  ]);
  const nombreCliente = new Map(clientes.map((c) => [String(c.id), String(c.nombre)] as const));
  const nombreSitio = new Map(sitios.map((g) => [String(g.id), String(g.nombre)] as const));
  const porConvenio = new Map<string, Instruccion[]>();
  for (const f of instrucciones) {
    const i = filaAInstruccion(f);
    if (i) porConvenio.set(String(f.convenio_id), [...(porConvenio.get(String(f.convenio_id)) ?? []), i]);
  }
  const dinero = new Map(comerciales.map((f) => [String(f.convenio_id), f] as const));

  return convenios.map((f): ConvenioFila => {
    const id = String(f.id);
    const m = dinero.get(id);
    const comercial: ComercialImportado | null = m
      ? {
        modo: (s(m.tarifa_modo) as ComercialImportado['modo']) ?? null,
        precio: m.tarifa_precio === null || m.tarifa_precio === undefined ? null : Number(m.tarifa_precio),
        moneda: m.tarifa_moneda === 'USD' ? 'USD' : 'MXN',
        requisitos: Array.isArray(m.requisitos_cobro) ? (m.requisitos_cobro as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      }
      : null;
    return {
      id, clienteId: String(f.cliente_id), cliente: nombreCliente.get(String(f.cliente_id)) ?? '(cliente borrado)', nombre: String(f.nombre),
      origen: s(f.origen), destino: s(f.destino), origenSitioId: s(f.origen_sitio_id), destinoSitioId: s(f.destino_sitio_id),
      sitioOrigenNombre: f.origen_sitio_id ? (nombreSitio.get(String(f.origen_sitio_id)) ?? null) : null,
      sitioDestinoNombre: f.destino_sitio_id ? (nombreSitio.get(String(f.destino_sitio_id)) ?? null) : null,
      vigenteDesde: s(f.vigente_desde), vigenteHasta: s(f.vigente_hasta), activo: f.activo !== false, notas: s(f.notas),
      instrucciones: porConvenio.get(id) ?? [], comercial: opciones.conFinanzas ? comercial : undefined,
    };
  });
}

// ── IMPORTACIÓN (todo o nada en la validación; escritura idempotente) ───────

export type ResultadoImportar =
  | { ok: true; creados: number; actualizados: number; instrucciones: number }
  | { ok: false; errores: ErrorFila[] };

/**
 * Escribe los convenios ya validados. Lo que solo la base sabe se revisa ANTES de escribir nada: que el cliente exista
 * en la flota y que el sitio (por código o por nombre) esté en su catálogo. Un nombre que no existe NO se inventa.
 * La escritura es idempotente: el convenio se upserta por (flota, cliente, nombre) y las instrucciones por
 * (convenio, categoría, texto). Las que el archivo ya no trae se borran DESPUÉS de escribir las nuevas (el archivo
 * manda): una falla a medias deja el convenio con lo que tenía más lo nuevo, nunca sin instrucciones.
 */
export async function importarConvenios(tenantId: string, convenios: readonly ConvenioImportado[], opciones: { conFinanzas: boolean }): Promise<ResultadoImportar> {
  const admin = supabaseAdmin();
  const [clientes, sitios] = await Promise.all([
    leerTodo((d, h) => acotada(admin.from('cliente').select('id, nombre', conteo(d)).eq('tenant_id', tenantId).order('id').range(d, h), 'convenios.imp_clientes') as never, 'convenios.imp_clientes'),
    leerTodo((d, h) => acotada(admin.from('geocerca').select('id, nombre, codigo', conteo(d)).eq('tenant_id', tenantId).eq('activa', true).order('id').range(d, h), 'convenios.imp_sitios') as never, 'convenios.imp_sitios'),
  ]);
  const clientePorNombre = new Map(clientes.map((c) => [llave(String(c.nombre)), String(c.id)] as const));
  const sitioPorClave = new Map<string, string>();
  for (const g of sitios) {
    sitioPorClave.set(llave(String(g.nombre)), String(g.id));
    if (typeof g.codigo === 'string') sitioPorClave.set(llave(g.codigo), String(g.id));
  }

  const errores: ErrorFila[] = [];
  const resueltos = convenios.map((c) => {
    const clienteId = clientePorNombre.get(llave(c.cliente)) ?? null;
    if (!clienteId) errores.push({ fila: c.linea, motivo: `El cliente «${c.cliente}» no existe en tu flota. Créalo en Clientes o corrige el nombre.` });
    const sitio = (clave: string | null, que: string): string | null => {
      if (!clave) return null;
      const id = sitioPorClave.get(llave(clave)) ?? null;
      if (!id) errores.push({ fila: c.linea, motivo: `El sitio de ${que} «${clave}» no está en el catálogo de sitios (código o nombre).` });
      return id;
    };
    return { c, clienteId, origenSitioId: sitio(c.sitioOrigen, 'origen'), destinoSitioId: sitio(c.sitioDestino, 'destino') };
  });
  if (errores.length > 0) return { ok: false, errores };

  const previos = await leerTodo((d, h) => acotada(admin.from('cliente_convenio').select('id, cliente_id, nombre', conteo(d)).eq('tenant_id', tenantId).order('id').range(d, h), 'convenios.imp_previos') as never, 'convenios.imp_previos');
  const existe = new Set(previos.map((p) => `${p.cliente_id}|${llave(String(p.nombre))}`));

  let creados = 0; let actualizados = 0; let nInstrucciones = 0;
  for (const r of resueltos) {
    const { c } = r;
    const clienteId = r.clienteId as string;
    const nuevo = !existe.has(`${clienteId}|${llave(c.nombre)}`);
    const up = await acotada(admin.from('cliente_convenio').upsert({
      tenant_id: tenantId, cliente_id: clienteId, nombre: c.nombre, origen: c.origen, destino: c.destino,
      origen_sitio_id: r.origenSitioId, destino_sitio_id: r.destinoSitioId, vigente_desde: c.vigenteDesde, vigente_hasta: c.vigenteHasta,
      notas: c.notas, activo: true, actualizado_en: new Date().toISOString(),
    }, { onConflict: 'tenant_id,cliente_id,nombre' }).select('id').single(), 'convenios.imp_convenio');
    const convenioId = String((ok(up as never, 'convenios.imp_convenio') as Fila).id);
    if (nuevo) creados++; else actualizados++;

    if (c.instrucciones.length > 0) {
      const ins = await acotada(admin.from('convenio_instruccion').upsert(
        c.instrucciones.map((i) => ({ tenant_id: tenantId, convenio_id: convenioId, categoria: i.categoria, texto: i.texto, momento: i.momento, lugar: i.lugar, orden: i.orden, activa: true })),
        { onConflict: 'convenio_id,categoria,texto' },
      ).select('id, categoria, texto'), 'convenios.imp_instrucciones');
      const escritas = (ok(ins as never, 'convenios.imp_instrucciones') as Fila[]) ?? [];
      nInstrucciones += escritas.length;
      // El archivo manda: lo que ya no trae se quita (después de escribir lo nuevo, nunca antes).
      const conservar = new Set(escritas.map((e) => String(e.id)));
      const actuales = await leerTodo((d, h) => acotada(admin.from('convenio_instruccion').select('id', conteo(d))
        .eq('tenant_id', tenantId).eq('convenio_id', convenioId).order('id').range(d, h), 'convenios.imp_actuales') as never, 'convenios.imp_actuales');
      const sobran = actuales.map((a) => String(a.id)).filter((id) => !conservar.has(id));
      if (sobran.length > 0) {
        ok(await acotada(admin.from('convenio_instruccion').delete().eq('tenant_id', tenantId).eq('convenio_id', convenioId).in('id', sobran), 'convenios.imp_quitar') as never, 'convenios.imp_quitar');
      }
    }
    if (opciones.conFinanzas && c.comercial) {
      ok(await acotada(admin.from('convenio_comercial').upsert({
        tenant_id: tenantId, convenio_id: convenioId, tarifa_modo: c.comercial.modo, tarifa_precio: c.comercial.precio,
        tarifa_moneda: c.comercial.moneda, requisitos_cobro: c.comercial.requisitos, actualizado_en: new Date().toISOString(),
      }, { onConflict: 'convenio_id' }), 'convenios.imp_comercial') as never, 'convenios.imp_comercial');
    }
  }
  return { ok: true, creados, actualizados, instrucciones: nInstrucciones };
}

/** Archiva o reactiva un convenio (no se borra: los viajes ya despachados conservan su foto). `false` = no existe en la flota. */
export async function cambiarEstadoConvenio(tenantId: string, convenioId: string, activo: boolean): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('cliente_convenio').update({ activo, actualizado_en: new Date().toISOString() })
    .eq('tenant_id', tenantId).eq('id', convenioId).select('id'), 'convenios.estado');
  return ((ok(res as never, 'convenios.estado') as Fila[]) ?? []).length > 0;
}

// ── LIGAR AL VIAJE ──────────────────────────────────────────────────────────

export interface ViajeLigado {
  convenioId: string | null;
  instrucciones: Instruccion[];
  despachoEnviado: boolean;
  acercamientoOrigenEnviado: boolean;
  acercamientoDestinoEnviado: boolean;
}

export type ResultadoLigar =
  | { estado: 'ligado' | 'ya_ligado'; ligado: ViajeLigado }
  | { estado: 'sin_convenio'; motivo: string }
  | { estado: 'viaje_no_encontrado' };

function filaALigado(f: Fila): ViajeLigado {
  return {
    convenioId: s(f.convenio_id), instrucciones: leerFoto(f.instrucciones),
    despachoEnviado: !!f.despacho_enviado_en,
    acercamientoOrigenEnviado: !!f.acercamiento_origen_enviado_en, acercamientoDestinoEnviado: !!f.acercamiento_destino_enviado_en,
  };
}

const COLS_LIGADO = 'viaje_id, convenio_id, instrucciones, despacho_enviado_en, acercamiento_origen_enviado_en, acercamiento_destino_enviado_en';

/** La foto ya ligada del viaje, si la hay. */
export async function leerLigado(tenantId: string, viajeId: string): Promise<ViajeLigado | null> {
  const res = await acotada(supabaseAdmin().from('viaje_convenio').select(COLS_LIGADO).eq('tenant_id', tenantId).eq('viaje_id', viajeId).maybeSingle(), 'convenios.ligado');
  const f = ok(res as never, 'convenios.ligado') as Fila | null;
  return f ? filaALigado(f) : null;
}

/**
 * Elige el convenio del viaje (regla escrita en `seleccion.ts`) y FOTOGRAFÍA sus instrucciones vigentes en
 * `viaje_convenio`. Idempotente: un viaje ya ligado devuelve su foto sin tocarla (editar el convenio después no cambia lo
 * que ya se le dijo al operador). Si el viaje no traía sitios de catálogo y el convenio sí, se los pasa (solo donde
 * estaban vacíos): así el Conductor ya puede valídar y acercar contra esa planta.
 */
export async function ligarConvenioAViaje(tenantId: string, viajeId: string, hoy: string = hoyMx()): Promise<ResultadoLigar> {
  const admin = supabaseAdmin();
  const rv = await acotada(admin.from('viaje').select('id, cliente_id, origen, destino, origen_geocerca_id, destino_geocerca_id')
    .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'convenios.viaje');
  const v = ok(rv as never, 'convenios.viaje') as Fila | null;
  if (!v) return { estado: 'viaje_no_encontrado' };

  const previo = await leerLigado(tenantId, viajeId);
  if (previo) return { estado: 'ya_ligado', ligado: previo };

  const clienteId = s(v.cliente_id);
  if (!clienteId) return { estado: 'sin_convenio', motivo: 'el viaje no tiene cliente' };

  const convenios = await leerTodo((d, h) => acotada(admin.from('cliente_convenio').select(COLS_CONVENIO, conteo(d))
    .eq('tenant_id', tenantId).eq('cliente_id', clienteId).eq('activo', true).order('id').range(d, h), 'convenios.del_cliente') as never, 'convenios.del_cliente');
  if (convenios.length === 0) return { estado: 'sin_convenio', motivo: 'el cliente no tiene convenios' };
  const insts = await leerTodo((d, h) => acotada(admin.from('convenio_instruccion').select(COLS_INSTRUCCION, conteo(d))
    .eq('tenant_id', tenantId).eq('activa', true).in('convenio_id', convenios.map((c) => String(c.id))).order('orden').order('id').range(d, h), 'convenios.ins_del_cliente') as never, 'convenios.ins_del_cliente');
  const porConvenio = new Map<string, Instruccion[]>();
  for (const f of insts) {
    const i = filaAInstruccion(f);
    if (i) porConvenio.set(String(f.convenio_id), [...(porConvenio.get(String(f.convenio_id)) ?? []), i]);
  }
  const candidatos: ConvenioCandidato[] = convenios.map((c) => ({
    id: String(c.id), nombre: String(c.nombre), activo: c.activo !== false, origen: s(c.origen), destino: s(c.destino),
    origenSitioId: s(c.origen_sitio_id), destinoSitioId: s(c.destino_sitio_id), vigenteDesde: s(c.vigente_desde), vigenteHasta: s(c.vigente_hasta),
    instrucciones: porConvenio.get(String(c.id)) ?? [],
  }));
  const viaje: ViajeParaLigar = { origen: s(v.origen), destino: s(v.destino), origenSitioId: s(v.origen_geocerca_id), destinoSitioId: s(v.destino_geocerca_id) };
  const eleccion: EleccionConvenio = elegirConvenio(candidatos, viaje, hoy);
  if (eleccion.tipo === 'ninguno') return { estado: 'sin_convenio', motivo: eleccion.motivo };
  if (eleccion.tipo === 'ambiguo') {
    logger.warn('convenios.ambiguo', { viajeId, candidatos: eleccion.candidatos.length });
    return { estado: 'sin_convenio', motivo: `varios convenios empatan (${eleccion.candidatos.join(', ')}): hace falta el sitio del viaje` };
  }

  const elegido = eleccion.convenio;
  const ins = await acotada(admin.from('viaje_convenio').insert({
    viaje_id: viajeId, tenant_id: tenantId, convenio_id: elegido.id, cliente_id: clienteId, ligado_por: 'auto', instrucciones: elegido.instrucciones,
  }).select(COLS_LIGADO).single(), 'convenios.ligar');
  if (ins.error) {
    // Dos despachos del mismo viaje a la vez: el segundo pierde y lee la foto del primero.
    if (violaIndice(ins.error, 'viaje_convenio_pkey')) {
      const ya = await leerLigado(tenantId, viajeId);
      if (ya) return { estado: 'ya_ligado', ligado: ya };
    }
    ok(ins as never, 'convenios.ligar');
  }

  // Los sitios del convenio pasan al viaje SOLO donde el viaje no traía (best-effort, no cambia lo ya elegido).
  const rc = convenios.find((c) => String(c.id) === elegido.id);
  const sitios: Record<string, string> = {};
  if (!viaje.origenSitioId && s(rc?.origen_sitio_id)) sitios.origen_geocerca_id = String(rc?.origen_sitio_id);
  if (!viaje.destinoSitioId && s(rc?.destino_sitio_id)) sitios.destino_geocerca_id = String(rc?.destino_sitio_id);
  for (const [col, id] of Object.entries(sitios)) {
    const u = await acotada(admin.from('viaje').update({ [col]: id }).eq('tenant_id', tenantId).eq('id', viajeId).is(col, null), 'convenios.sitio_al_viaje');
    if (u.error) logger.warn('convenios.sitio_al_viaje_fallo', { viajeId, col, err: u.error.message });
  }
  return { estado: 'ligado', ligado: { convenioId: elegido.id, instrucciones: elegido.instrucciones, despachoEnviado: false, acercamientoOrigenEnviado: false, acercamientoDestinoEnviado: false } };
}

// ── CORREGIR A MANO EL CONVENIO LIGADO A UN VIAJE ───────────────────────────

export interface OpcionConvenio { id: string; nombre: string }

/** Un viaje abierto con el convenio que tiene ligado (o ninguno) y los convenios activos de su cliente entre los que se puede elegir. */
export interface ViajeConvenioFila {
  viajeId: string;
  folio: string;
  origen: string | null;
  destino: string | null;
  cliente: string | null;
  operador: string | null;
  convenioId: string | null;
  convenioNombre: string | null;
  /** `null` = el viaje todavía no tiene fila ligada (nunca se despachó con convenio, o hubo empate entre varios). */
  ligadoPor: 'auto' | 'manual' | null;
  instrucciones: number;
  despachoEnviado: boolean;
  opciones: OpcionConvenio[];
}

/** Cuántos viajes abiertos se listan en la pantalla (los más recientes). */
export const TOPE_VIAJES_CONVENIO = 60;

/** Los viajes abiertos con cliente, con su convenio ligado y las opciones para corregirlo. Lanza si la base no contesta. */
export async function listarViajesConConvenio(tenantId: string): Promise<ViajeConvenioFila[]> {
  const admin = supabaseAdmin();
  const rv = await acotada(admin.from('viaje').select('id, folio, origen, destino, cliente_id, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId).eq('estatus', 'abierto').not('cliente_id', 'is', null)
    .order('created_at', { ascending: false }).order('id').limit(TOPE_VIAJES_CONVENIO), 'convenios.viajes_lista');
  const viajes = (ok(rv as never, 'convenios.viajes_lista') ?? []) as Fila[];
  if (viajes.length === 0) return [];
  const viajeIds = viajes.map((v) => String(v.id));
  const clienteIds = [...new Set(viajes.map((v) => String(v.cliente_id)))];

  const [ligados, opciones, clientes] = await Promise.all([
    acotada(admin.from('viaje_convenio').select('viaje_id, convenio_id, ligado_por, instrucciones, despacho_enviado_en')
      .eq('tenant_id', tenantId).in('viaje_id', viajeIds), 'convenios.viajes_ligados'),
    acotada(admin.from('cliente_convenio').select('id, cliente_id, nombre').eq('tenant_id', tenantId).in('cliente_id', clienteIds).eq('activo', true)
      .order('nombre').order('id'), 'convenios.viajes_opciones'),
    acotada(admin.from('cliente').select('id, nombre').eq('tenant_id', tenantId).in('id', clienteIds), 'convenios.viajes_clientes'),
  ]);
  const filasLigadas = (ok(ligados as never, 'convenios.viajes_ligados') ?? []) as Fila[];
  const filasOpciones = (ok(opciones as never, 'convenios.viajes_opciones') ?? []) as Fila[];
  const nombreCliente = new Map(((ok(clientes as never, 'convenios.viajes_clientes') ?? []) as Fila[]).map((c) => [String(c.id), String(c.nombre)] as const));
  // El nombre de un convenio ligado que ya se archivó no está entre las opciones activas: se lee aparte.
  const ligadosIds = [...new Set(filasLigadas.map((l) => s(l.convenio_id)).filter((x): x is string => x !== null))];
  const nombres = new Map(filasOpciones.map((o) => [String(o.id), String(o.nombre)] as const));
  const faltan = ligadosIds.filter((id) => !nombres.has(id));
  if (faltan.length > 0) {
    const r = await acotada(admin.from('cliente_convenio').select('id, nombre').eq('tenant_id', tenantId).in('id', faltan), 'convenios.viajes_archivados');
    for (const o of ((ok(r as never, 'convenios.viajes_archivados') ?? []) as Fila[])) nombres.set(String(o.id), String(o.nombre));
  }
  const ligadoDe = new Map(filasLigadas.map((l) => [String(l.viaje_id), l] as const));

  return viajes.map((v): ViajeConvenioFila => {
    const l = ligadoDe.get(String(v.id));
    const convenioId = l ? s(l.convenio_id) : null;
    const rel = v.operador as { nombre?: string } | Array<{ nombre?: string }> | null;
    return {
      viajeId: String(v.id), folio: s(v.folio) ?? String(v.id).slice(0, 8), origen: s(v.origen), destino: s(v.destino),
      cliente: nombreCliente.get(String(v.cliente_id)) ?? null, operador: (Array.isArray(rel) ? rel[0] : rel)?.nombre ?? null,
      convenioId, convenioNombre: convenioId ? (nombres.get(convenioId) ?? null) : null,
      ligadoPor: l ? (l.ligado_por === 'manual' ? 'manual' : 'auto') : null,
      instrucciones: l ? leerFoto(l.instrucciones).length : 0,
      despachoEnviado: !!l?.despacho_enviado_en,
      opciones: filasOpciones.filter((o) => String(o.cliente_id) === String(v.cliente_id)).map((o) => ({ id: String(o.id), nombre: String(o.nombre) })),
    };
  });
}

export type ResultadoCorregir =
  | { estado: 'ok'; convenioNombre: string | null; instrucciones: number }
  | { estado: 'viaje_no_encontrado' | 'viaje_cerrado' | 'sin_cliente' | 'convenio_no_valido' };

const SELLOS_VACIOS = {
  despacho_reclamado_en: null, despacho_enviado_en: null, despacho_canal: null,
  acercamiento_origen_reclamado_en: null, acercamiento_origen_enviado_en: null, acercamiento_origen_canal: null,
  acercamiento_destino_reclamado_en: null, acercamiento_destino_enviado_en: null, acercamiento_destino_canal: null,
};

/**
 * La oficina corrige a mano el convenio de UN viaje: `convenioId` = otro convenio ACTIVO del MISMO cliente, o `null` = «este viaje no
 * usa convenio». La foto de instrucciones se vuelve a tomar del convenio elegido (con sus instrucciones de hoy) y la fila queda
 * `manual`: el despacho automático ya no la vuelve a elegir. `reenviar` borra los sellos de envío para que las instrucciones
 * correctas salgan otra vez (el que las manda es el llamador, con su claim). El convenio tiene que ser del cliente del viaje y de
 * la flota: un id ajeno o de otro cliente no pasa (`convenio_no_valido`). Un viaje liquidado ya no se corrige.
 */
export async function corregirConvenioDelViaje(
  tenantId: string, viajeId: string, convenioId: string | null, opciones: { reenviar: boolean },
): Promise<ResultadoCorregir> {
  const admin = supabaseAdmin();
  const rv = await acotada(admin.from('viaje').select('id, cliente_id, estatus, origen_geocerca_id, destino_geocerca_id')
    .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'convenios.corregir_viaje');
  const v = ok(rv as never, 'convenios.corregir_viaje') as Fila | null;
  if (!v) return { estado: 'viaje_no_encontrado' };
  if (v.estatus === 'liquidado') return { estado: 'viaje_cerrado' };
  const clienteId = s(v.cliente_id);
  if (!clienteId) return { estado: 'sin_cliente' };

  let convenio: Fila | null = null;
  let foto: Instruccion[] = [];
  if (convenioId !== null) {
    const rc = await acotada(admin.from('cliente_convenio').select(COLS_CONVENIO)
      .eq('tenant_id', tenantId).eq('id', convenioId).eq('cliente_id', clienteId).eq('activo', true).maybeSingle(), 'convenios.corregir_convenio');
    convenio = ok(rc as never, 'convenios.corregir_convenio') as Fila | null;
    if (!convenio) return { estado: 'convenio_no_valido' };
    const ri = await leerTodo((d, h) => acotada(admin.from('convenio_instruccion').select(COLS_INSTRUCCION, conteo(d))
      .eq('tenant_id', tenantId).eq('activa', true).eq('convenio_id', convenioId).order('orden').order('id').range(d, h), 'convenios.corregir_instrucciones') as never, 'convenios.corregir_instrucciones');
    foto = ri.map(filaAInstruccion).filter((x): x is Instruccion => x !== null);
  }

  const cambio = {
    convenio_id: convenioId, cliente_id: clienteId, ligado_por: 'manual', instrucciones: foto, ligado_en: new Date().toISOString(),
    ...(opciones.reenviar ? SELLOS_VACIOS : {}),
  };
  const actualizar = async (): Promise<boolean> => {
    const r = await acotada(admin.from('viaje_convenio').update(cambio).eq('tenant_id', tenantId).eq('viaje_id', viajeId).select('viaje_id'), 'convenios.corregir_actualizar');
    return ((ok(r as never, 'convenios.corregir_actualizar') ?? []) as Fila[]).length > 0;
  };
  if (!(await actualizar())) {
    const ins = await acotada(admin.from('viaje_convenio').insert({ viaje_id: viajeId, tenant_id: tenantId, ...cambio }).select('viaje_id'), 'convenios.corregir_insertar');
    // Otro gesto la creó entre la lectura y la escritura: se aplica la corrección sobre la fila que ganó.
    if (ins.error && violaIndice(ins.error, 'viaje_convenio_pkey')) await actualizar();
    else ok(ins as never, 'convenios.corregir_insertar');
  }

  // Los sitios del convenio elegido pasan al viaje SOLO donde el viaje no traía (best-effort, igual que al ligar).
  if (convenio) {
    const sitios: Record<string, string> = {};
    if (!s(v.origen_geocerca_id) && s(convenio.origen_sitio_id)) sitios.origen_geocerca_id = String(convenio.origen_sitio_id);
    if (!s(v.destino_geocerca_id) && s(convenio.destino_sitio_id)) sitios.destino_geocerca_id = String(convenio.destino_sitio_id);
    for (const [col, id] of Object.entries(sitios)) {
      const u = await acotada(admin.from('viaje').update({ [col]: id }).eq('tenant_id', tenantId).eq('id', viajeId).is(col, null), 'convenios.corregir_sitio');
      if (u.error) logger.warn('convenios.corregir_sitio_fallo', { viajeId, col, err: u.error.message });
    }
  }
  return { estado: 'ok', convenioNombre: convenio ? String(convenio.nombre) : null, instrucciones: foto.length };
}

// ── EL ENVÍO AL OPERADOR, CON CLAIM ─────────────────────────────────────────

/** Cada envío tiene su propio sello: el despacho y el acercamiento a cada planta (`<envio>_reclamado_en`, `_enviado_en`, `_canal`). */
export type Envio = 'despacho' | 'acercamiento_origen' | 'acercamiento_destino';

/** Un reclamo que lleva más de esto sin cerrarse se da por caído (la corrida murió entre reclamar y enviar). */
export const CLAIM_CADUCA_MIN = 10;

/**
 * Reclama el envío ANTES de mandarlo: UN UPDATE condicionado a «no enviado y no reclamado (o reclamo caducado)».
 * Dos corridas del cron (Vercel entrega at-least-once) o dos gestos del chofer: gana exactamente una.
 */
export async function reclamarEnvio(tenantId: string, viajeId: string, cual: Envio, ahora: Date = new Date()): Promise<'ganado' | 'perdido' | 'fallo'> {
  const caduca = new Date(ahora.getTime() - CLAIM_CADUCA_MIN * 60_000).toISOString();
  const res = await acotada(supabaseAdmin().from('viaje_convenio')
    .update({ [`${cual}_reclamado_en`]: ahora.toISOString() })
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId)
    .is(`${cual}_enviado_en`, null)
    .or(`${cual}_reclamado_en.is.null,${cual}_reclamado_en.lt.${caduca}`)
    .select('viaje_id'), 'convenios.reclamar');
  if (res.error) { logger.warn('convenios.reclamar_fallo', { viajeId, cual, err: res.error.message }); return 'fallo'; }
  return (res.data ?? []).length > 0 ? 'ganado' : 'perdido';
}

/** Sella el envío (hora + canal). Solo si aún no estaba sellado. */
export async function cerrarEnvio(tenantId: string, viajeId: string, cual: Envio, canal: 'texto' | 'botones' | 'plantilla', ahora: Date = new Date()): Promise<void> {
  const res = await acotada(supabaseAdmin().from('viaje_convenio')
    .update({ [`${cual}_enviado_en`]: ahora.toISOString(), [`${cual}_canal`]: canal })
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).is(`${cual}_enviado_en`, null), 'convenios.cerrar');
  if (res.error) logger.error('convenios.cerrar_fallo', { viajeId, cual, err: res.error.message });
}

/**
 * El operador del viaje CAMBIÓ: el nuevo no recibió ninguna de las instrucciones que se le mandaron al anterior, así que se
 * borran los tres sellos (despacho y acercamiento a cada planta) para que vuelvan a salir, una vez, hacia el operador nuevo.
 * Sin fila ligada no hace nada (la primera asignación liga y manda por la vía normal). La foto de instrucciones NO se toca:
 * lo que se le dijo al operador anterior es lo mismo que debe oír el nuevo; corregir el convenio es otro gesto (`corregirConvenioDelViaje`).
 */
export async function reiniciarEnvios(tenantId: string, viajeId: string): Promise<void> {
  const res = await acotada(supabaseAdmin().from('viaje_convenio').update(SELLOS_VACIOS)
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).select('viaje_id'), 'convenios.reiniciar_envios');
  ok(res as never, 'convenios.reiniciar_envios');
}

/** Suelta el reclamo tras un rechazo REINTENTABLE de Meta: el aviso no salió y la corrida siguiente lo intenta de nuevo. */
export async function liberarEnvio(tenantId: string, viajeId: string, cual: Envio): Promise<void> {
  const res = await acotada(supabaseAdmin().from('viaje_convenio').update({ [`${cual}_reclamado_en`]: null })
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).is(`${cual}_enviado_en`, null), 'convenios.liberar');
  if (res.error) logger.warn('convenios.liberar_fallo', { viajeId, cual, err: res.error.message });
}

// ── LA CONSULTA DEL OPERADOR ────────────────────────────────────────────────

/** Qué planta está atendiendo el viaje: la de carga hasta que sale de cargar; luego la de descarga. `null` si no se sabe. */
export async function ladoDelViaje(tenantId: string, viajeId: string): Promise<'origen' | 'destino' | null> {
  const res = await acotada(supabaseAdmin().from('viaje_hito').select('tipo, estado')
    .eq('tenant_id', tenantId).eq('viaje_id', viajeId).eq('tipo', 'salida_carga').maybeSingle(), 'convenios.lado');
  const f = ok(res as never, 'convenios.lado') as Fila | null;
  if (!f) return null;
  return f.estado === 'recibido' || f.estado === 'validado' ? 'destino' : 'origen';
}

export interface ContextoEnvio {
  folio: string;
  origen: string | null;
  destino: string | null;
  estatus: string;
  operadorNombre: string | null;
  telefono: string | null;
}

/** El viaje y a quién escribirle. `null` = el viaje no es de esta flota. */
export async function leerContextoEnvio(tenantId: string, viajeId: string): Promise<ContextoEnvio | null> {
  const res = await acotada(supabaseAdmin().from('viaje').select('id, folio, origen, destino, estatus, operador:operador_id(nombre, telefono)')
    .eq('tenant_id', tenantId).eq('id', viajeId).maybeSingle(), 'convenios.contexto');
  const f = ok(res as never, 'convenios.contexto') as Fila | null;
  if (!f) return null;
  const rel = f.operador as { nombre?: string; telefono?: string } | Array<{ nombre?: string; telefono?: string }> | null;
  const op = Array.isArray(rel) ? rel[0] : rel;
  return {
    folio: s(f.folio) ?? String(f.id).slice(0, 8), origen: s(f.origen), destino: s(f.destino), estatus: String(f.estatus),
    operadorNombre: op?.nombre ?? null, telefono: op?.telefono ?? null,
  };
}

/** ¿Este viaje es de ESTE operador y de esta flota, y sigue abierto? Quien pregunta por las instrucciones solo ve las suyas. */
export async function viajeAbiertoDelOperador(tenantId: string, operadorId: string, viajeId: string): Promise<boolean> {
  const res = await acotada(supabaseAdmin().from('viaje').select('id, estatus')
    .eq('tenant_id', tenantId).eq('operador_id', operadorId).eq('id', viajeId).maybeSingle(), 'convenios.viaje_del_operador');
  const f = ok(res as never, 'convenios.viaje_del_operador') as Fila | null;
  return !!f && f.estatus !== 'liquidado';
}
