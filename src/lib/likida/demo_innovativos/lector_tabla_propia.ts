// ═══════════════════════════════════════════════════════════════════════════
// LECTOR DE «TABLA PROPIA» — implementación de REFERENCIA del contrato
// (`contratos.ts`) sobre CSV, más lo que cualquier modo (SQL, CSV/SFTP,
// endpoint) necesita igual: normalizar encabezados, tipos, zona horaria,
// resolver unidades, y pasar sus geocercas al catálogo de sitios.
//
// PURO: sin base, sin red, sin reloj. Lo que no se entiende se RECHAZA con su
// motivo (jamás se adivina): ni lat/lng intercambiadas «arregladas», ni una zona
// horaria supuesta cuando el dato ya trae la suya, ni una unidad inventada.
// ═══════════════════════════════════════════════════════════════════════════

import {
  PROVEEDOR_TABLA_PROPIA, ZONA_INNOVATIVOS,
  type GeocercaTablaPropia, type LectorTablaPropia, type OpcionesLecturaPosiciones, type PosicionLikida,
  type PosicionTablaPropia, type ResultadoLectura,
} from './contratos';

// ── CSV mínimo (comillas dobles, separador detectado en el encabezado) ──────
export function partirCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (s: string) => primera.split(s).length - 1;
  const sep = [';', '\t', ','].reduce((m, c) => (cuenta(c) > cuenta(m) ? c : m), ',');
  const filas: string[][] = [];
  let fila: string[] = []; let campo = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else q = false; } else campo += c; }
    else if (c === '"' && campo === '') q = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; fila.push(campo); campo = ''; filas.push(fila); fila = []; }
    else campo += c;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}
const separadorDe = (texto: string): string => {
  const primera = texto.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (s: string) => primera.split(s).length - 1;
  return [';', '\t', ','].reduce((m, c) => (cuenta(c) > cuenta(m) ? c : m), ',');
};

export const llaveEncabezado = (h: string): string =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const ALIAS_POSICION: Record<'unidad' | 'lat' | 'lon' | 'fecha' | 'velocidad' | 'ignicion', string[]> = {
  unidad: ['id_unidad', 'unidad', 'economico', 'numero_economico', 'no_economico', 'num_economico', 'vehiculo', 'id_vehiculo'],
  lat: ['latitud', 'lat', 'latitude'],
  lon: ['longitud', 'lon', 'lng', 'long', 'longitude'],
  fecha: ['fecha_hora', 'fechahora', 'fecha_y_hora', 'fecha', 'timestamp', 'ts'],
  velocidad: ['velocidad_kmh', 'velocidad', 'speed', 'km_h', 'kmh'],
  ignicion: ['ignicion', 'ignition', 'encendido', 'motor'],
};

function indiceDe(encabezados: string[], alias: string[]): number {
  const llaves = encabezados.map(llaveEncabezado);
  for (const a of alias) { const i = llaves.indexOf(a); if (i >= 0) return i; }
  return -1;
}

/** Número estricto: «20.5», «-103,31» solo si el separador del archivo es `;`. Nada de «20°43'». */
export function leerNumero(v: string, decimalComa: boolean): number | null {
  let t = v.trim();
  if (t === '') return null;
  if (decimalComa) t = t.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** México continental e islas (caja generosa). Fuera de aquí un punto es error de captura, no un viaje a Alaska. */
export function dentroDeMexico(lat: number, lon: number): boolean {
  return lat >= 14 && lat <= 33.2 && lon >= -118.8 && lon <= -86;
}

/** Mensaje de rechazo para unas coordenadas, o null si son aceptables. NO «arregla» nada. */
export function motivoCoordenadas(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return 'latitud o longitud ilegible';
  // Primero la inversión: en México una latitud puesta como longitud (-100.19) cae «fuera de rango» y ese mensaje no ayuda.
  if (dentroDeMexico(lon, lat)) return 'parece latitud y longitud intercambiadas (no se corrige solo)';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return 'coordenadas fuera de rango';
  if (!dentroDeMexico(lat, lon)) return 'fuera de México';
  return null;
}

// ── Fechas: «hora local sin zona» → UTC ─────────────────────────────────────
const FECHA_LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;
const FECHA_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
const CON_ZONA = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Normaliza a «AAAA-MM-DD HH:MM:SS» local; devuelve {error} si trae zona o no se entiende. */
export function normalizarFechaLocal(v: string): { ok: string } | { error: string } {
  const t = v.trim();
  if (t === '') return { error: 'fecha_hora vacía' };
  if (CON_ZONA.test(t) && /T|\d{2}:\d{2}/.test(t)) return { error: 'la fecha trae zona horaria; el contrato espera hora local de CDMX SIN zona (confirmar con sistemas)' };
  let a: number, m: number, d: number, h: number, mi: number, s: number;
  let r = FECHA_LOCAL.exec(t);
  if (r) { [a, m, d, h, mi, s] = [+r[1], +r[2], +r[3], +r[4], +r[5], +(r[6] ?? 0)]; }
  else {
    r = FECHA_DMY.exec(t);
    if (!r) return { error: 'fecha_hora con formato desconocido (esperaba AAAA-MM-DD HH:MM:SS o DD/MM/AAAA HH:MM)' };
    [d, m, a, h, mi, s] = [+r[1], +r[2], +r[3], +r[4], +r[5], +(r[6] ?? 0)];
  }
  const f = new Date(Date.UTC(a, m - 1, d, h, mi, s));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) return { error: 'fecha_hora inexistente' };
  const p = (n: number) => String(n).padStart(2, '0');
  return { ok: `${a}-${p(m)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}` };
}

