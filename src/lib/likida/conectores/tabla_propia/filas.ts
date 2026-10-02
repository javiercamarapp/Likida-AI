import type { CursoTablaPropia, FilaRechazada, GeocercaTablaPropia, PosicionTablaPropia, ResultadoLectura } from './contrato';
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
  return { ok: { unidad, lat: lat as number, lon: lon as number, fechaHoraLocal: f.ok, velocidadKmh: vel, ignicion: r.ignicion === undefined ? null : leerIgnicion(r.ignicion) } };
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
export const ALIAS_POSICION: Record<'unidad' | 'lat' | 'lon' | 'fecha_hora' | 'velocidad_kmh' | 'ignicion', string[]> = {
  unidad: ['id_unidad', 'unidad', 'economico', 'numero_economico', 'no_economico', 'num_economico', 'vehiculo', 'id_vehiculo'],
  lat: ['latitud', 'lat', 'latitude'],
  lon: ['longitud', 'lon', 'lng', 'long', 'longitude'],
  fecha_hora: ['fecha_hora', 'fechahora', 'fecha_y_hora', 'fecha', 'timestamp', 'ts'],
  velocidad_kmh: ['velocidad_kmh', 'velocidad', 'speed', 'km_h', 'kmh'],
  ignicion: ['ignicion', 'ignition', 'encendido', 'motor'],
};
export const ALIAS_GEOCERCA: Record<'codigo' | 'nombre' | 'lat_centro' | 'lon_centro' | 'radio_m' | 'poligono_wkt' | 'cliente', string[]> = {
  codigo: ['codigo', 'clave', 'id', 'code'],
  nombre: ['nombre', 'name', 'geocerca'],
  lat_centro: ['lat_centro', 'latitud_centro', 'latitud', 'lat'],
  lon_centro: ['lon_centro', 'longitud_centro', 'longitud', 'lng', 'lon'],
  radio_m: ['radio_m', 'radio', 'radio_metros'],
  poligono_wkt: ['poligono_wkt', 'wkt', 'poligono', 'geometria'],
  cliente: ['cliente'],
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
