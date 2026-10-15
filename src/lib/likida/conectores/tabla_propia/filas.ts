import { ErrorTablaPropia, type CursoTablaPropia, type FilaRechazada, type GeocercaTablaPropia, type PosicionTablaPropia, type ResultadoLectura } from './contrato';
import { ZONA_POR_OMISION, normalizarFechaLocal } from './tiempo';
import { leerIgnicion, leerLineaWkt, leerNumero, leerPoligonoWkt, llaveEncabezado, llaveEconomico, motivoCoordenadas } from './validar';

// ═══════════════════════════════════════════════════════════════════════════
// De «registro crudo» (un objeto de SQL, de JSON o de una fila de CSV ya
// partida en columnas por nombre) a las filas del contrato. UN solo juez para
// los tres modos: lo que un modo acepta, los otros también; lo que uno rechaza,
// todos con el mismo motivo.
// ═══════════════════════════════════════════════════════════════════════════

export type Registro = Record<string, unknown>;

export const MAX_FILAS_LECTURA = 200_000;

/** Tope de la referencia de despacho: más largo que cualquier folio razonable; lo que exceda se recorta, no se rechaza la fila. */
const MAX_DESPACHO_REF = 60;

/**
 * La referencia de despacho (Icident) tal como se guarda en `posicion.despacho_ref` / `viaje.despacho_ref` (0802):
 * mayúsculas y sin espacios (ni dentro: «d 1» = «D1»). Vacío → null. UNA sola función para posiciones y viajes,
 * de modo que la igualdad entre ambos sea exacta.
 */
export function normalizarDespachoRef(v: unknown): string | null {
  const t = (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '').replace(/\s+/g, '').toUpperCase();
  return t === '' ? null : t.slice(0, MAX_DESPACHO_REF);
}

/** Tope del punto de interés: más largo que cualquier nombre de sitio razonable; lo que exceda se recorta. */
const MAX_PUNTO_INTERES = 120;

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v));

export function registroAPosicion(
  r: Registro, fila: number, opciones: { zona?: string; decimalComa?: boolean } = {},
): { ok: PosicionTablaPropia } | { rechazo: FilaRechazada } {
  const rech = (motivo: string) => ({ rechazo: { fila, motivo } });
  const unidad = str(r.unidad).trim();
  if (unidad === '') return rech('unidad vacía');
  if (unidad.length > 80) return rech('unidad demasiado larga');
  const lat = leerNumero(r.lat, opciones.decimalComa); const lon = leerNumero(r.lon, opciones.decimalComa);
  const mc = motivoCoordenadas(lat, lon);
  if (mc) return rech(mc);
  const f = normalizarFechaLocal(r.fecha_hora instanceof Date ? r.fecha_hora.toISOString() : str(r.fecha_hora), opciones.zona ?? ZONA_POR_OMISION);
  if ('error' in f) return rech(f.error);
  const vel = r.velocidad_kmh === undefined || r.velocidad_kmh === null || str(r.velocidad_kmh).trim() === '' ? null : leerNumero(r.velocidad_kmh, opciones.decimalComa);
  if (r.velocidad_kmh !== undefined && r.velocidad_kmh !== null && str(r.velocidad_kmh).trim() !== '' && vel === null) return rech('velocidad ilegible');
  if (vel !== null && (vel < 0 || vel >= 250)) return rech('velocidad fuera de rango (0–250 km/h)');
  const despacho = normalizarDespachoRef(r.despacho);
  // T-A5-15: «fecha de recibido» y «punto de interés» son OPCIONALES y de diagnóstico: si no se entienden, la fila NO se rechaza
  // (la posición es buena); simplemente la llave queda ausente, como si la tabla no la trajera.
  const recibidaCruda = r.fecha_recibida instanceof Date ? r.fecha_recibida.toISOString() : str(r.fecha_recibida).trim();
  const recibida = recibidaCruda === '' ? null : normalizarFechaLocal(recibidaCruda, opciones.zona ?? ZONA_POR_OMISION);
  const puntoInteres = str(r.punto_interes).trim().slice(0, MAX_PUNTO_INTERES);
  return {
    ok: {
      unidad, lat: lat as number, lon: lon as number, fechaHoraLocal: f.ok, velocidadKmh: vel, ignicion: r.ignicion === undefined ? null : leerIgnicion(r.ignicion),
      ...(despacho !== null ? { despacho } : {}),
      ...(recibida && 'ok' in recibida ? { fechaRecibidaLocal: recibida.ok } : {}),
      ...(puntoInteres !== '' ? { puntoInteres } : {}),
    },
  };
}

