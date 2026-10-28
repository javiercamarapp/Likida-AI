/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo; nada viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CORTE_MOVIL_PX, CORTE_SIDEBAR_COMPLETO_PX, ANCHO_SIDEBAR_PX, ANCHO_RIEL_PX, ALTO_CABECERA_ESCRITORIO_PX,
  ALTO_CABECERA_MOVIL_PX, ALTO_ITEM_PX, GROSOR_SENAL_PX,
} from '../../marco-v2';

// El CSS del shell repite en px las medidas de `marco-v2.ts`; aquí se cruzan. También se prueba la invariante de las
// DOS navegaciones: un solo corte móvil/escritorio, sin traslape (en tableta nunca hay dos navegaciones visibles).

const CSS = readFileSync(fileURLToPath(new URL('../../ui-v2/shell.css', import.meta.url)), 'utf8');
const sinComentarios = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** El cuerpo de la primera regla `selector { ... }` (dentro o fuera de un @media) que contiene ese selector exacto. */
function regla(selector: string, desde = 0): string {
  const i = sinComentarios.indexOf(`${selector} {`, desde);
  expect(i, `no encontré la regla ${selector}`).toBeGreaterThan(-1);
  return sinComentarios.slice(i, sinComentarios.indexOf('}', i));
}

describe('shell.css ↔ marco-v2.ts', () => {
  it('el corte móvil es uno solo y los medios están en 768 / 1024', () => {
    expect(CORTE_MOVIL_PX).toBe(768);
    expect(CORTE_SIDEBAR_COMPLETO_PX).toBe(1024);
    const cortes = [...sinComentarios.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(new Set(cortes)).toEqual(new Set([CORTE_MOVIL_PX, CORTE_SIDEBAR_COMPLETO_PX]));
  });

  it('las medidas del CSS son las de las constantes', () => {
    expect(regla('[data-ui="v2"] .rv-sb', sinComentarios.indexOf('@media (min-width: 768px)'))).toContain(`width: ${ANCHO_RIEL_PX}px`);
    expect(sinComentarios).toMatch(new RegExp(`@media \\(min-width: 1024px\\) \\{\\s*\\[data-ui="v2"\\] \\.rv-sb \\{ width: ${ANCHO_SIDEBAR_PX}px`));
    expect(regla('[data-ui="v2"] .rv-cab-movil')).toContain(`height: ${ALTO_CABECERA_MOVIL_PX}px`);
    expect(regla('[data-ui="v2"] .rv-cab-esc', sinComentarios.indexOf('@media (min-width: 768px)'))).toContain(`height: ${ALTO_CABECERA_ESCRITORIO_PX}px`);
    expect(regla('[data-ui="v2"] .rv-item', sinComentarios.indexOf('.rv-item {'))).toContain(`height: ${ALTO_ITEM_PX}px`);
    expect(regla('[data-ui="v2"] .rv-item[aria-current="page"]::before')).toContain(`width: ${GROSOR_SENAL_PX}px`);
  });
});

describe('una sola navegación visible a la vez', () => {
  it('móvil: el aside no se ve y la cabecera móvil sí; desde 768 se invierte', () => {
    const base = sinComentarios.slice(0, sinComentarios.indexOf('@media'));
    expect(base).toMatch(/\.rv-sb \{ display: none; \}/);
    expect(base).toMatch(/\.rv-cab-movil \{\s*display: flex/);
    const escritorio = sinComentarios.slice(sinComentarios.indexOf('@media (min-width: 768px) {'));
    expect(escritorio).toMatch(/\.rv-cab-movil \{ display: none; \}/);
    expect(escritorio).toMatch(/\.rv-sb \{\s*display: flex/);
  });

  it('el riel solo existe entre 768 y 1023 (sin traslape con el sidebar completo)', () => {
    expect(sinComentarios).toContain('@media (min-width: 768px) and (max-width: 1023.98px)');
  });

  it('el texto del riel se oculta de forma visual, nunca con display:none (conserva el nombre accesible)', () => {
    const i = sinComentarios.indexOf('@media (min-width: 768px) and (max-width: 1023.98px)');
    const bloque = sinComentarios.slice(i, sinComentarios.indexOf('@media (min-width: 1024px)'));
    const reglaTexto = bloque.slice(bloque.indexOf('.rv-sb .rv-item__txt'), bloque.indexOf('clip-path'));
    expect(reglaTexto).not.toMatch(/display:\s*none/);
    expect(bloque).toContain('clip-path: inset(50%)');
  });

  it('la hoja «Más» respeta el área segura de abajo y la cabecera móvil la de arriba', () => {
    expect(CSS).toContain('env(safe-area-inset-bottom)');
    expect(regla('[data-ui="v2"] .rv-cab-movil')).toContain('env(safe-area-inset-top)');
  });
});

describe('movimiento', () => {
  it('toda transición queda detrás de prefers-reduced-motion: no-preference', () => {
    const transiciones = [...sinComentarios.matchAll(/transition:/g)].length;
    expect(transiciones).toBeGreaterThan(0);
    const dentro = sinComentarios.slice(sinComentarios.indexOf('@media (prefers-reduced-motion: no-preference)'));
    const cierre = dentro.indexOf('\n}\n');
    expect([...dentro.slice(0, cierre).matchAll(/transition:/g)].length).toBe(transiciones);
  });
});
