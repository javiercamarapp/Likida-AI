/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from './navegador_prueba';

vi.setConfig({ testTimeout: 40_000 }); // Chromium bajo una Mac cargada

// COMPORTAMIENTO REAL (Chromium) de las gráficas interactivas del lote G: tooltip al pasar y con foco, flechas, tabla alterna, estados
// sin dato / parcial, reduced-motion = 0 animaciones, cinta táctil en 390 y ausencia de desborde. Monta React de verdad.
const ruta = (f: string) => join(__dirname, f).replace(/\\/g, '/');

const ENTRADA = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Columnas, AreaMini, DonaMini, BarList, ColumnasAgrupadas } from '${ruta('graficas')}';
const datos = [
  { etiqueta: '7 sep', valor: 4, largo: 'Semana del 7 sep' }, { etiqueta: '14 sep', valor: 8, largo: 'Semana del 14 sep' },
  { etiqueta: '21 sep', valor: null, largo: 'Semana del 21 sep' }, { etiqueta: '28 sep', valor: 6, largo: 'Semana del 28 sep' },
  { etiqueta: '5 oct', valor: 12, largo: 'Semana del 5 oct' }, { etiqueta: '12 oct', valor: 9, parcial: true, largo: 'Semana del 12 oct' },
];
createRoot(document.getElementById('raiz')).render(
  <div data-ui="v2" style={{ padding: 16, display: 'grid', gap: 24 }}>
    <section id="s-col" className="card" style={{ padding: 14, maxWidth: 640 }}><Columnas datos={datos} etiqueta="Cierres por semana" formato={(v) => v + ' cierres'} unidad="cierres" /></section>
    <section id="s-area" className="card" style={{ padding: 14, maxWidth: 640 }}><AreaMini matiz={5} valores={[3, 5, 4, 9, 7, 12]} etiquetas={['lun', 'mar', 'mié', 'jue', 'vie', 'sáb']} etiqueta="Respuestas por día" formato={(v) => v + ' resp.'} /></section>
    <section id="s-dona" className="card" style={{ padding: 14, maxWidth: 640 }}><DonaMini matiz={2} etiqueta="Rubros" gajos={[{ etiqueta: 'Diésel', valor: 91000 }, { etiqueta: 'Casetas', valor: 48200 }, { etiqueta: 'Viáticos', valor: 12000 }]} formato={(v) => '$' + v} /></section>
    <section id="s-bar" className="card" style={{ padding: 14, maxWidth: 640 }}><BarList etiqueta="Dónde pesa" matiz={6} items={[{ clave: 'a', etiqueta: 'Diésel fuera de política', valor: 9000, texto: '$9,000' }, { clave: 'b', etiqueta: 'Caseta sin comprobante', valor: 3000, texto: '$3,000' }, { clave: 'c', etiqueta: 'Sin dato', valor: null }]} /></section>
    <section id="s-agr" className="card" style={{ padding: 14, maxWidth: 640 }}><ColumnasAgrupadas etiqueta="Gasto semanal" categorias={['S1', 'S2', 'S3', 'S4']} parciales={[3]} series={[{ nombre: 'Diésel', valores: [100, 300, 200, 90] }, { nombre: 'Caseta', valores: [50, 80, 120, null] }]} formato={(v) => '$' + v} /></section>
  </div>,
);
`;

let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  const entrada = join(__dirname, `.entrada_lg_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({
      configFile: false, logLevel: 'silent', root: __dirname,
      resolve: { alias: { '@': join(__dirname, '../..'), 'next/link': join(__dirname, '__fixtures__/next-link-prueba.tsx'), 'next/navigation': join(__dirname, '__fixtures__/next-navigation-prueba.ts') } },
      define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } },
    });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280, opts: { reducido?: boolean; tactil?: boolean } = {}): Promise<Page> {
  const ctx = await browser!.newContext({ viewport: { width: ancho, height: 1500 }, reducedMotion: opts.reducido === false ? 'no-preference' : 'reduce', hasTouch: opts.tactil, isMobile: opts.tactil });
  const p = await ctx.newPage();
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css', 'graficas.css'].map((f) => readFileSync(join(__dirname, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('#s-col svg');
  await p.waitForTimeout(150); // ResizeObserver: ancho real
  return p;
}
const tip = (p: Page) => p.locator('.rv-pop--grafica');

