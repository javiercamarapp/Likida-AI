/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo; nada viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CORTE_MOVIL_PX, CORTE_SIDEBAR_COMPLETO_PX, ANCHO_SIDEBAR_PX, ANCHO_RIEL_PX, ALTO_CABECERA_ESCRITORIO_PX,
  ALTO_CABECERA_MOVIL_PX, ALTO_ITEM_PX, ALTO_PIE_MAX_PX, MARCO_PX, ALTO_BARRA_INFERIOR_PX, ALTO_LOGO_PX,
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
    // Activo de alto contraste (punto 10 del dueño, 11-nov): barra inset de 3 px NEGRA por el token --nav-activo-barra + fondo tinta al 7 % + peso 500, todo por tokens --nav-activo-*.
    const activo = regla('[data-ui="v2"] .rv-item[aria-current="page"]');
    expect(activo).toContain('background: var(--nav-activo-bg)');
    expect(activo).toContain('color: var(--nav-activo-fg)');
    expect(activo).toContain('font-weight: var(--nav-activo-peso)');
    // 16-nov-2026: la barra pasó de sombra interna (el radio de 8 px la recortaba en curva) a una pieza propia (::before) de 3 px, por el mismo token.
    const barra = regla('[data-ui="v2"] .rv-item[aria-current="page"]::before');
    expect(barra).toContain('width: 3px');
    expect(barra).toContain('background: var(--nav-activo-barra)');
    expect(regla('[data-ui="v2"] .rv-puesta[aria-current="page"]')).not.toMatch(/box-shadow|inset/);
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
  it('el pie es GRIS como el de Rovaq: fondo hundido (--ui-sunken, claro y oscuro), borde superior y sin franja blanca debajo', () => {
    const r = regla('[data-ui="v2"] .rv-sb__pie', sinComentarios.indexOf('@media (min-width: 768px)'));
    expect(r).toMatch(/background:\s*var\(--ui-sunken\)/);
    expect(r).toMatch(/border-top:\s*1px solid var\(--ui-border\)/);
    expect(sinComentarios).toMatch(/\.rv-sb \{[^}]*padding-bottom: 0;/);
  });
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

