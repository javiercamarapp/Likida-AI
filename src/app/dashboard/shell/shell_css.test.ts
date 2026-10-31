/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo; nada viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CORTE_MOVIL_PX, CORTE_SIDEBAR_COMPLETO_PX, ANCHO_SIDEBAR_PX, ANCHO_RIEL_PX, ALTO_CABECERA_ESCRITORIO_PX,
  ALTO_CABECERA_MOVIL_PX, ALTO_ITEM_PX, GROSOR_SENAL_PX, ALTO_PIE_MAX_PX, MARCO_PX, ALTO_BARRA_INFERIOR_PX,
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
    // Activo = fondo marino suave + barra de 3 px de COLOR de marca (`inset 3px 0 0`), por tokens de marca; nunca bloque negro/blanco.
    const activo = regla('[data-ui="v2"] .rv-item[aria-current="page"]');
    expect(activo).toContain(`inset ${GROSOR_SENAL_PX}px 0 0 var(--ui-activo-barra)`);
    expect(activo).toContain('background: var(--ui-activo-bg)');
    expect(activo).toContain('color: var(--ui-activo-ink)');
    expect(activo).not.toMatch(/background:\s*var\(--marca\)/);
    expect(regla('[data-ui="v2"] .rv-fila', sinComentarios.indexOf('@media (min-width: 768px)'))).toContain(`padding: ${MARCO_PX}px`);
  });
});

