import type { Http, PeticionHttp, ValoresCredencial } from '../tipos';
import { aNumero, jsonCualquiera, llamar, relojDe, MAX_PAGINAS_DEFENSIVO, type OpcionesLecturaPaginada, type PosicionLeida, type ResultadoPosiciones } from '../posiciones_comun';
import { porRuta } from '../posiciones_proveedores';
import {
  ErrorTablaPropia, PROVEEDOR_TABLA_PROPIA, type FallaTablaPropia, type GeocercaTablaPropia, type LectorTablaPropia,
  type OpcionesLecturaPosiciones, type PosicionTablaPropia, type ResultadoLectura,
} from './contrato';
import { leerGeocercasCsv, leerPosicionesCsv } from './csv';
import { leerConfigTablaPropia, type Autenticacion, type ConfigTablaPropia, type MapeoEndpointGeocercasT, type MapeoEndpointPosicionesT } from './config';
import { registrosAGeocercas, registrosAPosiciones, type Registro } from './filas';
import { TIMEOUT_SQL_MS, construirSelect, crearEjecutorPg, type EjecutorSql } from './sql';
import { localAUtc, utcALocal } from './tiempo';
import { llaveEconomico } from './validar';

// ═══════════════════════════════════════════════════════════════════════════
// LOS TRES LECTORES (SQL de solo lectura, CSV por HTTPS y endpoint JSON) detrás
// del MISMO contrato `LectorTablaPropia`, y el adaptador que lo conecta al
// asentador común (`leerPosicionesTablaPropia` → `LECTORES_POSICION`).
// ═══════════════════════════════════════════════════════════════════════════

export interface DepsLector { http: Http; ejecutor?: EjecutorSql; reloj?: OpcionesLecturaPaginada; ahora?: () => number }

const UNIDADES_KMH = { kmh: 1, mph: 1.609344, ms: 3.6, nudos: 1.852 } as const;
const MAX_FILAS_HTTP = 200_000;

function filtrarVentana(r: ResultadoLectura<PosicionTablaPropia>, o: OpcionesLecturaPosiciones, zona: string): ResultadoLectura<PosicionTablaPropia> {
  const unidades = o.unidades ? new Set(o.unidades.map(llaveEconomico)) : null;
  if (!unidades && !o.desdeUtc) return r;
  return {
    rechazadas: r.rechazadas,
    filas: r.filas.filter((f) => (!unidades || unidades.has(llaveEconomico(f.unidad))) && (!o.desdeUtc || localAUtc(f.fechaHoraLocal, zona) >= o.desdeUtc)),
  };
}

// ── SQL ─────────────────────────────────────────────────────────────────────
export class LectorTablaPropiaSql implements LectorTablaPropia {
  readonly modo = 'sql_solo_lectura' as const;
  constructor(private readonly cfg: Extract<ConfigTablaPropia, { modo: 'sql_solo_lectura' }>, private readonly ejecutor: EjecutorSql, private readonly ahora: () => number = Date.now) {}

  async leerPosiciones(o: OpcionesLecturaPosiciones = {}): Promise<ResultadoLectura<PosicionTablaPropia>> {
    const desde = o.desdeUtc ?? new Date(this.ahora() - this.cfg.ventanaMinutos * 60_000);
    const consulta = construirSelect(this.cfg.vista, this.cfg.columnas, {
      columnaFecha: 'fecha_hora', desdeLocal: utcALocal(desde, this.cfg.zona), columnaUnidad: 'unidad', unidades: o.unidades, limite: this.cfg.limiteFilas,
    });
    const filas = await this.ejecutor.ejecutar({ ...consulta, timeoutMs: TIMEOUT_SQL_MS, zona: this.cfg.zona });
    return registrosAPosiciones(filas, { zona: this.cfg.zona, primeraFila: 1 });
  }