export function registrosAPosiciones(
  registros: readonly Registro[], opciones: { zona?: string; decimalComa?: boolean; primeraFila?: number } = {},
): ResultadoLectura<PosicionTablaPropia> {
  const filas: PosicionTablaPropia[] = []; const rechazadas: FilaRechazada[] = [];
  registros.slice(0, MAX_FILAS_LECTURA).forEach((r, k) => {
    const x = registroAPosicion(r, k + (opciones.primeraFila ?? 1), opciones);
    if ('ok' in x) filas.push(x.ok); else rechazadas.push(x.rechazo);
  });
  if (registros.length > MAX_FILAS_LECTURA) rechazadas.push({ fila: MAX_FILAS_LECTURA + 1, motivo: `más de ${MAX_FILAS_LECTURA} filas: se leyeron las primeras; acota la vista o la ventana` });
  return { filas, rechazadas };
}

type Vertice = { lat: number; lon: number };
const orientacion = (a: Vertice, b: Vertice, c: Vertice): number => {
  const v = (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
};
const enSegmento = (a: Vertice, b: Vertice, p: Vertice): boolean =>
  p.lon >= Math.min(a.lon, b.lon) && p.lon <= Math.max(a.lon, b.lon) && p.lat >= Math.min(a.lat, b.lat) && p.lat <= Math.max(a.lat, b.lat);
function segmentosSeCruzan(a: Vertice, b: Vertice, c: Vertice, d: Vertice): boolean {
  const o1 = orientacion(a, b, c); const o2 = orientacion(a, b, d); const o3 = orientacion(c, d, a); const o4 = orientacion(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && enSegmento(a, b, c)) || (o2 === 0 && enSegmento(a, b, d)) || (o3 === 0 && enSegmento(c, d, a)) || (o4 === 0 && enSegmento(c, d, b));
}
/** ¿Algún par de lados NO contiguos del anillo (sin repetir el primer vértice) se cruza o se toca? (O(n²), acotado a 2,000 vértices.) */
export function poligonoSeAutointerseca(pts: readonly Vertice[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentosSeCruzan(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

/**
 * GeoJSON `FeatureCollection` de geocercas → mismas filas que el CSV. Cada Feature: `properties` con codigo, nombre,
 * (radio_m si es Point) y cliente opcional; geometría `Polygon` (anillo exterior, sin huecos; [lon, lat]) o `Point` (círculo,
 * exige radio_m). La fila N es el N-ésimo Feature. Lo que no se entiende se rechaza con su motivo.
 */
export function registrosDeGeoJson(texto: string): { registros: Registro[]; rechazadas: FilaRechazada[] } {
  let doc: unknown;
  try { doc = JSON.parse(texto.replace(/^﻿/, '')); } catch { throw new ErrorTablaPropia('El archivo GeoJSON no es un JSON válido.', 'formato'); }
  const fc = doc as { type?: unknown; features?: unknown };
  if (!fc || fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) throw new ErrorTablaPropia('El GeoJSON debe ser un FeatureCollection con una geocerca por Feature.', 'formato');
  const registros: Registro[] = []; const rechazadas: FilaRechazada[] = [];
  const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  fc.features.slice(0, MAX_FILAS_LECTURA).forEach((f: unknown, k: number) => {
    const fila = k + 1;
    const ft = f as { type?: unknown; properties?: unknown; geometry?: { type?: unknown; coordinates?: unknown } | null };
    const rech = (motivo: string) => void rechazadas.push({ fila, motivo });
    if (!ft || ft.type !== 'Feature' || !ft.geometry) return rech('el Feature no trae geometría');
    const props: Registro = {};
    if (ft.properties && typeof ft.properties === 'object') for (const [kk, v] of Object.entries(ft.properties as Registro)) props[llaveEncabezado(kk)] = v;
    const pick = (alias: readonly string[]): unknown => { for (const a of alias) if (props[a] !== undefined) return props[a]; return undefined; };
    const base: Registro = { codigo: pick(ALIAS_GEOCERCA.codigo), nombre: pick(ALIAS_GEOCERCA.nombre), cliente: pick(ALIAS_GEOCERCA.cliente) };
    const g = ft.geometry; const c = g.coordinates;
    if (g.type === 'Point') {
      if (!Array.isArray(c) || c.length < 2) return rech('Point sin coordenadas [lon, lat]');
      const r = pick(ALIAS_GEOCERCA.radio_m);
      return void registros.push({ ...base, lat_centro: num(c[1]), lon_centro: num(c[0]), radio_m: typeof r === 'number' ? String(r) : r });
    }
    if (g.type === 'Polygon') {
      if (!Array.isArray(c) || c.length !== 1 || !Array.isArray(c[0])) return rech('el Polygon debe traer un solo anillo exterior (sin huecos)');
      const anillo = c[0] as unknown[];
      if (anillo.length > MAX_VERTICES_GEOJSON) return rech(`un polígono admite hasta ${MAX_VERTICES_GEOJSON} vértices`);
      const pares: string[] = [];
      for (const v of anillo) {
        if (!Array.isArray(v) || num(v[0]) === '' || num(v[1]) === '') return rech('vértice ilegible en el Polygon (se espera [lon, lat])');
        pares.push(`${num(v[0])} ${num(v[1])}`);
      }
      return void registros.push({ ...base, poligono_wkt: `POLYGON((${pares.join(', ')}))` });
    }
    return rech(`geometría no soportada: ${typeof g.type === 'string' ? g.type.slice(0, 30) : 'desconocida'} (usa Polygon o Point con radio_m)`);
  });
  if (fc.features.length > MAX_FILAS_LECTURA) rechazadas.push({ fila: MAX_FILAS_LECTURA + 1, motivo: `más de ${MAX_FILAS_LECTURA} filas: se leyeron las primeras` });
  return { registros, rechazadas };
}
const MAX_VERTICES_GEOJSON = 2_000;

/** GeoJSON → geocercas con el MISMO juez que el CSV; los números de fila de los rechazos son el N-ésimo Feature. */
export function leerGeocercasGeoJson(texto: string): ResultadoLectura<GeocercaTablaPropia> {
  const { registros, rechazadas: previas } = registrosDeGeoJson(texto);
  // Los Features rechazados antes de llegar al juez dejan huecos: se reconstruye la fila real de cada registro.
  const filasReales: number[] = [];
  const malas = new Set(previas.map((r) => r.fila));
  const total = registros.length + previas.length;
  for (let n = 1; n <= total; n++) if (!malas.has(n)) filasReales.push(n);
  const { filas, rechazadas } = registrosAGeocercas(registros, { primeraFila: 1 });
  return { filas, rechazadas: [...previas, ...rechazadas.map((r) => ({ ...r, fila: filasReales[r.fila - 1] ?? r.fila }))].sort((a, b) => a.fila - b.fila) };
}

export function registrosAGeocercas(
  registros: readonly Registro[], opciones: { decimalComa?: boolean; primeraFila?: number } = {},
): ResultadoLectura<GeocercaTablaPropia> {
  const filas: GeocercaTablaPropia[] = []; const rechazadas: FilaRechazada[] = []; const vistos = new Set<string>();
  registros.slice(0, MAX_FILAS_LECTURA).forEach((r, k) => {
    const fila = k + (opciones.primeraFila ?? 1);
    const codigo = str(r.codigo).trim(); const nombre = str(r.nombre).trim();
    if (!codigo || !nombre) return void rechazadas.push({ fila, motivo: 'codigo o nombre vacío' });
    if (vistos.has(codigo)) return void rechazadas.push({ fila, motivo: `código repetido: ${codigo}` });
    vistos.add(codigo);
    const cliente = str(r.cliente).trim() || null;
    const wkt = str(r.poligono_wkt).trim();
    if (wkt !== '') {
      const p = leerPoligonoWkt(wkt);
      if ('error' in p) return void rechazadas.push({ fila, motivo: p.error });
      if (poligonoSeAutointerseca(p.ok)) return void rechazadas.push({ fila, motivo: 'el polígono se cruza consigo mismo (autointersección): corrige sus vértices' });
      return void filas.push({ codigo, nombre, tipo: 'poligono', centro: null, radioM: null, poligono: p.ok, cliente });
    }
    const lat = leerNumero(r.lat_centro, opciones.decimalComa); const lon = leerNumero(r.lon_centro, opciones.decimalComa);
    const mc = motivoCoordenadas(lat, lon);
    if (mc) return void rechazadas.push({ fila, motivo: mc });
    const radio = leerNumero(r.radio_m, opciones.decimalComa);
    if (radio === null || radio < 25 || radio > 100_000) return void rechazadas.push({ fila, motivo: 'radio_m obligatorio entre 25 y 100,000 m (no se supone uno)' });
    filas.push({ codigo, nombre, tipo: 'circulo', centro: { lat: lat as number, lon: lon as number }, radioM: Math.round(radio), poligono: null, cliente });
  });
  return { filas, rechazadas };
}

// ── Cursos (rutas autorizadas, P8) ──────────────────────────────────────────
const MAX_CASETAS_CURSO = 200;
const FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;
const FECHA_DMA = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** «2026-08-01», «2026-08-01 00:00:00» o «01/08/2026» → AAAA-MM-DD, y solo si es una fecha real. */
function fechaCurso(v: unknown): { ok: string | null } | { error: string } {
  const t = (v instanceof Date ? v.toISOString() : str(v)).trim();
  if (t === '') return { ok: null };
  let a: number, m: number, d: number;
  const i = FECHA_ISO.exec(t); const l = FECHA_DMA.exec(t);
  if (i) { a = +i[1]; m = +i[2]; d = +i[3]; } else if (l) { a = +l[3]; m = +l[2]; d = +l[1]; } else return { error: `fecha ilegible: «${t.slice(0, 30)}» (usa AAAA-MM-DD o DD/MM/AAAA)` };
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return { error: `fecha inexistente: «${t.slice(0, 30)}»` };
  return { ok: `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

/** Las casetas de la celda: «Caseta A | Caseta B | Caseta C» (o una lista JSON ya partida). En orden; sin vacías. */
function listaCasetas(v: unknown): string[] {
  const crudas = Array.isArray(v) ? v.map((x) => str(x)) : str(v).split('|');
  return crudas.map((c) => c.trim()).filter((c) => c !== '');
}

export function registrosACursos(
  registros: readonly Registro[], opciones: { decimalComa?: boolean; primeraFila?: number } = {},
): ResultadoLectura<CursoTablaPropia> {
  const filas: CursoTablaPropia[] = []; const rechazadas: FilaRechazada[] = []; const vistos = new Set<string>();
  registros.slice(0, MAX_FILAS_LECTURA).forEach((r, k) => {
    const fila = k + (opciones.primeraFila ?? 1);
    const rech = (motivo: string) => void rechazadas.push({ fila, motivo });
    const codigo = str(r.codigo).trim(); const nombre = str(r.nombre).trim();
    if (!codigo || !nombre) return rech('codigo o nombre vacío');
    if (codigo.length > 80 || nombre.length > 160) return rech('codigo (80) o nombre (160) demasiado largo');
    if (vistos.has(codigo)) return rech(`código repetido: ${codigo}`);
    vistos.add(codigo);
    const unidad = str(r.unidad).trim() || null; const convenio = str(r.convenio).trim() || null;
    if (unidad !== null && (unidad.length > 80 || llaveEconomico(unidad) === '')) return rech('unidad ilegible');
    if (convenio !== null && convenio.length > 120) return rech('nombre de convenio demasiado largo');
    if (unidad === null && convenio === null) return rech('sin unidad ni convenio: un curso que no aplica a nadie no se carga');
    const desde = fechaCurso(r.vigente_desde); const hasta = fechaCurso(r.vigente_hasta);
    if ('error' in desde) return rech(`vigente_desde: ${desde.error}`);
    if ('error' in hasta) return rech(`vigente_hasta: ${hasta.error}`);
    if (desde.ok && hasta.ok && hasta.ok < desde.ok) return rech('vigente_hasta anterior a vigente_desde');
    const wkt = str(r.corredor_wkt).trim();
    const casetas = listaCasetas(r.casetas);
    if (wkt !== '' && casetas.length > 0) return rech('trae casetas Y corredor: un curso es de un solo tipo (separa las dos rutas en dos filas)');
    if (wkt !== '') {
      const p = leerLineaWkt(wkt);
      if ('error' in p) return rech(p.error);
      const b = leerNumero(r.buffer_m, opciones.decimalComa);
      if (b === null || b < 25 || b > 20_000) return rech('buffer_m obligatorio entre 25 y 20,000 m (no se supone uno)');
      return void filas.push({ codigo, nombre, tipo: 'corredor', unidad, convenio, casetas: [], corredor: p.ok, bufferM: Math.round(b), vigenteDesde: desde.ok, vigenteHasta: hasta.ok });
    }
    if (casetas.length === 0) return rech('sin casetas autorizadas ni corredor: no hay ruta que cargar');
    if (casetas.length > MAX_CASETAS_CURSO) return rech(`un curso admite hasta ${MAX_CASETAS_CURSO} casetas`);
    if (casetas.some((c) => c.length > 120)) return rech('nombre de caseta demasiado largo');
    if (new Set(casetas.map(llaveEconomico)).size !== casetas.length) return rech('una caseta se repite en el mismo curso');
    filas.push({ codigo, nombre, tipo: 'casetas', unidad, convenio, casetas, corredor: null, bufferM: null, vigenteDesde: desde.ok, vigenteHasta: hasta.ok });
  });
  if (registros.length > MAX_FILAS_LECTURA) rechazadas.push({ fila: MAX_FILAS_LECTURA + 1, motivo: `más de ${MAX_FILAS_LECTURA} filas: se leyeron las primeras` });
  return { filas, rechazadas };
}

// ── Nombres de columna de SU archivo → nombres del contrato ─────────────────
export const ALIAS_POSICION: Record<'unidad' | 'lat' | 'lon' | 'fecha_hora' | 'velocidad_kmh' | 'ignicion' | 'despacho' | 'fecha_recibida' | 'punto_interes', string[]> = {
  unidad: ['id_unidad', 'unidad', 'economico', 'numero_economico', 'no_economico', 'num_economico', 'vehiculo', 'id_vehiculo'],
  lat: ['latitud', 'lat', 'latitude'],
  lon: ['longitud', 'lon', 'lng', 'long', 'longitude'],
  fecha_hora: ['fecha_hora', 'fechahora', 'fecha_y_hora', 'fecha', 'timestamp', 'ts'],
  velocidad_kmh: ['velocidad_kmh', 'velocidad', 'speed', 'km_h', 'kmh'],
  ignicion: ['ignicion', 'ignition', 'encendido', 'motor'],
  despacho: ['despacho', 'icident', 'incident', 'viaje', 'no_viaje'],
  fecha_recibida: ['fecha_recibida', 'fecha_recibido', 'fecha_de_recibido', 'fecha_de_recibida', 'recibido', 'recibida', 'fecha_recepcion', 'received_at'],
  punto_interes: ['punto_interes', 'punto_de_interes', 'poi', 'point_of_interest'],
};
export const ALIAS_GEOCERCA: Record<'codigo' | 'nombre' | 'lat_centro' | 'lon_centro' | 'radio_m' | 'poligono_wkt' | 'cliente', string[]> = {
  codigo: ['codigo', 'clave', 'id', 'code', 'codigo_geocerca', 'clave_geocerca', 'id_geocerca', 'codigo_sitio', 'clave_sitio'],
  nombre: ['nombre', 'name', 'geocerca', 'nombre_geocerca', 'nombre_de_la_geocerca', 'nombre_de_geocerca', 'nombre_sitio', 'sitio', 'descripcion'],
  lat_centro: ['lat_centro', 'latitud_centro', 'latitud', 'lat', 'centro_lat', 'centro_latitud'],
  lon_centro: ['lon_centro', 'longitud_centro', 'longitud', 'lng', 'lon', 'centro_lon', 'centro_lng', 'centro_longitud'],
  radio_m: ['radio_m', 'radio', 'radio_metros', 'radio_en_metros', 'radio_mts', 'metros'],
  poligono_wkt: ['poligono_wkt', 'wkt', 'poligono', 'geometria', 'geometria_wkt', 'area_wkt'],
  cliente: ['cliente', 'nombre_cliente', 'cliente_asociado'],
};

export const ALIAS_CURSO: Record<'codigo' | 'nombre' | 'unidad' | 'convenio' | 'casetas' | 'corredor_wkt' | 'buffer_m' | 'vigente_desde' | 'vigente_hasta', string[]> = {
  codigo: ['codigo', 'clave', 'id', 'code', 'curso'],
  nombre: ['nombre', 'name', 'descripcion', 'ruta'],
  unidad: ['unidad', 'economico', 'numero_economico', 'no_economico', 'id_unidad'],
  convenio: ['convenio'],
  casetas: ['casetas', 'casetas_autorizadas', 'ruta_casetas'],
  corredor_wkt: ['corredor_wkt', 'wkt', 'linea_wkt', 'polilinea', 'geometria'],
  buffer_m: ['buffer_m', 'buffer', 'ancho_m', 'tolerancia_m'],
  vigente_desde: ['vigente_desde', 'desde', 'inicio', 'fecha_inicio'],
  vigente_hasta: ['vigente_hasta', 'hasta', 'fin', 'fecha_fin'],
};

/** Índice de la primera columna del encabezado que coincide con algún alias (−1 si ninguna). */
export function indiceDe(encabezados: readonly string[], alias: readonly string[]): number {
  const llaves = encabezados.map(llaveEncabezado);
  for (const a of alias) { const i = llaves.indexOf(a); if (i >= 0) return i; }
  return -1;
}
