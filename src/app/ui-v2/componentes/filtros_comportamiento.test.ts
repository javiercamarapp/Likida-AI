/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL de la familia de filtros (LF) en Chromium: selección, envío GET con los parámetros de siempre,
// limpiar, teclado, Esc, alto 32/36, una sola fila.
const RAIZ = join(__dirname, '..');
const ENTRADA = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarraFiltros } from '${join(RAIZ, 'componentes/barra-filtros').replace(/\\/g, '/')}';
import { FiltroOpciones, FiltroBusqueda, FiltroFecha, FiltroInterruptor } from '${join(RAIZ, 'componentes/filtros').replace(/\\/g, '/')}';
window.__envios = [];
document.addEventListener('submit', (e) => { e.preventDefault(); window.__envios.push(new URLSearchParams(new FormData(e.target)).toString()); }, true);
function Periodo() {
  const [v, setV] = useState('semanal');
  return <div><FiltroOpciones etiqueta="Periodo" porDefecto="semanal" valor={v} onCambio={setV} opciones={[{ valor: 'semanal', rotulo: 'Semanal' }, { valor: 'mensual', rotulo: 'Mensual' }]} /><output id="periodo">{v}</output></div>;
}
function App() {
  return (
    <div data-ui="v2" style={{ padding: 16, width: '100%' }}>
      <BarraFiltros accion="/dashboard/x" ocultos={{ tenant: 't1' }} nActivos={1} limpiarHref="/dashboard/x?tenant=t1">
        <FiltroOpciones nombre="rev" etiqueta="Revisión" porDefecto="pendientes" valor="pendientes" opciones={[{ valor: 'pendientes', rotulo: 'Pendientes' }, { valor: 'todas', rotulo: 'Todas' }]} />
        <FiltroOpciones nombre="estado" etiqueta="Cuadre" valor="" opciones={[{ valor: '', rotulo: 'Cualquiera' }, { valor: 'cuadrado', rotulo: 'Cuadrado' }, { valor: 'sobrante', rotulo: 'Sobrante' }]} />
        <FiltroFecha nombre="desde" etiqueta="Desde" valor="" />
        <FiltroInterruptor nombre="vista" valor="excepciones" etiqueta="Solo con excepciones" marcado={false} />
        <FiltroBusqueda nombre="q" placeholder="Folio" />
      </BarraFiltros>
      <Periodo />
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;
let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(__dirname, `.entrada_filtros_${process.pid}.tmp.tsx`);
  const enlace = join(__dirname, `.stub_link_${process.pid}.tmp.tsx`);
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
  const css = ['tokens.css', 'movimiento.css', 'graficas.css', 'componentes.css', 'overlay.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>*{box-sizing:border-box}${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('button.rv-fl');
  return p;
}
const envios = (p: Page) => p.evaluate(() => (window as unknown as { __envios: string[] }).__envios);

describe.skipIf(SIN_NAVEGADOR)('Filtros LF · comportamiento en Chromium', { timeout: 30_000 }, () => {
  it('elegir una opción envía el GET con TODOS los parámetros (ocultos + valores vigentes)', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: 'Cuadre' }).click();
    await p.getByRole('option', { name: 'Sobrante' }).click();
    const e = await envios(p);
    expect(e).toHaveLength(1);
    const q = new URLSearchParams(e[0]);
    expect(q.get('tenant')).toBe('t1');
    expect(q.get('estado')).toBe('sobrante');
    expect(q.get('rev')).toBe('pendientes');
    await p.close();
  });
  it('el chip activo muestra el valor dentro y se marca; el neutro no', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: 'Cuadre' }).click();
    await p.getByRole('option', { name: 'Cuadrado' }).click();
    // la página real recarga; aquí el estado local ya refleja el valor
    const t = await p.evaluate(() => { const b = [...document.querySelectorAll('button.rv-fl')].find((x) => x.textContent?.includes('Cuadre'))!; return { txt: b.textContent, activo: b.hasAttribute('data-activo') }; });
    expect(t.txt).toContain('Cuadrado');
    expect(t.activo).toBe(true);
    const neutro = await p.evaluate(() => [...document.querySelectorAll('button.rv-fl')].find((x) => x.textContent?.includes('Revisión'))!.hasAttribute('data-activo'));
    expect(neutro).toBe(false);
    await p.close();
  });
  it('teclado: flecha abre, flechas mueven, Intro elige, Esc cierra y devuelve el foco', async () => {
    const p = await abrir();
    await p.getByRole('button', { name: 'Cuadre' }).focus();
    await p.keyboard.press('ArrowDown');
    expect(await p.locator('[role="option"]').count()).toBe(3);
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Cualquiera');
    await p.keyboard.press('Escape');
    expect(await p.locator('.rv-pop').count()).toBe(0);
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Cuadre');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    expect(new URLSearchParams((await envios(p))[0]).get('estado')).toBe('cuadrado');
    await p.close();
  });
  it('fecha e interruptor envían al cambiar; Intro en la búsqueda envía q', async () => {
    const p = await abrir();
    await p.locator('input[name="desde"]').fill('2026-10-01', { timeout: 4000 });
    await p.locator('label.rv-fl--interruptor').click({ timeout: 4000 });
    await p.locator('input[name="q"]').fill('V-10', { timeout: 4000 });
    await p.keyboard.press('Enter');
    const e = (await envios(p)).map((s) => new URLSearchParams(s));
    expect(e[0].get('desde')).toBe('2026-10-01');
    expect(e[1].get('vista')).toBe('excepciones');
    expect(e.at(-1)!.get('q')).toBe('V-10');
    await p.close();
  });
  it('«Limpiar» es un enlace al contexto sin filtros; modo cliente (periodo) cambia sin enviar', async () => {
    const p = await abrir();
    expect(await p.getByRole('link', { name: 'Limpiar' }).getAttribute('href')).toBe('/dashboard/x?tenant=t1');
    await p.getByRole('button', { name: 'Periodo' }).click();
    await p.getByRole('option', { name: 'Mensual' }).click();
    expect(await p.locator('#periodo').textContent()).toBe('mensual');
    expect(await envios(p)).toEqual([]);
    await p.close();
  });
  it('1440 y 390: UNA fila; controles de 32 px (36 en móvil); la fila se desplaza en horizontal', async () => {
    for (const [ancho, alto] of [[1280, 32], [390, 36]] as const) {
      const p = await abrir(ancho);
      const r = await p.evaluate(() => {
        const cs = [...document.querySelectorAll('.rv-filtros .rv-fl')].map((e) => e.getBoundingClientRect());
        const z = document.querySelector('.rv-filtros__chips') as HTMLElement;
        return { altos: cs.map((c) => Math.round(c.height)), tops: cs.map((c) => Math.round(c.top)), desplaza: z.scrollWidth > z.clientWidth, barra: document.querySelector('.rv-filtros')!.getBoundingClientRect().height };
      });
      expect(new Set(r.altos)).toEqual(new Set([alto]));
      expect(Math.max(...r.tops) - Math.min(...r.tops)).toBeLessThanOrEqual(2);
      expect(r.barra).toBeLessThanOrEqual(48);
      if (ancho === 390) expect(r.desplaza).toBe(true);
      await p.close();
    }
  });
});