  async leerGeocercas(): Promise<ResultadoLectura<GeocercaTablaPropia>> {
    if (!this.cfg.vistaGeocercas || !this.cfg.columnasGeocercas) throw new ErrorTablaPropia('no hay vista de geocercas configurada', 'formato');
    const consulta = construirSelect(this.cfg.vistaGeocercas, this.cfg.columnasGeocercas, { limite: 20_000 });
    const filas = await this.ejecutor.ejecutar({ ...consulta, timeoutMs: TIMEOUT_SQL_MS, zona: this.cfg.zona });
    return registrosAGeocercas(filas, { primeraFila: 1 });
  }
}

// ── HTTP (endpoint JSON y CSV por HTTPS) ────────────────────────────────────
/** Base64 de un texto UTF-8 (sin `Buffer.from`: la frontera de datos cuenta esa forma como acceso a Supabase). */
const base64Utf8 = (t: string): string => {
  let binario = '';
  for (const b of new TextEncoder().encode(t)) binario += String.fromCharCode(b);
  return btoa(binario);
};

function peticion(url: string, a: Autenticacion, extra: Record<string, string> = {}): PeticionHttp {
  const u = new URL(url);
  const encabezados: Record<string, string> = { accept: 'application/json, text/csv;q=0.9, */*;q=0.1' };
  if (a.patron === 'bearer') encabezados.Authorization = `Bearer ${a.token}`;
  else if (a.patron === 'cabecera') encabezados[a.nombreCampo] = a.token;
  else if (a.patron === 'query') u.searchParams.set(a.nombreCampo, a.token);
  else if (a.patron === 'basic') encabezados.Authorization = `Basic ${base64Utf8(`${a.nombreCampo}:${a.token}`)}`;
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return { url: u.toString(), metodo: 'GET', encabezados };
}

/** Una llamada GET con la política común (5xx/429 con backoff dentro del presupuesto) y la clasificación de estados. */
async function obtener(deps: DepsLector, p: PeticionHttp): Promise<string> {
  const l = await llamar(deps.http, p, 'El sistema de la flota', relojDe(deps.reloj ?? {}));
  if (!l.ok) throw new ErrorTablaPropia(l.motivo, l.falla ?? 'proveedor', l.backlog ?? false);
  const e = l.r.estado;
  if (e === 401 || e === 403) throw new ErrorTablaPropia(`El sistema de la flota rechazó la credencial (${e}).`, 'credencial');
  if (e !== 200) throw new ErrorTablaPropia(`El sistema de la flota contestó ${e}.`, e >= 400 && e < 500 ? 'formato' : 'proveedor');
  return l.r.cuerpo;
}

const FACTOR = (m: MapeoEndpointPosicionesT) => UNIDADES_KMH[m.unidad_velocidad];

function fechaDeEndpoint(valor: unknown, formato: MapeoEndpointPosicionesT['formato_fecha']): unknown {
  if (formato === 'texto') return valor;
  const n = aNumero(valor);
  if (n === null || n <= 0) return '';
  const d = new Date(formato === 'epoch_s' ? n * 1_000 : n);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
}

