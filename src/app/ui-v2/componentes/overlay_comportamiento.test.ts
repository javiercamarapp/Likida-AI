/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { build } from 'vite';
import { type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL (Chromium) de Drawer y Modal: foco atrapado, Esc, retorno de foco, clic al fondo,
// aria, alertdialog y arrastre de la hoja inferior. No es regex sobre CSS: monta React de verdad.
// Se omite si Playwright no puede lanzar Chromium (sin navegador instalado).
const RAIZ = join(__dirname, '..');

const ENTRADA = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Drawer, Modal } from '${join(RAIZ, 'componentes/overlay').replace(/\\/g, '/')}';
window.__cierres = 0;
function App() {
  const [d, setD] = useState(false); const [m, setM] = useState(false); const [a, setA] = useState(false); const [f, setF] = useState(false);
  return (
    <div data-ui="v2">
      <button id="abre-d" onClick={() => setD(true)}>Abrir drawer</button>
      <button id="abre-m" onClick={() => setM(true)}>Abrir modal</button>
      <button id="abre-f" onClick={() => setF(true)}>Abrir formulario</button>
      <button id="abre-a" onClick={() => setA(true)}>Abrir alerta</button>
      <Drawer abierto={d} onCerrar={() => { window.__cierres++; setD(false); }} titulo="Sus reglas" descripcion="Política vigente" pie={<button id="pie-ok">Guardar</button>}>
        <input id="campo" aria-label="Campo" /><p>cuerpo</p><button id="abre-apilado" onClick={() => setM(true)}>Apilar</button>
      </Drawer>
      <Modal abierto={m} onCerrar={() => setM(false)} titulo="Confirmar" pie={<button id="m-ok">Aceptar</button>}>texto</Modal>
      <Modal abierto={f} onCerrar={() => setF(false)} cierraConFondo={false} titulo="Formulario" pie={<button id="f-ok" data-autofocus>Guardar</button>}><input id="f-campo" aria-label="Nombre" /></Modal>
      <Modal alerta abierto={a} onCerrar={() => setA(false)} titulo="¿Anular?" pie={<button id="a-ok">Anular</button>}>irreversible</Modal>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;

let browser: Browser | null = null;
let page: Page;
let bundle = '';

beforeAll(async () => {
  // La entrada vive junto al código (para resolver react y lucide) y se borra al terminar.
  const entrada = join(__dirname, `.entrada_overlay_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({
      configFile: false, logLevel: 'silent', root: RAIZ,
      define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } },
    });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 60_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280, alto = 800): Promise<Page> {
  page = await browser!.newPage({ viewport: { width: ancho, height: alto }, reducedMotion: 'reduce' });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await page.setContent(`<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await page.waitForSelector('#abre-d');
  return page;
}

describe.skipIf(SIN_NAVEGADOR)('Drawer / Modal · comportamiento en Chromium', () => {
  it('abre como <dialog> modal, nombrado por su título, y mueve el foco adentro', async () => {
    const p = await abrir();
    await p.click('#abre-d');
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')?.hasAttribute('open'))).toBe(true);
    expect(await p.evaluate(() => { const d = document.querySelector('dialog.rv-ov--drawer')!; return document.getElementById(d.getAttribute('aria-labelledby')!)?.textContent; })).toBe('Sus reglas');
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.contains(document.activeElement))).toBe(true);
    await p.close();
  });
  it('el foco queda atrapado: Tab repetido nunca sale del diálogo y lo de afuera es inerte', async () => {
    const p = await abrir();
    await p.click('#abre-d');
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press('Tab');
      expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.contains(document.activeElement))).toBe(true);
    }
    await p.keyboard.press('Shift+Tab');
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.contains(document.activeElement))).toBe(true);
    await p.close();
  });
  it('Esc llama a onCerrar una vez, cierra y devuelve el foco al disparador', async () => {
    const p = await abrir();
    await p.focus('#abre-d');
    await p.keyboard.press('Enter');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    expect(await p.evaluate(() => (window as unknown as { __cierres: number }).__cierres)).toBe(1);
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('abre-d');
    await p.close();
  });
  it('clic en el fondo cierra; clic dentro del panel no', async () => {
    const p = await abrir();
    await p.click('#abre-d');
    await p.click('#campo');
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'))).toBe(true);
    await p.mouse.click(20, 400); // el fondo (scrim) queda a la izquierda del drawer
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    await p.close();
  });
  it('Drawer mide 420 de ancho en escritorio, con margen de 8', async () => {
    const p = await abrir(1440, 900);
    await p.click('#abre-d');
    const r = await p.evaluate(() => { const b = document.querySelector('dialog.rv-ov--drawer .rv-ov__panel')!.getBoundingClientRect(); return { w: Math.round(b.width), top: Math.round(b.top), right: Math.round(innerWidth - b.right) }; });
    expect(r).toEqual({ w: 420 - 0, top: 8, right: 8 });
    await p.close();
  });
  it('Modal de confirmación: foco adentro y Esc; la alerta usa role=alertdialog', async () => {
    const p = await abrir();
    await p.click('#abre-m');
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--modal')!.contains(document.activeElement))).toBe(true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--modal')!.hasAttribute('open'));
    await p.click('#abre-a');
    expect(await p.evaluate(() => document.querySelector('dialog[role="alertdialog"]')?.hasAttribute('open'))).toBe(true);
    await p.close();
  });
  it('hoja inferior <820: ≤90 dvh, grabber visible y arrastrar >80 px cierra (menos de 80 no)', async () => {
    const p = await abrir(390, 844);
    await p.click('#abre-d');
    const g = await p.evaluate(() => { const pn = document.querySelector('dialog.rv-ov--drawer .rv-ov__panel')!.getBoundingClientRect(); const gr = document.querySelector('.rv-ov__grabber')!; return { alto: pn.height, grabber: getComputedStyle(gr).display, ancho: Math.round(pn.width), pie: Math.round(innerHeight - pn.bottom) }; });
    expect(g.alto).toBeLessThanOrEqual(844 * 0.9 + 1);
    expect(g.grabber).toBe('block');
    expect(g.ancho).toBe(390);
    expect(g.pie).toBe(0);
    const caja = await p.locator('.rv-ov__grabber').boundingBox();
    const x = caja!.x + caja!.width / 2, y = caja!.y + 2;
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y + 40, { steps: 4 }); await p.mouse.up();
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'))).toBe(true);
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x, y + 120, { steps: 6 }); await p.mouse.up();
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    await p.close();
  });

  it('scroll lock por contador: <html data-overlay-abierto> sigue hasta cerrar el ÚLTIMO overlay apilado', async () => {
    const p = await abrir();
    const bloqueado = () => p.evaluate(() => document.documentElement.hasAttribute('data-overlay-abierto'));
    expect(await bloqueado()).toBe(false);
    await p.click('#abre-d');
    expect(await bloqueado()).toBe(true);
    await p.click('#abre-apilado');
    await p.keyboard.press('Escape'); // cierra el modal apilado, el drawer sigue
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--modal')!.hasAttribute('open'));
    expect(await bloqueado()).toBe(true);
    expect(await p.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    expect(await bloqueado()).toBe(false);
    await p.close();
  });
  it('retorno de foco en WebKit: si el disparador no recibió foco al clic (activeElement = body), vuelve al último tocado', async () => {
    const p = await abrir();
    // Simula WebKit: el clic no enfoca el botón. Se dispara el pointerdown y se quita el foco antes de abrir.
    await p.evaluate(() => { const b = document.getElementById('abre-m')!; b.addEventListener('pointerdown', () => queueMicrotask(() => b.blur())); });
    await p.click('#abre-m');
    expect(await p.evaluate(() => document.activeElement === document.body)).toBe(false); // el diálogo tiene el foco
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--modal')!.hasAttribute('open'));
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('abre-m');
    await p.close();
  });
  it('foco inicial: data-autofocus manda; sin él, el primer campo del cuerpo; Cerrar nunca roba el foco al botón marcado', async () => {
    const p = await abrir();
    await p.click('#abre-f');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('f-ok');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--modal:nth-of-type(2)')?.hasAttribute('open'));
    await p.click('#abre-d');
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('campo');
    await p.close();
  });
  it('cierraConFondo={false}: el clic al fondo no cierra, Esc sí; arrastrar desde un campo hasta el fondo tampoco cierra', async () => {
    const p = await abrir();
    await p.click('#abre-f');
    await p.mouse.click(5, 5);
    expect(await p.evaluate(() => [...document.querySelectorAll('dialog.rv-ov--modal')].some((d) => d.hasAttribute('open')))).toBe(true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => ![...document.querySelectorAll('dialog.rv-ov--modal')].some((d) => d.hasAttribute('open')));
    // Arrastre desde dentro del drawer hasta el fondo: el gesto no empezó en el fondo.
    await p.click('#abre-d');
    const c = await p.locator('#campo').boundingBox();
    await p.mouse.move(c!.x + 5, c!.y + 5); await p.mouse.down(); await p.mouse.move(20, 400, { steps: 4 }); await p.mouse.up();
    expect(await p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'))).toBe(true);
    await p.close();
  });
});
