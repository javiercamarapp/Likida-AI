// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE POSICIONES del conector TMS (T-TMS-10). Lee las posiciones que el sistema de gestión de transporte
// del cliente ya combina (varios proveedores GPS en una sola tabla) y las entrega con el `Icident` (= número
// de despacho) que las liga a su viaje.
//
// Tres piezas, separadas a propósito:
//  · `leerPosiciones`: SOLO LEE. Cursor incremental por `medida_en`, conversión de zona, descarte contado de
//    coordenadas inválidas. No escribe en la base.
//  · `asentarPosicionesTms`: entrega las lecturas a `asentarLecturas` (la ÚNICA ruta de escritura a `posicion`:
//    misma compuerta de privacidad, mismo upsert idempotente `posicion_sin_duplicado`, mismo sello
//    `gps_visto_en`), ligando la unidad por NÚMERO ECONÓMICO. No se modifica ni se duplica esa ruta.
//  · `asentarDespachoRef`: tras asentar, estampa `posicion.despacho_ref` por (tenant, unidad, medida_en), solo
//    donde la fila existe y la referencia viene y aún no estaba. No pisa una referencia ya asentada.
//
// SUPUESTO (BLOQUEO EXTERNO: la tabla GPS combinada / endpoint de posiciones NO está acordado — 15ed3efd 04:54
// a 05:33): ruta, nombres de columna y formato de fecha están en `MAPEO_POSICIONES_SUPUESTO`. El crudo solo
// confirma que existe un campo `Icident` que es el número de despacho y que la fila trae la unidad. Si el
// cliente entrega una vista SQL, la alternativa ya existente es `tabla_propia` (no se duplica aquí).
//
// El cron `gps` (≈180 s de 300) NO se alarga: este lector corre en su propio cron (T-TMS-12).
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { TZ_MX } from '@/lib/formato';
import { acotada } from '../../presupuesto';
import { coordenadaValida } from '../posiciones_comun';
import { asentarLecturas, type Lectura, type ResultadoSync } from '../sincronizar_gps';
import { llaveEconomico } from '../tabla_propia/validar';
import type { MapeoTms } from './mapeo';
import { paginar, type OpcionesPaginar, type PuntoReanudo } from './paginar';
import type { SesionTms } from './sesion';
import type { FilaRechazadaTms, LectorTms, LecturaTms } from './tipos';

/** Valor de `posicion.proveedor` y de `gps_proveedor` para lo que entra por la API de lectura del TMS. */
export const PROVEEDOR_TMS_POSICIONES = 'tms_api_lectura';

/** SUPUESTO: forma hipotética de la tabla de posiciones combinada. Se confirma al llegar la documentación. */
export const MAPEO_POSICIONES_SUPUESTO: MapeoTms = {
  recurso: 'posiciones',
  ruta: '/api/posiciones',
  metodo: 'GET',
  params: { desde: 'desde', hasta: 'hasta', pagina: 'pagina', tam: 'tam' },
  raiz: 'data.items',
  campos: {
    // El crudo no garantiza que SIEMPRE traiga despacho (15ed3efd, abierto): por eso no es obligatorio.
    despacho_ref: { fuente: 'Icident', transformar: 'texto' },
    deviceId: { fuente: 'unidad', transformar: 'texto' },
    lat: { fuente: 'latitud', transformar: 'numero' },
    lng: { fuente: 'longitud', transformar: 'numero' },
    medidaEn: { fuente: 'fecha', transformar: 'fecha_local', zona: TZ_MX },
    velocidad: { fuente: 'velocidad', transformar: 'numero' },
    rumbo: { fuente: 'rumbo', transformar: 'numero' },
  },
  clave_externa: ['deviceId', 'medidaEn'],
  obligatorios: ['deviceId', 'lat', 'lng', 'medidaEn'],
};

/** Una lectura lista para `asentarLecturas`, más la referencia de despacho si el origen la trajo. */
export interface PosicionTms extends Lectura {
  despacho_ref?: string;
}

export interface LecturaPosiciones {
  filas: PosicionTms[];
  /** Filas que el mapeo no pudo leer (falta un campo, número ilegible…), con motivo. */
  rechazadas: FilaRechazadaTms[];
  /** Filas con coordenadas fuera de rango o (0,0): descartadas y CONTADAS, nunca en silencio. */
  descartadasPorCoordenada: number;
  /**
   * Desde dónde leer en el próximo ciclo (instante UTC ISO, inclusivo: la relectura de la última posición no
   * duplica, la deduplica el índice único). Solo avanza cuando la lectura llegó hasta el final; si quedó
   * pendiente (`backlog`) o se cortó, se conserva el `desde` recibido y se continúa desde `reanudar`.
   */
  cursor: string;
  completa: boolean;
  backlog: boolean;
  reanudar?: PuntoReanudo;
  avisos: string[];
}

export type ResultadoPosiciones =
  | ({ ok: true } & LecturaPosiciones)
  | { ok: false; motivo: string; parcial: LecturaPosiciones };