async function leerListaJson(
  deps: DepsLector, url: string, auth: Autenticacion, lista: string | undefined,
  paginacion: MapeoEndpointPosicionesT['paginacion'],
): Promise<unknown[]> {
  const todos: unknown[] = [];
  let cursor: string | null = null; let pagina = paginacion?.tipo === 'pagina' ? paginacion.inicio : 0;
  const cursores = new Set<string>();
  for (let n = 0; n < MAX_PAGINAS_DEFENSIVO; n++) {
    const extra: Record<string, string> = {};
    if (paginacion?.tipo === 'cursor' && cursor) extra[paginacion.param] = cursor;
    if (paginacion?.tipo === 'pagina') { extra[paginacion.param] = String(pagina); if (paginacion.tamano_param) extra[paginacion.tamano_param] = String(paginacion.tamano); }
    const cuerpo = await obtener(deps, peticion(url, auth, extra));
    const crudo = jsonCualquiera(cuerpo);
    if (crudo === undefined) throw new ErrorTablaPropia('El endpoint contestó 200 con un cuerpo que no es JSON.', 'formato');
    const l = lista ? porRuta(crudo, lista) : crudo;
    if (!Array.isArray(l)) throw new ErrorTablaPropia(`La respuesta no trae la lista en «${lista ?? 'raíz'}»: el mapeo no corresponde a lo que contesta el endpoint.`, 'formato');
    todos.push(...l);
    if (todos.length > MAX_FILAS_HTTP) throw new ErrorTablaPropia(`El endpoint entregó más de ${MAX_FILAS_HTTP} filas; la lectura no se declara completa.`, 'formato', true);
    if (!paginacion) return todos;
    if (paginacion.tipo === 'cursor') {
      const sig = porRuta(crudo, paginacion.ruta_siguiente);
      if (sig === null || sig === undefined || sig === '' || sig === false) return todos;
      const s = String(sig);
      if (s === cursor || cursores.has(s)) throw new ErrorTablaPropia('El endpoint repitió un cursor: la lectura no es completa.', 'formato', true);
      cursores.add(s); cursor = s;
    } else {
      if (l.length < paginacion.tamano || l.length === 0) return todos;
      pagina += 1;
    }
  }
  throw new ErrorTablaPropia('El endpoint excedió el fusible de páginas; la lectura no se declaró completa.', 'proveedor', true);
}

function aRegistroPorCampos(item: unknown, campos: Record<string, string | undefined>): Registro {
  const r: Registro = {};
  for (const [alias, ruta] of Object.entries(campos)) r[alias] = ruta ? porRuta(item, ruta) : undefined;
  return r;
}

export class LectorTablaPropiaEndpoint implements LectorTablaPropia {
  readonly modo = 'endpoint' as const;
  constructor(private readonly cfg: Extract<ConfigTablaPropia, { modo: 'endpoint' }>, private readonly deps: DepsLector) {}

  async leerPosiciones(o: OpcionesLecturaPosiciones = {}): Promise<ResultadoLectura<PosicionTablaPropia>> {
    const m = this.cfg.mapeo;
    const items = await leerListaJson(this.deps, this.cfg.url, this.cfg.auth, m.lista, m.paginacion);
    const registros = items.map((it) => {
      const r = aRegistroPorCampos(it, m.campos);
      r.fecha_hora = fechaDeEndpoint(r.fecha_hora, m.formato_fecha);
      const vel = aNumero(r.velocidad_kmh);
      if (vel !== null && FACTOR(m) !== 1) r.velocidad_kmh = Math.round(vel * FACTOR(m) * 10) / 10;
      return r;
    });
    return filtrarVentana(registrosAPosiciones(registros, { zona: this.cfg.zona }), o, this.cfg.zona);
  }

  async leerGeocercas(): Promise<ResultadoLectura<GeocercaTablaPropia>> {
    const m: MapeoEndpointGeocercasT | undefined = this.cfg.mapeoGeocercas;
    if (!this.cfg.urlGeocercas || !m) throw new ErrorTablaPropia('no hay endpoint de geocercas configurado', 'formato');
    const items = await leerListaJson(this.deps, this.cfg.urlGeocercas, this.cfg.auth, m.lista, m.paginacion);
    return registrosAGeocercas(items.map((it) => aRegistroPorCampos(it, m.campos)));
  }
}

export class LectorTablaPropiaCsvHttp implements LectorTablaPropia {
  readonly modo = 'csv_sftp' as const;
  constructor(private readonly cfg: Extract<ConfigTablaPropia, { modo: 'csv_sftp' }>, private readonly deps: DepsLector) {}

  private async texto(url: string): Promise<string> {
    if (url.toLowerCase().startsWith('sftp:')) {
      // BLOQUEO EXTERNO declarado: no hay cliente SFTP entre las dependencias y no se instala nada en esta ola.
      throw new ErrorTablaPropia('La entrega por SFTP todavía no está habilitada en este despliegue (falta el cliente SFTP). Deja el archivo en una dirección https o usa el endpoint.', 'formato');
    }
    return obtener(this.deps, peticion(url, this.cfg.auth));
  }

