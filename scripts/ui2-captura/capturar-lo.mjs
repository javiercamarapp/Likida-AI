// Captura LO: las escenas de lo.harness.tsx en 1440 y 390, claro y oscuro. Coloca el foco y la etiqueta con la fórmula de capa.tsx sobre el
// rect MEDIDO del elemento real. Uso: node scripts/ui2-captura/capturar-lo.mjs <dir> <destino> [id,id]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright');
const [dir, dest, lista] = process.argv.slice(2);
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');
const ids = lista ? lista.split(',') : JSON.parse(readFileSync(path.join(dir, 'escenas.json'), 'utf8'));
const fuentes = [
  ...[400, 500, 600, 700].map((w) => `@font-face{font-family:'Hanken Grotesk UI';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/hankengrotesk-${w}.woff2') format('woff2')}`),
  ...[400, 500].map((w) => `@font-face{font-family:'IBM Plex Mono';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/plexmono-${w}.woff2') format('woff2')}`),
  `html{--font-mono:'IBM Plex Mono'}`,
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif;--font-display:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif}`,
].join('\n');
mkdirSync(dest, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_EXE ? { executablePath: process.env.CHROMIUM_EXE } : {});
let n = 0;

// Misma colocación que ui-v2/movimiento/tour/capa.tsx
async function colocar(page) {
  await page.evaluate(() => {
    const raizTour = document.querySelector('.rv-tour');
    const nombre = raizTour?.getAttribute('data-ancla');
    if (!raizTour || !nombre) return;
    const derivadas = { 'pantalla.primer-bloque': 'main.rv-marco > header.rv-encabezado ~ :not(script):not(style)' };
    const sel = derivadas[nombre] ?? `[data-onboarding="${nombre}"], [data-tour="${nombre}"]`;
    const el = [...document.querySelectorAll(sel)].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
    const capa = raizTour.querySelector('.rv-onb-capa'), etiqueta = raizTour.querySelector('.rv-onb-etiqueta'), tarjeta = raizTour.querySelector('.rv-onb');
    if (!el) { capa.setAttribute('data-scrim', ''); return; }
    el.scrollIntoView({ block: 'center' });
    const vp = { w: innerWidth, h: innerHeight }, R = 6, GAP = 10, M = 8;
    const b = el.getBoundingClientRect();
    const x = Math.max(0, b.x - R), y = Math.max(0, b.y - R), x2 = Math.min(vp.w, b.x + b.width + R), y2 = Math.min(vp.h, b.y + b.height + R);
    const r = { x, y, w: x2 - x, h: y2 - y };
    for (const [k, v] of [['--tour-x', r.x], ['--tour-y', r.y], ['--tour-w', r.w], ['--tour-h', r.h]]) capa.style.setProperty(k, `${Math.round(v)}px`);
    capa.removeAttribute('data-sin-foco');
    if (etiqueta) {
      const w = etiqueta.offsetWidth, h = etiqueta.offsetHeight;
      const cabe = { abajo: r.y + r.h + GAP + h < vp.h - M, arriba: r.y - GAP - h > M, der: r.x + r.w + GAP + w < vp.w - M, izq: r.x - GAP - w > M };
      const lado = ['abajo', 'arriba', 'der', 'izq'].find((l) => cabe[l]) ?? 'abajo';
      const lx = lado === 'der' ? r.x + r.w + GAP : lado === 'izq' ? r.x - GAP - w : r.x + r.w / 2 - w / 2;
      const ly = lado === 'abajo' ? r.y + r.h + GAP : lado === 'arriba' ? r.y - GAP - h : r.y + r.h / 2 - h / 2;
      etiqueta.style.setProperty('--lab-x', `${Math.round(Math.max(M, Math.min(lx, vp.w - w - M)))}px`);
      etiqueta.style.setProperty('--lab-y', `${Math.round(Math.max(M, Math.min(ly, vp.h - h - M)))}px`);
      etiqueta.setAttribute('data-lado', lado);
      etiqueta.style.setProperty('visibility', 'visible');
    }
    if (vp.w > 767 && tarjeta) tarjeta.setAttribute('data-lado', r.x + r.w / 2 > vp.w / 2 ? 'izq' : 'der');
  });
}

for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', locale: 'es-MX', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const id of ids) {
    const html = `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${dir}/v2full.css"><style>${fuentes}</style></head><body>${readFileSync(path.join(dir, 'vistas', `${id}.html`), 'utf8')}</body></html>`;
    const archivo = path.join(dir, 'vistas', `${id}.doc.html`);
    writeFileSync(archivo, html);
    for (const tema of ['claro', 'oscuro']) {
      await page.goto('file://' + archivo);
      await page.evaluate(async (t) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
      await colocar(page);
      await page.waitForTimeout(60);
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (desborde > 0) console.log(`DESBORDE ${id} ${w} ${tema}: ${desborde}px`);
      await page.screenshot({ path: path.join(dest, `${id}__${w}__${tema}.png`) });
      n++;
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`${n} capturas -> ${dest}`);
