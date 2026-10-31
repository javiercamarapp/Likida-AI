/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL (Chromium) de cada overlay MIGRADO al motor único (L3), con los componentes de producción:
// DialogoConfirmar (admin/ui/confirmar), CommandPalette (admin/command-palette), MenuAdjuntar (dashboard/menu-adjuntar)
// y el Drawer del historial. Por overlay: foco adentro, Esc, retorno de foco al disparador y scroll lock.
const RAIZ = join(__dirname, '..');
const APP = join(RAIZ, '..');
const ruta = (p: string) => join(APP, p).replace(/\\/g, '/');

const ENTRADA = `
import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DialogoConfirmar } from '${ruta('admin/ui/confirmar')}';
import CommandPalette from '${ruta('admin/command-palette')}';
import MenuAdjuntar from '${ruta('dashboard/menu-adjuntar')}';
import { Drawer } from '${ruta('ui-v2/componentes/overlay')}';
window.__acciones = [];
function App() {
  const [c, setC] = useState(false);
  const [p, setP] = useState(false);
  const [m, setM] = useState(false);
  const [h, setH] = useState(false);
  const clip = useRef(null);
  return (
    <div data-ui="v2" style={{ padding: 40 }}>
      <form onSubmit={(e) => { e.preventDefault(); window.__acciones.push('submit'); }}>
        <button id="abre-c" type="button" onClick={() => setC(true)}>Dar de baja</button>
        <DialogoConfirmar abierto={c} titulo="Dar de baja a un operador" descripcion="Dejará de recibir mensajes." etiquetaConfirmar="Dar de baja"
          tipoConfirmar="submit" onConfirmar={() => setC(false)} onCancelar={() => setC(false)} />
      </form>
      <CommandPalette />
      <button id="abre-p" type="button" onClick={() => window.dispatchEvent(new CustomEvent('likida:abrir-buscador'))}>Buscar</button>
      <button id="clip" ref={clip} type="button" onClick={() => setM((v) => !v)}>Clip</button>
      <MenuAdjuntar abierto={m} onCerrar={() => setM(false)} ancla={clip} onCamara={() => window.__acciones.push('camara')} onImagen={() => {}} onArchivo={() => {}} />
      <button id="abre-h" type="button" onClick={() => setH(true)}>Historial</button>
      <Drawer abierto={h} onCerrar={() => setH(false)} titulo="Historial"><div className="rv-historial"><input id="busca" aria-label="Buscar chats" /></div></Drawer>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;

// Next no existe en el bundle de prueba: se sustituyen solo los dos módulos que tocan los componentes.
const STUBS: Record<string, string> = {
  'next/navigation': 'export const useRouter = () => ({ push() {}, refresh() {} });',
  'next/link': "import React from 'react'; export default function Link({ href, children, ...r }) { return React.createElement('a', { href, ...r }, children); }",
};

let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(__dirname, `.entrada_migrados_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({
      configFile: false, logLevel: 'silent', root: RAIZ,
      plugins: [{
        name: 'stubs-next', enforce: 'pre',
        resolveId: (id) => (id in STUBS ? `\0stub:${id}` : null),
        load: (id) => (id.startsWith('\0stub:') ? STUBS[id.slice(6)] : null),
      }],
      resolve: { alias: { '@': join(APP, '..') } },
      define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } },
    });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 90_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280, alto = 800): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: alto }, reducedMotion: 'reduce' });
  await p.route('**/api/admin/palette', (ruta) => ruta.fulfill({ json: { interruptores: [], flotas: [] } }));
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>window.process = { env: {} };</script><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('#abre-c');
  return p;
}
const bloqueado = (p: Page) => p.evaluate(() => document.documentElement.hasAttribute('data-overlay-abierto'));
const activo = (p: Page) => p.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName);