describe('paleta de MARCA de Likida: naranja ladrillo, azul marino y crema (decisión de Javier, 16-nov; anula 31-oct y 11-nov)', () => {
  const tokens = readFileSync(fileURLToPath(new URL('../../ui-v2/tokens.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const oscuro = tokens.slice(tokens.indexOf(':root[data-theme="dark"] [data-ui="v2"].tema-neutro'));
  const claro = tokens.slice(0, tokens.indexOf(':root[data-theme="dark"] [data-ui="v2"].tema-neutro'));
  it('cromo NEGRO (primario y barra del activo; claro en oscuro), fondos grises de siempre, marino de marca solo en info/series y señal burdeos como acento puntual', () => {
    expect(claro).toMatch(/--btn-bg:\s*#0e0e10/); // primario negro (16-nov: el dueño devolvió el negro)
    expect(claro).toMatch(/--btn-fg:\s*#ffffff/);
    expect(claro).toMatch(/--marca:\s*#0e0e10/);
    expect(claro).toMatch(/--info:\s*#2a3f5f/); // el marino de marca queda en info (notas y banners con color propio)
    expect(claro).toMatch(/--bg:\s*#f6f6f7/); // fondos grises de siempre
    expect(claro).toMatch(/--canvas:\s*#f1f1f2/);
    expect(claro).toMatch(/--ui-activo-barra:\s*var\(--nav-activo-barra\)/);
    expect(claro).toMatch(/--nav-activo-barra:\s*#0e0e10/);
    expect(claro).toMatch(/--kpi-filete:\s*#0e0e10/);
    expect(tokens).not.toMatch(/--acento-marca/);
    expect(claro).toMatch(/--senal:\s*#a6264a/);
    expect(oscuro).toMatch(/--btn-bg:\s*#f4f4f5/);
    expect(oscuro).toMatch(/--btn-fg:\s*#0e0e10/);
    expect(oscuro).toMatch(/--nav-activo-barra:\s*#f4f4f5/);
    expect(oscuro).toMatch(/--bg:\s*#0e0e10/);
    expect(oscuro).toMatch(/--marca:\s*#f4f4f5/);
    expect(oscuro).toMatch(/--info:\s*#9db8e0/);
    expect(oscuro).toMatch(/--senal:\s*#cc4a6c/);
  });
  it('los de marca EXISTEN en tokens.css y no hay otros naranjas ni azules fuera de la lista blanca (tokens, shell, componentes, páginas, gráficas, logo)', () => {
    // Lista blanca = valores declarados en tokens.css (marca, estados cálidos y series de datos); un tono nuevo obliga a tocar esta lista a propósito.
    const NARANJAS = new Set(['c2410c', '9a3412', 'fb923c', 'fdba74', 'b45309', '7a2a06', '6b3406', '4a2a12', 'fdd0aa', '86580d', 'f0c987', 'fbe3b0', '4a3a14', '3d352d']);
    const AZULES = new Set(['2a3f5f', '9db8e0', '1c2c45', '1b2b44', '17243a', '163f5f', '16384f', '1d2838', '232a36', '263450', '2b6f9e', '334155', '64748b', '7ec0e8', '7f93ae']);
    const familia = (h: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b); const min = Math.min(r, g, b);
      if (max === min || (max - min) / max < 0.22 || max <= 0.2) return null;
      let t = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      t *= 60; if (t < 0) t += 360;
      return t >= 8 && t <= 48 ? 'naranja' : t >= 180 && t <= 260 ? 'azul' : null;
    };
    for (const h of ['c2410c', 'fb923c', '2a3f5f', '9db8e0']) expect(tokens, h).toContain(`#${h}`);
    const dir = new URL('../../ui-v2/', import.meta.url);
    const archivos = ['tokens.css', 'shell.css', 'componentes.css', 'overlay.css', 'paginas.css', 'paginas-dominio.css', 'graficas.css', 'movimiento.css', 'carga.css'];
    const intrusos: string[] = [];
    for (const a of archivos) {
      const css = readFileSync(fileURLToPath(new URL(a, dir)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of css.matchAll(/#([0-9a-fA-F]{6})\b/g)) {
        const h = m[1].toLowerCase(); const f = familia(h);
        if ((f === 'naranja' && !NARANJAS.has(h)) || (f === 'azul' && !AZULES.has(h))) intrusos.push(`${a}: #${h} (${f})`);
        // Fuera de tokens.css, el color de marca se LEE por token: ningún naranja ni azul literal.
        if (f && a !== 'tokens.css') intrusos.push(`${a}: #${h} literal (${f}); usa el token`);
      }
      // Nombres de token heredados de la marca vieja siguen sin existir.
      expect(css, a).not.toMatch(/--marca-(naranja|marino|crema)|--marino|--crema|#ede4d3|#e4e9f1|#f6f1e7|#17100d|#f7f1e8|#120d0a/i);
    }
    expect(intrusos).toEqual([]);
    const logo = readFileSync(fileURLToPath(new URL('./logo-v2.tsx', import.meta.url)), 'utf8');
    expect(logo).not.toMatch(/marca-naranja|#fb923c|#c2410c/); // el logo sigue en tinta/currentColor, sin naranja propio
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
    expect(sinComentarios).toMatch(/\.rv-sb__plegar\[aria-expanded="false"\] \.rv-chev-plegar[^{]*\{ transform: rotate\(180deg\)/);
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

describe('identidad Rovaq en la topbar y el árbol (S1)', () => {
  it('Guía es una píldora de 28 px, radio 999, sobre --ui-soft, con texto 12/500 muted', () => {
    const r = regla('[data-ui="v2"] .rv-guia__btn');
    expect(r).toContain('height: 28px');
    expect(r).toContain('border-radius: 999px');
    expect(r).toContain('background: var(--ui-soft)');
    expect(r).toContain('font: 500 12px');
  });

  it('el título de la topbar y el disparador ⌘K tienen sus reglas, con foco visible', () => {
    expect(sinComentarios).toContain('.rv-cab-esc__titulo');
    expect(sinComentarios).toContain('.rv-cab-esc__buscar');
    expect(sinComentarios).toMatch(/\.rv-cab-esc__buscar:focus-visible/);
  });

  it('el árbol del sidebar trae sombras de scroll arriba y abajo (solo CSS) y «Página actual» no se pinta en el riel', () => {
    const nav = regla('[data-ui="v2"] .rv-sb__nav', sinComentarios.indexOf('@media (min-width: 768px)'));
    expect(nav).toContain('local');
    expect(nav).toContain('radial-gradient');
    expect(sinComentarios).toMatch(/\.rv-sb\[data-riel\] \.rv-pagina-actual \{ display: none; \}/);
    expect(sinComentarios).toMatch(/\.rv-sb \.rv-pagina-actual \{ display: none; \}/);
  });
});

describe('marco y logo finos (controles finos K2-2, SPEC §1.6 y §2.7)', () => {
  const tokens = readFileSync(fileURLToPath(new URL('../../ui-v2/tokens.css', import.meta.url)), 'utf8');
  const tok = (k: string) => Number(new RegExp(`${k}:\\s*(\\d+)px`).exec(tokens)?.[1]);
  const leer = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

  it('los TRES lugares del logo coinciden: ALTO_LOGO_PX, --logo-* y el JSX (que lee la constante)', () => {
    expect(ALTO_LOGO_PX).toEqual({ sidebar: 22, riel: 24, movil: 22, carga: 40 });
    expect(tok('--logo-sb')).toBe(ALTO_LOGO_PX.sidebar);
    expect(tok('--logo-riel')).toBe(ALTO_LOGO_PX.riel);
    expect(tok('--logo-movil')).toBe(ALTO_LOGO_PX.movil);
    expect(tok('--logo-carga')).toBe(ALTO_LOGO_PX.carga);
    const sidebar = leer('./sidebar-v2.tsx');
    expect(sidebar).toContain('alto={ALTO_LOGO_PX.sidebar}');
    expect(sidebar).toContain('alto={ALTO_LOGO_PX.riel}');
    expect(leer('./cabecera-movil.tsx')).toContain('alto={ALTO_LOGO_PX.movil}');
    for (const f of ['./sidebar-v2.tsx', './cabecera-movil.tsx']) expect(leer(f), f).not.toMatch(/alto=\{\d+\}/);
    // Solo se cambió tamaño y colocación: forma y color del logo siguen siendo los de logo-v2.tsx (currentColor).
    expect(leer('./logo-v2.tsx')).toContain('fill="currentColor"');
  });

  it('el bloque de marca mide como la barra de página (44) y alinea logo y título', () => {
    expect(tok('--marca-h')).toBe(ALTO_CABECERA_ESCRITORIO_PX);
    const marca = regla('[data-ui="v2"] .rv-sb__marca');
    expect(marca).toContain('height: var(--marca-h)');
    expect(marca).toContain('padding: 0 12px');
    expect(marca).not.toMatch(/min-height/);
    expect(regla('[data-ui="v2"] .rv-sb__logo::after')).toContain('inset: -11px 0'); // 22 + 22 = 44 de toque
    expect(regla('[data-ui="v2"] .rv-sb .rv-sb__marca')).toContain('padding: 0');
  });

  it('la tarjeta de cuenta: nombre 12/500; hoja «Más» con filas de 44 y fuente 13', () => {
    const nombre = regla('[data-ui="v2"] .rv-cuenta__nombre');
    expect(nombre).toContain('font-size: 12px');
    expect(nombre).toContain('font-weight: 500');
    const hoja = regla('[data-ui="v2"] .rv-ov .rv-item');
    expect(hoja).toContain('height: 44px');
    expect(hoja).toContain('font-size: 13px');
  });
});
