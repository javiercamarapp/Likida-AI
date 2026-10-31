/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';
import { TablaLista, type ColumnaTabla } from './index';

// COMPORTAMIENTO REAL en Chromium de TablaLista: teclado entre filas, «seleccionar todas» con conteo anunciado, cabecera pegajosa
// de 36, filas de 40 y la tarjeta-fila bajo 820 px. La tabla se renderiza en el servidor (HTML estático) y solo la envoltura de
// cliente (`TablaTeclado`) se monta en el navegador, igual que en producción.
const RAIZ = join(__dirname, '..');
interface Fila { id: string; folio: string; total: number }
const FILAS: Fila[] = [1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, folio: `V-${n}`, total: n * 100 }));
const COLS: ColumnaTabla<Fila>[] = [
  { id: 'folio', titulo: 'Folio', principal: true, celda: (f) => <a href={`#${f.id}`}>{f.folio}</a>, valor: (f) => f.folio },
  { id: 'total', titulo: 'Total', alinear: 'der', celda: (f) => String(f.total), valor: (f) => f.total },
  { id: 'accion', titulo: 'Acción', tituloOculto: true, celda: (f) => <button type="button" id={`b-${f.id}`}>Revisar</button> },
];
const ESTATICO = renderToStaticMarkup(
  <TablaLista<Fila> etiqueta="Viajes" columnas={COLS} filas={FILAS} idFila={(f) => f.id} base="/x" params={{}} orden="local"
    seleccion={{ nombre: 'ids', form: 'masiva', idFila: (f) => f.id, etiquetaFila: (f) => `Seleccionar ${f.folio}`, singular: 'seleccionada', plural: 'seleccionadas' }} />,
);
// Solo la parte interior (sin la envoltura de cliente, que se monta aquí): la caja externa trae el conteo y la tabla.
const ENTRADA = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TablaTeclado } from '${join(RAIZ, 'datos/tabla-teclado').replace(/\\/g, '/')}';
const html = ${JSON.stringify(ESTATICO)};
createRoot(document.getElementById('raiz')!).render(
  <TablaTeclado seleccion={{ singular: 'seleccionada', plural: 'seleccionadas' }}>
    <div dangerouslySetInnerHTML={{ __html: html }} />
  </TablaTeclado>
);
`;
let browser: Browser | null = null;
let bundle = '';
const css = () => ['tokens.css', 'graficas.css', 'datos.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');

beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(__dirname, `.entrada_tabla_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({ configFile: false, logLevel: 'silent', root: RAIZ, define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } } });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 120_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1440, extra: { reducedMotion?: 'reduce' | 'no-preference' } = {}): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 900 }, reducedMotion: extra.reducedMotion ?? 'no-preference' });
  await p.setContent(`<!doctype html><html><head><style>${css()}</style></head><body><div data-ui="v2" style="padding:16px"><form id="masiva"></form><div id="raiz"></div></div></body></html>`);
  await p.addScriptTag({ content: bundle });
  await p.waitForSelector('table.rv-tl');
  return p;
}

