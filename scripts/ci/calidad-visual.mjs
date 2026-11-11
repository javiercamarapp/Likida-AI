// Detector de choques visuales SIN red ni producción (F22).
//
// Dos familias de guardas, ambas puras (reciben texto/números, no tocan disco ni navegador) para que cada una
// pueda probarse con un caso sintético que la haga fallar a propósito (ver calidad_visual.test.ts):
//
//   1. Estáticas sobre CSS (corren en `npm test`, sin navegador):
//        · colisionesDeClases   — el mismo selector definido en más de una hoja con valores distintos de la misma
//                                 propiedad. Es la causa raíz de `.rv-fila` (ronda 1 de la revisión visual): una
//                                 fila de shell a 100dvh pisaba la fila de tarjetas.
//        · alturasAViewport     — `height: 100vh|100dvh|100svh|100lvh` (no min-height): tarjetas del alto de la
//                                 pantalla en cuanto alguien reutiliza la clase fuera del shell.
//   2. Evaluadores de medidas del DOM (las medidas las toma Playwright en pruebas-navegador/calidad-visual.nav.ts):
//        · evaluarDesborde      — scroll horizontal de página (a 412 px).
//        · evaluarH1            — exactamente un <h1> visible.
//        · evaluarTitulosEncimados — cajas de títulos que se solapan o más estrechas que una palabra por línea.

const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Divide un texto CSS en bloques `selector { cuerpo }` de primer nivel (respeta llaves anidadas de @media). */
function bloques(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    // at-rules sin cuerpo (`@import ...;`, `@charset ...;`): se saltan hasta el `;`
    if (s[i] === '@') {
      const pc = s.indexOf(';', i);
      const ll = s.indexOf('{', i);
      if (pc >= 0 && (ll < 0 || pc < ll)) { i = pc + 1; continue; }
    }
    const j = s.indexOf('{', i);
    if (j < 0) break;
    let d = 1;
    let k = j + 1;
    while (d > 0 && k < s.length) {
      if (s[k] === '{') d++;
      else if (s[k] === '}') d--;
      k++;
    }
    out.push([norm(s.slice(i, j)), s.slice(j + 1, k - 1)]);
    i = k;
  }
  return out;
}

