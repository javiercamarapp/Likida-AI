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
import { Tooltip } from '${ruta('componentes/overlay')}';
import { Tabs } from '${ruta('componentes/tabs')}';
import { SegmentedControl } from '${ruta('componentes/segmented')}';
function App() {
  const [marcada, setMarcada] = useState(false);
  const [periodo, setPeriodo] = useState('mes');
  return (
    <div data-ui="v2" style={{ padding: 16 }}>
      <SegmentedControl etiqueta="Periodo" valor={periodo} onChange={setPeriodo} opciones={[{ valor: 'sem', etiqueta: 'Semana', conteo: 4 }, { valor: 'mes', etiqueta: 'Mes' }, { valor: 'anio', etiqueta: 'Año', deshabilitada: true }, { valor: 'todo', etiqueta: 'Todo' }]} />
      <Tabs etiqueta="Secciones" param="vista" pestanas={[{ valor: 'a', etiqueta: 'Resumen', contenido: <p id="pa">Panel A <button id="ba">x</button></p> }, { valor: 'b', etiqueta: 'Fuentes', conteo: 0, contenido: <p id="pb">Panel B</p> }, { valor: 'c', etiqueta: 'Cobertura', conteo: 3, contenido: <p id="pc">Panel C</p> }]} />
      <div style={{ position: 'absolute', left: 4, top: 600 }}><Tooltip texto="Cuadra contra el anticipo y la política de gasto de la flota"><button id="con-tip">Cuadre</button></Tooltip> <Tooltip texto="Solo texto">Corte</Tooltip></div>
      <output id="periodo">{periodo}</output>
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

describe.skipIf(SIN_NAVEGADOR)('SegmentedControl · comportamiento en Chromium', () => {
  it('radiogroup nombrado; solo la opción activa entra con Tab; aria-checked refleja el valor', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const g = document.querySelector('[role="radiogroup"]')!;
      return { nombre: g.getAttribute('aria-label'), checked: [...g.querySelectorAll('[role="radio"]')].map((b) => b.getAttribute('aria-checked')), tabs: [...g.querySelectorAll('[role="radio"]')].map((b) => (b as HTMLElement).tabIndex) };
    });
    expect(r.nombre).toBe('Periodo');
    expect(r.checked).toEqual(['false', 'true', 'false', 'false']);
    expect(r.tabs).toEqual([-1, 0, -1, -1]);
    await p.close();
  });
  it('flechas mueven selección y foco, saltan lo deshabilitado y dan la vuelta; Inicio/Fin', async () => {
    const p = await abrir();
    await p.focus('[aria-checked="true"]');
    await p.keyboard.press('ArrowRight'); // Mes -> (Año deshabilitado) -> Todo
    await p.waitForFunction(() => document.getElementById('periodo')!.textContent === 'todo');
    await p.waitForFunction(() => document.activeElement?.textContent === 'Todo');
    await p.keyboard.press('ArrowRight'); // vuelta -> Semana
    await p.waitForFunction(() => document.getElementById('periodo')!.textContent === 'sem');
    await p.waitForFunction(() => document.activeElement?.textContent?.includes('Semana'));
    await p.keyboard.press('End');
    await p.waitForFunction(() => document.getElementById('periodo')!.textContent === 'todo');
    await p.keyboard.press('Home');
    await p.waitForFunction(() => document.getElementById('periodo')!.textContent === 'sem');
    await p.keyboard.press('ArrowLeft');
    await p.waitForFunction(() => document.getElementById('periodo')!.textContent === 'todo');
    await p.close();
  });
  it('clic selecciona; el activo es blanco sobre pista suave; el conteo se lee', async () => {
    const p = await abrir();
    await p.click('text=Todo');
    expect(await p.textContent('#periodo')).toBe('todo');
    const r = await p.evaluate(() => {
      const b = document.querySelector('[aria-checked="true"]')!;
      const g = document.querySelector('.rv-seg')!;
      return { activo: getComputedStyle(b).backgroundColor, pista: getComputedStyle(g).backgroundColor, radio: getComputedStyle(g).borderTopLeftRadius, conteo: document.querySelector('.rv-seg__conteo')?.textContent };
    });
    expect(r.activo).not.toBe(r.pista);
    expect(r.conteo).toBe('4');
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('Tabs · comportamiento en Chromium', () => {
  it('tablist nombrada; tab/tabpanel enlazados por aria-controls/labelledby; solo el panel activo visible', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      return {
        lista: document.querySelector('[role="tablist"]')!.getAttribute('aria-label'),
        sel: tabs.map((t) => t.getAttribute('aria-selected')),
        ok: tabs.every((t) => document.getElementById(t.getAttribute('aria-controls')!)?.getAttribute('aria-labelledby') === t.id),
        visibles: [...document.querySelectorAll('[role="tabpanel"]')].map((x) => !(x as HTMLElement).hidden),
      };
    });
    expect(r).toEqual({ lista: 'Secciones', sel: ['true', 'false', 'false'], ok: true, visibles: [true, false, false] });
    await p.close();
  });
  it('flechas cambian y activan con foco; Inicio/Fin; Tab entra al panel; la URL refleja ?vista=', async () => {
    const p = await abrir();
    await p.focus('[role="tab"][aria-selected="true"]');
    await p.keyboard.press('ArrowRight');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Fuentes');
    expect(await p.isVisible('#pb')).toBe(true);
    expect(await p.isVisible('#pa')).toBe(false);
    await p.keyboard.press('End');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Cobertura');
    await p.keyboard.press('ArrowRight');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toContain('Resumen');
    await p.keyboard.press('Tab'); // al panel activo
    expect(await p.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('tabpanel');
    await p.keyboard.press('Shift+Tab');
    await p.keyboard.press('Home');
    await p.keyboard.press('ArrowRight');
    expect(await p.evaluate(() => new URL(location.href).searchParams.get('vista'))).toBe('b');
    await p.close();
  });
  it('subrayado de 2 px en tinta y alto de 36 px en la activa; conteo 0 en gris', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const t = document.querySelector('[role="tab"][aria-selected="true"]')!;
      const s = getComputedStyle(t);
      return { alto: Math.round(t.getBoundingClientRect().height), borde: s.borderBottomWidth, color: s.borderBottomColor, peso: s.fontWeight };
    });
    expect(r).toEqual({ alto: 36, borde: '2px', color: 'rgb(14, 14, 16)', peso: '600' });
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('Tooltip · comportamiento en Chromium', () => {
  it('foco de teclado lo abre, enlazado por aria-describedby con role=tooltip; salir del foco lo cierra', async () => {
    const p = await abrir();
    const vis = () => p.evaluate(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility);
    expect(await vis()).toBe('hidden');
    await p.focus('#con-tip');
    expect(await vis()).toBe('visible');
    const r = await p.evaluate(() => { const b = document.getElementById('con-tip')!; const t = document.getElementById(b.getAttribute('aria-describedby')!)!; return { rol: t.getAttribute('role'), txt: t.textContent }; });
    expect(r).toEqual({ rol: 'tooltip', txt: 'Cuadra contra el anticipo y la política de gasto de la flota' });
    await p.evaluate(() => (document.activeElement as HTMLElement).blur());
    expect(await vis()).toBe('hidden');
    await p.close();
  });
  it('Esc lo cierra aunque el foco siga en el disparador; hover lo abre y salir lo cierra', async () => {
    const p = await abrir();
    const vis = () => p.evaluate(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility);
    await p.focus('#con-tip');
    await p.keyboard.press('Escape');
    expect(await vis()).toBe('hidden');
    await p.hover('#con-tip');
    expect(await vis()).toBe('visible');
    await p.mouse.move(900, 100);
    expect(await vis()).toBe('hidden');
    await p.close();
  });
  it('es una tarjeta de superficie (no invertida) de 160 a 280 px, encima del disparador y dentro del viewport', async () => {
    const p = await abrir();
    await p.focus('#con-tip');
    const r = await p.evaluate(() => {
      const t = document.querySelector('[role="tooltip"]') as HTMLElement; const b = document.getElementById('con-tip')!.getBoundingClientRect(); const c = t.getBoundingClientRect(); const s = getComputedStyle(t);
      return { w: Math.round(c.width), arribaDe: c.bottom <= b.top, dentro: c.left >= 8 && c.right <= innerWidth - 8 && c.top >= 8, fondo: s.backgroundColor, radio: s.borderTopLeftRadius, fuente: s.fontSize, sup: getComputedStyle(document.documentElement).getPropertyValue('--surface') };
    });
    expect(r.w).toBeGreaterThanOrEqual(160); expect(r.w).toBeLessThanOrEqual(280);
    expect(r.arribaDe).toBe(true); expect(r.dentro).toBe(true);
    expect(r.fondo).toBe('rgb(255, 255, 255)'); expect(r.radio).toBe('12px'); expect(r.fuente).toBe('12px');
    await p.close();
  });
  it('un texto suelto se vuelve enfocable (Tab) y también se describe', async () => {
    const p = await abrir();
    await p.focus('.rv-tip__texto');
    expect(await p.evaluate(() => getComputedStyle(document.querySelectorAll('[role="tooltip"]')[1]).visibility)).toBe('visible');
    await p.close();
  });
});
