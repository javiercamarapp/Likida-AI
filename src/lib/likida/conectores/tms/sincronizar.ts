// ═══════════════════════════════════════════════════════════════════════════
// EL SINCRONIZADOR DEL CONECTOR TMS (T-TMS-12): el ejecutor de `leer_viajes`.
//
// Une las piezas de solo lectura (sesión, paginación, huellas y los cuatro lectores) con las
// puertas EXISTENTES de cada agente y deja el avance guardado:
//
//   viajes         → `importarViajes`                    (base)
//   liquidaciones  → `recibirLiquidacionExterna`         (A1: guarda la liquidación; NO la entrega)
//   peajes         → `recibirArchivoPeaje`               (A2: un CSV a la cola de ingesta, origen `api`)
//   posiciones     → `asentarPosicionesTms`              (A5: `asentarLecturas` + `despacho_ref`)
//
// SOLO LEE del sistema del cliente: ninguna petición de escritura (la carga de CCP es T-TMS-11 y tiene su
// propia bandera). NO activa nada: una flota entra aquí solo si Javier capturó la credencial, la PROBÓ
// (`probada_en`) y dejó un mapeo activo; sin eso el cron no llama a nadie.
//
// REGLAS (cada una tiene su prueba):
//  · Opt-in por flota: credencial `tms_api_lectura` activa + probada + sin error + mapeo activo por recurso.
//  · Un recurso que falla NO detiene a los demás; una credencial rechazada SÍ detiene a la flota entera.
//  · Falla de credencial → UNA alarma (`degradar`: marca la credencial con el error vía `marcarProbada` y avisa
//    al operador) y la flota deja de listarse hasta que alguien vuelva a probarla con éxito: no se alarma
//    cada 10 minutos ni se martilla un login que ya se sabe malo.
//  · El avance (`tms_sincronizacion.desde`) solo se mueve cuando la lectura llegó al FINAL real del origen y
//    la entrega no falló: lo que quedó a medias (presupuesto, tope de páginas, cursor en círculo, error) se
//    reanuda o se repite, nunca se salta (hallazgo H2 de la revisión C3-12: aquí se usan `leerX`, que dicen
//    `completa/backlog/reanudar`, y NO los adaptadores `LectorTms`, que los pierden).
//  · Idempotencia por `tms_ingesta` (clave externa + huella): lo ya entregado y sin cambios se omite. Las
//    huellas se guardan DESPUÉS de entregar y solo de lo entregado: lo que no se pudo entregar se reintenta.
//    Las posiciones no pasan por `tms_ingesta` (serían cientos de miles de filas): su idempotencia es el
//    cursor + el índice único `posicion_sin_duplicado`.
//  · Presupuesto de la corrida (`venceEn`): no se abre otra flota ni otro recurso pasado el reloj; lo que
//    quede se hace en la corrida siguiente (el estado no se toca).
//  · Liquidaciones NO se reanudan a media nómina: reanudar entregaría totales parciales de una póliza partida
//    entre páginas. Si la nómina no cabe en el presupuesto, no avanza y se reintenta desde el inicio.
//
// SUPUESTO (BLOQUEO EXTERNO: la documentación del login del cliente no existe): el login es
// `POST <base_url><ruta_login>` con `{usuario, clave}` y el token viene en `token` (el mismo supuesto de
// `ficha.ts`). Cuando llegue la documentación se corrige en `loginDe`.
// ═══════════════════════════════════════════════════════════════════════════
import { alertarOperador } from '@/lib/observability/alerta';
import { logger } from '@/lib/logger';
import { httpsPublico } from '@/lib/http/https_publico';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../../presupuesto';
import { importarViajes, type ResultadoImportacion } from '../../importar_viajes';
import {
  validarLiquidacionExterna,
} from '../../liquidacion_externa/esquema';
import { buscarPorClave } from '../../liquidacion_externa/repo';
import { dependenciasPorOmision, recibirLiquidacionExterna } from '../../liquidacion_externa/servicio';
import { MENSAJE_CANAL_CORREO_SIN_WHATSAPP } from '../../liquidacion_externa/canal_correo';
import { recibirArchivoPeaje } from '../../peajes/ingesta';
import { toCsv } from '../../export';
import { leerCredencial, marcarProbada } from '../credenciales';
import type { Capacidad, Http, ValoresCredencial } from '../tipos';
import { RUTA_LOGIN_POR_DEFECTO } from './ficha';
import { estadoDeFila, huella, type EstadoFila } from './huella';
import { validarMapeo, type MapeoTms } from './mapeo';
import type { PuntoReanudo } from './paginar';
import {
  asentarPosicionesTms, leerPosiciones, type LecturaPosiciones,
} from './posiciones';
import { leerPeajes, type FilaPeajeTms, type ReanudarPeajes } from './peajes';
import { leerLiquidaciones, type LiquidacionTms, type MapeoLiquidacionesTms } from './liquidaciones';
import { SesionTms } from './sesion';
import { leerViajes, type FilaViajeTms } from './viajes';

/** La capacidad que este módulo ejecuta (la saca de `CAPACIDADES_SIN_EJECUTOR`). */
export const CAPACIDAD_QUE_EJECUTA: Capacidad = 'leer_viajes';
export const CONECTOR_TMS = 'tms_api_lectura';