/** Divide una lista de selectores por comas de nivel 0 (respeta :is(a, b) y [attr="a,b"]). */
function dividir(sel) {
  const out = [];
  let d = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(' || ch === '[') d++;
    else if (ch === ')' || ch === ']') d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** Declaraciones `prop: valor` de un cuerpo (sin anidamiento; el CSS del repo no usa nesting). */
function declaraciones(cuerpo) {
  const out = new Map();
  for (const trozo of cuerpo.split(';')) {
    const i = trozo.indexOf(':');
    if (i < 0) continue;
    const prop = trozo.slice(0, i).trim().toLowerCase();
    const valor = norm(trozo.slice(i + 1).replace(/!important/i, ' !important'));
    if (prop && valor && !prop.includes('{')) out.set(prop, valor);
  }
  return out;
}

/** Aplana el CSS a reglas `{ contexto, selector, decls }`. `contexto` = cadena de @media/@supports que la envuelve. */
export function extraerReglas(css, contexto = '') {
  const reglas = [];
  for (const [sel, cuerpo] of bloques(sinComentarios(css))) {
    if (/^@media|^@supports|^@layer/.test(sel)) { reglas.push(...extraerReglas(cuerpo, `${contexto}${sel} `)); continue; }
    if (/^@/.test(sel)) continue; // @keyframes, @font-face, @property...
    const decls = declaraciones(cuerpo);
    for (const s of dividir(sel)) reglas.push({ contexto, selector: norm(s), decls });
  }
  return reglas;
}

/** Quita el prefijo de ámbito de v2 para que `[data-ui="v2"] .x` y `.x` sean el mismo nombre. */
const sinAmbito = (sel) => norm(sel.replace(/\[data-ui=["']?v2["']?\]\s*/g, ''));

/** Propiedades cuya diferencia entre dos hojas rompe el layout (el resto, p. ej. `color`, suele ser un tema legítimo). */
const PROPS_LAYOUT = new Set([
  'display', 'position', 'height', 'min-height', 'max-height', 'width', 'min-width', 'max-width',
  'flex', 'flex-direction', 'flex-wrap', 'flex-basis', 'flex-grow', 'flex-shrink', 'grid-template-columns',
  'grid-template-rows', 'grid-column', 'grid-row', 'gap', 'row-gap', 'column-gap', 'padding', 'margin',
  'overflow', 'overflow-x', 'overflow-y', 'align-items', 'justify-content', 'inset', 'top', 'right', 'bottom', 'left',
]);

/**
 * Selectores definidos en MÁS DE UNA hoja con valores distintos de una propiedad de layout.
 * @param {Array<{ruta:string, css:string}>} archivos
 * @returns {Array<{clave:string, propiedad:string, valores:Array<{ruta:string,valor:string}>}>}
 *   `clave` = «contexto|selector» (estable: es la que usa la base que solo baja).
 */
export function colisionesDeClases(archivos) {
  /** clave → ruta → prop → valor (la última declaración de la hoja gana, como en cascada dentro de una hoja) */
  const mapa = new Map();
  for (const { ruta, css } of archivos) {
    for (const r of extraerReglas(css)) {
      // Solo selectores con alguna clase: los de elemento/atributo puro no son "nombres" que dos equipos puedan chocar.
      if (!/\.[a-zA-Z_-]/.test(r.selector)) continue;
      if (/^:root|^html/.test(r.selector)) continue;
      const clave = `${r.contexto.trim()}|${sinAmbito(r.selector)}`;
      const porRuta = mapa.get(clave) ?? new Map();
      const props = porRuta.get(ruta) ?? new Map();
      for (const [p, v] of r.decls) if (PROPS_LAYOUT.has(p)) props.set(p, v);
      porRuta.set(ruta, props);
      mapa.set(clave, porRuta);
    }
  }
  const salida = [];
  for (const [clave, porRuta] of mapa) {
    if (porRuta.size < 2) continue;
    const porProp = new Map();
    for (const [ruta, props] of porRuta) {
      for (const [p, v] of props) {
        const l = porProp.get(p) ?? [];
        l.push({ ruta, valor: v });
        porProp.set(p, l);
      }
    }
    for (const [propiedad, valores] of porProp) {
      if (valores.length >= 2 && new Set(valores.map((x) => x.valor)).size > 1) salida.push({ clave, propiedad, valores });
    }
  }
  return salida.sort((a, b) => (a.clave + a.propiedad).localeCompare(b.clave + b.propiedad));
}

/** `height: 100vh` (y variantes dvh/svh/lvh) declarado — NO min-height ni max-height. */
export function alturasAViewport(archivos) {
  const salida = [];
  for (const { ruta, css } of archivos) {
    for (const r of extraerReglas(css)) {
      const h = r.decls.get('height');
      if (h && /^100(d|s|l)?vh\b/.test(h)) salida.push(`${ruta}::${r.contexto.trim()}|${sinAmbito(r.selector)}`);
    }
  }
  return [...new Set(salida)].sort();
}

/** Medida del DOM: {scrollWidth, innerWidth}. Tolera 1 px de redondeo. */
export function evaluarDesborde({ scrollWidth, innerWidth }, tolerancia = 1) {
  const exceso = scrollWidth - innerWidth;
  return exceso > tolerancia ? [`scroll horizontal de página: scrollWidth ${scrollWidth} > ancho ${innerWidth} (+${exceso})`] : [];
}

/** Medida del DOM: textos de los <h1> visibles. Exactamente uno. */
export function evaluarH1(titulos) {
  if (titulos.length === 1) return [];
  return [titulos.length === 0 ? 'la página no tiene <h1> visible' : `hay ${titulos.length} <h1> visibles (${titulos.map((t) => `«${t}»`).join(', ')})`];
}

/**
 * Cajas de títulos {texto, x, y, w, h}. Falla si dos se solapan (>2 px en ambos ejes) o si un título de varias palabras
 * mide menos de 4 caracteres de ancho por línea (el síntoma «una palabra por línea» de la ronda 2).
 */
export function evaluarTitulosEncimados(cajas, { pxPorCaracter = 6 } = {}) {
  const fallos = [];
  for (let i = 0; i < cajas.length; i++) {
    const a = cajas[i];
    const palabras = a.texto.trim().split(/\s+/).filter(Boolean);
    if (palabras.length >= 3 && a.h > 0) {
      const lineas = Math.max(1, Math.round(a.h / 18));
      if (lineas >= palabras.length) fallos.push(`título «${a.texto}» con una palabra por línea (${lineas} líneas para ${palabras.length} palabras)`);
    }
    if (a.w > 0 && a.w < pxPorCaracter * 4 && palabras.length > 1) fallos.push(`título «${a.texto}» triturado: ${a.w} px de ancho`);
    for (let j = i + 1; j < cajas.length; j++) {
      const b = cajas[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 2 && oy > 2) fallos.push(`«${a.texto}» se encima con «${b.texto}» (${Math.round(ox)}×${Math.round(oy)} px)`);
    }
  }
  return fallos;
}
