// Escalas y formatos de las gráficas: aritmética pura, sin DOM ni React, para poder probarla.
// Port fiel de Vexa `lib/charts/escala.mjs` (eje de 3 marcas, geometría de columnas, etiquetas directas, variación solo entre
// periodos completos, colocación del tooltip). Todo número que sale en un eje, una etiqueta directa o un tooltip pasa por aquí.

const entero = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
const unDecimal = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const decimalBreve = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });

/** «2.1 M», «337.9 mil», «842». Los negativos conservan el signo (−); no finitos ⇒ «—». */
export function compactEs(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const signo = n < 0 ? '−' : '';
  if (a < 1000) return signo + entero.format(Math.round(a * 10) / 10 === Math.round(a) ? Math.round(a) : Math.round(a * 10) / 10);
  if (a < 1e6) return `${signo}${decimalBreve.format(a / 1e3)} mil`;
  if (a < 1e9) return `${signo}${decimalBreve.format(a / 1e6)} M`;
  return `${signo}${decimalBreve.format(a / 1e9)} mil M`;
}

/** Pasos «agradables»: el máximo del eje es uno de estos × 10^k y su mitad también es redonda. */
const PASOS = [1, 1.2, 1.6, 2, 3, 4, 5, 6, 8, 10];

/** Eje de 3 marcas [0, mitad, tope] con tope ≥ max. `entero` fuerza marcas enteras (conteos pequeños). */
export function niceScale(max: number, { entero: soloEnteros = false }: { entero?: boolean } = {}): { max: number; ticks: [number, number, number] } {
  const m = Number.isFinite(max) && max > 0 ? max : 0;
  if (m === 0) return { max: soloEnteros ? 2 : 1, ticks: soloEnteros ? [0, 1, 2] : [0, 0.5, 1] };
  const exp = Math.floor(Math.log10(m));
  for (let k = exp; k <= exp + 1; k++) {
    for (const p of PASOS) {
      const top = Math.round(p * 10 ** k * 1e9) / 1e9;
      if (top < m - 1e-9) continue;
      const mid = top / 2;
      if (soloEnteros && (!Number.isInteger(top) || !Number.isInteger(mid))) continue;
      return { max: top, ticks: [0, mid, top] };
    }
  }
  return { max: m, ticks: [0, m / 2, m] };
}

/** ¿Todos los valores son enteros y pequeños (≤ 12)? Entonces el eje no debe mostrar «0.5». */
export function esConteoPequeno(valores: ReadonlyArray<number | null | undefined>): boolean {
  const v = valores.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length > 0 && v.every(Number.isInteger) && Math.max(...v) <= 12;
}

/** Geometría de columnas: relación barra/hueco ≈ 0.6, ancho máximo 22 px, mínimo 3 px. */
export function geometriaColumnas(n: number, anchoPlano: number, { ratio = 0.6, max = 22, min = 3 } = {}): { ranura: number; ancho: number; desfase: number } {
  const ranura = anchoPlano / Math.max(1, n);
  const ancho = Math.max(min, Math.min(max, ranura * ratio));
  return { ranura, ancho, desfase: (ranura - ancho) / 2 };
}

/** Cada cuántas marcas del eje X poner etiqueta para que no se pisen (`minPx` por etiqueta). */
export const cadaCuantas = (n: number, anchoPlano: number, minPx = 30): number => Math.max(1, Math.ceil(n / Math.max(2, Math.floor(anchoPlano / minPx))));

export interface PuntoComparable { valor: number | null | undefined; parcial?: boolean }
export interface Variacion { dir: 'up' | 'down' | 'flat'; texto: string }
const signo = (d: number) => (Math.abs(d) < 0.05 ? '' : d > 0 ? '+' : '−');

/** Variación contra el periodo anterior SOLO entre periodos completos con dato y base > 0. Si no es comparable devuelve null
 *  (nunca se inventa un «0 %»). */
export function variacionVsAnterior(puntos: readonly PuntoComparable[], i: number): Variacion | null {
  const a = puntos[i - 1], b = puntos[i];
  if (i < 1 || !a || !b) return null;
  if (a.parcial || b.parcial || a.valor == null || b.valor == null) return null;
  if (!(a.valor > 0)) return null;
  const d = ((b.valor - a.valor) / a.valor) * 100;
  return { dir: d > 0.05 ? 'up' : d < -0.05 ? 'down' : 'flat', texto: `${signo(d)}${unDecimal.format(Math.abs(d))} %` };
}

/** Índices con etiqueta directa: el máximo y el último periodo completo (si están a menos de 3 posiciones, solo el último). */
export function indicesEtiquetados(puntos: readonly PuntoComparable[]): number[] {
  let max = -1, ultimo = -1;
  puntos.forEach((p, i) => {
    if (p.valor == null || p.parcial) return;
    if (max < 0 || p.valor > (puntos[max].valor as number)) max = i;
    ultimo = i;
  });
  const out: number[] = [];
  if (max >= 0 && !(ultimo >= 0 && Math.abs(max - ultimo) < 3 && max !== ultimo)) out.push(max);
  if (ultimo >= 0 && !out.includes(ultimo)) out.push(ultimo);
  return out;
}

export interface ParamsColocar { ax: number; ay: number; w: number; h: number; vw: number; vh: number; sep?: number; margen?: number }
export interface Colocado { x: number; y: number; lado: 'izquierda' | 'derecha' }

/** Coloca un tooltip de w×h junto a un punto (ax, ay) en coordenadas de VENTANA: a la derecha del punto (se voltea a la izquierda si no
 *  cabe), vertical centrado en el punto y acotado. Nunca devuelve una caja fuera de [margen, vw − margen] × [margen, vh − margen]
 *  mientras el viewport la admita. */
export function colocarLado({ ax, ay, w, h, vw, vh, sep = 14, margen = 8 }: ParamsColocar): Colocado {
  const acota = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));
  const derecha = ax + sep + w <= vw - margen;
  const izquierda = ax - sep - w >= margen;
  const aLaIzq = !derecha && izquierda;
  const x = acota(aLaIzq ? ax - sep - w : ax + sep, margen, vw - margen - w);
  return { x, y: acota(ay - h / 2, margen, vh - margen - h), lado: aLaIzq ? 'izquierda' : 'derecha' };
}

/** Índice de la ranura bajo una coordenada (px desde el borde izquierdo del plano), acotado a [0, n−1]; −1 si n = 0. */
export function ranuraEn(px: number, n: number, anchoPlano: number): number {
  if (n <= 0) return -1;
  return Math.max(0, Math.min(n - 1, Math.floor(px / (anchoPlano / n))));
}
