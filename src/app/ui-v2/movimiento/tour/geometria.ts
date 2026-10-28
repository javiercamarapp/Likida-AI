import type { Lado, Rect, Tam } from './tipos';

// Geometría pura del foco y del globo (sin DOM): se prueba con números.

export const BREAKPOINT_HOJA = 640; // bajo este ancho el globo es una hoja inferior

export interface Colocacion {
  lado: 'arriba' | 'abajo' | 'izquierda' | 'derecha' | 'centro' | 'hoja';
  x: number;
  y: number;
  /** Posición de la flecha sobre el borde del globo (px desde su esquina); null sin flecha. */
  flecha: number | null;
}

export interface OpcionesColocar { margen?: number; separacion?: number; esquinaFlecha?: number }

/** Rect del foco: el elemento más un respiro, recortado al viewport. */
export function rectFoco(objetivo: Rect, vp: Tam, respiro = 6): Rect {
  const x = Math.max(0, objetivo.x - respiro);
  const y = Math.max(0, objetivo.y - respiro);
  const x2 = Math.min(vp.w, objetivo.x + objetivo.w + respiro);
  const y2 = Math.min(vp.h, objetivo.y + objetivo.h + respiro);
  return { x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) };
}

/** Trazo SVG del velo con agujero (relleno evenodd): los clics en el agujero
 *  pasan a la página real; el resto del velo los absorbe. */
export function trazoVelo(vp: Tam, hueco: Rect | null, radio = 8): string {
  const fuera = `M0 0H${vp.w}V${vp.h}H0Z`;
  if (!hueco || hueco.w <= 0 || hueco.h <= 0) return fuera;
  const r = Math.min(radio, hueco.w / 2, hueco.h / 2);
  const { x, y, w, h } = hueco;
  const dentro =
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}` +
    `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}` +
    `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  return `${fuera}${dentro}`;
}

const sujetar = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export function colocarGlobo(
  objetivo: Rect | null, globo: Tam, vp: Tam, lado: Lado = 'auto', op: OpcionesColocar = {},
): Colocacion {
  const margen = op.margen ?? 12;
  const sep = op.separacion ?? 14;
  const esq = op.esquinaFlecha ?? 18;

  if (vp.w < BREAKPOINT_HOJA) {
    return { lado: 'hoja', x: 0, y: Math.max(0, vp.h - globo.h), flecha: null };
  }
  if (!objetivo) {
    return { lado: 'centro', x: Math.round((vp.w - globo.w) / 2), y: Math.round((vp.h - globo.h) / 2), flecha: null };
  }

  const espacio = {
    arriba: objetivo.y - margen,
    abajo: vp.h - (objetivo.y + objetivo.h) - margen,
    izquierda: objetivo.x - margen,
    derecha: vp.w - (objetivo.x + objetivo.w) - margen,
  };
  const cabe = (l: keyof typeof espacio) =>
    espacio[l] >= (l === 'arriba' || l === 'abajo' ? globo.h : globo.w) + sep;

  const orden = (['abajo', 'arriba', 'derecha', 'izquierda'] as const).slice();
  let elegido: keyof typeof espacio | undefined;
  if (lado !== 'auto' && cabe(lado)) elegido = lado;
  else elegido = orden.find(cabe);
  if (!elegido) elegido = orden.reduce((a, b) => (espacio[b] > espacio[a] ? b : a));

  const vertical = elegido === 'arriba' || elegido === 'abajo';
  let x: number;
  let y: number;
  if (vertical) {
    x = sujetar(objetivo.x + objetivo.w / 2 - globo.w / 2, margen, vp.w - globo.w - margen);
    y = elegido === 'abajo' ? objetivo.y + objetivo.h + sep : objetivo.y - sep - globo.h;
  } else {
    y = sujetar(objetivo.y + objetivo.h / 2 - globo.h / 2, margen, vp.h - globo.h - margen);
    x = elegido === 'derecha' ? objetivo.x + objetivo.w + sep : objetivo.x - sep - globo.w;
  }
  y = sujetar(y, margen, vp.h - globo.h - margen);
  x = sujetar(x, margen, vp.w - globo.w - margen);

  const centro = vertical ? objetivo.x + objetivo.w / 2 - x : objetivo.y + objetivo.h / 2 - y;
  const largo = vertical ? globo.w : globo.h;
  return { lado: elegido, x: Math.round(x), y: Math.round(y), flecha: Math.round(sujetar(centro, esq, largo - esq)) };
}

/** Interpolación del desliz del foco (easeOutQuint ≈ la curva única del sistema). */
export const suavizado = (t: number) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 5);
export function mezclarRect(a: Rect, b: Rect, t: number): Rect {
  const k = suavizado(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k };
}

export const rectsIguales = (a: Rect, b: Rect, tol = 0.5) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
