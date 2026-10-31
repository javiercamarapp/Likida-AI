/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo (o UI2_CSS_DIR para la prueba de rojo) */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from './navegador_prueba';

// COMPORTAMIENTO REAL (Chromium) de la ronda B4: InfoTip (ⓘ) con explicación unificada, Tarjeta, PanelLateral,
// BarraFiltros, color de marca, Esc dentro de un panel, conteo de KPI y entradas escalonadas.
const RAIZ = __dirname;
const DIR = process.env.UI2_CSS_DIR ?? RAIZ;
const imp = (r: string) => join(RAIZ, r).replace(/\\/g, '/');
const ENTRADA = `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Tarjeta, BarraFiltros, PanelLateral, Popover, Boton, InfoTip } from '${imp('componentes/index')}';
import { TiraKpi } from '${imp('graficas/index')}';
function Interior() {
  const [p, setP] = useState(false);
  const ancla = useRef(null);
  return (<><button id="p-abre" ref={ancla} onClick={() => setP((v) => !v)}>Opciones</button>
    <Popover abierto={p} onCerrar={() => setP(false)} ancla={ancla} etiqueta="Opciones"><button id="p-item" role="menuitem">Uno</button></Popover></>);
}
function App() {
  const [q, setQ] = useState('');
  const [chips, setChips] = useState(['Hoy','7 días','30 días','Mes','Trimestre','Año','Cuadradas','Con diferencias','Por firmar','Peajes','Diésel','Casetas'].map((e, i) => ({ id: 'c' + i, etiqueta: e, activo: i === 1 })));
  const [panel, setPanel] = useState(0);
  return (
    <div data-ui="v2" className="tema-neutro" style={{ background: 'var(--bg)', color: 'var(--ink)', padding: 16, font: '400 13px/1.5 system-ui, sans-serif' }}>
      <div id="scroll" style={{ height: 500, overflowY: 'auto' }}>
        <BarraFiltros busqueda={{ valor: q, onCambio: setQ, placeholder: 'Buscar folio' }} chips={chips} onChip={(id) => setChips(chips.map((c) => c.id === id ? { ...c, activo: !c.activo } : c))} avanzados={<><label>Operador<select><option>Todos</option></select></label><label>Patio<select><option>Todos</option></select></label></>} nAvanzados={1} fuentes="Fuentes 5 de 7" />
        <div className="rv-escalona" id="esc" style={{ display: 'grid', gap: 12, paddingTop: 12 }}>
          <Tarjeta titulo="Diferencias vs recuperado" info="resumen.diferencias_recuperado" acciones={<Boton tamano="sm">Exportar</Boton>}><p>Contenido uno</p></Tarjeta>
          <Tarjeta titulo="Por firmar" info="resumen.por_firmar"><p>Contenido dos</p></Tarjeta>
          <Tarjeta titulo="Peajes" info="resumen.peajes_periodo" estado="vacio" mensaje="Sin cruces en el periodo" />
          <Tarjeta titulo="A tiempo" info="resumen.a_tiempo" estado="error" onReintentar={() => { window.__reint = (window.__reint || 0) + 1; }} />
          <TiraKpi etiqueta="KPI" items={[{ etiqueta: 'Viajes', valor: 1250, conteo: true, info: 'resumen.carta_porte_completas', metrica: 'volumen_viajes' }]} />
          <div style={{ height: 900 }}>relleno</div>
        </div>
      </div>
      <Boton variante="primary" id="prim">Guardar</Boton>
      <Boton id="abre-320" onClick={() => setPanel(320)}>P320</Boton>
      <Boton id="abre-420" onClick={() => setPanel(420)}>P420</Boton>
      <Boton id="abre-560" onClick={() => setPanel(560)}>P560</Boton>
      <PanelLateral abierto={panel !== 0} ancho={panel || 420} onCerrar={() => setPanel(0)} titulo="Detalle"><Interior /></PanelLateral>
    </div>
  );
}
createRoot(document.getElementById('raiz')).render(<App />);
`;
let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(RAIZ, `.entrada_b4_${process.pid}.tmp.tsx`);
  const enlace = join(RAIZ, `.enlace_b4_${process.pid}.tmp.tsx`); // next/link no vive fuera de Next: un <a> equivalente para el navegador de prueba
  writeFileSync(entrada, ENTRADA);
  writeFileSync(enlace, "import React from 'react'; export default function Link({ href, children, ...r }: { href: string; children?: React.ReactNode }) { return <a href={href} {...r}>{children}</a>; }");
  try {
    const r = await build({ configFile: false, logLevel: 'silent', root: RAIZ, define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
      resolve: { alias: [{ find: /^next\/link$/, replacement: enlace }, { find: /^@\//, replacement: join(RAIZ, '../../') + '/' }] },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } } });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); rmSync(enlace, { force: true }); }
  browser = await lanzarNavegador();
}, 90_000);
afterAll(async () => { await browser?.close(); });

const css = () => ['tokens.css', 'movimiento.css', 'componentes.css', 'graficas.css'].map((f) => readFileSync(join(f === 'tokens.css' ? RAIZ : DIR, f), 'utf8')).join('\n');
async function abrir(ancho = 1440, opts: { animar?: boolean; reduce?: boolean; oscuro?: boolean } = {}): Promise<Page> {
  // Por omisión SIN animación (medidas estables); las pruebas de movimiento piden `animar`.
  const p = await browser!.newPage({ viewport: { width: ancho, height: 900 }, reducedMotion: opts.animar && !opts.reduce ? 'no-preference' : 'reduce' });
  await p.setContent(`<!doctype html><html data-theme="${opts.oscuro ? 'dark' : 'light'}"><head><style>*{box-sizing:border-box}${css()}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('#prim');
  return p;
}
const rgb = (s: string) => (s.match(/\d+\.?\d*/g) ?? []).slice(0, 3).map(Number);
const lum = ([r, g, b]: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe.skipIf(SIN_NAVEGADOR)('B4 · InfoTip (ⓘ)', () => {
  it('abre un popover ≤280 px con sus bloques (y «Por confirmar» cuando no hay lector verificado), aria-describedby y aria-expanded; Esc cierra y devuelve el foco', async () => {
    const p = await abrir();
    const boton = p.locator('.rv-info').first();
    await boton.click();
    const r = await p.evaluate(() => {
      const pop = document.querySelector('.rv-pop--info')!;
      const b = document.querySelector('.rv-info')!;
      return {
        w: Math.round(pop.getBoundingClientRect().width),
        dts: [...pop.querySelectorAll('dt')].map((d) => d.textContent),
        font: parseFloat(getComputedStyle(pop.querySelector('dd')!).fontSize),
        desc: b.getAttribute('aria-describedby') === pop.id,
        exp: b.getAttribute('aria-expanded'),
        btn: Math.round(b.getBoundingClientRect().width),
      };
    });
    expect(r.w).toBeLessThanOrEqual(280);
    expect(r.dts).toEqual(['Qué es', 'Cómo se calcula', 'Fuente y corte', 'Estado']); // «Qué hacer» es opcional; «Estado» marca lo por confirmar
    expect(r.font).toBeGreaterThanOrEqual(12);
    expect(r.desc).toBe(true);
    expect(r.exp).toBe('true');
    expect(r.btn).toBeGreaterThanOrEqual(20);
    expect(r.btn).toBeLessThanOrEqual(24);
    await p.keyboard.press('Escape');
    expect(await p.locator('.rv-pop--info').count()).toBe(0);
    expect(await p.evaluate(() => document.activeElement?.classList.contains('rv-info'))).toBe(true);
    await p.close();
  });
  it('Tab desde el ⓘ cierra la explicación (el foco nunca entra al panel)', async () => {
    const p = await abrir();
    await p.locator('.rv-info').first().focus();
    await p.keyboard.press('Enter');
    expect(await p.locator('.rv-pop--info').count()).toBe(1);
    await p.keyboard.press('Tab');
    expect(await p.locator('.rv-pop--info').count()).toBe(0);
    await p.close();
  });
  it('un solo ⓘ abierto a la vez', async () => {
    const p = await abrir();
    await p.locator('.rv-info').nth(0).click();
    // clic programático (sin mover el foco ni depender de lo que tape el primer panel): el almacén cierra el anterior
    await p.evaluate(() => (document.querySelectorAll('.rv-info')[1] as HTMLElement).click());
    expect(await p.locator('.rv-pop--info').count()).toBe(1);
    expect(await p.evaluate(() => document.querySelectorAll('.rv-info[aria-expanded="true"]').length)).toBe(1);
    await p.close();
  });
  it('390: la explicación se abre como hoja inferior con los mismos 4 bloques', async () => {
    const p = await abrir(390);
    await p.locator('.rv-info').first().click();
    const r = await p.evaluate(() => { const d = document.querySelector('dialog[open]')!; const pn = d.querySelector('.rv-ov__panel')!.getBoundingClientRect(); return { dts: [...d.querySelectorAll('dt')].map((x) => x.textContent), pie: Math.round(innerHeight - pn.bottom), alto: pn.height }; });
    expect(r.dts).toEqual(['Qué es', 'Cómo se calcula', 'Fuente y corte', 'Estado']);
    expect(r.pie).toBe(0);
    expect(r.alto).toBeLessThanOrEqual(900 * 0.9 + 1);
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('B4 · Tarjeta unificada', () => {
  it('la ⓘ queda en el mismo sitio en todas las tarjetas, radio 12, padding 12, y los estados vacío / error son una línea', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const tarjetas = [...document.querySelectorAll('.rv-tarjeta')] as HTMLElement[];
      const pos = tarjetas.map((t) => { const i = t.querySelector('.rv-info')!.getBoundingClientRect(); const c = t.getBoundingClientRect(); return { arriba: Math.round(i.top - c.top), derecha: Math.round(c.right - i.right), alto: Math.round(i.height) }; });
      const cs = getComputedStyle(tarjetas[0]);
      return { pos, radio: cs.borderTopLeftRadius, pad: cs.paddingTop, vacio: document.querySelector('.rv-tarjeta .rv-vacio')!.getBoundingClientRect().height, errRol: document.querySelector('.rv-tarjeta__error')!.getAttribute('role'), errAlto: document.querySelector('.rv-tarjeta__error')!.getBoundingClientRect().height };
    });
    expect(new Set(r.pos.map((x) => x.arriba)).size, JSON.stringify(r.pos)).toBe(1);
    expect(new Set(r.pos.map((x) => x.derecha)).size, 'la ⓘ va SIEMPRE en la esquina derecha: ' + JSON.stringify(r.pos)).toBe(1);
    expect(r.radio).toBe('12px');
    expect(r.pad).toBe('12px');
    expect(r.vacio).toBeLessThanOrEqual(44);
    expect(r.errRol).toBe('alert');
    expect(r.errAlto).toBeLessThanOrEqual(44);
    await p.getByRole('button', { name: 'Reintentar' }).click();
    expect(await p.evaluate(() => (window as unknown as { __reint: number }).__reint)).toBe(1);
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('B4 · PanelLateral', () => {
  for (const ancho of [320, 420, 560]) {
    it(`ancho ${ancho} en escritorio`, async () => {
      const p = await abrir();
      await p.click(`#abre-${ancho}`);
      expect(await p.evaluate(() => Math.round(document.querySelector('dialog[open] .rv-ov__panel')!.getBoundingClientRect().width))).toBe(ancho);
      await p.close();
    });
  }
  it('390: hoja inferior', async () => {
    const p = await abrir(390);
    await p.click('#abre-420');
    const r = await p.evaluate(() => { const b = document.querySelector('dialog[open] .rv-ov__panel')!.getBoundingClientRect(); return { w: Math.round(b.width), pie: Math.round(innerHeight - b.bottom) }; });
    expect(r).toEqual({ w: 390, pie: 0 });
    await p.close();
  });
  it('Esc dentro del panel con un popover abierto cierra SOLO el popover; un segundo Esc cierra el panel', async () => {
    const p = await abrir();
    await p.click('#abre-420');
    await p.click('#p-abre');
    expect(await p.locator('.rv-pop').count()).toBe(1);
    expect(await p.evaluate(() => document.getElementById('p-abre')!.getAttribute('aria-expanded'))).toBe('true');
    expect(await p.evaluate(() => document.getElementById('p-abre')!.getAttribute('aria-haspopup'))).toBe('true');
    await p.keyboard.press('Escape');
    expect(await p.locator('.rv-pop').count()).toBe(0);
    expect(await p.evaluate(() => document.querySelector('dialog')!.hasAttribute('open'))).toBe(true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog')!.hasAttribute('open'));
    await p.close();
  });
  it('Tab fuera del popover lo cierra', async () => {
    const p = await abrir();
    await p.click('#abre-420');
    await p.click('#p-abre');
    await p.keyboard.press('Tab'); // del ítem al botón de cierre del panel: sale del popover
    await p.keyboard.press('Tab');
    expect(await p.locator('.rv-pop').count()).toBe(0);
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('B4 · BarraFiltros', () => {
  for (const ancho of [1440, 390]) {
    it(`${ancho}: UNA fila de ≤ 48 px (no apila filtros)`, async () => {
      const p = await abrir(ancho);
      const r = await p.evaluate(() => {
        const b = document.querySelector('.rv-filtros')!;
        const hijos = [...b.querySelectorAll('input, .rv-filtros__chips, .rv-filtros__derecha .rv-btn')].map((e) => Math.round(e.getBoundingClientRect().top));
        const chips = document.querySelector('.rv-filtros__chips') as HTMLElement;
        return { alto: b.getBoundingClientRect().height, tops: hijos, desplaza: chips.scrollWidth > chips.clientWidth };
      });
      expect(r.alto).toBeLessThanOrEqual(48);
      expect(Math.max(...r.tops) - Math.min(...r.tops)).toBeLessThanOrEqual(8);
      if (ancho === 390) expect(r.desplaza).toBe(true); // los chips se desplazan en horizontal, no se apilan
      await p.close();
    });
  }
  it('1440: «Filtros» abre los avanzados en un popover (no empuja el contenido) y el chip activo es gris suave', async () => {
    const p = await abrir();
    const antes = await p.evaluate(() => document.querySelector('#esc')!.getBoundingClientRect().top);
    await p.getByRole('button', { name: /Filtros/ }).click();
    const r = await p.evaluate(() => ({ pop: !!document.querySelector('.rv-pop select'), despues: document.querySelector('#esc')!.getBoundingClientRect().top, activo: getComputedStyle(document.querySelector('.rv-chip[aria-pressed="true"]')!).backgroundColor }));
    expect(r.pop).toBe(true);
    expect(r.despues).toBe(antes);
    expect(rgb(r.activo)).toEqual([226, 226, 226]); // --soft-8 #e2e2e2
    await p.close();
  });
  it('390: «Filtros» abre una hoja inferior', async () => {
    const p = await abrir(390);
    await p.getByRole('button', { name: /Filtros/ }).click();
    expect(await p.evaluate(() => !!document.querySelector('dialog[open] select'))).toBe(true);
    await p.close();
  });
  it('es sticky: al hacer scroll queda pegada arriba', async () => {
    const p = await abrir();
    await p.evaluate(() => { document.getElementById('scroll')!.scrollTop = 300; });
    const r = await p.evaluate(() => ({ barra: document.querySelector('.rv-filtros')!.getBoundingClientRect().top, cont: document.getElementById('scroll')!.getBoundingClientRect().top }));
    expect(Math.round(r.barra)).toBe(Math.round(r.cont));
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('B4 · chip activo (los tokens de marca son del shell)', () => {
  it('claro: gris suave con texto de tinta (AA), nunca un bloque sólido', async () => {
    const p = await abrir();
    const c = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.rv-chip[aria-pressed="true"]')!); return { bg: s.backgroundColor, fg: s.color }; });
    expect(rgb(c.bg)).toEqual([226, 226, 226]);
    expect(rgb(c.fg)).toEqual([14, 14, 16]);
    expect(ratio(rgb(c.bg), rgb(c.fg))).toBeGreaterThanOrEqual(4.5);
    await p.close();
  });
  it('oscuro: fondo gris oscuro con texto claro (AA)', async () => {
    const p = await abrir(1440, { oscuro: true });
    const c = await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.rv-chip[aria-pressed="true"]')!); return { bg: s.backgroundColor, fg: s.color }; });
    expect(rgb(c.bg)).toEqual([50, 50, 52]); // --soft-8 oscuro #323234
    expect(ratio(rgb(c.bg), rgb(c.fg))).toBeGreaterThanOrEqual(4.5);
    await p.close();
  });
  it('esta capa NO redefine los tokens de marca del shell (--btn-*, --chart-8)', async () => {
    const css = readFileSync(join(DIR, 'componentes.css'), 'utf8');
    for (const t of ['--btn-bg:', '--btn-fg:', '--btn-borde:', '--btn-hover:', '--chart-8:']) expect(css.includes(t), t).toBe(false);
  });
});

describe.skipIf(SIN_NAVEGADOR)('B4 · movimiento', () => {
  it('conteo de KPI: arranca cerca (nunca en 0), termina en el valor y con reduced-motion no se mueve', async () => {
    const p = await abrir(1440, { animar: true });
    const muestras: string[] = [];
    for (let i = 0; i < 6; i++) { muestras.push(await p.evaluate(() => document.querySelector('.rv-kpi__valor')!.textContent!)); await p.waitForTimeout(90); }
    const n = muestras.map((m) => Number(m.replace(/[^0-9.]/g, '')));
    expect(n.every((v) => v > 0)).toBe(true);
    expect(n.some((v) => v < 1250)).toBe(true);
    expect(n[n.length - 1]).toBe(1250);
    await p.close();
    const q = await abrir(1440, { reduce: true });
    const fijas = new Set<string>();
    for (let i = 0; i < 4; i++) { fijas.add(await q.evaluate(() => document.querySelector('.rv-kpi__valor')!.textContent!)); await q.waitForTimeout(80); }
    expect([...fijas]).toEqual(['1,250']);
    await q.close();
  });
  it('entradas escalonadas: el retardo crece por hijo; con reduced-motion no hay animación', async () => {
    const p = await abrir(1440, { animar: true });
    const r = await p.evaluate(() => [...document.querySelectorAll('#esc > *')].slice(0, 4).map((e) => ({ d: getComputedStyle(e).animationDelay, n: getComputedStyle(e).animationName, t: getComputedStyle(e).animationDuration })));
    expect(r.map((x) => x.d)).toEqual(['0s', '0.04s', '0.08s', '0.12s']);
    expect(r[0].n).toBe('rv-sube');
    expect(r[0].t).toBe('0.22s');
    await p.close();
    const q = await abrir(1440, { reduce: true });
    expect(await q.evaluate(() => getComputedStyle(document.querySelector('#esc > *')!).animationName)).toBe('none');
    await q.close();
  });
});

// Capturas reales (claro/oscuro × 1440/390) de ⓘ abierta, panel lateral y barra de filtros. Solo con UI2_B4_CAPS=<carpeta>.
const CAPS = process.env.UI2_B4_CAPS;
describe.skipIf(!CAPS)('B4 · capturas', () => {
  for (const oscuro of [false, true]) {
    for (const ancho of [1440, 390]) {
      it(`${oscuro ? 'oscuro' : 'claro'} ${ancho}`, async () => {
        const nombre = `${CAPS}/b4-${oscuro ? 'oscuro' : 'claro'}-${ancho}`;
        const p = await abrir(ancho, { oscuro, reduce: true });
        await p.screenshot({ path: `${nombre}-barra-y-tarjetas.png` });
        await p.locator('.rv-info').first().click();
        await p.screenshot({ path: `${nombre}-info-abierta.png` });
        await p.keyboard.press('Escape');
        if (ancho === 1440) { await p.getByRole('button', { name: /Filtros/ }).click(); await p.screenshot({ path: `${nombre}-filtros.png` }); await p.keyboard.press('Escape'); }
        await p.click('#abre-420');
        await p.screenshot({ path: `${nombre}-panel.png` });
        await p.close();
      });
    }
  }
});