export const RECURSOS_SINCRONIZABLES = ['liquidaciones', 'peajes', 'viajes', 'posiciones'] as const;
export type RecursoSincronizable = (typeof RECURSOS_SINCRONIZABLES)[number];

/** Primera corrida de una flota: cuántos días hacia atrás se lee. */
export const VENTANA_INICIAL_DIAS = 2;
/** Cuánto se retrocede el `desde` al avanzar, por si el origen publica tarde. Es seguro: la idempotencia absorbe el traslape. */
export const SOLAPE_MS = 60 * 60 * 1000;
const DIA_MS = 86_400_000;
const LOTE_BASE = 200;

// ── Dependencias (todo lo que toca la base o a otros módulos) ───────────────

/** Una flota que cumple el opt-in. */
export interface FlotaTms {
  tenantId: string;
  valores: ValoresCredencial;
  /** Mapeo activo por recurso (JSON tal como está en `tms_mapeo`). Sin mapeo, el recurso no se sincroniza. */
  mapeos: Partial<Record<RecursoSincronizable, unknown>>;
}

export interface EstadoSync {
  desde: string | null;
  /** Solo hay cursor cuando una lectura quedó a medias: `hasta` de esa ventana y dónde seguir. */
  cursor: { hasta: string; reanudar?: unknown } | null;
  ultimaOkEn: string | null;
  ultimoError: string | null;
  filasLeidas: number;
}

export interface ResultadoEntrega {
  /** Claves externas realmente entregadas (o ya existentes): son las únicas cuya huella se guarda. */
  hechas: string[];
  /** Filas que la puerta no pudo recibir por una razón de datos (sin operador, sin unidad…): se dicen, no se pierden en silencio. */
  pendientes: number;
  /** Correcciones que la puerta no sobrescribe (A1 no pisa una liquidación ya recibida). */
  conflictos?: number;
  detalle?: string;
}

export interface Entregas {
  viajes(tenantId: string, filas: FilaViajeTms[]): Promise<ResultadoEntrega>;
  liquidaciones(tenantId: string, items: LiquidacionTms[]): Promise<ResultadoEntrega>;
  peajes(tenantId: string, filas: FilaPeajeTms[], ventana: { desde: string; hasta: string }): Promise<ResultadoEntrega>;
  posiciones(tenantId: string, lectura: Pick<LecturaPosiciones, 'filas' | 'descartadasPorCoordenada'>): Promise<{ guardadas: number; error?: string }>;
}

export interface DepsSincronizacion {
  ahora: () => number;
  listarFlotas(): Promise<FlotaTms[]>;
  leerEstado(tenantId: string, recurso: RecursoSincronizable): Promise<EstadoSync | null>;
  guardarEstado(tenantId: string, recurso: RecursoSincronizable, e: EstadoSync): Promise<void>;
  huellasPrevias(tenantId: string, recurso: RecursoSincronizable, claves: string[]): Promise<Map<string, string>>;
  guardarHuellas(tenantId: string, recurso: RecursoSincronizable, filas: Array<{ clave: string; huella: string }>): Promise<void>;
  entregas: Entregas;
  /** La alarma de credencial: se llama UNA vez por falla (la flota deja de listarse después). */
  degradar(tenantId: string, detalle: string): Promise<void>;
  /** Transporte; por omisión `httpsPublico`. Las pruebas inyectan el servidor falso. */
  http?: Http;
  /** Espera entre reintentos de 429/5xx; por omisión real. Las pruebas la vuelven instantánea. */
  dormir?: (ms: number) => Promise<void>;
}

// ── Resultados ──────────────────────────────────────────────────────────────

export type EstadoRecurso = 'ok' | 'parcial' | 'error' | 'sin_mapeo' | 'sin_turno';

export interface ResumenRecurso {
  recurso: RecursoSincronizable;
  estado: EstadoRecurso;
  leidas: number;
  nuevas: number;
  omitidas: number;
  entregadas: number;
  rechazadas: number;
  /** Filas que la puerta no pudo recibir por datos (sin operador…). */
  pendientes: number;
  conflictos: number;
  backlog: boolean;
  aviso?: string;
  error?: string;
}

export interface ResumenFlota {
  tenantId: string;
  recursos: ResumenRecurso[];
  /** Peticiones HTTP al sistema del cliente (login incluido). */
  peticiones: number;
  /** 401 recibidos en peticiones de datos: sesiones que hubo que renovar. */
  renovados401: number;
  /** La credencial fue rechazada: se alarmó y la flota quedó detenida. */
  credencialRechazada: boolean;
  sinTurno: boolean;
}

export interface ResumenSincronizacion {
  flotas: ResumenFlota[];
  filasPorRecurso: Record<RecursoSincronizable, number>;
  peticiones: number;
  renovados401: number;
  conError: number;
  parciales: number;
  sinTurno: number;
  alarmas: number;
}

export interface OpcionesSincronizar {
  /** Instante absoluto tras el que no se abre otra flota/recurso/petición. */
  venceEn?: number;
}

// ── Utilidades ──────────────────────────────────────────────────────────────

const iso = (ms: number): string => new Date(ms).toISOString();

/** Frase fija (nuestra) para un error: jamás se copia nada que pudiera traer un token. */
const FRASE_CORTA = 300;
const limpiarFrase = (t: string): string => t.replace(/\s+/g, ' ').trim().slice(0, FRASE_CORTA);

