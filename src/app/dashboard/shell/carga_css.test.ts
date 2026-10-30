/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// GUARDIA del seguro de 20 s de la capa de carga (H1): si alguien borra el keyframe del marco, el retardo o la reafirmación con
// !important para reduced-motion, la app vuelve a poder quedar TAPADA/EN BLANCO para siempre (JS roto, hidratación fallida,
// reduced-motion). Prueba de cadenas y barata; la prueba de comportamiento en Chromium es `scripts/ui2-calidad/carga-seguro.mjs`.

const CSS = readFileSync(fileURLToPath(new URL('../../ui-v2/carga.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Devuelve lo que falta del seguro; [] = íntegro. */
export function faltantesDelSeguro(css: string): string[] {
  const falta: string[] = [];
  if (!/@keyframes rv-marco-seguro\s*\{\s*to\s*\{\s*visibility:\s*visible/.test(css)) falta.push('keyframe rv-marco-seguro (el marco vuelve a ser visible)');
  if (!/@keyframes rv-carga-seguro\s*\{\s*to\s*\{[^}]*visibility:\s*hidden[^}]*pointer-events:\s*none/.test(css)) falta.push('keyframe rv-carga-seguro (la capa se retira)');
  if (!/animation-name:\s*rv-marco-seguro;[^}]*animation-delay:\s*20s;[^}]*animation-fill-mode:\s*forwards/.test(css)) falta.push('animación del marco a 20 s con fill forwards');
  if (!/animation-name:\s*rv-carga-seguro;[^}]*animation-delay:\s*20s;[^}]*animation-fill-mode:\s*forwards/.test(css)) falta.push('animación de la capa a 20 s con fill forwards');
  const reduce = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  for (const nombre of ['rv-carga-seguro', 'rv-marco-seguro']) {
    if (!new RegExp(`animation-name:\\s*${nombre}\\s*!important[^}]*animation-delay:\\s*20s\\s*!important`).test(reduce)) falta.push(`reduced-motion reafirma ${nombre} con !important`);
  }
  if (!/@media \(scripting: none\)/.test(css)) falta.push('@media (scripting: none)');
  // El seguro no puede vivir SOLO bajo no-preference: sus keyframes están fuera de ese bloque.
  const idxNoPref = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  if (idxNoPref >= 0 && css.indexOf('@keyframes rv-marco-seguro') > idxNoPref) falta.push('rv-marco-seguro declarado dentro de no-preference');
  return falta;
}

describe('seguro de 20 s de la capa de carga (guardia de cadenas)', () => {
  it('carga.css lo trae íntegro', () => {
    expect(faltantesDelSeguro(CSS)).toEqual([]);
  });
  it('la guardia FALLA si se borra el keyframe del marco, el retardo o la reafirmación de reduced-motion', () => {
    expect(faltantesDelSeguro(CSS.replace('@keyframes rv-marco-seguro', '@keyframes otro'))).not.toEqual([]);
    expect(faltantesDelSeguro(CSS.replace(/animation-delay:\s*20s;/g, ''))).not.toEqual([]);
    expect(faltantesDelSeguro(CSS.replace(/animation-name:\s*rv-marco-seguro\s*!important/g, 'animation-name: rv-marco-seguro'))).not.toEqual([]);
    expect(faltantesDelSeguro(CSS.replace('@media (scripting: none)', '@media (hover: none)'))).not.toEqual([]);
  });
});