export interface OpcionesPosiciones extends OpcionesPaginar {
  /** Mapeo del tenant; por omisión el supuesto. */
  mapeo?: MapeoTms;
}

interface Cruda {
  despacho_ref?: string; deviceId: string; lat: number; lng: number; medidaEn: string; velocidad?: number; rumbo?: number;
}

/** A37-S39-03: el cursor retrocede este tramo del máximo leído para no perder lo que un dispositivo con buffer sube tarde. La idempotencia la da `posicion_sin_duplicado`. */
export const SOLAPE_CURSOR_POSICIONES_MS = 10 * 60_000;

const mayorInstante = (a: string, b: string): string => (Date.parse(b) > Date.parse(a) ? b : a);

/**
 * Lee las posiciones de la ventana [desde, hasta]. `desde` es el cursor de la corrida anterior (o el arranque).
 * No escribe nada.
 */
export async function leerPosiciones(
  sesion: SesionTms, ventana: { desde: string; hasta: string; reanudar?: PuntoReanudo }, opciones: OpcionesPosiciones = {},
): Promise<ResultadoPosiciones> {
  const mapeo = opciones.mapeo ?? MAPEO_POSICIONES_SUPUESTO;
  const r = await paginar<Cruda>(sesion, mapeo, ventana, opciones);
  const base = r.ok ? r : r.parcial;

  const filas: PosicionTms[] = [];
  let descartadasPorCoordenada = 0;
  let descartadasPorFuturo = 0;
  const topeMs = Date.parse(ventana.hasta);
  let maxima: string | undefined;
  for (const m of base.filas) {
    const c = m.fila;
    // A37-S39-03: una marca de tiempo posterior al fin de la ventana (reloj adelantado del GPS) no se acepta: adelantaría el cursor al futuro.
    if (Number.isFinite(topeMs) && Date.parse(c.medidaEn) > topeMs) { descartadasPorFuturo += 1; continue; }
    if (!coordenadaValida(c.lat, c.lng)) { descartadasPorCoordenada += 1; continue; }
    const p: PosicionTms = {
      deviceId: c.deviceId, lat: c.lat, lng: c.lng, medidaEn: c.medidaEn,
      velocidad: c.velocidad ?? null, rumbo: c.rumbo ?? null,
    };
    if (c.despacho_ref !== undefined && c.despacho_ref !== '') p.despacho_ref = c.despacho_ref;
    filas.push(p);
    maxima = maxima === undefined ? c.medidaEn : mayorInstante(maxima, c.medidaEn);
  }

  const avisos = [...base.avisos];
  if (descartadasPorCoordenada > 0) avisos.push(`${descartadasPorCoordenada} posición(es) con coordenadas inválidas se descartaron.`);
  // El cursor solo avanza con una lectura completa: si quedó trabajo, las páginas sin leer pueden traer
  // instantes anteriores al máximo ya visto y adelantar el cursor las perdería.
  if (descartadasPorFuturo > 0) avisos.push(`${descartadasPorFuturo} posición(es) con fecha posterior a la ventana se descartaron.`);
  const maximaConSolape = maxima === undefined || Number.isNaN(Date.parse(maxima)) ? undefined : new Date(Date.parse(maxima) - SOLAPE_CURSOR_POSICIONES_MS).toISOString();
  const cursor = base.completa && maximaConSolape !== undefined ? mayorInstante(ventana.desde, maximaConSolape) : ventana.desde;
  const lectura: LecturaPosiciones = {
    filas, rechazadas: base.rechazadas, descartadasPorCoordenada, cursor,
    completa: base.completa, backlog: base.backlog, reanudar: base.reanudar, avisos,
  };
  return r.ok ? { ok: true, ...lectura } : { ok: false, motivo: r.motivo, parcial: lectura };
}

/** Adaptador al contrato `LectorTms`: lanza si la lectura falla (el sincronizador usa `leerPosiciones` y conserva el parcial). */
export function lectorPosiciones(sesion: SesionTms, opciones: OpcionesPosiciones = {}): LectorTms<PosicionTms> {
  return {
    recurso: 'posiciones',
    async leer(desde, hasta): Promise<LecturaTms<PosicionTms>> {
      const r = await leerPosiciones(sesion, { desde, hasta }, opciones);
      if (!r.ok) throw new Error(r.motivo);
      return { filas: r.filas, rechazadas: r.rechazadas };
    },
  };
}

// ── Escritura: SIEMPRE por la ruta única ─────────────────────────────────

const MAX_UNIDADES = 50_000;
const PAGINA_UNIDADES = 1_000;
const TIEMPOS_POR_UPDATE = 200;

