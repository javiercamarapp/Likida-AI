/* eslint-disable security/detect-non-literal-fs-filename -- recorre el árbol del repo con rutas propias */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_CONTROLES, BASE_SIN_ALTURA, type ConteoControles } from './controles_gruesos_base';
import { botonesCrudos, clasesGruesas, constantesDuplicadas, controlesSinAltura, hoverHuerfano } from './controles_gruesos_medir';
import { EXCEPCIONES } from './controles_excepciones';

// ═══════════════════════════════════════════════════════════════════════════
// GUARDA ANTI-GORDURA (K1, SPEC-CONTROLES-FINOS §4.1.1). Mismo patrón de trinquete que iconos_trazo.test.ts: la base solo BAJA.
//   R1  <button> crudo (sin clase rv-, sin clasesBoton( ) fuera de las primitivas y de las excepciones.
//   R2  clases gruesas de Tailwind en etiquetas de control (h-9…, py-2.5…, rounded-xl…, border-2, shadow-md…, text-base…).
//   R3  constantes de estilo duplicadas (CAMPO, CSS_BOTON, CSS_INPUT, BTN_*…).
//   R4  CSS del kit: ningún control crece por encima de 36 px a escritorio; --btn-h no pasa de 32.
// Alcance: dashboard, ui-v2, vendedor y admin (admin solo como trinquete: K3 lo baja). Al migrar un archivo se borra su línea de
// `controles_gruesos_base.ts`; si ya está limpio y sigue listado, también falla. Regenerar la base (solo para BAJARLA):
//   GENERAR_BASE_CONTROLES=1 npx vitest run src/app/ui-v2/controles_gruesos_guarda.test.ts
// ═══════════════════════════════════════════════════════════════════════════

const SRC = join(process.cwd(), 'src');
const ALCANCE = ['app/dashboard', 'app/ui-v2', 'app/vendedor', 'app/admin'];

function tsx(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const r = join(dir, n);
    if (statSync(r).isDirectory()) { if (n !== 'node_modules' && n !== '__fixtures__') tsx(r, salida); continue; }
    if (n.endsWith('.tsx') && !/\.test\.|harness|\.tmp\./.test(n)) salida.push(r);
  }
  return salida;
}
const excepcion = (ruta: string) => Object.keys(EXCEPCIONES).find((k) => (k.endsWith('/') ? ruta.startsWith(k) : ruta === k));

const medidas = new Map<string, ConteoControles>();
for (const a of ALCANCE) {
  for (const f of tsx(join(SRC, a))) {
    const ruta = relative(SRC, f);
    const ex = excepcion(ruta);
    if (ex && EXCEPCIONES[ex].R1 === undefined && EXCEPCIONES[ex].R2 === undefined && EXCEPCIONES[ex].R3 === undefined) continue; // excepción total (primitivas, gráficas)
    const src = readFileSync(f, 'utf8');
    const c: ConteoControles = { R1: botonesCrudos(src), R2: clasesGruesas(src), R3: constantesDuplicadas(src) };
    if (c.R1 + c.R2 + c.R3 > 0) medidas.set(ruta, c);
  }
}