function desfaseMs(instante: number, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instante));
  const g = (t: string) => Number(partes.find((x) => x.type === t)?.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(instante / 1000) * 1000;
}

/** «2026-10-20 09:00:00» en `zona` → instante UTC. Resuelve el desfase real de ESA fecha (no un -6 fijo). */
export function localAUtc(fechaHoraLocal: string, zona: string = ZONA_INNOVATIVOS): Date {
  const r = FECHA_LOCAL.exec(fechaHoraLocal);
  if (!r) throw new Error(`fecha local inválida: ${fechaHoraLocal}`);
  const comoUtc = Date.UTC(+r[1], +r[2] - 1, +r[3], +r[4], +r[5], +(r[6] ?? 0));
  let utc = comoUtc - desfaseMs(comoUtc, zona);
  utc = comoUtc - desfaseMs(utc, zona); // una segunda pasada cubre el borde de un cambio de horario
  return new Date(utc);
}

const SI = new Set(['1', 'true', 'on', 'si', 'sí', 's', 'encendido', 'yes', 'y']);
const NO = new Set(['0', 'false', 'off', 'no', 'n', 'apagado']);
const leerIgnicion = (v: string): boolean | null => { const t = v.trim().toLowerCase(); return SI.has(t) ? true : NO.has(t) ? false : null; };

// ── Posiciones ──────────────────────────────────────────────────────────────
export function leerPosicionesCsv(texto: string): ResultadoLectura<PosicionTablaPropia> & { error?: string } {
  const matriz = partirCsv(texto);
  if (matriz.length === 0) return { filas: [], rechazadas: [], error: 'El archivo está vacío.' };
  const enc = matriz[0];
  const ix = {
    unidad: indiceDe(enc, ALIAS_POSICION.unidad), lat: indiceDe(enc, ALIAS_POSICION.lat), lon: indiceDe(enc, ALIAS_POSICION.lon),
    fecha: indiceDe(enc, ALIAS_POSICION.fecha), vel: indiceDe(enc, ALIAS_POSICION.velocidad), ign: indiceDe(enc, ALIAS_POSICION.ignicion),
  };
  const faltan = (['unidad', 'lat', 'lon', 'fecha'] as const).filter((k) => ix[k] < 0);
  if (faltan.length) {
    return { filas: [], rechazadas: [], error: `Faltan columnas obligatorias: ${faltan.join(', ')}. Encabezados leídos: ${enc.join(' | ')}.` };
  }
  const decimalComa = separadorDe(texto) === ';';
  const filas: PosicionTablaPropia[] = []; const rechazadas: ResultadoLectura<PosicionTablaPropia>['rechazadas'] = [];
  matriz.slice(1).forEach((c, k) => {
    const fila = k + 2;
    const unidad = (c[ix.unidad] ?? '').trim();
    if (unidad === '') return void rechazadas.push({ fila, motivo: 'unidad vacía' });
    const lat = leerNumero(c[ix.lat] ?? '', decimalComa); const lon = leerNumero(c[ix.lon] ?? '', decimalComa);
    const mc = motivoCoordenadas(lat, lon);
    if (mc) return void rechazadas.push({ fila, motivo: mc });
    const f = normalizarFechaLocal(c[ix.fecha] ?? '');
    if ('error' in f) return void rechazadas.push({ fila, motivo: f.error });
    const vel = ix.vel >= 0 ? leerNumero(c[ix.vel] ?? '', decimalComa) : null;
    if (vel !== null && (vel < 0 || vel >= 250)) return void rechazadas.push({ fila, motivo: 'velocidad fuera de rango (0–250 km/h)' });
    filas.push({ unidad, lat: lat as number, lon: lon as number, fechaHoraLocal: f.ok, velocidadKmh: vel, ignicion: ix.ign >= 0 ? leerIgnicion(c[ix.ign] ?? '') : null });
  });
  return { filas, rechazadas };
}

