/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL (Chromium) de FormaEnCajon: foco al abrir, Esc, retorno de foco, rechazo que conserva lo escrito, éxito que cierra
// y reinicia, doble clic que no envía dos veces y apertura por ?abrir= (con el parámetro quitado al cerrar). Monta React de verdad.
// Se omite si Playwright no puede lanzar Chromium.
const RAIZ = join(__dirname, '..');

const ENTRADA = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FormaEnCajon } from '${join(RAIZ, 'componentes/forma-en-cajon').replace(/\\/g, '/')}';
window.__envios = [];
async function accion(previo, datos) {
  const nombre = String(datos.get('nombre') || '');
  window.__envios.push(nombre);
  await new Promise((r) => setTimeout(r, 150));
  if (nombre === 'mal') return { error: 'Ese nombre ya existe' };
  return { ok: 'Cliente creado' };
}
function App() {
  return (
    <div data-ui="v2">
      <FormaEnCajon id="alta" titulo="Nuevo cliente" descripcion="Datos básicos" accion={accion} boton="Crear cliente" disparador="Nuevo cliente">
        <label>Nombre <input id="nombre" name="nombre" /></label>
        <input type="hidden" name="flota" value="f-1" />
      </FormaEnCajon>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;

const STUBS: Record<string, string> = {
  'next/navigation': 'export const useRouter = () => ({ push() {}, refresh() {}, replace() {} });',
  'next/link': "import React from 'react'; export default function Link({ href, children, ...r }) { return React.createElement('a', { href, ...r }, children); }",
};

let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(__dirname, `.entrada_forma_cajon_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({
      configFile: false, logLevel: 'silent', root: RAIZ,
      plugins: [{
        name: 'stubs-next', enforce: 'pre',
        resolveId: (id) => (id in STUBS ? `\0stub:${id}` : null),
        load: (id) => (id.startsWith('\0stub:') ? STUBS[id.slice(6)] : null),
      }],
      resolve: { alias: { '@': join(RAIZ, '..') } },
      define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } },
    });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 60_000);
afterAll(async () => { await browser?.close(); });

async function abrir(query = ''): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  const html = `<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
  await p.route('http://prueba.local/**', (ruta) => ruta.fulfill({ contentType: 'text/html', body: html }));
  await p.goto(`http://prueba.local/clientes${query}`);
  await p.waitForSelector('button[aria-haspopup="dialog"]');
  return p;
}
const abierto = (p: Page) => p.evaluate(() => document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));

describe.skipIf(SIN_NAVEGADOR)('FormaEnCajon · comportamiento en Chromium', () => {
  it('abre con el foco en el primer campo, Esc cierra y el foco vuelve al disparador', async () => {
    const p = await abrir();
    await p.focus('button[aria-haspopup="dialog"]');
    await p.keyboard.press('Enter');
    expect(await abierto(p)).toBe(true);
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('nombre');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    expect(await p.evaluate(() => document.activeElement?.getAttribute('aria-haspopup'))).toBe('dialog');
    await p.close();
  });
  it('un rechazo NO cierra, conserva lo escrito, avisa por qué y rehabilita el botón', async () => {
    const p = await abrir();
    await p.click('button[aria-haspopup="dialog"]');
    await p.fill('#nombre', 'mal');
    await p.click('button[type="submit"]');
    await p.waitForSelector('[aria-live="polite"] >> text=Ese nombre ya existe');
    expect(await abierto(p)).toBe(true);
    expect(await p.inputValue('#nombre')).toBe('mal');
    expect(await p.evaluate(() => (document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled)).toBe(false);
    await p.close();
  });
  it('mientras corre, el botón se deshabilita: dos clics seguidos envían UNA vez', async () => {
    const p = await abrir();
    await p.click('button[aria-haspopup="dialog"]');
    await p.fill('#nombre', 'Acme');
    await p.click('button[type="submit"]');
    expect(await p.evaluate(() => (document.querySelector('button[type="submit"]') as HTMLButtonElement).disabled)).toBe(true);
    await p.click('button[type="submit"]', { force: true, timeout: 500 }).catch(() => undefined);
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    expect(await p.evaluate(() => (window as unknown as { __envios: string[] }).__envios)).toEqual(['Acme']);
    await p.close();
  });
  it('un éxito cierra, anuncia el mensaje y al reabrir el formulario está limpio y sin aviso viejo', async () => {
    const p = await abrir();
    await p.click('button[aria-haspopup="dialog"]');
    await p.fill('#nombre', 'Acme');
    await p.click('button[type="submit"]');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    expect(await p.locator('[role="status"]').first().textContent()).toBe('Cliente creado');
    await p.click('button[aria-haspopup="dialog"]');
    expect(await p.inputValue('#nombre')).toBe('');
    expect(await p.locator('dialog [aria-live="polite"]').textContent()).toBe('');
    await p.close();
  });
  it('?abrir=alta abre el cajón al cargar y cerrarlo quita el parámetro sin recargar ni tocar el resto del query', async () => {
    const p = await abrir('?abrir=alta&q=x');
    await p.waitForFunction(() => document.querySelector('dialog.rv-ov--drawer')?.hasAttribute('open'));
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('nombre');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog.rv-ov--drawer')!.hasAttribute('open'));
    expect(await p.evaluate(() => location.search)).toBe('?q=x');
    await p.close();
  });
  it('?abrir=otro no abre este cajón', async () => {
    const p = await abrir('?abrir=otro');
    expect(await abierto(p)).toBe(false);
    await p.close();
  });
});