describe('una sola navegación visible a la vez', () => {
  it('móvil: el aside no se ve y la cabecera móvil sí; desde 768 se invierte', () => {
    const base = sinComentarios.slice(0, sinComentarios.indexOf('@media'));
    expect(base).toMatch(/\.rv-sb \{ display: none; \}/);
    expect(base).toMatch(/\.rv-cab-movil \{\s*display: flex/);
    const escritorio = sinComentarios.slice(sinComentarios.indexOf('@media (min-width: 768px) {'));
    expect(escritorio).toMatch(/\.rv-cab-movil,\s*\[data-ui="v2"\] \.rv-nav-inf \{ display: none; \}/);
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

  it('la cabecera móvil respeta el área segura de arriba (la hoja «Más» es el Drawer de overlay.css)', () => {
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

describe('pie del sidebar y tokens de shell', () => {
  it('el pie es UN solo bloque y cabe en el techo: la suma sale de las reglas del CSS (no de números escritos a mano)', () => {
    const alto = (sel: string) => Number(/(?:^|[\s;{])height:\s*(\d+)px/.exec(regla(sel))?.[1]);
    const filas = [alto('[data-ui="v2"] .rv-puesta'), alto('[data-ui="v2"] .rv-cuenta')];
    expect(filas.every((n) => Number.isFinite(n) && n > 0), `alturas leídas: ${filas}`).toBe(true);
    const hueco = Number(/gap:\s*(\d+)px/.exec(regla('[data-ui="v2"] .rv-pie'))?.[1]);
    const valores = (/padding:([^;]+);/.exec(regla('[data-ui="v2"] .rv-sb__pie', sinComentarios.indexOf('@media (min-width: 768px)')))?.[1] ?? '').trim().split(/\s+/).map(parseFloat);
    const arriba = valores[0];
    const abajo = valores.length === 3 ? valores[2] : valores[0]; // `padding: 8px` (los cuatro lados) o `padding: arriba lados abajo`
    // Peor caso: con «Puesta en marcha» (<6/6) y la tarjeta; sin ella, solo la tarjeta.
    const suma = filas.reduce((a, b) => a + b, 0) + hueco * (filas.length - 1) + 1 /* borde superior */ + arriba + abajo;
    expect(suma, `pie = ${filas.join('+')} + ${filas.length - 1} huecos de ${hueco} + borde y relleno`).toBeLessThanOrEqual(ALTO_PIE_MAX_PX);
    expect(filas).toEqual([24, 44]);
  });

  it('el pie ya no apila tema segmentado, Notificaciones ni tarjetas: esas funciones viven en el menú de la tarjeta y en la topbar', () => {
    expect(sinComentarios).not.toMatch(/\.rv-tema\b/);
    expect(sinComentarios).not.toMatch(/\.rv-tema__op/);
  });

  it('los tokens de shell de tokens.css repiten las constantes', () => {
    const t = readFileSync(fileURLToPath(new URL('../../ui-v2/tokens.css', import.meta.url)), 'utf8');
    for (const [k, v] of Object.entries({ '--sb-w': ANCHO_SIDEBAR_PX, '--rail-w': ANCHO_RIEL_PX, '--topbar-h': ALTO_CABECERA_ESCRITORIO_PX,
      '--cab-movil-h': ALTO_CABECERA_MOVIL_PX, '--nav-inf-h': ALTO_BARRA_INFERIOR_PX, '--item-h': ALTO_ITEM_PX, '--pie-max': ALTO_PIE_MAX_PX, '--marco-pad': MARCO_PX })) {
      expect(t, k).toMatch(new RegExp(`${k}:\\s*${v}px`));
    }
  });
});

describe('clases del menú de cuenta', () => {
  it('shell.css no define .rv-menu* (son del MenuList de overlay): sus clases propias son .rv-cuenta-*', () => {
    expect(sinComentarios).not.toMatch(/\.rv-menu\b/);
    expect(sinComentarios).toContain('.rv-cuenta-tema');
  });
});

describe('paleta: cromo negro/gris/blanco, color en los datos como Vexa (decisión de Javier, 31-oct)', () => {
  const tokens = readFileSync(fileURLToPath(new URL('../../ui-v2/tokens.css', import.meta.url)), 'utf8');
  it('primario negro, activo con barra gris de 3 px y señal burdeos como acento puntual', () => {
    expect(tokens).toMatch(/--btn-bg:\s*#0e0e10/); // primario negro
    expect(tokens).toMatch(/--marca:\s*#0e0e10/);
    expect(tokens).toMatch(/--ink:\s*#0e0e10/);
    expect(tokens).toMatch(/--ui-activo-barra:\s*var\(--n-500\)/); // barra gris, el rojo es solo acento puntual
    expect(tokens).not.toMatch(/--acento-marca/);
    expect(tokens).toMatch(/--senal:\s*#a6264a/);
    // oscuro: negro neutro #0e0e10, señal #cc4a6c
    expect(tokens).toMatch(/--bg:\s*#0e0e10/);
    expect(tokens).toMatch(/--senal:\s*#cc4a6c/);
  });
  it('ningún token ni valor de naranja, marino o crema sobrevive en la capa v2 (tokens, shell, componentes, páginas, gráficas, logo)', () => {
    const dir = new URL('../../ui-v2/', import.meta.url);
    const archivos = ['tokens.css', 'shell.css', 'componentes.css', 'overlay.css', 'paginas.css', 'paginas-dominio.css', 'graficas.css', 'movimiento.css', 'carga.css'];
    for (const a of archivos) {
      const css = readFileSync(fileURLToPath(new URL(a, dir)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, a).not.toMatch(/--marca-(naranja|marino|crema)|--marino|--crema|#c2410c|#9a3412|#fb923c|#2a3f5f|#ede4d3|#e4e9f1|#f6f1e7|#17100d|#f7f1e8|#120d0a/i);
    }
    const logo = readFileSync(fileURLToPath(new URL('./logo-v2.tsx', import.meta.url)), 'utf8');
    expect(logo).not.toMatch(/marca-naranja|#fb923c/);
  });
  it('las entradas animadas del shell viven solo en no-preference y duran ≤ 220 ms', () => {
    const i = sinComentarios.indexOf('@keyframes rv-nav-entra');
    expect(i).toBeGreaterThan(sinComentarios.indexOf('@media (prefers-reduced-motion: no-preference)'));
    for (const m of sinComentarios.matchAll(/animation:\s*rv-(?:nav|shell)-entra (\d+)ms/g)) expect(Number(m[1])).toBeLessThanOrEqual(220);
  });
});

describe('padding de página', () => {
  it('móvil: el shell no suma padding (las páginas ya ponen 16); desde 768 el padding único es 24/24/28', () => {
    expect(regla('[data-ui="v2"] .rv-contenido')).toContain('padding: 0');
    expect(regla('[data-ui="v2"] .rv-contenido', sinComentarios.indexOf('@media (min-width: 768px)'))).toContain('padding: 24px 24px 28px');
  });
});

describe('desborde horizontal y lienzo de carga', () => {
  it('la columna y el marco recortan el desborde horizontal (móvil incluido)', () => {
    expect(regla('[data-ui="v2"] .rv-col')).toContain('overflow-x: clip');
    expect(sinComentarios).toMatch(/\.rv-fila \{ overflow-x: clip; \}/);
  });
  it('carga.css no redefine --bg del html (pisaba el tema oscuro mientras la capa se veía)', () => {
    const carga = readFileSync(fileURLToPath(new URL('../../ui-v2/carga.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(carga).not.toMatch(/--bg\s*:/);
  });
});

describe('riel, topbar y barra inferior móvil (lote L2a)', () => {
  it('el ancho del riel se anima 180 ms con la curva del sistema, solo con movimiento permitido, y el chevron de plegar gira', () => {
    const dentro = sinComentarios.slice(sinComentarios.indexOf('@media (prefers-reduced-motion: no-preference)'));
    const cierre = dentro.indexOf('\n}\n');
    const bloque = dentro.slice(0, cierre);
    expect(bloque).toMatch(/\.rv-sb \{ transition: width 180ms cubic-bezier\(0\.22, 1, 0\.36, 1\); \}/);
    expect(bloque).toMatch(/\.rv-chev-plegar \{ transition: transform 180ms/);
    expect(sinComentarios).toMatch(/\.rv-cab-esc__plegar\[aria-expanded="false"\] \.rv-chev-plegar[^{]*\{ transform: rotate\(180deg\)/);
  });

  it('el riel conserva todos los ítems alcanzables: el acordeón se abre completo y el texto se oculta de forma visual', () => {
    expect(sinComentarios).toMatch(/\.rv-sb\[data-riel\] \.rv-grupo__cuerpo \{ grid-template-rows: 1fr; visibility: visible; \}/);
    expect(sinComentarios).toMatch(/\.rv-sb \.rv-grupo__cuerpo \{ grid-template-rows: 1fr; visibility: visible; \}/);
  });

  it('la topbar no tiene miga de pan: queda Guía, Notificaciones y la fecha, y el marco lleva sombra suave', () => {
    expect(sinComentarios).not.toMatch(/\.rv-migas/);
    expect(sinComentarios).toContain('.rv-guia__btn');
    expect(sinComentarios).toContain('.rv-cab-esc__fecha');
    expect(regla('[data-ui="v2"] .rv-col', sinComentarios.indexOf('@media (min-width: 768px)'))).toContain('box-shadow: var(--sh-marco)');
    expect(regla('[data-ui="v2"] .rv-sb', sinComentarios.indexOf('@media (min-width: 768px)'))).toContain('box-shadow: var(--sh-marco)');
  });

  it('la barra inferior: píldora flotante de 64 px con área segura, solo bajo 768, y el contenido le deja sitio', () => {
    const barra = regla('[data-ui="v2"] .rv-nav-inf');
    expect(barra).toContain('position: fixed');
    expect(barra).toContain(`height: ${ALTO_BARRA_INFERIOR_PX}px`);
    expect(barra).toContain('border-radius: 999px');
    expect(barra).toContain('env(safe-area-inset-bottom)');
    expect(barra).toContain('box-shadow: var(--sh-pop)');
    const escritorio = sinComentarios.slice(sinComentarios.indexOf('@media (min-width: 768px) {'));
    expect(escritorio).toMatch(/\.rv-nav-inf \{ display: none; \}/);
    expect(sinComentarios).toMatch(/@media \(max-width: 767\.98px\) \{\s*\[data-ui="v2"\] \.rv-contenido \{ padding-bottom: calc\(64px \+ max\(10px, env\(safe-area-inset-bottom\)\) \+ 24px\); \}/);
  });

  it('cada destino de la barra mide al menos 44 px de toque y su etiqueta es de 11 px', () => {
    const item = regla('[data-ui="v2"] .rv-nav-inf__item');
    expect(item).toContain('min-height: 44px');
    expect(item).toMatch(/font: 500 11px/);
  });

  it('el chip de fecha de cada página se oculta en v2 (la fecha vive en el shell) y la cabecera móvil lleva la suya', () => {
    expect(sinComentarios).toContain('[data-ui="v2"] .chip-fecha { display: none; }');
    expect(sinComentarios).toContain('.rv-cab-movil__fecha');
  });
});
