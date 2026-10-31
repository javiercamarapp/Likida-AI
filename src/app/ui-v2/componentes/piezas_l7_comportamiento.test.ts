/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';
import { type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30_000 }); // Chromium bajo una Mac cargada
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
import { StatusChip } from '${ruta('componentes/status-chip')}';
import { TablaBase } from '${ruta('componentes/tabla-base')}';
import { TabsLinea } from '${ruta('componentes/tabs-linea')}';
import { Tabs } from '${ruta('componentes/tabs')}';
import { SegmentedControl } from '${ruta('componentes/segmented')}';
function App() {
  const [marcada, setMarcada] = useState(false);
  const [periodo, setPeriodo] = useState('mes');
  return (
    <div data-ui="v2" style={{ padding: 16 }}>
      <SegmentedControl etiqueta="Periodo" valor={periodo} onChange={setPeriodo} opciones={[{ valor: 'sem', etiqueta: 'Semana', conteo: 4 }, { valor: 'mes', etiqueta: 'Mes' }, { valor: 'anio', etiqueta: 'Año', deshabilitada: true }, { valor: 'todo', etiqueta: 'Todo' }]} />
      <Tabs etiqueta="Secciones" param="vista" pestanas={[{ valor: 'a', etiqueta: 'Resumen', contenido: <p id="pa">Panel A <button id="ba">x</button></p> }, { valor: 'b', etiqueta: 'Fuentes', conteo: 0, contenido: <p id="pb">Panel B</p> }, { valor: 'c', etiqueta: 'Cobertura', conteo: 3, atencion: true, contenido: <p id="pc">Panel C</p> }]} />
      <TabsLinea etiqueta="Rutas" actual="a" pestanas={[{ clave: 'a', etiqueta: 'Uno', href: '#a', conteo: 2 }, { clave: 'b', etiqueta: 'Dos', href: '#b' }]} />
      <Campo etiqueta="Con descripción propia" ayuda="Ayuda del campo"><input id="cd" name="cd" aria-describedby="nota-propia" /></Campo><span id="nota-propia">Nota propia</span>
      <Casilla name="cdesc" etiqueta="Con nota" ayuda="Ayuda casilla" aria-describedby="nota-propia" />
      <Radio name="ui" form="sin-formulario" value="1" etiqueta="Uno" defaultChecked /><Radio name="ui" form="sin-formulario" value="2" etiqueta="Dos" />
      <div style={{ position: 'absolute', left: 4, top: 600 }}><Tooltip texto="Cuadra contra el anticipo y la política de gasto de la flota"><button id="con-tip">Cuadre</button></Tooltip> <Tooltip texto="Solo texto">Corte</Tooltip></div>
      <div id="estados"><StatusChip tono="ok">Cuadra</StatusChip><StatusChip tono="warn">Por revisar</StatusChip><StatusChip tono="bad">Rechazada</StatusChip><StatusChip tono="info">En cola</StatusChip><StatusChip>Borrador</StatusChip><StatusChip tono="muted">Sin dato</StatusChip></div>
      <div id="tablas"><TablaBase etiqueta="Unidades" tarjetaMovil idFila={(f: { id: string }) => f.id} columnas={[{ id: 'u', titulo: 'Unidad', principal: true, celda: (f: { id: string; km: number }) => f.id }, { id: 'k', titulo: 'Km', alinear: 'der', celda: (f: { id: string; km: number }) => f.km }]} filas={Array.from({ length: 40 }, (_, i) => ({ id: 'U-' + i, km: i * 10 }))} />
<TablaBase etiqueta="Vacía" idFila={(f: { id: string }) => f.id} columnas={[]} filas={[]} vacio={{ titulo: 'Sin unidades', texto: 'Aún no hay unidades.' }} /></div>
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
      // next/link y next/navigation (Boton → EstadoError) no se empaquetan para el navegador: se sustituyen por fixtures.
      resolve: { alias: { 'next/link': join(RAIZ, '__fixtures__/next-link-prueba.tsx'), 'next/navigation': join(RAIZ, '__fixtures__/next-navigation-prueba.ts') } },
      define: { 'process.env.NODE_ENV': '"development"' },
      build: { write: false, minify: false, lib: { entry: entrada, formats: ['iife'], name: 'App', fileName: 'app' } },
    });
    const salida = (Array.isArray(r) ? r[0] : r) as { output: Array<{ type: string; code?: string }> };
    bundle = salida.output.find((o) => o.type === 'chunk')!.code!;
  } finally { rmSync(entrada, { force: true }); }
  browser = await lanzarNavegador();
}, 90_000);
afterAll(async () => { await browser?.close(); });

