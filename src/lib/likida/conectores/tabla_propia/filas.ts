import type { FilaRechazada, GeocercaTablaPropia, PosicionTablaPropia, ResultadoLectura } from './contrato';
import { ZONA_POR_OMISION, normalizarFechaLocal } from './tiempo';
import { leerIgnicion, leerNumero, leerPoligonoWkt, llaveEncabezado, motivoCoordenadas } from './validar';

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

/** Índice de la primera columna del encabezado que coincide con algún alias (−1 si ninguna). */
export function indiceDe(encabezados: readonly string[], alias: readonly string[]): number {
  const llaves = encabezados.map(llaveEncabezado);
  for (const a of alias) { const i = llaves.indexOf(a); if (i >= 0) return i; }
  return -1;
}
