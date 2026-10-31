/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from '../navegador_prueba';

// COMPORTAMIENTO REAL (Chromium) de las piezas comunes de L7: teclado, aria, foco y estilos calculados. Monta React de verdad.
// Se omite solo con UI2_SIN_NAVEGADOR=1.
const RAIZ = join(__dirname, '..');
const ruta = (f: string) => join(RAIZ, f).replace(/\\/g, '/');

const ENTRADA = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Casilla, Radio, Campo, Fieldset, CampoArchivo } from '${ruta('componentes/campos')}';
import { Switch } from '${ruta('componentes/switch')}';
function App() {
  const [marcada, setMarcada] = useState(false);
  return (
    <div data-ui="v2" style={{ padding: 16 }}>
      <form id="f">
        <Casilla id="c1" name="c1" etiqueta="Recibir avisos" ayuda="Llegan por correo" checked={marcada} onChange={(e) => setMarcada(e.target.checked)} />
        <Casilla id="c2" name="c2" etiqueta="Todas" indeterminada />
        <Casilla id="c3" name="c3" etiqueta="Bloqueada" disabled />
        <Fieldset leyenda="Formato" ayuda="Elige uno">
          <Radio name="fmt" value="pdf" etiqueta="PDF" defaultChecked />
          <Radio name="fmt" value="xml" etiqueta="XML" />
          <Radio name="fmt" value="csv" etiqueta="CSV" />
        </Fieldset>
        <Switch nombre="sw" etiqueta="Activo" />
        <Campo etiqueta="Nombre" ayuda="Como en el RFC" error="Falta el nombre" obligatorio><input name="nombre" /></Campo>
        <CampoArchivo name="archivo" etiqueta="Documento" accept=".pdf" />
      </form>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<App />);
`;

let browser: Browser | null = null;
let bundle = '';
beforeAll(async () => {
  const entrada = join(__dirname, `.entrada_l7_${process.pid}.tmp.tsx`);
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
}, 90_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280, extra: { forcedColors?: 'active' } = {}): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 900 }, reducedMotion: 'reduce', ...extra });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css', 'piezas.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
  await p.waitForSelector('form#f');
  return p;
}

describe.skipIf(SIN_NAVEGADOR)('Campos · comportamiento en Chromium', () => {
  it('casilla: Espacio la marca, la etiqueta la marca, viaja en el FormData y la ayuda queda enlazada', async () => {
    const p = await abrir();
    await p.focus('#c1');
    await p.keyboard.press('Space');
    expect(await p.isChecked('#c1')).toBe(true);
    await p.click('label[for="c1"]');
    expect(await p.isChecked('#c1')).toBe(false);
    await p.click('#c1');
    expect(await p.evaluate(() => new FormData(document.querySelector('form')!).get('c1'))).toBe('on');
    expect(await p.evaluate(() => { const i = document.getElementById('c1')!; return document.getElementById(i.getAttribute('aria-describedby')!)?.textContent; })).toBe('Llegan por correo');
    await p.close();
  });
  it('casilla: caja de 16 px propia (no la nativa), marcada pinta tinta y tiene foco visible', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const i = document.getElementById('c1') as HTMLInputElement;
      const antes = getComputedStyle(i);
      const caja = [antes.width, antes.height, antes.appearance];
      i.checked = true;
      return { caja, marcado: getComputedStyle(i).backgroundColor, marca: getComputedStyle(document.documentElement).getPropertyValue('--marca') };
    });
    expect(r.caja).toEqual(['16px', '16px', 'none']);
    expect(r.marcado).toBe('rgb(14, 14, 16)');
    await p.keyboard.press('Tab');
    expect(await p.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)).toBe('solid');
    await p.close();
  });
  it('casilla indeterminada y deshabilitada: el estado se expone al navegador y no se puede enfocar', async () => {
    const p = await abrir();
    expect(await p.evaluate(() => (document.getElementById('c2') as HTMLInputElement).indeterminate)).toBe(true);
    expect(await p.evaluate(() => getComputedStyle(document.getElementById('c3')!).borderTopStyle)).toBe('dashed');
    await p.focus('#c1');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    expect(await p.evaluate(() => document.activeElement?.id)).not.toBe('c3');
    await p.close();
  });
  it('radios: flechas recorren el grupo dentro del fieldset nombrado por su leyenda', async () => {
    const p = await abrir();
    expect(await p.evaluate(() => { const f = document.querySelector('fieldset')!; return f.querySelector('legend')!.textContent; })).toBe('Formato');
    await p.focus('input[value="pdf"]');
    await p.keyboard.press('ArrowDown');
    expect(await p.isChecked('input[value="xml"]')).toBe(true);
    await p.keyboard.press('ArrowDown');
    expect(await p.isChecked('input[value="csv"]')).toBe(true);
    expect(await p.evaluate(() => new FormData(document.querySelector('form')!).get('fmt'))).toBe('csv');
    // el punto del radio se pinta
    expect(await p.evaluate(() => getComputedStyle(document.querySelector('input[value="csv"]')!, '::after').display)).toBe('block');
    await p.close();
  });
  it('switch: Espacio lo enciende, perilla de 14 px que recorre 14 px', async () => {
    const p = await abrir();
    await p.focus('#sw');
    const antes = await p.evaluate(() => document.querySelector('.rv-switch__perilla')!.getBoundingClientRect().left);
    await p.keyboard.press('Space');
    expect(await p.isChecked('#sw')).toBe(true);
    const despues = await p.evaluate(() => document.querySelector('.rv-switch__perilla')!.getBoundingClientRect().left);
    expect(Math.round(despues - antes)).toBe(14);
    expect(await p.evaluate(() => { const s = getComputedStyle(document.querySelector('.rv-switch__pista')!); return s.width; })).toBe('34px');
    expect(await p.getAttribute('#sw', 'role')).toBe('switch');
    await p.close();
  });
  it('campo: etiqueta enlazada, descripción y error por aria, obligatorio y error anunciado', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const i = document.querySelector<HTMLInputElement>('input[name="nombre"]')!;
      const desc = i.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent);
      return { etq: document.querySelector(`label[for="${i.id}"]`)?.textContent, desc, invalido: i.getAttribute('aria-invalid'), req: i.required, alerta: document.querySelector('.rv-campo__error')?.getAttribute('role') };
    });
    expect(r.etq).toContain('Nombre');
    expect(r.desc.join('|')).toContain('Como en el RFC');
    expect(r.desc.join('|')).toContain('Falta el nombre');
    expect(r.invalido).toBe('true');
    expect(r.req).toBe(true);
    expect(r.alerta).toBe('alert');
    await p.close();
  });
  it('archivo: input file real con botón interno de 32 px; acepta por teclado el foco', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const i = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      return { acc: i.accept, btn: getComputedStyle(i, '::file-selector-button').minHeight, etq: document.querySelector(`label[for="${i.id}"]`)?.textContent };
    });
    expect(r).toEqual({ acc: '.pdf', btn: '32px', etq: 'Documento' });
    await p.close();
  });
  it('alto contraste forzado: casilla y radio vuelven a ser los nativos del sistema', async () => {
    const p = await abrir(1280, { forcedColors: 'active' });
    expect(await p.evaluate(() => getComputedStyle(document.getElementById('c1')!).appearance)).not.toBe('none');
    await p.close();
  });
  it('móvil: la fila de la casilla mide 44 de alto (zona táctil)', async () => {
    const p = await abrir(390);
    expect(await p.evaluate(() => Math.round(document.querySelector('.rv-marca__fila')!.getBoundingClientRect().height))).toBeGreaterThanOrEqual(44);
    await p.close();
  });
});