/** «IN-001», «in 001» e «IN.001» son la misma unidad. */
export const llaveEconomico = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface ResultadoAdaptacion {
  posiciones: PosicionLikida[];
  /** Económicos que su tabla trae y Likida no tiene (o son ambiguos), con cuántas filas. NO se inventan unidades. */
  sinUnidad: Map<string, number>;
  /** Filas anteriores a `desdeUtc` (lectura incremental). */
  anteriores: number;
}

/** Su fila → fila de `posicion`: unidad resuelta, hora en UTC, proveedor fijo. */
export function adaptarAPosiciones(
  filas: readonly PosicionTablaPropia[],
  unidadesPorEconomico: ReadonlyMap<string, string>,
  opciones: { desdeUtc?: Date; zona?: string } = {},
): ResultadoAdaptacion {
  const mapa = new Map<string, string | null>();
  for (const [eco, id] of unidadesPorEconomico) {
    const k = llaveEconomico(eco);
    mapa.set(k, mapa.has(k) && mapa.get(k) !== id ? null : id); // dos económicos que chocan al normalizar => ambiguo
  }
  const posiciones: PosicionLikida[] = []; const sinUnidad = new Map<string, number>(); let anteriores = 0;
  for (const f of filas) {
    const id = mapa.get(llaveEconomico(f.unidad));
    if (!id) { sinUnidad.set(f.unidad, (sinUnidad.get(f.unidad) ?? 0) + 1); continue; }
    const utc = localAUtc(f.fechaHoraLocal, opciones.zona);
    if (opciones.desdeUtc && utc < opciones.desdeUtc) { anteriores++; continue; }
    posiciones.push({ unidadId: id, lat: f.lat, lng: f.lon, velocidad: f.velocidadKmh, ignicion: f.ignicion, medidaEn: utc.toISOString(), proveedor: PROVEEDOR_TABLA_PROPIA });
  }
  return { posiciones, sinUnidad, anteriores };
}

// ── Consulta SQL de SOLO LECTURA (modo sql_solo_lectura) ────────────────────
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export interface MapeoColumnasSql { unidad: string; lat: string; lon: string; fecha: string; velocidad?: string; ignicion?: string }

/**
 * Arma el SELECT parametrizado. Los identificadores (vista y columnas) los pone
 * un humano en la configuración: se validan contra una lista cerrada de forma
 * (letras, dígitos, guion bajo; vista = `esquema.nombre` o `nombre`) y se
 * entrecomillan; los VALORES van siempre como parámetros. No hay concatenación
 * de texto libre, y la sentencia es un solo SELECT (nunca escribe).
 */
export function construirConsultaPosiciones(
  cfg: { vista: string; columnas: MapeoColumnasSql; limite?: number },
  filtro: { desdeLocal?: string; unidades?: readonly string[] } = {},
): { text: string; values: unknown[] } {
  const partes = cfg.vista.split('.');
  if (partes.length > 2 || !partes.every((p) => IDENT.test(p))) throw new Error(`vista inválida: ${cfg.vista}`);
  const col = (n: string | undefined): string | null => { if (n === undefined) return null; if (!IDENT.test(n)) throw new Error(`columna inválida: ${n}`); return `"${n}"`; };
  const c = cfg.columnas;
  const lista = [[c.unidad, 'unidad'], [c.lat, 'lat'], [c.lon, 'lon'], [c.fecha, 'fecha_hora'], [c.velocidad, 'velocidad_kmh'], [c.ignicion, 'ignicion']]
    .filter(([n]) => n !== undefined).map(([n, alias]) => `${col(n as string)} as ${alias}`).join(', ');
  const values: unknown[] = []; const donde: string[] = [];
  if (filtro.desdeLocal) { values.push(filtro.desdeLocal); donde.push(`${col(c.fecha)} >= $${values.length}`); }
  if (filtro.unidades?.length) { values.push([...filtro.unidades]); donde.push(`${col(c.unidad)} = any($${values.length})`); }
  const limite = Math.min(Math.max(Math.trunc(cfg.limite ?? 50_000), 1), 200_000);
  return {
    text: `select ${lista} from ${partes.map((p) => `"${p}"`).join('.')}${donde.length ? ` where ${donde.join(' and ')}` : ''} order by ${col(c.fecha)} asc limit ${limite}`,
    values,
  };
}