/** Económico normalizado → id de unidad ACTIVA de ESTA flota. Los ambiguos quedan fuera. `null` = no se pudo leer. */
async function unidadesPorEconomico(tenantId: string): Promise<Map<string, string> | null> {
  const mapa = new Map<string, string | null>();
  for (let desde = 0; desde < MAX_UNIDADES; desde += PAGINA_UNIDADES) {
    const { data, error } = await acotada(
      supabaseAdmin().from('unidad')
        .select('id, numero_economico')
        .eq('tenant_id', tenantId)
        .eq('activo', true)
        .order('id', { ascending: true })
        .range(desde, desde + PAGINA_UNIDADES - 1),
      'tms.posiciones.unidades',
    );
    if (error) { logger.error('tms.posiciones.unidades_no_leidas', { tenantId, err: error.message }); return null; }
    for (const u of data ?? []) {
      const k = llaveEconomico(String(u.numero_economico ?? ''));
      if (k === '') continue;
      mapa.set(k, mapa.has(k) ? null : String(u.id));
    }
    if ((data ?? []).length < PAGINA_UNIDADES) break;
  }
  const limpio = new Map<string, string>();
  for (const [k, v] of mapa) if (v) limpio.set(k, v);
  return limpio;
}

export interface ResultadoDespachoRef {
  /** Posiciones a las que se les estampó la referencia. */
  actualizadas: number;
  /** Lecturas que traían referencia pero cuya unidad no se pudo ligar por económico. */
  sinUnidad: number;
  error?: string;
}

/**
 * Estampa `posicion.despacho_ref` en las posiciones YA asentadas, por (tenant, unidad, medida_en). Solo toca filas
 * que existen (las que la compuerta de privacidad no dejó guardar no existen: no se crean aquí), solo con
 * referencia que viene, y no pisa una referencia ya asentada. No cambia la ruta única de escritura: no inserta.
 */
export async function asentarDespachoRef(tenantId: string, lecturas: readonly PosicionTms[]): Promise<ResultadoDespachoRef> {
  const base: ResultadoDespachoRef = { actualizadas: 0, sinUnidad: 0 };
  const conRef = lecturas.filter((l) => l.despacho_ref !== undefined && l.despacho_ref !== '');
  if (conRef.length === 0) return base;

  const porEco = await unidadesPorEconomico(tenantId);
  if (porEco === null) return { ...base, error: 'no se pudieron leer las unidades de la flota' };

  // (unidad, referencia) → instantes
  const grupos = new Map<string, { unidadId: string; ref: string; tiempos: Set<string> }>();
  for (const l of conRef) {
    const unidadId = porEco.get(llaveEconomico(l.deviceId));
    if (!unidadId) { base.sinUnidad += 1; continue; }
    const k = `${unidadId}\u0000${l.despacho_ref}`;
    const g = grupos.get(k) ?? { unidadId, ref: l.despacho_ref as string, tiempos: new Set<string>() };
    g.tiempos.add(l.medidaEn);
    grupos.set(k, g);
  }

  for (const g of grupos.values()) {
    const tiempos = [...g.tiempos];
    for (let i = 0; i < tiempos.length; i += TIEMPOS_POR_UPDATE) {
      const { data, error } = await acotada(
        supabaseAdmin().from('posicion')
          .update({ despacho_ref: g.ref })
          .eq('tenant_id', tenantId)
          .eq('unidad_id', g.unidadId)
          .in('medida_en', tiempos.slice(i, i + TIEMPOS_POR_UPDATE))
          .is('despacho_ref', null)
          .select('id'),
        'tms.posiciones.despacho_ref',
      );
      if (error) {
        logger.error('tms.posiciones.despacho_ref_no_guardado', { tenantId, err: error.message });
        return { ...base, error: 'no se pudo guardar la referencia de despacho' };
      }
      base.actualizadas += (data ?? []).length;
    }
  }
  return base;
}

export interface DepsAsentarTms {
  asentar?: typeof asentarLecturas;
  despachoRef?: typeof asentarDespachoRef;
}

/**
 * Asienta una lectura de `leerPosiciones`: primero por la ruta única (`asentarLecturas`, ligando por número
 * económico), luego la referencia de despacho de lo que quedó guardado.
 */
export async function asentarPosicionesTms(
  tenantId: string,
  lectura: Pick<LecturaPosiciones, 'filas' | 'descartadasPorCoordenada'>,
  opciones: Parameters<typeof asentarLecturas>[3] = {},
  deps: DepsAsentarTms = {},
): Promise<ResultadoSync & { despachoRef: ResultadoDespachoRef }> {
  const asentar = deps.asentar ?? asentarLecturas;
  const sellar = deps.despachoRef ?? asentarDespachoRef;
  const lecturas: Lectura[] = lectura.filas.map(({ despacho_ref: _ref, ...l }) => l);
  const r = await asentar(tenantId, PROVEEDOR_TMS_POSICIONES, lecturas, {
    // Las coordenadas inválidas ya se descartaron y contaron al leer; aquí se suman al conteo, no se repiten.
    invalidasDelLector: lectura.descartadasPorCoordenada,
    descartadasNoSonError: true,
    ligarPorEconomico: true,
    ...opciones,
  });
  // Si el asentador cortó antes de guardar nada, no hay filas a las que estampar.
  const despachoRef = r.guardadas > 0 || r.error === undefined
    ? await sellar(tenantId, lectura.filas)
    : { actualizadas: 0, sinUnidad: 0 };
  return { ...r, despachoRef };
}
