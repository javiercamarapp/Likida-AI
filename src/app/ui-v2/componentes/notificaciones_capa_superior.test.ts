/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// Paquete C (identidad Rovaq, 10-nov-2026): el toast vive en la CAPA SUPERIOR (`popover="manual"`) y se ve ENCIMA de un <dialog> modal.
const RAIZ = join(__dirname, '..');
const ENTRADA = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Drawer } from '${join(RAIZ, 'componentes/overlay').replace(/\\/g, '/')}';
import { ProveedorNotificaciones, useNotificar } from '${join(RAIZ, 'componentes/notificaciones').replace(/\\/g, '/')}';
function Botones() {
  const { notificar } = useNotificar();
  const [d, setD] = useState(false);
  return (<>
    <button id="abre-d" onClick={() => setD(true)}>Abrir</button>
    <Drawer abierto={d} onCerrar={() => setD(false)} titulo="Reglas" pie={<button className="rv-btn rv-btn--sm" id="pie-ok">Guardar</button>}>
      <button id="avisa" onClick={() => notificar({ tono: 'ok', mensaje: 'Guardado', duracionMs: null })}>Avisar</button>
    </Drawer>
  </>);
}
createRoot(document.getElementById('raiz')!).render(<div data-ui="v2"><ProveedorNotificaciones><Botones /></ProveedorNotificaciones></div>);
`;
let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  const entrada = join(__dirname, `.entrada_toast_${process.pid}.tmp.tsx`);
  writeFileSync(entrada, ENTRADA);
  try {
    const r = await build({ configFile: false, logLevel: 'silent', root: RAIZ, define: { 'process.env.NODE_ENV': '"development"' }, build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } } });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 60_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 800 }, reducedMotion: 'reduce' });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('#abre-d');
  return p;
}

describe.skipIf(SIN_NAVEGADOR)('Toast · capa superior y piel de Aviso', () => {
  it('abierto un Drawer, el toast se pinta ENCIMA del velo y usa la piel de Aviso', async () => {
    const p = await abrir();
    await p.click('#abre-d');
    await p.click('#avisa');
    await p.waitForSelector('.rv-toast');
    const r = await p.evaluate(() => {
      const t = document.querySelector('.rv-toast') as HTMLElement; const c = t.getBoundingClientRect();
      const dlg = document.querySelector('dialog[open]')!;
      const pie = document.querySelector('.rv-ov__pie .rv-btn') as HTMLElement;
      return { visible: c.width > 0 && c.bottom <= innerHeight && c.right <= innerWidth && getComputedStyle(t).visibility === 'visible', abierto: dlg.hasAttribute('open'), capa: (document.querySelector('.rv-toasts') as HTMLElement).matches(':popover-open'), tono: t.dataset.tono, clase: t.className, fondo: getComputedStyle(t).backgroundColor, pie: pie.getBoundingClientRect().height };
    });
    expect(r.capa).toBe(true);
    expect(r.visible).toBe(true);
    expect(r.abierto).toBe(true);
    expect(r.tono).toBe('ok');
    expect(r.clase).toContain('rv-aviso');
    expect(r.fondo).not.toBe('rgba(0, 0, 0, 0)');
    expect(r.pie).toBe(32); // pie de overlay: 32 px aunque el botón sea `sm`
    await p.close();
  });
  it('el toast que nació sobre un Drawer se cierra con su X en cuanto el Drawer se cierra (con el modal abierto el resto del documento es inerte)', async () => {
    const p = await abrir();
    await p.click('#abre-d');
    await p.click('#avisa');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[open]'));
    await p.click('.rv-toast__x');
    await p.waitForFunction(() => !document.querySelector('.rv-toast'));
    await p.close();
  });
});