describe.skipIf(SIN_NAVEGADOR)('gráficas interactivas · Chromium', () => {
  it('columnas: pasar el puntero abre el tooltip de ESA columna, dentro del viewport; salir lo cierra', async () => {
    const p = await abrir();
    const col = p.locator('#s-col [data-i="4"]');
    const caja = (await col.boundingBox())!;
    await p.mouse.move(caja.x + caja.width / 2, caja.y + 60);
    await expect.poll(() => tip(p).count()).toBe(1);
    const txt = await tip(p).innerText();
    expect(txt).toContain('Semana del 5 oct');
    expect(txt).toContain('12 cierres');
    expect(txt).toContain('+100.0 %'); // 28 sep (6) → 5 oct (12)
    expect(txt).toContain('contra 28 sep');
    const caja2 = (await tip(p).boundingBox())!;
    expect(caja2.x).toBeGreaterThanOrEqual(8);
    expect(caja2.x + caja2.width).toBeLessThanOrEqual(1280 - 8);
    await p.mouse.move(2, 2);
    await expect.poll(() => tip(p).count()).toBe(0);
    await p.close();
  });
  it('columnas: la variación se calcula contra el periodo anterior COMPLETO con dato (el null y el parcial no comparan)', async () => {
    const p = await abrir();
    await p.hover('#s-col [data-i="3"] .rv-colum__golpe'); // 28 sep = 6, el anterior (21 sep) no tiene dato
    expect(await tip(p).innerText()).not.toMatch(/[▲▼]/);
    await p.hover('#s-col [data-i="5"] .rv-colum__golpe'); // parcial: sin variación
    const t = await tip(p).innerText();
    expect(t).toContain('parcial');
    expect(t).toContain('Sin variación: periodo incompleto');
    await p.hover('#s-col [data-i="1"] .rv-colum__golpe'); // 14 sep = 8 contra 4 = +100 %
    expect(await tip(p).innerText()).toContain('+100.0 %');
    await p.close();
  });
  it('columnas: teclado. Tab entra en la última columna completa, las flechas recorren, Inicio/Fin saltan y Esc cierra', async () => {
    const p = await abrir();
    await p.focus('#s-col [data-i="4"]');
    expect(await tip(p).innerText()).toContain('Semana del 5 oct');
    await p.keyboard.press('ArrowLeft');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-i'))).toBe('3');
    expect(await tip(p).innerText()).toContain('Semana del 28 sep');
    await p.keyboard.press('Home');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-i'))).toBe('0');
    await p.keyboard.press('End');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('data-i'))).toBe('5');
    await p.keyboard.press('Escape');
    expect(await tip(p).count()).toBe(0);
    // un solo punto de tabulación dentro de la gráfica (roving)
    expect(await p.locator('#s-col [data-i][tabindex="0"]').count()).toBe(1);
    await p.close();
  });
  it('columnas: cada columna es una imagen con nombre y valor; la sin dato dice «sin datos», nunca 0', async () => {
    const p = await abrir();
    expect(await p.getAttribute('#s-col [data-i="1"]', 'aria-label')).toBe('Semana del 14 sep: 8 cierres');
    expect(await p.getAttribute('#s-col [data-i="2"]', 'aria-label')).toBe('Semana del 21 sep: sin datos');
    expect(await p.locator('#s-col [data-i="2"] .rv-colum__barra').count()).toBe(0);
    expect(await p.locator('#s-col [data-i="2"]').textContent()).toContain('s/d');
    const leyenda = await p.locator('#s-col .rv-leyenda-fina').innerText();
    expect(leyenda).toContain('trama = parcial');
    expect(leyenda).toContain('= sin datos');
    await p.close();
  });
  it('columnas: «Ver como tabla» abre una tabla con los MISMOS valores y «—» donde no hay dato', async () => {
    const p = await abrir();
    expect(await p.locator('#s-col .rv-tabla-grafica table').isVisible()).toBe(false);
    await p.click('#s-col summary');
    const filas = await p.locator('#s-col .rv-tabla-grafica tbody tr').allInnerTexts();
    expect(filas.map((f) => f.replace(/\s+/g, ' '))).toEqual([
      'Semana del 7 sep 4 cierres', 'Semana del 14 sep 8 cierres', 'Semana del 21 sep —', 'Semana del 28 sep 6 cierres', 'Semana del 5 oct 12 cierres', 'Semana del 12 oct (incompleto) 9 cierres',
    ]);
    expect(await p.getAttribute('#s-col .rv-tabla-grafica__caja', 'role')).toBe('region');
    await p.close();
  });
  it('columnas: eje de 3 marcas y etiquetas directas del máximo y del último completo', async () => {
    const p = await abrir();
    expect(await p.locator('#s-col .rv-gr__marca:not(.rv-gr__marca-x)').allTextContents()).toEqual(['0', '6', '12']);
    expect(await p.locator('#s-col .rv-gr__directa').allTextContents()).toEqual(['12']); // máximo = último completo (a <3 columnas): una sola
    await p.close();
  });
  it('área: ←/→ mueven el punto, el tooltip sigue, hay crosshair y Esc lo quita', async () => {
    const p = await abrir();
    await p.focus('#s-area svg');
    await p.keyboard.press('ArrowRight');
    expect(await p.locator('#s-area .rv-area__cruz').count()).toBe(1);
    expect(await tip(p).innerText()).toContain('lun');
    await p.keyboard.press('End');
    const t = await tip(p).innerText();
    expect(t).toContain('sáb');
    expect(t).toContain('12 resp.');
    expect(t).toContain('+71.4 %'); // 7 → 12
    await p.keyboard.press('Escape');
    expect(await p.locator('#s-area .rv-area__cruz').count()).toBe(0);
    expect(await tip(p).count()).toBe(0);
    await p.close();
  });
  it('área: el puntero sobre el plano elige el punto más cercano; trae tabla alterna', async () => {
    const p = await abrir();
    const c = (await p.locator('#s-area svg').boundingBox())!;
    await p.mouse.move(c.x + c.width - 20, c.y + 60);
    expect(await tip(p).innerText()).toContain('sáb');
    await p.click('#s-area summary');
    expect(await p.locator('#s-area tbody tr').count()).toBe(6);
    await p.close();
  });
  it('dona: la leyenda trae cifra exacta y porcentaje con un decimal; enfocar una fila resalta su gajo', async () => {
    const p = await abrir();
    const filas = await p.locator('#s-dona .rv-dona__leyenda li').allInnerTexts();
    expect(filas[0].replace(/\s+/g, ' ')).toContain('Diésel $91000 60.2%');
    await p.focus('#s-dona .rv-dona__leyenda li');
    expect(await p.locator('#s-dona .rv-dona__gajo[data-activo]').count()).toBe(1);
    expect(await p.locator('#s-dona .rv-dona[data-hay-activo]').count()).toBe(1);
    await p.close();
  });
  it('barlist: sin dato = pista con trama y «—», sin barra; la cifra exacta siempre impresa', async () => {
    const p = await abrir();
    expect(await p.locator('#s-bar .rv-barlist__fila').count()).toBe(3);
    expect(await p.locator('#s-bar .rv-barlist__relleno').count()).toBe(2);
    expect((await p.locator('#s-bar .rv-barlist__fila').nth(2).innerText()).replace(/\s+/g, ' ')).toBe('Sin dato —');
    expect(await p.locator('#s-bar .rv-barlist__relleno').first().getAttribute('width')).toBe('100.00%');
    expect(await p.locator('#s-bar .rv-barlist__relleno').nth(1).getAttribute('width')).toBe('33.33%');
    await p.close();
  });
  it('agrupadas: el tooltip lista cada serie y el total; la tabla trae una columna por serie', async () => {
    const p = await abrir();
    await p.hover('#s-agr [data-i="1"] .rv-colum__golpe');
    const t = (await tip(p).innerText()).replace(/\s+/g, ' ');
    expect(t).toContain('S2');
    expect(t).toContain('Diésel $300');
    expect(t).toContain('Caseta $80');
    expect(t).toContain('Total $380');
    await p.click('#s-agr summary');
    expect(await p.locator('#s-agr thead th').allInnerTexts()).toEqual(['Periodo', 'Diésel', 'Caseta']);
    await p.close();
  });
  it('agrupadas: un null NO es cero (s/d, «Sin datos», total «n de N»), el periodo parcial lo dice y la tabla pone «—»', async () => {
    const p = await abrir();
    await p.hover('#s-agr [data-i="3"] .rv-colum__golpe');
    const t = (await tip(p).innerText()).replace(/\s+/g, ' ');
    expect(t).toContain('parcial');
    expect(t).toContain('Caseta Sin datos');
    expect(t).toContain('Total $90 (1 de 2)');
    expect(await p.locator('#s-agr [data-i="3"]').textContent()).toContain('s/d');
    expect(await p.getAttribute('#s-agr [data-i="3"]', 'aria-label')).toContain('Caseta sin datos');
    expect(await p.locator('#s-agr [data-i="3"] .rv-colum__barra').count()).toBe(1);
    expect(await p.locator('#s-agr .rv-leyenda-fina').innerText()).toContain('= sin datos');
    await p.click('#s-agr summary');
    expect((await p.locator('#s-agr tbody tr').nth(3).innerText()).replace(/\s+/g, ' ')).toBe('S4 (incompleto) $90 —');
    expect(await p.locator('#s-agr caption').textContent()).toBe('Gasto semanal');
    await p.close();
  });
  it('WCAG 1.4.13: Esc descarta el tooltip aunque el puntero siga encima, y al hacer scroll sigue pegado a su columna', async () => {
    const p = await abrir();
    await p.hover('#s-col [data-i="1"] .rv-colum__golpe');
    expect(await tip(p).count()).toBe(1);
    const dist = async () => p.evaluate(() => { const a = document.querySelector('#s-col [data-i="1"] .rv-colum__golpe')!.getBoundingClientRect(); const b = document.querySelector('.rv-pop--grafica')!.getBoundingClientRect(); return Math.round(b.left - a.right); });
    const antes = await dist();
    await p.evaluate(() => window.scrollBy(0, 40));
    await p.waitForTimeout(100);
    expect(Math.abs((await dist()) - antes)).toBeLessThanOrEqual(2);
    await p.keyboard.press('Escape');
    expect(await tip(p).count()).toBe(0);
    await p.close();
  });
  it('reduced-motion: CERO animaciones en todas las gráficas; sin esa preferencia sí se animan', async () => {
    const quieto = await abrir(1280, { reducido: true });
    expect(await quieto.evaluate(() => document.getAnimations().length)).toBe(0);
    await quieto.close();
    const vivo = await abrir(1280, { reducido: false });
    const tipos = await vivo.evaluate(() => {
      const nombres = document.getAnimations().map((a) => (a as CSSAnimation).animationName);
      return { total: nombres.length, nombres: [...new Set(nombres)] };
    });
    expect(tipos.total).toBeGreaterThan(5);
    expect(tipos.nombres).toEqual(expect.arrayContaining(['rv-crece-y', 'rv-trazo', 'rv-barrido', 'rv-crece']));
    await vivo.close();
  });
  it('animación de entrada: columnas 420 ms con escalón de 14 ms, línea 380 ms, dona 700 ms con escalón de 90 ms', async () => {
    const p = await abrir(1280, { reducido: false });
    const r = await p.evaluate(() => {
      const dato = (sel: string) => { const e = document.querySelector(sel)!; const t = getComputedStyle(e); return [t.animationDuration, t.animationDelay]; };
      return {
        col0: dato('#s-col [data-r="0"]'), col3: dato('#s-col [data-r="3"]'), linea: dato('#s-area .rv-area__linea'),
        dona0: dato('#s-dona .rv-dona__gajo[data-r="0"]'), dona2: dato('#s-dona .rv-dona__gajo[data-r="2"]'), barra1: dato('#s-bar .rv-barlist__relleno[data-r="1"]'),
      };
    });
    expect(r.col0).toEqual(['0.42s', '0s']);
    expect(r.col3).toEqual(['0.42s', '0.042s']);
    expect(r.linea[0]).toBe('0.38s');
    expect(r.dona0).toEqual(['0.7s', '0s']);
    expect(r.dona2).toEqual(['0.7s', '0.18s']);
    expect(r.barra1).toEqual(['0.42s', '0.04s']);
    await p.close();
  });
  it('390: sin desborde horizontal, la cinta guía aparece, el globo no, y TOCAR una columna escribe la lectura en la cinta', async () => {
    const p = await abrir(390, { tactil: true });
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const cinta = p.locator('#s-col .rv-gr-cinta');
    expect(await cinta.isVisible()).toBe(true);
    expect(await cinta.innerText()).toBe('Toca o desliza para ver el valor');
    const c = (await p.locator('#s-col [data-i="4"] .rv-colum__golpe').boundingBox())!;
    await p.touchscreen.tap(c.x + c.width / 2, c.y + 60);
    await expect.poll(async () => cinta.innerText()).toContain('Semana del 5 oct');
    expect(await tip(p).isVisible().catch(() => false)).toBe(false);
    // texto de gráfica ≥ 12 px
    const minimo = await p.evaluate(() => Math.min(...[...document.querySelectorAll('#s-col svg text')].map((t) => parseFloat(getComputedStyle(t).fontSize))));
    expect(minimo).toBeGreaterThanOrEqual(12);
    await p.close();
  });
  it('390: las agrupadas y el área tampoco desbordan', async () => {
    const p = await abrir(390, { tactil: true });
    for (const id of ['#s-agr', '#s-area', '#s-dona', '#s-bar']) {
      const dentro = await p.evaluate((s) => { const e = document.querySelector(s)!; const f = e.getBoundingClientRect(); return [...e.querySelectorAll('svg,table,ul')].every((x) => x.getBoundingClientRect().right <= f.right + 1); }, id);
      expect(dentro, id).toBe(true);
    }
    await p.close();
  });
});
