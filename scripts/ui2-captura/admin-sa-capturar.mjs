// Captura con Playwright los .html que deja admin-sa.harness.tsx (+ admin.css de admin-sa-compilar-css.mjs).
// Uso: node scripts/ui2-captura/admin-sa-capturar.mjs TRABAJO DEST [ids,separados,por,coma]
// Cada vista: "<id>" -> 1440x900; el campo ANCHOS abajo agrega variantes (p. ej. 1920x1080 del Resumen).
// Navegador: chromium_headless_shell instalado (la versión del repo puede no coincidir; se resuelve por glob).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright-core');
const [dir, dest, lista] = process.argv.slice(2);
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');
const filtro = lista ? lista.split(',') : null;
const ANCHOS = {}; // por defecto 1440x900 (una sola captura de página completa, nombre = id.png)
const fuentes = [
  ...[400, 500, 600, 700].map((w) => `@font-face{font-family:'Hanken Grotesk UI';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/hankengrotesk-${w}.woff2') format('woff2')}`),
  ...[400, 500].map((w) => `@font-face{font-family:'IBM Plex Mono';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/plexmono-${w}.woff2') format('woff2')}`),
  `html{--font-mono:'IBM Plex Mono'}`,
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif;--font-display:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif}`,
  `*,*::before,*::after{transition:none!important;animation:none!important}`,
].join('\n');

const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell')).sort().pop();
const bin = path.join(cache, shell, readdirSync(path.join(cache, shell)).find((d) => d.startsWith('chrome-')), 'chrome-headless-shell');
const ejecutable = existsSync(bin) ? bin : undefined;

mkdirSync(dest, { recursive: true });
const ids = readdirSync(path.join(dir, 'vistas')).filter((f) => f.endsWith('.html') && !f.endsWith('.doc.html')).map((f) => f.replace('.html', '')).filter((id) => !filtro || filtro.some((s) => id.startsWith(s)));
const browser = await chromium.launch({ executablePath: ejecutable, args: ['--force-prefers-reduced-motion'] });
for (const id of ids) {
  const en = /-en$/.test(id) || id.includes('-resumen-en');
  const cuerpo = readFileSync(path.join(dir, 'vistas', `${id}.html`), 'utf8').replace(/ data-estado="inicial"/g, ' data-estado="oculta"');
  const html = `<!doctype html><html lang="${en ? 'en' : 'es'}" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${dir}/admin.css"><style>${fuentes}</style></head><body>${cuerpo}</body></html>`;
  const archivo = path.join(dir, 'vistas', `${id}.doc.html`);
  writeFileSync(archivo, html);
  for (const [w, h] of ANCHOS[id] ?? [[1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', locale: en ? 'en-US' : 'es-MX' });
    const page = await ctx.newPage();
    await page.goto('file://' + archivo);
    // React agrupa la revelación de los <Suspense> (hasta ~2.3 s tras cargar): se espera a que no quede ninguna plantilla B:n pendiente.
    await page.waitForFunction(() => !document.querySelector('template[id^="B:"]'), null, { timeout: 8000 }).catch(() => console.log('AVISO: quedan boundaries sin revelar en', id));
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForTimeout(80);
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (desborde > 0) console.log(`DESBORDE ${id} ${w}: ${desborde}px`);
    // Página completa: el contenido de /admin scrollea dentro de .rv-contenido, así que se captura también la altura total del scroller.
    const alto = await page.evaluate(() => { const c = document.querySelector('.rv-contenido'); return c ? c.scrollHeight : document.documentElement.scrollHeight; });
    const nombre = ANCHOS[id] ? `${id}-${w}` : id;
    // Página completa: un solo PNG con la altura total del scroller (tope 6000 px); si cabe en el viewport, el viewport.
    const arriba = await page.evaluate(() => document.querySelector('.rv-contenido')?.getBoundingClientRect().top ?? 0);
    if (alto + arriba > h) {
      // Al crecer el viewport el layout puede cambiar de altura: se vuelve a medir hasta que se estabiliza (máx. 3 pasadas).
      let alto2 = alto;
      for (let i = 0; i < 3; i++) {
        await page.setViewportSize({ width: w, height: Math.min(alto2 + 8, 6000) });
        await page.waitForTimeout(60);
        const nuevo = await page.evaluate(() => { const c = document.querySelector('.rv-contenido'); return c ? c.scrollHeight + c.getBoundingClientRect().top : document.documentElement.scrollHeight; });
        if (nuevo <= alto2 + 8) break;
        alto2 = nuevo;
      }
    }
    await page.waitForTimeout(60);
    await page.screenshot({ path: path.join(dest, `${nombre}.png`) });
    console.log('captura', nombre, 'alto contenido', alto);
    await ctx.close();
  }
}
await browser.close();