// ── Geocercas ───────────────────────────────────────────────────────────────
export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8; const rad = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** WKT `POLYGON((lon lat, lon lat, …))` → vértices {lat, lon} (WKT va lon primero). */
export function leerPoligonoWkt(wkt: string): { ok: Array<{ lat: number; lon: number }> } | { error: string } {
  const m = /^\s*POLYGON\s*\(\(\s*([^()]+?)\s*\)\)\s*$/i.exec(wkt);
  if (!m) return { error: 'poligono_wkt no es un POLYGON((lon lat, …)) simple' };
  const pts: Array<{ lat: number; lon: number }> = [];
  for (const par of m[1].split(',')) {
    const [x, y, ...resto] = par.trim().split(/\s+/);
    const lon = leerNumero(x ?? '', false); const lat = leerNumero(y ?? '', false);
    if (resto.length || lon === null || lat === null) return { error: `vértice ilegible: «${par.trim()}»` };
    pts.push({ lat, lon });
  }
  if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon) pts.pop();
  if (pts.length < 3) return { error: 'un polígono necesita al menos 3 vértices distintos' };
  for (const p of pts) { const mc = motivoCoordenadas(p.lat, p.lon); if (mc) return { error: `vértice ${mc}` }; }
  return { ok: pts };
}

const ALIAS_GEO = {
  codigo: ['codigo', 'clave', 'id', 'code'], nombre: ['nombre', 'name', 'geocerca'], tipo: ['tipo', 'forma'],
  lat: ['lat_centro', 'latitud_centro', 'latitud', 'lat'], lon: ['lon_centro', 'longitud_centro', 'longitud', 'lng', 'lon'],
  radio: ['radio_m', 'radio', 'radio_metros'], wkt: ['poligono_wkt', 'wkt', 'poligono', 'geometria'], cliente: ['cliente'],
};

export function leerGeocercasCsv(texto: string): ResultadoLectura<GeocercaTablaPropia> & { error?: string } {
  const matriz = partirCsv(texto);
  if (matriz.length === 0) return { filas: [], rechazadas: [], error: 'El archivo está vacío.' };
  const enc = matriz[0];
  const ix = Object.fromEntries(Object.entries(ALIAS_GEO).map(([k, a]) => [k, indiceDe(enc, a)])) as Record<keyof typeof ALIAS_GEO, number>;
  const faltan = (['codigo', 'nombre'] as const).filter((k) => ix[k] < 0);
  if (faltan.length || (ix.lat < 0 && ix.wkt < 0)) {
    return { filas: [], rechazadas: [], error: `Faltan columnas: ${[...faltan, ...(ix.lat < 0 && ix.wkt < 0 ? ['lat_centro/lon_centro o poligono_wkt'] : [])].join(', ')}. Encabezados leídos: ${enc.join(' | ')}.` };
  }
  const decimalComa = separadorDe(texto) === ';';
  const filas: GeocercaTablaPropia[] = []; const rechazadas: ResultadoLectura<GeocercaTablaPropia>['rechazadas'] = [];
  const vistos = new Set<string>();
  matriz.slice(1).forEach((c, k) => {
    const fila = k + 2;
    const codigo = (c[ix.codigo] ?? '').trim(); const nombre = (c[ix.nombre] ?? '').trim();
    if (!codigo || !nombre) return void rechazadas.push({ fila, motivo: 'codigo o nombre vacío' });
    if (vistos.has(codigo)) return void rechazadas.push({ fila, motivo: `código repetido: ${codigo}` });
    vistos.add(codigo);
    const wkt = ix.wkt >= 0 ? (c[ix.wkt] ?? '').trim() : '';
    const cliente = ix.cliente >= 0 ? ((c[ix.cliente] ?? '').trim() || null) : null;
    if (wkt !== '') {
      const p = leerPoligonoWkt(wkt);
      if ('error' in p) return void rechazadas.push({ fila, motivo: p.error });
      return void filas.push({ codigo, nombre, tipo: 'poligono', centro: null, radioM: null, poligono: p.ok, cliente });
    }
    const lat = leerNumero(c[ix.lat] ?? '', decimalComa); const lon = leerNumero(c[ix.lon] ?? '', decimalComa);
    const mc = motivoCoordenadas(lat, lon);
    if (mc) return void rechazadas.push({ fila, motivo: mc });
    const radio = ix.radio >= 0 ? leerNumero(c[ix.radio] ?? '', decimalComa) : null;
    if (radio === null || radio < 25 || radio > 100_000) return void rechazadas.push({ fila, motivo: 'radio_m obligatorio entre 25 y 100,000 m (no se supone uno)' });
    filas.push({ codigo, nombre, tipo: 'circulo', centro: { lat: lat as number, lon: lon as number }, radioM: Math.round(radio), poligono: null, cliente });
  });
  return { filas, rechazadas };
}