const vacioResumen = (recurso: RecursoSincronizable, estado: EstadoRecurso): ResumenRecurso => ({
  recurso, estado, leidas: 0, nuevas: 0, omitidas: 0, entregadas: 0, rechazadas: 0, pendientes: 0, conflictos: 0, backlog: false,
});

export function urlBaseHttps(v: string | undefined): string | null {
  try {
    const u = new URL((v ?? '').trim());
    return u.protocol === 'https:' ? u.origin + u.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/** SUPUESTO: la forma del login. Se corrige aquí cuando llegue la documentación del cliente. */
export function loginDe(v: ValoresCredencial): { ruta: string; cuerpo: Record<string, string>; campo_token: string } {
  return {
    ruta: (v.ruta_login ?? '').trim() || RUTA_LOGIN_POR_DEFECTO,
    cuerpo: { usuario: '{usuario}', clave: '{clave}' },
    campo_token: 'token',
  };
}

interface ContextoFlota {
  peticiones: number;
  renovados401: number;
  /** El login contestó 401/403: la credencial es mala. */
  loginRechazado: boolean;
}

/** Frases de `SesionTms` cuando la credencial es lo que falló (ya limpias de secretos). */
const FRASE_CREDENCIAL = /rechaz[oó] (el usuario|la sesi[oó]n)/i;

function envolverHttp(base: Http, ctx: ContextoFlota, rutaLogin: string): Http {
  return async (p) => {
    ctx.peticiones += 1;
    const r = await base(p);
    let esLogin = false;
    try { esLogin = new URL(p.url).pathname.endsWith(rutaLogin.startsWith('/') ? rutaLogin : `/${rutaLogin}`); } catch { /* url ilegible: no es login */ }
    if (esLogin) {
      if (r.estado === 401 || r.estado === 403) ctx.loginRechazado = true;
    } else if (r.estado === 401) {
      ctx.renovados401 += 1;
    }
    return r;
  };
}

function ventanaDe(estado: EstadoSync | null, ahora: number): { desde: string; hasta: string; reanudar: unknown } {
  const hasta = estado?.cursor?.hasta ?? iso(ahora);
  const desde = estado?.desde ?? iso(ahora - VENTANA_INICIAL_DIAS * DIA_MS);
  return { desde, hasta, reanudar: estado?.cursor?.reanudar };
}

/** El `desde` de la siguiente corrida tras una lectura completa: se retrocede `SOLAPE_MS` sin pasar atrás del anterior. */
function desdeSiguiente(desde: string, hasta: string): string {
  return iso(Math.max(Date.parse(desde), Date.parse(hasta) - SOLAPE_MS));
}

function validarMapeoOError(m: unknown): string | null {
  const problemas = validarMapeo(m);
  return problemas.length === 0 ? null : limpiarFrase(problemas.join('; '));
}

function mapeoLiquidacionesValido(m: unknown): { ok: true; mapeo: MapeoLiquidacionesTms } | { ok: false; motivo: string } {
  if (typeof m !== 'object' || m === null) return { ok: false, motivo: 'el mapeo de liquidaciones no es un objeto' };
  const o = m as Record<string, unknown>;
  for (const t of ['nomina', 'operadores', 'conceptos'] as const) {
    const e = validarMapeoOError(o[t]);
    if (e) return { ok: false, motivo: `el mapeo de ${t} no es válido: ${e}` };
  }
  return { ok: true, mapeo: m as MapeoLiquidacionesTms };
}

async function clasificar(
  deps: DepsSincronizacion, tenantId: string, recurso: RecursoSincronizable, items: ReadonlyArray<{ clave: string; huella: string }>,
): Promise<Map<string, EstadoFila>> {
  const previas = new Map<string, string>();
  const claves = [...new Set(items.map((i) => i.clave))];
  for (let i = 0; i < claves.length; i += LOTE_BASE) {
    const trozo = await deps.huellasPrevias(tenantId, recurso, claves.slice(i, i + LOTE_BASE));
    for (const [k, v] of trozo) previas.set(k, v);
  }
  const salida = new Map<string, EstadoFila>();
  for (const it of items) {
    // Una clave repetida dentro de la misma tanda: la primera gana.
    salida.set(it.clave, salida.has(it.clave) ? 'omitida' : estadoDeFila(previas, it.clave, it.huella));
  }
  return salida;
}

// ── Una flota ───────────────────────────────────────────────────────────────

interface CierreLectura {
  completa: boolean;
  backlog: boolean;
  reanudar?: unknown;
  /** `desde` ya calculado por el lector (posiciones) o `undefined` para usar `desdeSiguiente`. */
  desdeFijo?: string;
  /** Aviso del origen (cursor en círculo, tope…). */
  avisos: string[];
}

async function sincronizarRecurso(
  deps: DepsSincronizacion, flota: FlotaTms, sesion: SesionTms, ctx: ContextoFlota,
  recurso: RecursoSincronizable, venceEn: number | undefined,
): Promise<ResumenRecurso> {
  const r = vacioResumen(recurso, 'ok');
  const mapeoCrudo = flota.mapeos[recurso];
  if (mapeoCrudo === undefined || mapeoCrudo === null) return vacioResumen(recurso, 'sin_mapeo');

  const ahora = deps.ahora();
  const previo = await deps.leerEstado(flota.tenantId, recurso);
  const { desde, hasta, reanudar } = ventanaDe(previo, ahora);
  const opcionesLector = { venceEn, ahora: deps.ahora };

  const fallar = async (motivo: string, reanudarGuardado?: unknown): Promise<ResumenRecurso> => {
    const e = limpiarFrase(motivo);
    await deps.guardarEstado(flota.tenantId, recurso, {
      desde: previo?.desde ?? desde,
      cursor: reanudarGuardado !== undefined ? { hasta, reanudar: reanudarGuardado } : previo?.cursor ?? null,
      ultimaOkEn: previo?.ultimaOkEn ?? null,
      ultimoError: e,
      filasLeidas: previo?.filasLeidas ?? 0,
    });
    return { ...r, estado: 'error', error: e };
  };

  /** Falla de un lector: si el reloj de la corrida ya venció NO es un error del origen, es presupuesto agotado. */
  const falloLector = async (motivo: string, reanudarGuardado?: unknown): Promise<ResumenRecurso> => {
    if (venceEn !== undefined && deps.ahora() >= venceEn) {
      await deps.guardarEstado(flota.tenantId, recurso, {
        desde: previo?.desde ?? desde,
        cursor: reanudarGuardado !== undefined ? { hasta, reanudar: reanudarGuardado } : previo?.cursor ?? null,
        ultimaOkEn: previo?.ultimaOkEn ?? null,
        ultimoError: null,
        filasLeidas: previo?.filasLeidas ?? 0,
      });
      return { ...r, estado: 'parcial', backlog: true, aviso: 'Se agotó el presupuesto de la corrida; se continúa en la siguiente.' };
    }
    return fallar(motivo, reanudarGuardado);
  };

  const cerrar = async (c: CierreLectura): Promise<ResumenRecurso> => {
    r.backlog = c.backlog;
    r.aviso = c.avisos.length > 0 ? limpiarFrase(c.avisos.join(' ')) : undefined;
    if (c.completa && !c.backlog) {
      await deps.guardarEstado(flota.tenantId, recurso, {
        desde: c.desdeFijo ?? desdeSiguiente(desde, hasta),
        cursor: null,
        ultimaOkEn: iso(deps.ahora()),
        ultimoError: null,
        filasLeidas: r.leidas,
      });
      return { ...r, estado: r.pendientes > 0 || r.conflictos > 0 || r.rechazadas > 0 ? 'parcial' : 'ok' };
    }
    if (c.backlog) {
      // Quedó trabajo: se guarda dónde seguir (si el recurso se puede reanudar) y NO se mueve el `desde`.
      await deps.guardarEstado(flota.tenantId, recurso, {
        desde: previo?.desde ?? desde,
        cursor: c.reanudar !== undefined ? { hasta, reanudar: c.reanudar } : previo?.cursor ?? null,
        ultimaOkEn: previo?.ultimaOkEn ?? null,
        ultimoError: null,
        filasLeidas: previo?.filasLeidas ?? 0,
      });
      return { ...r, estado: 'parcial' };
    }
    // Ni completa ni con trabajo pendiente: el origen se cerró en círculo. No se declara hecha.
    return fallar(c.avisos.join(' ') || 'la lectura no llegó al final del origen');
  };

  try {
    if (recurso === 'viajes') {
      const mapeo = mapeoCrudo as MapeoTms;
      const malo = validarMapeoOError(mapeo);
      if (malo) return await fallar(`el mapeo de viajes no es válido: ${malo}`);
      const l = await leerViajes(sesion, { desde, hasta, reanudar: reanudar as PuntoReanudo | undefined }, { ...opcionesLector, mapeo });
      const base = l.ok ? l : l.parcial;
      r.leidas = base.filas.length; r.rechazadas = base.rechazadas.length;
      const items = base.filas.map((f) => ({ clave: f.folio, huella: huella('viajes', f.folio, estables(f)) }));
      const estados = await clasificar(deps, flota.tenantId, 'viajes', items);
      const porEntregar = base.filas.filter((f) => estados.get(f.folio) !== 'omitida');
      r.omitidas = base.filas.length - porEntregar.length; r.nuevas = porEntregar.length;
      if (porEntregar.length > 0) {
        const e = await deps.entregas.viajes(flota.tenantId, porEntregar);
        aplicarEntrega(r, e);
        await deps.guardarHuellas(flota.tenantId, 'viajes', items.filter((i) => e.hechas.includes(i.clave)));
      }
      if (!l.ok) return await falloLector(l.motivo, base.reanudar);
      return await cerrar({ completa: base.completa, backlog: base.backlog, reanudar: base.reanudar, avisos: base.avisos });
    }

    if (recurso === 'peajes') {
      const mapeo = mapeoCrudo as MapeoTms;
      const malo = validarMapeoOError(mapeo);
      if (malo) return await fallar(`el mapeo de peajes no es válido: ${malo}`);
      const l = await leerPeajes(sesion, { desde, hasta, reanudar: reanudar as ReanudarPeajes | undefined }, { ...opcionesLector, mapeo });
      const base = l.ok ? l : l.parcial;
      r.leidas = base.filas.length; r.rechazadas = base.rechazadas.length;
      const estados = await clasificar(deps, flota.tenantId, 'peajes', base.filas.map((f) => ({ clave: f.clave, huella: f.huella })));
      const porEntregar = base.filas.filter((f) => estados.get(f.clave) !== 'omitida');
      r.omitidas = base.filas.length - porEntregar.length; r.nuevas = porEntregar.length;
      if (porEntregar.length > 0) {
        const e = await deps.entregas.peajes(flota.tenantId, porEntregar, { desde, hasta });
        aplicarEntrega(r, e);
        await deps.guardarHuellas(flota.tenantId, 'peajes', base.filas.filter((f) => e.hechas.includes(f.clave)).map((f) => ({ clave: f.clave, huella: f.huella })));
      }
      if (!l.ok) return await falloLector(l.motivo, base.reanudar);
      return await cerrar({ completa: base.completa, backlog: base.backlog, reanudar: base.reanudar, avisos: base.avisos });
    }

    if (recurso === 'liquidaciones') {
      const v = mapeoLiquidacionesValido(mapeoCrudo);
      if (!v.ok) return await fallar(v.motivo);
      // Sin `reanudar`: ver el encabezado (totales parciales de una póliza partida entre páginas).
      const l = await leerLiquidaciones(sesion, v.mapeo, { desde, hasta }, opcionesLector);
      const base = l.ok ? l : l.parcial;
      r.leidas = base.cuerpos.length; r.rechazadas = base.rechazadas.length;
      const estados = await clasificar(deps, flota.tenantId, 'liquidaciones', base.cuerpos.map((c) => ({ clave: c.clave, huella: c.huella })));
      const porEntregar = base.cuerpos.filter((c) => estados.get(c.clave) !== 'omitida');
      r.omitidas = base.cuerpos.length - porEntregar.length; r.nuevas = porEntregar.length;
      if (porEntregar.length > 0) {
        const e = await deps.entregas.liquidaciones(flota.tenantId, porEntregar);
        aplicarEntrega(r, e);
        await deps.guardarHuellas(flota.tenantId, 'liquidaciones', base.cuerpos.filter((c) => e.hechas.includes(c.clave)).map((c) => ({ clave: c.clave, huella: c.huella })));
      }
      if (!l.ok) return await falloLector(l.motivo);
      // Una nómina a medias no se reanuda: se repite entera en la siguiente corrida.
      const avisos = [...base.avisos];
      if (base.backlog) avisos.push('la nómina no cupo en el presupuesto de la corrida; se repite completa en la siguiente');
      return await cerrar({ completa: base.completa, backlog: false, avisos: base.completa ? base.avisos : avisos });
    }

    // posiciones
    const mapeo = mapeoCrudo as MapeoTms;
    const malo = validarMapeoOError(mapeo);
    if (malo) return await fallar(`el mapeo de posiciones no es válido: ${malo}`);
    const l = await leerPosiciones(sesion, { desde, hasta, reanudar: reanudar as PuntoReanudo | undefined }, { ...opcionesLector, mapeo });
    const base = l.ok ? l : l.parcial;
    r.leidas = base.filas.length; r.rechazadas = base.rechazadas.length + base.descartadasPorCoordenada;
    if (base.filas.length > 0) {
      const e = await deps.entregas.posiciones(flota.tenantId, base);
      r.entregadas = e.guardadas; r.nuevas = e.guardadas; r.omitidas = Math.max(0, base.filas.length - e.guardadas);
      if (e.error) return await fallar(e.error, base.backlog ? base.reanudar : undefined);
    }
    if (!l.ok) return await falloLector(l.motivo, base.reanudar);
    return await cerrar({
      completa: base.completa, backlog: base.backlog, reanudar: base.reanudar, avisos: base.avisos,
      // El cursor de posiciones ya es «desde dónde seguir» (inclusive): no se le resta el solape.
      desdeFijo: base.cursor,
    });
  } catch (e) {
    // Un fallo de infraestructura (base, red, puerta) en ESTE recurso: se dice y no toca a los demás.
    return fallar(e instanceof Error ? e.message : String(e));
  }
}

function aplicarEntrega(r: ResumenRecurso, e: ResultadoEntrega): void {
  r.entregadas = e.hechas.length;
  r.pendientes = e.pendientes;
  r.conflictos = e.conflictos ?? 0;
  if (e.detalle) r.aviso = r.aviso ? `${r.aviso} ${e.detalle}` : e.detalle;
}

/** Campos estables de un viaje para su huella (nunca la marca de lectura). */
function estables(f: FilaViajeTms): Record<string, unknown> {
  return {
    folio: f.folio, origen: f.origen, destino: f.destino, fechaInicio: f.fechaInicio, unidadEco: f.unidadEco,
    despacho_ref: f.despacho_ref, salida_en: f.salida_en, llegada_en: f.llegada_en,
  };
}

async function sincronizarFlota(
  deps: DepsSincronizacion, flota: FlotaTms, venceEn: number | undefined,
): Promise<ResumenFlota> {
  const ctx: ContextoFlota = { peticiones: 0, renovados401: 0, loginRechazado: false };
  const resumen: ResumenFlota = {
    tenantId: flota.tenantId, recursos: [], peticiones: 0, renovados401: 0, credencialRechazada: false, sinTurno: false,
  };
  const base = urlBaseHttps(flota.valores.base_url);
  if (base === null) {
    // Dirección inválida: no es la credencial, es la captura. Se dice por recurso y no se llama a nadie.
    for (const rec of RECURSOS_SINCRONIZABLES) {
      if (flota.mapeos[rec] === undefined) { resumen.recursos.push(vacioResumen(rec, 'sin_mapeo')); continue; }
      resumen.recursos.push({ ...vacioResumen(rec, 'error'), error: 'la dirección de la API no es una URL https válida' });
    }
    return resumen;
  }
  const login = loginDe(flota.valores);
  const transporte = deps.http ?? ((p) => httpsPublico(p, 15_000));
  const sesion = new SesionTms({
    http: envolverHttp(transporte, ctx, login.ruta),
    base,
    login,
    credenciales: { usuario: (flota.valores.usuario ?? '').trim(), clave: flota.valores.clave ?? '' },
    reloj: { venceEn, ahora: deps.ahora, dormir: deps.dormir },
  });

  for (const recurso of RECURSOS_SINCRONIZABLES) {
    if (flota.mapeos[recurso] === undefined || flota.mapeos[recurso] === null) {
      resumen.recursos.push(vacioResumen(recurso, 'sin_mapeo'));
      continue;
    }
    if (venceEn !== undefined && deps.ahora() >= venceEn) {
      resumen.recursos.push(vacioResumen(recurso, 'sin_turno'));
      resumen.sinTurno = true;
      continue;
    }
    const antes = ctx.loginRechazado;
    const rr = await sincronizarRecurso(deps, flota, sesion, ctx, recurso, venceEn);
    resumen.recursos.push(rr);
    const credencialMala = (!antes && ctx.loginRechazado) || (rr.estado === 'error' && FRASE_CREDENCIAL.test(rr.error ?? ''));
    if (credencialMala) {
      resumen.credencialRechazada = true;
      const detalle = 'El sistema de transporte rechazó el usuario o la contraseña de la cuenta de servicio. La sincronización se detuvo; vuelve a capturar la credencial y a probarla.';
      try { await deps.degradar(flota.tenantId, detalle); } catch (e) {
        logger.error('tms.sincronizar.degradar_fallo', { tenant: flota.tenantId, error: e instanceof Error ? e.message : String(e) });
      }
      // Los recursos que faltan no se intentan: no se martilla un login que ya se sabe malo.
      for (const resto of RECURSOS_SINCRONIZABLES.slice(RECURSOS_SINCRONIZABLES.indexOf(recurso) + 1)) {
        resumen.recursos.push(vacioResumen(resto, flota.mapeos[resto] === undefined ? 'sin_mapeo' : 'sin_turno'));
      }
      break;
    }
  }
  resumen.peticiones = ctx.peticiones;
  resumen.renovados401 = ctx.renovados401;
  return resumen;
}

/** Corre UNA pasada para todas las flotas que cumplen el opt-in. Nunca lanza por una flota o un recurso. */
export async function sincronizarTms(deps: DepsSincronizacion, opciones: OpcionesSincronizar = {}): Promise<ResumenSincronizacion> {
  const flotas = await deps.listarFlotas();
  const total: ResumenSincronizacion = {
    flotas: [], filasPorRecurso: { liquidaciones: 0, peajes: 0, viajes: 0, posiciones: 0 },
    peticiones: 0, renovados401: 0, conError: 0, parciales: 0, sinTurno: 0, alarmas: 0,
  };
  for (const flota of flotas) {
    if (opciones.venceEn !== undefined && deps.ahora() >= opciones.venceEn) {
      total.sinTurno += 1;
      total.flotas.push({ tenantId: flota.tenantId, recursos: [], peticiones: 0, renovados401: 0, credencialRechazada: false, sinTurno: true });
      continue;
    }
    let f: ResumenFlota;
    try {
      f = await sincronizarFlota(deps, flota, opciones.venceEn);
    } catch (e) {
      logger.error('tms.sincronizar.flota_fallo', { tenant: flota.tenantId, error: e instanceof Error ? e.message : String(e) });
      f = { tenantId: flota.tenantId, recursos: [], peticiones: 0, renovados401: 0, credencialRechazada: false, sinTurno: false };
      total.conError += 1;
    }
    total.flotas.push(f);
    total.peticiones += f.peticiones; total.renovados401 += f.renovados401;
    if (f.credencialRechazada) total.alarmas += 1;
    if (f.sinTurno) total.sinTurno += 1;
    for (const rr of f.recursos) {
      total.filasPorRecurso[rr.recurso] += rr.leidas;
      if (rr.estado === 'error') total.conError += 1;
      if (rr.estado === 'parcial') total.parciales += 1;
    }
  }
  return total;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAS DEPENDENCIAS REALES (base de datos y puertas de los agentes).
// ═══════════════════════════════════════════════════════════════════════════

const TOPE_UPSERT = 500;

interface FilaMapeoBd { tenant_id: string; recurso: string; mapeo: unknown }

async function listarFlotasReales(): Promise<FlotaTms[]> {
  const admin = supabaseAdmin();
  // Solo credenciales activas, PROBADAS alguna vez y sin error vigente: una credencial que falló la
  // alarma queda fuera hasta que alguien la pruebe con éxito (eso limpia `ultimo_error`).
  const cred = await acotada(admin.from('conector_credencial').select('tenant_id')
    .eq('conector_id', CONECTOR_TMS).eq('activo', true).not('probada_en', 'is', null).is('ultimo_error', null), 'tms.sincronizar.credenciales');
  if (cred.error) throw new Error(`tms.sincronizar.credenciales: ${cred.error.message}`);
  const tenants = [...new Set((cred.data ?? []).map((f) => String((f as { tenant_id: unknown }).tenant_id)))];
  if (tenants.length === 0) return [];

  const map = await acotada(admin.from('tms_mapeo').select('tenant_id, recurso, mapeo').in('tenant_id', tenants).eq('activo', true), 'tms.sincronizar.mapeos');
  if (map.error) throw new Error(`tms.sincronizar.mapeos: ${map.error.message}`);
  const porTenant = new Map<string, Partial<Record<RecursoSincronizable, unknown>>>();
  for (const f of (map.data ?? []) as FilaMapeoBd[]) {
    if (!(RECURSOS_SINCRONIZABLES as readonly string[]).includes(f.recurso)) continue;
    const m = porTenant.get(f.tenant_id) ?? {};
    m[f.recurso as RecursoSincronizable] = f.mapeo;
    porTenant.set(f.tenant_id, m);
  }

  const flotas: FlotaTms[] = [];
  for (const tenantId of tenants) {
    const mapeos = porTenant.get(tenantId);
    if (!mapeos || Object.keys(mapeos).length === 0) continue; // sin mapeo activo no hay nada que leer
    const valores = await leerCredencial(tenantId, CONECTOR_TMS);
    if (valores === null) continue;
    flotas.push({ tenantId, valores, mapeos });
  }
  return flotas;
}

async function leerEstadoReal(tenantId: string, recurso: RecursoSincronizable): Promise<EstadoSync | null> {
  const { data, error } = await acotada(supabaseAdmin().from('tms_sincronizacion')
    .select('cursor, desde, ultima_ok_en, ultimo_error, filas_leidas').eq('tenant_id', tenantId).eq('recurso', recurso).maybeSingle(), 'tms.sincronizar.estado');
  if (error) throw new Error(`tms.sincronizar.estado: ${error.message}`);
  if (!data) return null;
  const f = data as { cursor: unknown; desde: string | null; ultima_ok_en: string | null; ultimo_error: string | null; filas_leidas: number | null };
  const c = f.cursor;
  const cursor = typeof c === 'object' && c !== null && typeof (c as { hasta?: unknown }).hasta === 'string'
    ? { hasta: (c as { hasta: string }).hasta, reanudar: (c as { reanudar?: unknown }).reanudar }
    : null;
  return { desde: f.desde, cursor, ultimaOkEn: f.ultima_ok_en, ultimoError: f.ultimo_error, filasLeidas: f.filas_leidas ?? 0 };
}

async function guardarEstadoReal(tenantId: string, recurso: RecursoSincronizable, e: EstadoSync): Promise<void> {
  const { error } = await acotada(supabaseAdmin().from('tms_sincronizacion').upsert({
    tenant_id: tenantId, recurso, cursor: e.cursor, desde: e.desde, ultima_ok_en: e.ultimaOkEn,
    ultimo_error: e.ultimoError, filas_leidas: e.filasLeidas, actualizado_en: new Date().toISOString(),
  }, { onConflict: 'tenant_id,recurso' }), 'tms.sincronizar.guardar_estado');
  if (error) throw new Error(`tms.sincronizar.guardar_estado: ${error.message}`);
}

async function huellasPreviasReales(tenantId: string, recurso: RecursoSincronizable, claves: string[]): Promise<Map<string, string>> {
  const { data, error } = await acotada(supabaseAdmin().from('tms_ingesta').select('clave_externa, huella')
    .eq('tenant_id', tenantId).eq('recurso', recurso).in('clave_externa', claves), 'tms.sincronizar.huellas');
  if (error) throw new Error(`tms.sincronizar.huellas: ${error.message}`);
  return new Map((data ?? []).map((f) => [String((f as { clave_externa: unknown }).clave_externa), String((f as { huella: unknown }).huella)]));
}

async function guardarHuellasReales(tenantId: string, recurso: RecursoSincronizable, filas: Array<{ clave: string; huella: string }>): Promise<void> {
  const visto = new Date().toISOString();
  for (let i = 0; i < filas.length; i += TOPE_UPSERT) {
    const lote = filas.slice(i, i + TOPE_UPSERT).map((f) => ({ tenant_id: tenantId, recurso, clave_externa: f.clave, huella: f.huella, visto_en: visto }));
    const { error } = await acotada(supabaseAdmin().from('tms_ingesta').upsert(lote, { onConflict: 'tenant_id,recurso,clave_externa' }), 'tms.sincronizar.guardar_huellas');
    if (error) throw new Error(`tms.sincronizar.guardar_huellas: ${error.message}`);
  }
}

const DUPLICADO = /duplicate key|unique/i;

/** Las puertas reales de cada agente. */
export const entregasReales: Entregas = {
  async viajes(tenantId, filas) {
    const r: ResultadoImportacion = await importarViajes(tenantId, filas);
    if (r.error) throw new Error(`importarViajes: ${r.error}`);
    // Lo que la puerta no pudo amarrar (operador, unidad, cliente) NO se marca como entregado: se dice y se reintenta
    // cuando el catálogo lo permita. Los folios ya existentes (`saltados`) sí cuentan como hechos.
    const noHechos = new Set<string>([...r.sinOperador, ...r.sinUnidad, ...r.sinCliente, ...r.operadorOcupado, ...(r.unidadOcupada ?? [])]);
    return {
      hechas: filas.map((f) => f.folio).filter((f) => !noHechos.has(f)),
      pendientes: noHechos.size,
      detalle: noHechos.size > 0 ? `${noHechos.size} viaje(s) sin entrar: falta operador, unidad o cliente en el catálogo, o el operador o la unidad ya tiene un viaje abierto.` : undefined,
    };
  },

  async liquidaciones(tenantId, items) {
    const hechas: string[] = []; let conflictos = 0; let pendientes = 0;
    // Mismo guardia que `POST /v1/liquidaciones-externas` (A35-TRANSVERSAL-02): esta puerta guarda por la vía vieja y
    // NUNCA arma la entrega por correo (esa solo nace en `recibirDesglose`). Si la flota entrega por correo, guardar aquí
    // dejaría la liquidación `pendiente` para siempre y la clave marcada como entregada (no se reentregaría después por
    // la vía correcta). Se rechaza al CREAR con el mismo mensaje: la clave queda sin marcar, se avisa y no hay huérfana.
    // Se lee el canal una sola vez por tanda y solo si hay algo que crear; lo ya existente sigue su curso normal.
    let porCanal = 0;
    let canalCorreo: boolean | undefined;
    const esCorreo = async (): Promise<boolean> => {
      canalCorreo ??= (await dependenciasPorOmision.canalDeEntrega(tenantId)) === 'correo';
      return canalCorreo;
    };
    for (const it of items) {
      const existente = await buscarPorClave(tenantId, it.clave);
      if (existente) {
        // A1 no sobrescribe una liquidación ya recibida (el chofer pudo verla): la corrección se dice, no se aplica.
        if (existente.huella !== it.huella) conflictos += 1;
        hechas.push(it.clave);
        continue;
      }
      try {
        if (await esCorreo()) { porCanal += 1; pendientes += 1; continue; }
        await recibirLiquidacionExterna(tenantId, validarLiquidacionExterna(it.cuerpo), it.huella);
        hechas.push(it.clave);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (DUPLICADO.test(msg)) { hechas.push(it.clave); continue; } // la carrera de dos corridas: ya está
        logger.warn('tms.sincronizar.liquidacion_no_recibida', { tenant: tenantId, clave: it.clave, error: limpiarFrase(msg) });
        pendientes += 1;
      }
    }
    return {
      hechas, pendientes, conflictos,
      detalle: [
        porCanal > 0 ? `${porCanal} liquidación(es) sin guardar: ${MENSAJE_CANAL_CORREO_SIN_WHATSAPP}` : '',
        conflictos > 0 ? `${conflictos} liquidación(es) cambiaron en el origen después de recibirse; Likida no las sobrescribe.` : '',
      ].filter(Boolean).join(' ') || undefined,
    };
  },

  async peajes(tenantId, filas, ventana) {
    const csv = toCsv(filas.map((f) => ({
      Fecha: f.fecha, Hora: f.hora, Caseta: f.caseta, Importe: f.importe.toFixed(2),
      TAG: f.tag ?? '', Unidad: f.unidad, Clase: f.clase ?? '', Icident: f.despacho_ref ?? '',
    })));
    const nombre = `tms-peajes-${ventana.desde.slice(0, 10)}-${ventana.hasta.slice(0, 10)}.csv`;
    const r = await recibirArchivoPeaje(tenantId, { nombre, proveedor: 'tms', contenido: Buffer.from(csv, 'utf8') }, 'api');
    if (!r.ok) throw new Error(`recibirArchivoPeaje: ${r.motivo}`);
    return { hechas: filas.map((f) => f.clave), pendientes: 0 };
  },

  async posiciones(tenantId, lectura) {
    const r = await asentarPosicionesTms(tenantId, lectura);
    return { guardadas: r.guardadas, error: r.error };
  },
};

async function degradarReal(tenantId: string, detalle: string): Promise<void> {
  // Marca la credencial con el error (la pantalla de Conexiones lo enseña) y la saca del listado hasta la
  // próxima prueba exitosa. `marcarProbada` falla si ya no hay credencial activa: entonces solo se avisa.
  try {
    await marcarProbada(tenantId, CONECTOR_TMS, { ok: false, detalle, verificadoContra: null });
  } catch (e) {
    logger.warn('tms.sincronizar.marcar_probada_fallo', { tenant: tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  await alertarOperador('cron.tms.credencial', { tenantId, detalle });
}

export function depsReales(): DepsSincronizacion {
  return {
    ahora: Date.now,
    listarFlotas: listarFlotasReales,
    leerEstado: leerEstadoReal,
    guardarEstado: guardarEstadoReal,
    huellasPrevias: huellasPreviasReales,
    guardarHuellas: guardarHuellasReales,
    entregas: entregasReales,
    degradar: degradarReal,
  };
}
