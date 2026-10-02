// Validación de datos de SU tabla. Lo que no se entiende se RECHAZA con su motivo (jamás se adivina):
// ni lat/lon intercambiadas «arregladas», ni una zona supuesta cuando el dato trae la suya, ni una unidad inventada.

export const llaveEncabezado = (h: string): string =>
  h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** «IN-001», «in 001» e «IN.001» son la misma unidad. */
export const llaveEconomico = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Número estricto: «20.5»; «-103,31» solo si el separador del archivo es `;`. Nada de «20°43'». */
export function leerNumero(v: unknown, decimalComa = false): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let t = v.trim();
  if (t === '') return null;
  if (decimalComa) t = t.replace(',', '.');
  if (!/^-?\d{1,15}(\.\d{1,15})?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** México continental e islas (caja generosa). Fuera de aquí un punto es error de captura. */
export function dentroDeMexico(lat: number, lon: number): boolean {
  return lat >= 14 && lat <= 33.2 && lon >= -118.8 && lon <= -86;
}

/** Mensaje de rechazo para unas coordenadas, o null si son aceptables. NO «arregla» nada. */
export function motivoCoordenadas(lat: number | null, lon: number | null): string | null {
  if (lat === null || lon === null) return 'latitud o longitud ilegible';
  if (dentroDeMexico(lon, lat)) return 'parece latitud y longitud intercambiadas (no se corrige solo)';
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return 'coordenadas fuera de rango';
  if (!dentroDeMexico(lat, lon)) return 'fuera de México';
  return null;
}

const SI = new Set(['1', 'true', 'on', 'si', 'sí', 's', 'encendido', 'yes', 'y', 't']);
const NO = new Set(['0', 'false', 'off', 'no', 'n', 'apagado', 'f']);
export function leerIgnicion(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v === 1 ? true : v === 0 ? false : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return SI.has(t) ? true : NO.has(t) ? false : null;
}

export function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8; const rad = (g: number) => (g * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const MAX_VERTICES = 2_000;
/** WKT `POLYGON((lon lat, lon lat, …))` → vértices {lat, lon} (WKT va lon primero). Solo anillo exterior simple. */
export function leerPoligonoWkt(wkt: string): { ok: Array<{ lat: number; lon: number }> } | { error: string } {
  if (wkt.length > 200_000) return { error: 'poligono_wkt demasiado largo' };
  const m = /^\s*POLYGON\s*\(\(\s*([^()]+?)\s*\)\)\s*$/i.exec(wkt);
  if (!m) return { error: 'poligono_wkt no es un POLYGON((lon lat, …)) simple (sin huecos ni multipolígonos)' };
  const pares = m[1].split(',');
  if (pares.length > MAX_VERTICES + 1) return { error: `un polígono admite hasta ${MAX_VERTICES} vértices` };
  const pts: Array<{ lat: number; lon: number }> = [];
  for (const par of pares) {
    const [x, y, ...resto] = par.trim().split(/\s+/);
    const lon = leerNumero(x ?? ''); const lat = leerNumero(y ?? '');
    if (resto.length || lon === null || lat === null) return { error: `vértice ilegible: «${par.trim().slice(0, 40)}»` };
    pts.push({ lat, lon });
  }
  if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lon === pts[pts.length - 1].lon) pts.pop();
  if (pts.length < 3) return { error: 'un polígono necesita al menos 3 vértices distintos' };
  for (const p of pts) { const mc = motivoCoordenadas(p.lat, p.lon); if (mc) return { error: `vértice: ${mc}` }; }
  return { ok: pts };
}
