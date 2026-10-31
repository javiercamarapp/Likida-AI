/* eslint-disable security/detect-non-literal-fs-filename -- rutas fijas del propio módulo (o UI2_CSS_DIR para la prueba de rojo) */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser } from 'playwright';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lanzarNavegador, SIN_NAVEGADOR } from './navegador_prueba';
import { Chip } from './componentes';
import { TiraKpi } from './graficas';

// COMPORTAMIENTO REAL en Chromium de lo que el CSS promete (estilos calculados, no regex): tarjeta-fila móvil,
// chip sin partir, deshabilitado con trazo discontinuo en móvil, alto contraste forzado, cabecera pegajosa y
// procedencia anunciada bajo 1100 px. Se omite si Playwright no puede lanzar Chromium.
const DIR = process.env.UI2_CSS_DIR ?? __dirname;
let browser: Browser | null = null;
beforeAll(async () => { browser = await lanzarNavegador(); }, 60_000);
afterAll(async () => { await browser?.close(); });

const css = () => ['tokens.css', 'movimiento.css', 'componentes.css', 'graficas.css'].map((f) => readFileSync(join(f === 'componentes.css' || f === 'graficas.css' ? DIR : __dirname, f), 'utf8')).join('\n');
const HTML = `<div data-ui="v2" style="padding:16px">
  <section class="card"><table data-tarjeta><thead><tr><th>Folio</th><th>Ruta</th><th>Estado</th></tr></thead><tbody>
    <tr><td data-label="Folio">V-4102</td><td data-label="Ruta">Monterrey → Querétaro</td><td data-label="Estado">${renderToStaticMarkup(<Chip tamano="estado" tono="bad">Revisar</Chip>)}</td></tr>
    <tr><td data-label="Folio">V-4103</td><td data-label="Ruta">Veracruz → Puebla</td><td data-label="Estado">${renderToStaticMarkup(<Chip tamano="estado" tono="ok">Cuadra</Chip>)}</td></tr>
  </tbody></table></section>
  <div class="card" style="margin-top:12px"><input id="normal" aria-label="n" value="x"><input id="dis" aria-label="d" disabled value="No editable"></div>
  ${renderToStaticMarkup(<TiraKpi items={[{ etiqueta: 'Peajes', valor: '$1', sello: 'Casetas · semana 43', tipo: 'observado', metrica: 'gasto_peajes' }]} />)}
</div>`;

async function pagina(ancho: number, extra: { forcedColors?: 'active' } = {}) {
  const p = await browser!.newPage({ viewport: { width: ancho, height: 800 }, reducedMotion: 'reduce', ...extra });
  await p.setContent(`<!doctype html><html data-theme="light"><head><style>${css()}</style></head><body>${HTML}</body></html>`);
  return p;
}

describe.skipIf(SIN_NAVEGADOR)('primitivas v2 · estilos calculados en Chromium', () => {
  it('390: la tabla se vuelve tarjeta-fila (grid) con la etiqueta de cada celda, y el chip «Revisar» no se parte', async () => {
    const p = await pagina(390);
    const r = await p.evaluate(() => {
      const tr = document.querySelector('table[data-tarjeta] tbody tr')!;
      const chip = document.querySelector('.rv-chip')!;
      const antes = getComputedStyle(document.querySelector('table[data-tarjeta] td')!, '::before').content;
      return { fila: getComputedStyle(tr).display, borde: getComputedStyle(tr).borderTopWidth, etiqueta: antes, nowrap: getComputedStyle(chip).whiteSpace, chipAlto: Math.round(chip.getBoundingClientRect().height), cab: document.querySelector('thead')!.getBoundingClientRect().height };
    });
    expect(r.fila).toBe('grid');
    expect(r.borde).toBe('1px');
    expect(r.etiqueta).toContain('Folio');
    expect(r.nowrap).toBe('nowrap');
    expect(r.chipAlto).toBeLessThanOrEqual(28); // una sola línea (partido sería ≥ 40)
    expect(r.cab).toBeLessThanOrEqual(1); // la cabecera sigue en el árbol (semántica) pero fuera de la vista
    await p.close();
  });
  it('390: el campo deshabilitado conserva el trazo DISCONTINUO (outline) aunque la caja de 44 use borde transparente', async () => {
    const p = await pagina(390);
    const r = await p.evaluate(() => { const c = getComputedStyle(document.getElementById('dis')!); const n = getComputedStyle(document.getElementById('normal')!); return { outline: c.outlineStyle, alto: document.getElementById('dis')!.getBoundingClientRect().height, normalOutline: n.outlineStyle }; });
    expect(r.outline).toBe('dashed');
    expect(r.alto).toBe(44);
    expect(r.normalOutline).not.toBe('dashed');
    await p.close();
  });
  it('alto contraste forzado: el campo recupera un borde real de 1 px (no un marco transparente de 5 px)', async () => {
    const p = await pagina(390, { forcedColors: 'active' });
    const w = await p.evaluate(() => getComputedStyle(document.getElementById('normal')!).borderTopWidth);
    expect(w).toBe('1px');
    await p.close();
  });
  it('1440: la cabecera de tabla es pegajosa y la tarjeta NO es contenedor de scroll (clip), así sigue a la página', async () => {
    const p = await pagina(1440);
    const r = await p.evaluate(() => ({ pos: getComputedStyle(document.querySelector('thead th')!).position, ox: getComputedStyle(document.querySelector('.card:has(> table)')!).overflowX }));
    expect(r.pos).toBe('sticky');
    expect(r.ox).toBe('clip');
    await p.close();
  });
  it('1024: el sello de procedencia sigue en el árbol de accesibilidad (visualmente oculto, no display:none)', async () => {
    const p = await pagina(1024);
    const r = await p.evaluate(() => { const s = document.querySelector('.rv-kpi__sello')!; const cs = getComputedStyle(s); return { display: cs.display, w: Math.round(s.getBoundingClientRect().width), texto: s.textContent }; });
    expect(r.display).not.toBe('none');
    expect(r.w).toBeLessThanOrEqual(1);
    expect(r.texto).toContain('Casetas · semana 43');
    expect(await p.getByText('Casetas · semana 43').count()).toBe(1); // localizable por lector/rol de texto
    await p.close();
  });
  it('1440: el sello se ve completo en una línea, sin elipsis', async () => {
    const p = await pagina(1440);
    const r = await p.evaluate(() => { const s = document.querySelector('.rv-kpi__sello')!; return { w: s.getBoundingClientRect().width, h: s.getBoundingClientRect().height, ov: getComputedStyle(s).textOverflow }; });
    expect(r.w).toBeGreaterThan(60);
    expect(r.h).toBeLessThanOrEqual(20);
    expect(r.ov).toBe('clip');
    await p.close();
  });
});