  async leerPosiciones(o: OpcionesLecturaPosiciones = {}): Promise<ResultadoLectura<PosicionTablaPropia>> {
    return filtrarVentana(leerPosicionesCsv(await this.texto(this.cfg.url), { zona: this.cfg.zona }), o, this.cfg.zona);
  }

  async leerGeocercas(): Promise<ResultadoLectura<GeocercaTablaPropia>> {
    if (!this.cfg.urlGeocercas) throw new ErrorTablaPropia('no hay archivo de geocercas configurado', 'formato');
    return leerGeocercasCsv(await this.texto(this.cfg.urlGeocercas));
  }
}

// ── Fábrica ─────────────────────────────────────────────────────────────────
export function crearLectorTablaPropia(valores: ValoresCredencial, deps: DepsLector): { ok: true; lector: LectorTablaPropia; config: ConfigTablaPropia } | { ok: false; motivo: string } {
  const c = leerConfigTablaPropia(valores);
  if (!c.ok) return c;
  const cfg = c.config;
  if (cfg.modo === 'sql_solo_lectura') {
    return { ok: true, config: cfg, lector: new LectorTablaPropiaSql(cfg, deps.ejecutor ?? crearEjecutorPg(cfg.conexion), deps.ahora) };
  }
  if (cfg.modo === 'endpoint') return { ok: true, config: cfg, lector: new LectorTablaPropiaEndpoint(cfg, deps) };
  return { ok: true, config: cfg, lector: new LectorTablaPropiaCsvHttp(cfg, deps) };
}

const falla = (e: unknown): { motivo: string; falla: FallaTablaPropia; backlog: boolean } =>
  e instanceof ErrorTablaPropia ? { motivo: e.message, falla: e.falla, backlog: e.backlog } : { motivo: 'la lectura de la tabla propia falló', falla: 'proveedor', backlog: false };

// ── Adaptador al poller/asentador común ─────────────────────────────────────
/**
 * Lo que `LECTORES_POSICION['tabla_propia']` ejecuta. Lee la ventana reciente (30 min por omisión; el asentador
 * es idempotente por (unidad, medida_en, proveedor), así que repetir la ventana es seguro), pasa la hora local de
 * SU zona a UTC y entrega `PosicionLeida` con `deviceId` = su número económico: el asentador lo liga a la unidad
 * por `gps_device_id` (si la flota lo mapeó) o por `numero_economico` normalizado (ver `asentarLecturas`).
 * Las filas que el lector rechaza se cuentan como inválidas: el poll sale PARCIAL y se dice, no «todo bien».
 */
export async function leerPosicionesTablaPropia(
  valores: ValoresCredencial, http: Http, opciones: OpcionesLecturaPaginada & { ejecutor?: EjecutorSql } = {},
): Promise<ResultadoPosiciones> {
  const ahora = opciones.ahora ?? Date.now;
  const c = crearLectorTablaPropia(valores, { http, ejecutor: opciones.ejecutor, reloj: opciones, ahora });
  if (!c.ok) return { ok: false, motivo: c.motivo, falla: 'formato' };
  try {
    const r = await c.lector.leerPosiciones({ desdeUtc: new Date(ahora() - c.config.ventanaMinutos * 60_000) });
    const posiciones: PosicionLeida[] = r.filas.map((f) => ({
      deviceId: f.unidad, lat: f.lat, lng: f.lon, medidaEn: localAUtc(f.fechaHoraLocal, c.config.zona).toISOString(),
      velocidad: f.velocidadKmh, rumbo: null, ignicion: f.ignicion,
    }));
    return { ok: true, posiciones, paginas: 1, completo: true, invalidas: r.rechazadas.length };
  } catch (e) {
    const f = falla(e);
    return { ok: false, motivo: f.motivo, falla: f.falla, backlog: f.backlog || undefined };
  }
}

export { PROVEEDOR_TABLA_PROPIA };