export interface ResultadoSitios {
  /** CSV listo para `parsearCsvSitios` / «Importar sitios» (conductor/sitios). */
  csv: string;
  /** Polígonos que hubo que APROXIMAR a un círculo que los envuelve (el catálogo de sitios solo guarda centro + radio). */
  aproximadas: Array<{ codigo: string; radioM: number }>;
}

const esc = (v: string | number | null): string => { const s = v === null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Sus geocercas → el CSV de sitios del Conductor. Un polígono se aproxima por el
 * círculo de centro = promedio de vértices y radio = vértice más lejano (+ 5 %):
 * SIEMPRE lo contiene, a costa de ser más grande; se reporta cuál se aproximó
 * para que se decida a la vista si hace falta soporte nativo de polígonos.
 */
export function geocercasASitiosCsv(geocercas: readonly GeocercaTablaPropia[], tipoDe: (g: GeocercaTablaPropia) => string = (g) => (/^patio/i.test(g.codigo) ? 'patio' : 'planta')): ResultadoSitios {
  const aproximadas: ResultadoSitios['aproximadas'] = [];
  const filas = geocercas.map((g) => {
    let centro = g.centro; let radio = g.radioM;
    if (g.tipo === 'poligono' && g.poligono) {
      const lat = g.poligono.reduce((s, p) => s + p.lat, 0) / g.poligono.length;
      const lon = g.poligono.reduce((s, p) => s + p.lon, 0) / g.poligono.length;
      centro = { lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6 };
      radio = Math.ceil(Math.max(...g.poligono.map((p) => haversineM(centro as { lat: number; lon: number }, p))) * 1.05);
      aproximadas.push({ codigo: g.codigo, radioM: radio });
    }
    return [g.codigo, g.nombre, tipoDe(g), centro?.lat ?? null, centro?.lon ?? null, radio, null, g.cliente, null].map(esc).join(',');
  });
  return { csv: `codigo,nombre,tipo,lat,lng,radio_m,direccion,cliente,padre\n${filas.join('\n')}\n`, aproximadas };
}

// ── Implementaciones del contrato ───────────────────────────────────────────
/** Lector sobre dos CSV ya descargados (modo `csv_sftp`). Referencia y doble de prueba a la vez. */
export class LectorTablaPropiaCsv implements LectorTablaPropia {
  readonly modo = 'csv_sftp' as const;
  constructor(private readonly archivos: { posiciones: string; geocercas: string }) {}
  async leerPosiciones(opciones: OpcionesLecturaPosiciones = {}) {
    const r = leerPosicionesCsv(this.archivos.posiciones);
    if (r.error) throw new Error(r.error);
    const unidades = opciones.unidades ? new Set(opciones.unidades.map(llaveEconomico)) : null;
    const filas = r.filas.filter((f) => (!unidades || unidades.has(llaveEconomico(f.unidad))) && (!opciones.desdeUtc || localAUtc(f.fechaHoraLocal) >= opciones.desdeUtc));
    return { filas, rechazadas: r.rechazadas };
  }
  async leerGeocercas() {
    const r = leerGeocercasCsv(this.archivos.geocercas);
    if (r.error) throw new Error(r.error);
    return { filas: r.filas, rechazadas: r.rechazadas };
  }
}
