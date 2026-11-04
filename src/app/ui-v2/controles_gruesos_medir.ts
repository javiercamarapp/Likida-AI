import { etiquetas } from './guardas_jsx';

// Medición de «controles gruesos» (K1, SPEC-CONTROLES-FINOS §4.1.1). Funciones puras sobre el texto de un .tsx; las usa la guarda
// (controles_gruesos_guarda.test.ts) y el generador de la base. R1 = <button> crudo; R2 = clases gruesas en etiquetas de control;
// R3 = constantes de estilo duplicadas (CAMPO, CSS_BOTON…).

/** Clases de Tailwind que engordan un control (el kit v2 fija 32 px, radio 8 y borde de 1 px). */
const GRUESAS = [
  /\bh-(?:9|10|11|12|14)\b/, /\bpy-(?:2\.5|3|4)\b/, /\bpx-(?:5|6)\b/, /\brounded-(?:xl|2xl|3xl)\b/, /\bborder-2\b/,
  /\bshadow-(?:md|lg|xl|2xl)\b/, /\btext-(?:base|lg|xl)\b/,
];
const RF = /\brounded-full\b/;

/** Un <button> es del kit si lleva una clase `rv-…`, `clasesBoton(` o se construye con el componente. */
export function botonesCrudos(src: string): number {
  return etiquetas(src, 'button').filter((t) => !/\brv-|clasesBoton\(|\.\.\.props|\{\.\.\.resto\}/.test(t)).length;
}

/** Etiquetas de control: button, input, select, textarea y enlaces con pinta de botón (borde o fondo propios). */
function etiquetasControl(src: string): string[] {
  const base = etiquetas(src, '(?:button|input|select|textarea)');
  const enlaces = etiquetas(src, '(?:Link|a)').filter((t) => /\b(?:border|bg-|rounded)/.test(t));
  return [...base, ...enlaces];
}

export function clasesGruesas(src: string): number {
  let n = 0;
  for (const t of etiquetasControl(src)) {
    for (const re of GRUESAS) if (re.test(t)) n++;
    if (/^<button\b/.test(t) && RF.test(t)) n++;
  }
  return n;
}

export function constantesDuplicadas(src: string): number {
  return [...src.matchAll(/\bconst (?:CAMPO|CSS_BOTON|CSS_INPUT|BTN_[A-Z_]+|BOTON[A-Z_]*|CLASE_BOTON)\s*=/g)].length;
}
