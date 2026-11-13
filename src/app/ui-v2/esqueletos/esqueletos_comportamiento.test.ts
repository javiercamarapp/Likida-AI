/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL (Chromium) del cajón de Vista rápida con el esqueleto de tabla maestra: foco adentro al abrir, Tab atrapado, Esc cierra
// (navega a la URL sin `ver`) y, con prefers-reduced-motion, sin animación de entrada. Sin Chromium falla claro; UI2_SIN_NAVEGADOR=1 las omite.
const RAIZ = join(__dirname, '..');
const APP = join(RAIZ, '..');
const ruta = (p: string) => join(APP, p).replace(/\\/g, '/');

const ENTRADA = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { CajonVistaRapida } from '${ruta('ui-v2/esqueletos/cajon-vista-rapida')}';
window.__reemplazos = [];
function App() {
  return (
    <div data-ui="v2">
      <button id="fila" type="button">Vista rápida</button>
      <CajonVistaRapida titulo="Grupo 1" subtitulo="Grupo 1 de 12" hrefCerrar="/dashboard/viajes"
        cifras={[{ etiqueta: 'A', valor: '1' }, { etiqueta: 'B', valor: '—' }, { etiqueta: 'C', valor: '3' }, { etiqueta: 'D', valor: '4' }]}
        pie={<button id="abrir" type="button">Abrir viaje</button>} />
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;
const STUBS: Record<string, string> = {
  'next/navigation': 'export const useRouter = () => ({ push() {}, refresh() {}, replace(h, o) { window.__reemplazos.push([h, o]); } });',
  'next/link': "import React from 'react'; export default function Link({ href, children, ...r }) { return React.createElement('a', { href, ...r }, children); }",
};

let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  if (SIN_NAVEGADOR) return;
  const entrada = join(__dirname, `.entrada_esq_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({
      configFile: false, logLevel: 'silent', root: RAIZ,
      plugins: [{ name: 'stubs-next', enforce: 'pre', resolveId: (id) => (id in STUBS ? `\0stub:${id}` : null), load: (id) => (id.startsWith('\0stub:') ? STUBS[id.slice(6)] : null) }],
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

async function abrir(movimiento: 'reduce' | 'no-preference'): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: movimiento });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css', 'esqueletos/esqueletos.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>window.process = { env: {} };</script><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('dialog[open]');
  return p;
}

describe.skipIf(SIN_NAVEGADOR)('CajonVistaRapida · comportamiento en Chromium', { timeout: 30_000 }, () => {
  it('abre como diálogo modal de 420 con el foco ADENTRO y Tab atrapado', async () => {
    const p = await abrir('reduce');
    expect(await p.evaluate(() => document.querySelector('dialog')!.contains(document.activeElement))).toBe(true);
    const ancho = await p.evaluate(() => Math.round(document.querySelector('.rv-ov__panel')!.getBoundingClientRect().width));
    expect(ancho).toBe(420);
    for (let i = 0; i < 6; i++) {
      await p.keyboard.press('Tab');
      expect(await p.evaluate(() => document.querySelector('dialog')!.contains(document.activeElement))).toBe(true);
    }
    await p.close();
  });
  it('Esc cierra el cajón y navega a la URL sin `ver` sin saltar el scroll', async () => {
    const p = await abrir('reduce');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => (window as unknown as { __reemplazos: unknown[] }).__reemplazos.length > 0);
    expect(await p.evaluate(() => (window as unknown as { __reemplazos: unknown[] }).__reemplazos[0])).toEqual(['/dashboard/viajes', { scroll: false }]);
    await p.close();
  });
  it('con prefers-reduced-motion la entrada no anima (duración efectiva ~0)', async () => {
    const p = await abrir('reduce');
    const dur = await p.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.rv-ov__panel')!).animationDuration || '0'));
    expect(dur).toBeLessThan(0.02);
    await p.close();
  });
});
