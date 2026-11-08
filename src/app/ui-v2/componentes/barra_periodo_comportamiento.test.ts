/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL de BarraPeriodo + cajón de filtros + BarraFiltros(avanzados) en Chromium: el botón abre el Drawer, Esc cierra,
// «Aplicar» envía el GET con los parámetros (sin vacíos, con modo «personalizado» si hay fechas) y los enlaces del periodo son enlaces.
const RAIZ = join(__dirname, '..');
const ENTRADA = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { BarraPeriodo } from '${join(RAIZ, 'componentes/barra-periodo').replace(/\\/g, '/')}';
import { BarraFiltros } from '${join(RAIZ, 'componentes/barra-filtros').replace(/\\/g, '/')}';
window.__envios = [];
document.addEventListener('submit', (e) => { e.preventDefault(); window.__envios.push(new URLSearchParams(new FormData(e.target)).toString()); }, false); // en burbuja: después del onSubmit de React, como el envío nativo
function App() {
  return (
    <div data-ui="v2" style={{ padding: 16, width: '100%' }}>
      <BarraPeriodo
        periodo={{ etiqueta: 'Periodo', valor: '30d', opciones: [{ valor: 'mes', etiqueta: 'Este mes', href: '/x?periodo=mes' }, { valor: '30d', etiqueta: '30 días', href: '/x?periodo=30d' }] }}
        chips={[{ id: 'm', etiqueta: 'USD', hrefQuitar: '/x?moneda=' }]}
        accion={<span>Última publicación</span>}
        cajon={{
          accion: '/x', ocultos: [['tenant', 't1']], limpiarHref: '/x?tenant=t1', nActivos: 1, resumen: 'USD',
          periodo: { desde: null, hasta: null, modo: { nombre: 'periodo', actual: '30d', personalizado: 'custom' } },
          monedaBase: { moneda: { nombre: 'moneda', etiqueta: 'Moneda', valor: 'USD', opciones: [{ valor: 'USD', rotulo: 'USD' }, { valor: 'MXN', rotulo: 'MXN' }] } },
          fuentes: { nombre: 'fuente', opciones: [{ valor: 'hubspot', etiqueta: 'HubSpot', marca: 'hubspot' }, { valor: 'csv', etiqueta: 'CSV', marca: 'csv' }], seleccionadas: ['csv'] },
          texto: { nombre: 'sku', titulo: 'Producto (SKU)', etiqueta: 'SKU, uno por línea', valor: '' },
        }}
      />
      <BarraFiltros accion="/y" avanzados={<p>contenido avanzado</p>} nAvanzados={0} />
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;
let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(__dirname, `.entrada_bp_${process.pid}.tmp.tsx`);
  const enlace = join(__dirname, `.stub_link_bp_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  writeFileSync(enlace, "import React from 'react';\nexport default function Link({ href, children, prefetch: _p, scroll: _s, ...r }: any) { return <a href={href} {...r}>{children}</a>; }\n");
  try {
    const r = await build({ configFile: false, logLevel: 'silent', root: RAIZ, define: { 'process.env.NODE_ENV': '"development"' },
      resolve: { alias: { 'next/link': enlace } },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } } });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); rmSync(enlace, { force: true }); }
  browser = await lanzarNavegador();
}, 90_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 800 }, reducedMotion: 'reduce' });
  const css = ['tokens.css', 'movimiento.css', 'graficas.css', 'componentes.css', 'overlay.css', 'piezas.css', 'barra-periodo.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>*{box-sizing:border-box}${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('.rv-bp');
  return p;
}
const envios = (p: Page) => p.evaluate(() => (window as unknown as { __envios: string[] }).__envios);

describe.skipIf(SIN_NAVEGADOR)('BarraPeriodo · comportamiento en Chromium', { timeout: 30_000 }, () => {
  it('una sola fila: segmentado, Filtros, chip y acción comparten la fila (escritorio) y miden 32', async () => {
    const p = await abrir();
    const m = await p.evaluate(() => {
      const b = document.querySelector('.rv-bp')!;
      const tops = [...b.children].map((c) => Math.round(c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2));
      return { tops, filtros: document.querySelector('.rv-bp__filtros')!.getBoundingClientRect().height, chip: document.querySelector('.rv-bp__chip')!.getBoundingClientRect().height };
    });
    expect(new Set(m.tops).size).toBe(1);
    expect(m.filtros).toBe(32);
    expect(m.chip).toBe(32);
    await p.close();
  });
  it('el periodo vigente es el único aria-current y las opciones son enlaces', async () => {
    const p = await abrir();
    expect(await p.locator('.rv-bp__seg a[aria-current="true"]').innerText()).toBe('30 días');
    expect(await p.locator('.rv-bp__seg a').count()).toBe(2);
    await p.close();
  });
  it('«Filtros» abre el Drawer de 420; Esc lo cierra y devuelve el foco al botón', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: /Filtros/ }).first().click();
    const dlg = p.locator('dialog.rv-ov--drawer[open]');
    await dlg.waitFor();
    expect(Math.round((await dlg.boundingBox())!.width)).toBe(420);
    await p.keyboard.press('Escape');
    await p.waitForSelector('dialog.rv-ov--drawer[open]', { state: 'detached' });
    expect(await p.evaluate(() => document.activeElement?.className)).toContain('rv-bp__filtros');
    await p.close();
  });
  it('Aplicar envía GET con ocultos y valores; vacíos fuera; modo = periodo vigente sin fechas', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: /Filtros/ }).first().click();
    await p.getByLabel('Moneda', { exact: true }).selectOption('MXN');
    await p.getByLabel('HubSpot').check();
    await p.getByRole('button', { name: 'Aplicar', exact: true }).click();
    const q = new URLSearchParams((await envios(p))[0]);
    expect(q.get('tenant')).toBe('t1');
    expect(q.get('moneda')).toBe('MXN');
    expect(q.getAll('fuente').sort()).toEqual(['csv', 'hubspot']);
    expect(q.get('periodo')).toBe('30d');
    expect(q.has('desde')).toBe(false);
    expect(q.has('sku')).toBe(false);
    await p.close();
  });
  it('con una fecha el modo pasa a «personalizado» y el SKU viaja', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: /Filtros/ }).first().click();
    await p.getByLabel('Desde', { exact: true }).fill('2026-08-01');
    await p.getByLabel('SKU, uno por línea').fill('A1\nB2');
    await p.getByRole('button', { name: 'Aplicar', exact: true }).click();
    const q = new URLSearchParams((await envios(p))[0]);
    expect(q.get('periodo')).toBe('custom');
    expect(q.get('desde')).toBe('2026-08-01');
    expect(q.get('sku')).toBe('A1\nB2');
    await p.close();
  });
  it('BarraFiltros con avanzados abre el cajón (Drawer), no un Popover, también en escritorio', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: 'Filtros', exact: true }).last().click();
    await p.locator('dialog.rv-ov--drawer[open]').waitFor();
    expect(await p.locator('.rv-pop').count()).toBe(0);
    expect(await p.getByText('contenido avanzado').isVisible()).toBe(true);
    await p.close();
  });
});