describe.skipIf(SIN_NAVEGADOR)('overlays migrados · comportamiento en Chromium', { timeout: 30_000 }, () => {
  it('confirmar (peligro): alertdialog, foco en Cancelar, scroll lock, Esc cierra y devuelve el foco al disparador', async () => {
    const p = await abrir();
    await p.focus('#abre-c');
    await p.keyboard.press('Enter');
    expect(await p.evaluate(() => document.querySelector('dialog[role="alertdialog"]')?.hasAttribute('open'))).toBe(true);
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Cancelar');
    expect(await bloqueado(p)).toBe(true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[role="alertdialog"]')!.hasAttribute('open'));
    expect(await activo(p)).toBe('abre-c');
    expect(await bloqueado(p)).toBe(false);
    await p.close();
  });
  it('confirmar: el botón de confirmar envía el formulario (submit) y cierra; el foco vuelve al disparador', async () => {
    const p = await abrir();
    await p.click('#abre-c');
    await p.getByRole('button', { name: 'Dar de baja', exact: true }).last().click();
    expect(await p.evaluate(() => (window as unknown as { __acciones: string[] }).__acciones)).toEqual(['submit']);
    await p.waitForFunction(() => !document.querySelector('dialog[role="alertdialog"]')!.hasAttribute('open'));
    expect(await activo(p)).toBe('abre-c');
    await p.close();
  });
  it('confirmar: Tab no sale del diálogo', async () => {
    const p = await abrir();
    await p.click('#abre-c');
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press('Tab');
      expect(await p.evaluate(() => document.querySelector('dialog[role="alertdialog"]')!.contains(document.activeElement))).toBe(true);
    }
    await p.close();
  });
  it('paleta: abre con ⌘K, foco en el campo, scroll lock, Esc cierra y el foco vuelve a lo que lo tenía', async () => {
    const p = await abrir();
    await p.focus('#abre-p');
    await p.keyboard.press('Control+k');
    await p.waitForSelector('dialog.rv-ov--modal[open] input[aria-label]');
    expect(await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Buscar una acción, interruptor o flota');
    expect(await bloqueado(p)).toBe(true);
    expect(await p.evaluate(() => document.querySelector('dialog[open]')!.getAttribute('aria-label'))).toBe('Buscar en administración');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[open]'));
    expect(await bloqueado(p)).toBe(false);
    expect(await activo(p)).toBe('abre-p');
    await p.close();
  });
  it('paleta: sin cabecera, 560 de ancho y subida (margen superior ≈ 12 % de la altura)', async () => {
    const p = await abrir(1440, 900);
    await p.keyboard.press('Control+k');
    await p.waitForSelector('dialog[open]');
    const r = await p.evaluate(() => { const b = document.querySelector('dialog[open] .rv-ov__panel')!.getBoundingClientRect(); return { w: Math.round(b.width), top: Math.round(b.top), cab: !!document.querySelector('dialog[open] .rv-ov__cab') }; });
    expect(r.w).toBe(560);
    expect(r.cab).toBe(false);
    expect(r.top).toBeGreaterThan(100);
    expect(r.top).toBeLessThan(140);
    await p.close();
  });
  it('Adjuntar: foco en la primera fila, flechas recorren, Esc cierra y devuelve el foco al clip', async () => {
    const p = await abrir();
    await p.click('#clip');
    await p.waitForSelector('[role="menu"]');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Tomar foto');
    await p.keyboard.press('ArrowDown');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Subir imágenes');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('[role="menu"]'));
    expect(await activo(p)).toBe('clip');
    await p.close();
  });
  it('Adjuntar: elegir una fila cierra el menú y ejecuta la acción; clic afuera también cierra; no bloquea el scroll', async () => {
    const p = await abrir();
    await p.click('#clip');
    expect(await bloqueado(p)).toBe(false); // un popover no es modal
    await p.getByRole('menuitem', { name: /Tomar foto/ }).click();
    expect(await p.evaluate(() => (window as unknown as { __acciones: string[] }).__acciones)).toContain('camara');
    expect(await p.evaluate(() => !!document.querySelector('[role="menu"]'))).toBe(false);
    await p.click('#clip');
    await p.mouse.click(5, 700);
    await p.waitForFunction(() => !document.querySelector('[role="menu"]'));
    await p.close();
  });
  it('historial (Drawer): en 390 px es hoja inferior; foco al campo, Esc cierra, retorno de foco y scroll lock', async () => {
    const p = await abrir(390, 844);
    await p.focus('#abre-h');
    await p.keyboard.press('Enter');
    const g = await p.evaluate(() => { const b = document.querySelector('dialog.rv-ov--drawer[open] .rv-ov__panel')!.getBoundingClientRect(); return { w: Math.round(b.width), pie: Math.round(innerHeight - b.bottom), alto: b.height }; });
    expect(g.w).toBe(390);
    expect(g.pie).toBe(0);
    expect(g.alto).toBeLessThanOrEqual(844 * 0.9 + 1);
    expect(await activo(p)).toBe('busca');
    expect(await bloqueado(p)).toBe(true);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer[open]'));
    expect(await activo(p)).toBe('abre-h');
    expect(await bloqueado(p)).toBe(false);
    await p.close();
  });
});