if (process.env.GENERAR_BASE_CONTROLES) {
  const filas = [...medidas.entries()].filter(([r]) => !excepcion(r)).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  '${k}': { R1: ${v.R1}, R2: ${v.R2}, R3: ${v.R3} },`);
  writeFileSync(join(SRC, 'app/ui-v2/controles_gruesos_base.ts'),
`// Base del trinquete de controles_gruesos_guarda.test.ts: archivos con controles gruesos, con su tope por regla (R1 botones crudos,
// R2 clases gruesas, R3 constantes duplicadas). Solo puede BAJAR: al migrar un archivo se borra su línea. Un archivo nuevo no entra aquí.
export interface ConteoControles { R1: number; R2: number; R3: number }
export const BASE_CONTROLES: Record<string, ConteoControles> = {
${filas.join('\n')}
};
`);
}

describe('controles gruesos: el detector ve lo que debe', () => {
  it('R1 cuenta botones sin clase del kit', () => {
    expect(botonesCrudos('<button type="button" className="h-9 px-3">x</button>')).toBe(1);
    expect(botonesCrudos('<button className="rv-btn">x</button><button className={clasesBoton(\'primary\')}>y</button>')).toBe(0);
  });
  it('R2 cuenta clases gruesas solo en etiquetas de control', () => {
    expect(clasesGruesas('<input className="h-9 rounded-xl" />')).toBe(2);
    expect(clasesGruesas('<div className="h-9 rounded-xl" />')).toBe(0);
    expect(clasesGruesas('<button className="rv-btn rounded-full">x</button>')).toBe(1);
    expect(clasesGruesas('<span className="rounded-full" />')).toBe(0);
  });
  it('R3 cuenta constantes de estilo duplicadas', () => {
    expect(constantesDuplicadas('const CAMPO = "h-9";\nconst CSS_BOTON = `x`;\nconst OTRA = 1;')).toBe(2);
  });
});

describe('controles gruesos: trinquete (la base solo baja)', () => {
  it('ningún archivo supera su tope y los archivos nuevos entran limpios', () => {
    const fallos: string[] = [];
    for (const [ruta, c] of medidas) {
      const ex = excepcion(ruta);
      const t = ex ? EXCEPCIONES[ex] : undefined;
      const b = t ? { R1: t.R1 ?? 0, R2: t.R2 ?? 0, R3: t.R3 ?? 0 } : BASE_CONTROLES[ruta] ?? { R1: 0, R2: 0, R3: 0 };
      for (const k of ['R1', 'R2', 'R3'] as const) if (c[k] > b[k]) fallos.push(`${ruta}: ${k} = ${c[k]} (tope ${b[k]})`);
    }
    expect(fallos).toEqual([]);
  });
  it('un archivo ya limpio sale de la base (obliga a borrar su línea)', () => {
    const limpios = Object.keys(BASE_CONTROLES).filter((r) => !medidas.has(r));
    expect(limpios).toEqual([]);
    // una excepción con tope también debe seguir usándose (si el archivo quedó limpio, se borra de la lista)
    expect(Object.entries(EXCEPCIONES).filter(([k, e]) => !k.endsWith('/') && (e.R1 ?? e.R2 ?? e.R3) !== undefined && !medidas.has(k)).map(([k]) => k)).toEqual([]);
  });
  it('las excepciones llevan razón', () => {
    for (const [k, e] of Object.entries(EXCEPCIONES)) expect(e.razon.length, k).toBeGreaterThan(15);
  });
});

// ── R5/R6: `hover:` huérfano y controles sin altura ───────────────────────────────────────────────────────────────────
const sinAltura = new Map<string, number>();
const huerfanos: string[] = [];
for (const a of ALCANCE) {
  for (const f of tsx(join(SRC, a))) {
    const ruta = relative(SRC, f);
    const src = readFileSync(f, 'utf8');
    if (hoverHuerfano(src) > 0) huerfanos.push(ruta);
    if (ruta.startsWith('app/admin/') && !excepcion(ruta)) { const n = controlesSinAltura(src); if (n > 0) sinAltura.set(ruta, n); }
  }
}
describe('R5/R6 · hover huérfano y controles sin altura', () => {
  it('el detector ve lo que debe', () => {
    expect(hoverHuerfano('className="card transition-shadow hover:"')).toBe(1);
    expect(hoverHuerfano('className="md:hover: p-2"')).toBe(1);
    expect(hoverHuerfano('className="hover:opacity-70 hover:bg-[var(--x)]"')).toBe(0);
    expect(controlesSinAltura('<button type="submit" className="px-4 rounded-lg">x</button>')).toBe(1);
    expect(controlesSinAltura('<button className="h-8 px-4">x</button><button className="rv-btn">y</button><button className="w-8 h-8">z</button>')).toBe(0);
    expect(controlesSinAltura('<Link href="/x" className="relative w-9 rounded-lg hairline">x</Link>')).toBe(1);
    expect(controlesSinAltura('<Link href="/x" className="relative h-8 w-8 rounded-lg">x</Link>')).toBe(0);
  });
  it('ningún archivo trae `hover:` sin utilidad detrás', () => {
    expect(huerfanos).toEqual([]);
  });
  it('en /admin ningún botón ni enlace-botón nuevo queda sin altura (la base solo baja)', () => {
    const fallos: string[] = [];
    for (const [ruta, n] of sinAltura) if (n > (BASE_SIN_ALTURA[ruta] ?? 0)) fallos.push(`${ruta}: sin altura = ${n} (tope ${BASE_SIN_ALTURA[ruta] ?? 0})`);
    expect(fallos).toEqual([]);
    expect(Object.keys(BASE_SIN_ALTURA).filter((r) => !sinAltura.has(r))).toEqual([]);
  });
});

// ── R4: el CSS del kit no engorda ────────────────────────────────────────────────────────────────────────────────────────
function sinMovil(css: string): string {
  // quita los bloques @media (max-width: 819px) { … } con emparejamiento de llaves
  let out = '', i = 0;
  const re = /@media\s*\(max-width:\s*8(?:19|20)px\)\s*\{/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    out += css.slice(i, m.index);
    let d = 1, k = m.index + m[0].length;
    while (d > 0 && k < css.length) { if (css[k] === '{') d++; else if (css[k] === '}') d--; k++; }
    i = k; re.lastIndex = k;
  }
  return out + css.slice(i);
}
describe('R4 · el CSS del kit no engorda', () => {
  const css = (f: string) => readFileSync(join(SRC, 'app/ui-v2', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('ningún .rv-btn/.rv-fl/.rv-chip/.rv-seg/.rv-menu__item/.rv-item supera 36 px de alto a escritorio (fuera de ::after)', () => {
    const fallos: string[] = [];
    // shell.css queda fuera: el riel (40) y la hoja «Más» (44, área táctil) son medidas del marco que fija el spec (K2).
    for (const f of ['componentes.css', 'piezas.css', 'overlay.css']) {
      const c = sinMovil(css(f));
      for (const m of c.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
        const sel = m[1].trim();
        if (!/\.rv-(?:btn|fl|chip|seg|menu__item|item)\b/.test(sel) || /::after|::before/.test(sel)) continue;
        for (const h of m[2].matchAll(/(?:^|;|\s)(?:min-)?height:\s*(\d+)px/g)) if (Number(h[1]) > 36) fallos.push(`${f}: ${sel} → ${h[0].trim()}`);
      }
    }
    expect(fallos).toEqual([]);
  });
  it('--btn-h no pasa de 32 px', () => {
    const t = css('tokens.css');
    expect(t).toMatch(/--btn-h:\s*var\(--ctl-h\)/);
    expect(Number.parseInt(/--ctl-h:\s*(\d+)px/.exec(t)?.[1] ?? '99', 10)).toBeLessThanOrEqual(32);
  });
});
