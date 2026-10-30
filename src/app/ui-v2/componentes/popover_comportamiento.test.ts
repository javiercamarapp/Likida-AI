/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// COMPORTAMIENTO REAL de Popover y MenuList en Chromium: anclaje, Esc + retorno de foco, clic afuera, flechas, filas de 32.
const RAIZ = join(__dirname, '..');
const ENTRADA = `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Popover, MenuList, MenuItem } from '${join(RAIZ, 'componentes/overlay').replace(/\\/g, '/')}';
window.__elegidos = [];
function App() {
  const [a, setA] = useState(false);
  const ancla = useRef(null);
  return (
    <div data-ui="v2" style={{ padding: 40 }}>
      <button id="ancla" ref={ancla} onClick={() => setA((v) => !v)}>Cuenta</button>
      <button id="otro">Otro</button>
      <Popover abierto={a} onCerrar={() => setA(false)} ancla={ancla} etiqueta="Menú de cuenta">
        <MenuList etiqueta="Cuenta">
          <MenuItem onSelect={() => { window.__elegidos.push('perfil'); setA(false); }}>Mi perfil</MenuItem>
          <MenuItem href="#ayuda">Ayuda</MenuItem>
          <MenuItem deshabilitado>Deshabilitado</MenuItem>
          <MenuItem peligro onSelect={() => window.__elegidos.push('salir')}>Salir</MenuItem>
        </MenuList>
      </Popover>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;
let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  const entrada = join(__dirname, '.entrada_popover.tmp.tsx');
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({ configFile: false, logLevel: 'silent', root: RAIZ, define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } } });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  try { browser = await chromium.launch(); } catch { browser = null; }
}, 60_000);
afterAll(async () => { await browser?.close(); });

async function abrir(): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>*{box-sizing:border-box}${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('#ancla');
  return p;
}

describe('Popover / MenuList · comportamiento en Chromium', () => {
  it('abre anclado bajo el disparador, con filas de 32, foco en el primer ítem y nombre accesible', async ({ skip }) => {
    if (!browser) skip();
    const p = await abrir();
    await p.click('#ancla');
    const r = await p.evaluate(() => {
      const pop = document.querySelector('.rv-pop')!.getBoundingClientRect();
      const a = document.getElementById('ancla')!.getBoundingClientRect();
      const fila = document.querySelector('.rv-pop__item')!.getBoundingClientRect();
      return { debajo: Math.round(pop.top - a.bottom), alineadoDer: Math.round(pop.right - a.right), fila: Math.round(fila.height), foco: document.activeElement?.textContent, etq: document.querySelector('.rv-pop')!.getAttribute('aria-label'), radio: getComputedStyle(document.querySelector('.rv-pop')!).borderTopLeftRadius };
    });
    expect(r.debajo).toBe(6);
    expect(r.fila).toBe(32);
    expect(r.foco).toBe('Mi perfil');
    expect(r.etq).toBe('Menú de cuenta');
    expect(r.radio).toBe('12px');
    await p.close();
  });
  it('flechas recorren los ítems saltando el deshabilitado; Fin va al último', async ({ skip }) => {
    if (!browser) skip();
    const p = await abrir();
    await p.click('#ancla');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Ayuda');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Salir');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Mi perfil');
    await p.keyboard.press('End');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Salir');
    await p.close();
  });
  it('Esc cierra y devuelve el foco al disparador; clic afuera cierra', async ({ skip }) => {
    if (!browser) skip();
    const p = await abrir();
    await p.click('#ancla');
    await p.keyboard.press('Escape');
    expect(await p.locator('.rv-pop').count()).toBe(0);
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('ancla');
    await p.click('#ancla');
    await p.click('#otro');
    expect(await p.locator('.rv-pop').count()).toBe(0);
    await p.close();
  });
  it('elegir un ítem lo ejecuta y cierra; el deshabilitado no ejecuta nada', async ({ skip }) => {
    if (!browser) skip();
    const p = await abrir();
    await p.click('#ancla');
    await p.click('text=Mi perfil');
    expect(await p.evaluate(() => (window as unknown as { __elegidos: string[] }).__elegidos)).toEqual(['perfil']);
    expect(await p.locator('.rv-pop').count()).toBe(0);
    await p.click('#ancla');
    await p.click('text=Deshabilitado', { force: true });
    expect(await p.locator('.rv-pop').count()).toBe(1);
    await p.close();
  });
});
