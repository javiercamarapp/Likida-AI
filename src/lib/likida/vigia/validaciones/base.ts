// Utilidades puras compartidas por las validaciones.
import type { ConfigValidaciones, Hallazgo, IdHallazgo, Severidad } from './tipos';

export const CONFIG_POR_DEFECTO: ConfigValidaciones = {
  formatoPlacaGenerico: '^[A-Z0-9]{3,12}$',
  formatoPlacaPorEstado: {},
  exigirEstadoCaja: true,
  prefijosCaja: [],
  diasAvisoVigencia: 30,
  camposObligatorios: [
    'ref', 'cita', 'caja.linea', 'caja.numero', 'caja.placas', 'caja.estado', 'unidad.eco', 'unidad.placa', 'operador.nombre',
  ],
  exigirSensibles: false,
  digitosCelular: 10,
  minPalabrasNombre: 3,
  exigirZonaHoraria: true,
  ventanasPorMovimiento: {},
  fechasExtraordinarias: [],
  domingoExtraordinario: true,
  ventanaInestableMin: 60,
  maxAntiguedadEtaMin: 60,
  toleranciaEtaContiguaMin: 30,
  retrasoEscalaMin: 60,
  minutosSelloPendiente: 90,
  exigirSuspensionAire: false,
  checklistSalida: ['sello', 'candado_electronico', 'gps_caja', 'bol_firmado', 'caja_numero_visible'],
  requisitosPod: [],
  buzonCompartido: null,
  reportarAusentes: 'ficha',
};

export function resolverConfig(parcial?: Partial<ConfigValidaciones> | null): ConfigValidaciones {
  const p = parcial && typeof parcial === 'object' ? parcial : {};
  const salida: ConfigValidaciones = { ...CONFIG_POR_DEFECTO };
  for (const k of Object.keys(p) as Array<keyof ConfigValidaciones>) {
    const v = p[k];
    if (v !== undefined) (salida as unknown as Record<string, unknown>)[k] = v;
  }
  return salida;
}

export function txt(v: unknown): string {
  return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

/** Mayúsculas, sin acentos, espacios colapsados. */
export function norm(v: unknown): string {
  return txt(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');
}

/** Placa comparable: mayúsculas sin espacios, guiones ni puntos. */
export function placaNorm(v: unknown): string {
  return norm(v).replace(/[\s.-]/g, '');
}

/** Número de caja comparable: sin separadores, sin prefijos de línea configurados, sin ceros a la izquierda. */
export function cajaNorm(v: unknown, prefijos: readonly string[] = []): string {
  let s = norm(v).replace(/[^A-Z0-9]/g, '');
  for (const p of prefijos) {
    const pn = norm(p).replace(/[^A-Z0-9]/g, '');
    if (pn && s.startsWith(pn) && s.length > pn.length) { s = s.slice(pn.length); break; }
  }
  return s.replace(/^0+(?=.)/, '');
}

export function esPendiente(v: unknown): boolean {
  const s = norm(v);
  return s === '' || /^(PENDIENTE|POR CONFIRMAR|N\/?A|NA|S\/?D|-+|\?+|\.+)$/.test(s);
}

/** Distancia de edición con transposición adyacente (Damerau restringida). */
export function distanciaEdicion(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  const d: number[][] = [];
  for (let i = 0; i <= n; i += 1) { d.push([i]); }
  for (let j = 1; j <= m; j += 1) d[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + costo);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[n][m];
}

// Sin cuantificadores anidados: los grupos opcionales son de largo fijo.
// eslint-disable-next-line security/detect-unsafe-regex
const RE_INSTANTE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** ISO → ms. Sin offset se toma como hora de pared UTC (todas las horas del contexto comparten zona). `null` si no es válida. */
export function parseInstante(v: unknown): number | null {
  const s = txt(v);
  const m = RE_INSTANTE.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = m[4] ? Number(m[4]) : 0;
  const mi = m[5] ? Number(m[5]) : 0;
  const se = m[6] ? Number(m[6]) : 0;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const f = new Date(ms);
  if (f.getUTCFullYear() !== y || f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return null;
  if (m[7] && m[7] !== 'Z') {
    const sg = m[7][0] === '-' ? -1 : 1;
    const dig = m[7].replace(/[^0-9]/g, '');
    return ms - sg * (Number(dig.slice(0, 2)) * 60 + Number(dig.slice(2, 4))) * 60000;
  }
  return ms;
}

export const MIN = 60000;
export const DIA = 86400000;

/** Inicio del día (ms) del instante dado. */
export function inicioDia(ms: number): number {
  return Math.floor(ms / DIA) * DIA;
}

export function diaIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export const DIAS_SEMANA = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'] as const;

export function hallazgo(
  id: IdHallazgo,
  severidad: Severidad,
  mensaje: string,
  camposInvolucrados: string[],
  sugerencia: string,
  datoAusente = false,
): Hallazgo {
  const h: Hallazgo = { id, severidad, mensaje, camposInvolucrados, sugerencia };
  if (datoAusente) h.datoAusente = true;
  return h;
}

export function ausente(id: IdHallazgo, dato: string, campos: string[], severidad: Severidad = 'aviso'): Hallazgo {
  return hallazgo(id, severidad, `Dato ausente: ${dato}; no se puede validar.`, campos, `Pedir ${dato} a la persona responsable; no se asume ningún valor.`, true);
}

const ORDEN: Record<Severidad, number> = { bloqueo: 0, aviso: 1, info: 2 };

export function ordenar(hs: Hallazgo[]): Hallazgo[] {
  return [...hs].sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Lee una ruta con puntos (`caja.numero`) de un objeto cualquiera. */
export function leerRuta(o: unknown, ruta: string): unknown {
  let cur: unknown = o;
  for (const p of ruta.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function lista<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : [];
}

export function regexSegura(fuente: string): RegExp | null {
  try { return new RegExp(fuente); } catch { return null; }
}