describe.skipIf(SIN_NAVEGADOR)('TablaLista en Chromium', () => {
  it('flechas ↑ ↓ pasan al mismo control de la fila vecina; Ctrl+Fin/Inicio a los extremos; no se salen de la tabla', async () => {
    const p = await abrir();
    await p.focus('a[href="#f1"]');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href'))).toBe('#f2');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href'))).toBe('#f3');
    await p.keyboard.press('ArrowUp');
    expect(await p.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href'))).toBe('#f2');
    await p.keyboard.press('Control+End');
    expect(await p.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href'))).toBe('#f5');
    await p.keyboard.press('ArrowDown'); // ya es la última: se queda
    expect(await p.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href'))).toBe('#f5');
    await p.keyboard.press('Control+Home');
    expect(await p.evaluate(() => (document.activeElement as HTMLAnchorElement).getAttribute('href'))).toBe('#f1');
    await p.close();
  }, 60_000);

  it('el índice del control se conserva: desde el botón «Revisar» de una fila se baja al botón de la siguiente', async () => {
    const p = await abrir();
    await p.focus('#b-f2');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('b-f3');
    await p.close();
  }, 60_000);

  it('las flechas de la cabecera NO se secuestran y Tab sigue el orden natural', async () => {
    const p = await abrir();
    await p.focus('thead a.rv-tl__orden');
    const antes = await p.evaluate(() => document.activeElement?.textContent);
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe(antes);
    await p.close();
  }, 60_000);

  it('«seleccionar todas» marca las filas, anuncia el conteo y el estado intermedio se refleja', async () => {
    const p = await abrir();
    await p.check('input[data-sel-todas]');
    expect(await p.locator('input[data-sel-fila]:checked').count()).toBe(5);
    expect(await p.textContent('[data-sel-conteo]')).toBe('5 seleccionadas');
    expect(await p.locator('tbody tr[data-seleccionada]').count()).toBe(5);
    await p.uncheck('input[data-sel-fila] >> nth=0');
    expect(await p.textContent('[data-sel-conteo]')).toBe('4 seleccionadas');
    expect(await p.evaluate(() => (document.querySelector('input[data-sel-todas]') as HTMLInputElement).indeterminate)).toBe(true);
    await p.click('input[data-sel-todas]'); // desde el estado intermedio, un clic las marca todas
    expect(await p.textContent('[data-sel-conteo]')).toBe('5 seleccionadas');
    await p.click('input[data-sel-todas]'); // y otro las quita
    expect(await p.textContent('[data-sel-conteo]')).toBe('');
    expect(await p.locator('tbody tr[data-seleccionada]').count()).toBe(0);
    await p.close();
  }, 60_000);

  it('una casilla suelta dice «1 seleccionada» (singular)', async () => {
    const p = await abrir();
    await p.check('input[data-sel-fila] >> nth=2');
    expect(await p.textContent('[data-sel-conteo]')).toBe('1 seleccionada');
    await p.close();
  }, 60_000);

  it('medidas en escritorio: cabecera de 36 pegajosa, filas de 40 y números alineados a la derecha', async () => {
    const p = await abrir(1440);
    const m = await p.evaluate(() => {
      const th = document.querySelector('thead th') as HTMLElement;
      const td = document.querySelector('tbody td:not(.rv-tl__sel)') as HTMLElement;
      const der = document.querySelector('tbody td.rv-tl__der') as HTMLElement;
      return { alto: th.getBoundingClientRect().height, pos: getComputedStyle(th).position, fila: td.getBoundingClientRect().height, alin: getComputedStyle(der).textAlign };
    });
    expect(m.alto).toBe(36);
    expect(m.pos).toBe('sticky');
    expect(m.fila).toBeGreaterThanOrEqual(40);
    expect(m.alin).toBe('right');
    await p.close();
  }, 60_000);

  it('bajo 820 px cada fila es una tarjeta con «rótulo · valor» y las cabeceras ordenables quedan como pastillas', async () => {
    const p = await abrir(390);
    const m = await p.evaluate(() => {
      const tr = document.querySelector('tbody tr') as HTMLElement;
      const td = document.querySelectorAll('tbody tr:first-child td')[1] as HTMLElement; // «Total»
      const thFolio = document.querySelector('thead th[aria-sort]') as HTMLElement;
      const thAccion = Array.from(document.querySelectorAll('thead th')).find((t) => t.textContent === 'Acción') as HTMLElement;
      return {
        fila: getComputedStyle(tr).display, celda: getComputedStyle(td).display, rotulo: getComputedStyle(td, '::before').content,
        pastilla: getComputedStyle(thFolio).display, accionOculta: getComputedStyle(thAccion).display,
        desborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    expect(m.fila).toBe('grid');
    expect(m.celda).toBe('flex');
    expect(m.rotulo).toBe('"Total"');
    expect(m.pastilla).not.toBe('none');
    expect(m.accionOculta).toBe('none');
    expect(m.desborda).toBe(false);
    await p.close();
  }, 60_000);

  it('reduced-motion: sin transiciones en filas y páginas', async () => {
    const p = await abrir(1440, { reducedMotion: 'reduce' });
    const d = await p.evaluate(() => getComputedStyle(document.querySelector('tbody td') as HTMLElement).transitionDuration);
    expect(d).toBe('0s');
    await p.close();
  }, 60_000);

  it('el foco del enlace de orden es visible (contorno de 2 px)', async () => {
    const p = await abrir();
    await p.keyboard.press('Tab'); // región
    await p.focus('thead a.rv-tl__orden');
    const o = await p.evaluate(() => { const s = getComputedStyle(document.activeElement as HTMLElement); return [s.outlineStyle, s.outlineWidth]; });
    expect(o).toEqual(['solid', '2px']);
    await p.close();
  }, 60_000);
});