async function abrir(ancho = 1280, extra: { forcedColors?: 'active' } = {}, urlReal = false): Promise<Page> {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 900 }, reducedMotion: 'reduce', ...extra });
  const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css', 'piezas.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
  const html = `<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
  if (urlReal) { await p.route('http://l7.test/**', (r) => r.fulfill({ contentType: 'text/html', body: html })); await p.goto('http://l7.test/pagina'); } // historial real (about:blank no admite replaceState)
  else await p.setContent(html);
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

describe.skipIf(SIN_NAVEGADOR)('StatusChip · comportamiento en Chromium', () => {
  it('22 px, punto de 6 px, 12/600; cada tono pinta fondo y texto distintos y siempre hay texto', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => [...document.querySelectorAll('#estados .rv-estado')].map((c) => {
      const s = getComputedStyle(c); const d = getComputedStyle(c.querySelector('i')!);
      return { alto: Math.round(c.getBoundingClientRect().height), punto: d.width, peso: s.fontWeight, tam: s.fontSize, fondo: s.backgroundColor, color: s.color, texto: c.textContent, dot: d.backgroundColor, sombra: d.boxShadow };
    }));
    for (const c of r) { expect(c.alto).toBe(22); expect(c.punto).toBe('6px'); expect(c.peso).toBe('600'); expect(c.tam).toBe('12px'); expect(c.texto!.length).toBeGreaterThan(0); }
    expect(new Set(r.slice(0, 4).map((c) => c.fondo)).size).toBe(4);
    expect(r[0].dot).toBe(r[0].color); // el punto lleva la tinta del tono
    expect(r[5].dot).toBe('rgba(0, 0, 0, 0)'); expect(r[5].sombra).not.toBe('none'); // muted = punto hueco
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('TablaBase · comportamiento en Chromium', () => {
  it('región con nombre y foco por teclado, cabecera de 36 px pegajosa, filas de 40 y tope de alto', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const reg = document.querySelector('.rv-tb__region') as HTMLElement;
      const th = document.querySelector('.rv-tb thead th') as HTMLElement; const td = document.querySelector('.rv-tb tbody td') as HTMLElement;
      return { rol: reg.getAttribute('role'), nombre: document.getElementById(reg.getAttribute('aria-labelledby')!)?.textContent, tab: reg.tabIndex, cab: Math.round(parseFloat(getComputedStyle(th).height)), fila: Math.round(parseFloat(getComputedStyle(td).height)), pos: getComputedStyle(th).position, max: getComputedStyle(reg).maxHeight, scroll: reg.scrollHeight > reg.clientHeight, rowhead: document.querySelector('.rv-tb tbody th')?.getAttribute('scope') };
    });
    expect(r).toMatchObject({ rol: 'region', nombre: 'Unidades', tab: 0, cab: 36, fila: 40, pos: 'sticky', scroll: true, rowhead: 'row' });
    expect(r.max).not.toBe('none');
    await p.close();
  });
  it('la cabecera se queda fija al desplazar; sin filas muestra el estado vacío, no una tabla', async () => {
    const p = await abrir();
    const antes = await p.evaluate(() => { const reg = document.querySelector('.rv-tb__region') as HTMLElement; reg.scrollTop = 300; return document.querySelector('.rv-tb thead th')!.getBoundingClientRect().top - reg.getBoundingClientRect().top; });
    expect(Math.abs(antes)).toBeLessThan(2);
    expect(await p.evaluate(() => document.querySelectorAll('#tablas table').length)).toBe(1);
    expect(await p.textContent('#tablas .rv-vacio__titulo')).toBe('Sin unidades');
    await p.close();
  });
  it('móvil: cada fila es una tarjeta con rótulo y valor', async () => {
    const p = await abrir(390);
    const r = await p.evaluate(() => ({ disp: getComputedStyle(document.querySelector('.rv-tb tbody tr')!).display, etq: getComputedStyle(document.querySelector('.rv-tb tbody td')!, '::before').content }));
    expect(r.disp).toBe('grid'); expect(r.etq).toContain('Km');
    await p.close();
  });
});

describe.skipIf(SIN_NAVEGADOR)('Revisión L7 · móvil, URL, aria y tooltip', () => {
  it('móvil: la zona táctil de SegmentedControl, Tabs y TabsLinea es de 44 px', async () => {
    const p = await abrir(390);
    const r = await p.evaluate(() => {
      const alto = (sel: string) => Math.round(document.querySelector(sel)!.getBoundingClientRect().height);
      return { tab: alto('[role="tab"]'), linea: alto('.rv-tabs--enlaces .rv-tabs__tab'), segAlto: alto('.rv-seg__btn') };
    });
    expect(r.tab).toBeGreaterThanOrEqual(44);
    expect(r.linea).toBeGreaterThanOrEqual(44);
    expect(r.segAlto).toBeGreaterThanOrEqual(44);
    await p.close();
  });
  it('el conteo de la pestaña activa es neutro; solo `atencion` lo pinta burdeos', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => {
      const f = (e: Element) => getComputedStyle(e).backgroundColor;
      const activo = document.querySelector('[role="tab"][aria-selected="true"] .rv-tabs__conteo') ?? document.querySelectorAll('.rv-tabs__conteo')[0];
      const atencion = document.querySelector('.rv-tabs__conteo[data-atencion]')!;
      const neutro = document.querySelector('.rv-tabs--enlaces [aria-current="page"] .rv-tabs__conteo')!;
      return { atencion: f(atencion), neutro: f(neutro), canvas: getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim(), hay: !!activo };
    });
    expect(r.atencion).not.toBe(r.neutro);
    expect(r.neutro).not.toBe('rgb(244, 229, 233)'); // --soft-6 (burdeos suave)
    expect(await p.evaluate(() => document.querySelectorAll('.rv-tabs__conteo[data-atencion]').length)).toBe(1); // solo la que pidió `atencion`
    await p.close();
  });
  it('Tabs con `param` sigue la URL con atrás/adelante, también tras un clic propio', async () => {
    const p = await abrir(1280, {}, true);
    await p.click('[role="tab"]:has-text("Fuentes")');
    await p.click('[role="tab"]:has-text("Cobertura")');
    expect(await p.evaluate(() => new URL(location.href).searchParams.get('vista'))).toBe('c');
    await p.evaluate(() => { history.pushState(null, '', '?vista=b'); window.dispatchEvent(new PopStateEvent('popstate')); });
    await p.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Fuentes'));
    await p.evaluate(() => history.back()); // vuelve a ?vista=c (el clic propio): la pestaña lo sigue
    await p.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('Cobertura'));
    await p.close();
  });
  it('aria-describedby propio del hijo se conserva junto al de la ayuda (Campo y Casilla)', async () => {
    const p = await abrir();
    const r = await p.evaluate(() => ({
      campo: document.querySelector('input[name="cd"]')!.getAttribute('aria-describedby')!.split(' ').map((i) => document.getElementById(i)?.textContent),
      casilla: document.querySelector('input[name="cdesc"]')!.getAttribute('aria-describedby')!.split(' ').map((i) => document.getElementById(i)?.textContent),
    }));
    expect(r.campo).toEqual(['Nota propia', 'Ayuda del campo']);
    expect(r.casilla).toEqual(['Nota propia', 'Ayuda casilla']);
    await p.close();
  });
  it('radios con `form` ajeno: las flechas recorren el grupo y no viajan en el FormData', async () => {
    const p = await abrir();
    await p.focus('input[name="ui"][value="1"]');
    await p.keyboard.press('ArrowDown');
    expect(await p.isChecked('input[name="ui"][value="2"]')).toBe(true);
    expect(await p.evaluate(() => new FormData(document.querySelector('form')!).has('ui'))).toBe(false);
    await p.close();
  });
  it('Tooltip: cruzar el hueco con el puntero no la cierra y sigue abierta sobre la burbuja', async () => {
    const p = await abrir();
    const caja = await p.evaluate(() => { const b = document.getElementById('con-tip')!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top }; });
    await p.mouse.move(caja.x, caja.y + 5);
    await p.waitForFunction(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility === 'visible');
    const t = await p.evaluate(() => { const r = document.querySelector('[role="tooltip"]')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom, cy: r.top + r.height / 2 }; });
    await p.mouse.move(caja.x, caja.y - 3, { steps: 4 }); // dentro del hueco de 6 px
    expect(await p.evaluate(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility)).toBe('visible');
    await p.mouse.move(t.x, t.cy, { steps: 4 }); // sobre la burbuja
    expect(await p.evaluate(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility)).toBe('visible');
    await p.mouse.move(700, 800);
    await p.waitForFunction(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility === 'hidden');
    await p.close();
  });
  it('Tooltip en táctil: un toque la muestra unos segundos y luego se va sola', async () => {
    const c = await browser!.newContext({ viewport: { width: 390, height: 900 }, hasTouch: true, reducedMotion: 'reduce' });
    const p = await c.newPage();
    const css = ['tokens.css', 'movimiento.css', 'componentes.css', 'overlay.css', 'piezas.css'].map((f) => readFileSync(join(RAIZ, f), 'utf8')).join('\n');
    await p.setContent(`<!doctype html><html data-theme="light"><head><style>${css}</style></head><body><div id="raiz"></div><script>${bundle.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`);
    await p.waitForSelector('#con-tip');
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const caja = await p.evaluate(() => { const b = document.getElementById('con-tip')!.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    await p.touchscreen.tap(caja.x, caja.y);
    await p.waitForFunction(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility === 'visible');
    await p.waitForFunction(() => getComputedStyle(document.querySelector('[role="tooltip"]')!).visibility === 'hidden', undefined, { timeout: 8000 });
    await c.close();
  });
});
