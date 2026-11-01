// Captura L11: el Inicio de cinco_agentes en 1440 y 390, claro y oscuro (HTML de l11.harness.tsx + CSS de compilar-css.mjs). CHROMIUM_EXE opcional.
// captura-c.harness.tsx (UI2_SOLO_HTML=1) y el CSS que compila compilar-css.mjs. Uso:
//   UI2_TRABAJO=DIR UI2_SOLO_HTML=1 npx vitest run --config scripts/ui2-captura/vitest.config.mts captura-c.harness
//   node scripts/ui2-captura/compilar-css.mjs DIR && node scripts/ui2-captura/capturar-resumen.mjs DIR DEST [vistas,separadas,por,coma]
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
const vistas = (lista ?? 'l11-01-dueno-con-pesos,l11-02-encargado-sin-pesos,l11-03-flota-nueva,l11-04-fallo-de-lector').split(',');
const fuentes = [
  ...[400, 500, 600, 700].map((w) => `@font-face{font-family:'Hanken Grotesk UI';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/hankengrotesk-${w}.woff2') format('woff2')}`),
  ...[400, 500].map((w) => `@font-face{font-family:'IBM Plex Mono';font-weight:${w};font-style:normal;font-display:block;src:url('file://${F}/plexmono-${w}.woff2') format('woff2')}`),
  `html{--font-mono:'IBM Plex Mono'}`,
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif;--font-display:'Hanken Grotesk UI',ui-sans-serif,system-ui,sans-serif}`,
].join('\n');
mkdirSync(dest, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_EXE ? { executablePath: process.env.CHROMIUM_EXE } : {});
let n = 0;
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', locale: 'es-MX', deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const id of vistas) {
    const html = `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${dir}/v2full.css"><style>${fuentes}</style></head><body>${readFileSync(path.join(dir, 'vistas', `${id}.html`), 'utf8').replace(/ data-estado="inicial"/, ' data-estado="oculta"')}</body></html>`;
    const archivo = path.join(dir, 'vistas', `${id}.doc.html`);
    writeFileSync(archivo, html);
    for (const tema of ['claro', 'oscuro']) {
      await page.goto('file://' + archivo);
      await page.evaluate(async (t) => { document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'); await document.fonts.ready; }, tema);
      await page.waitForTimeout(1500);
      const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (desborde > 0) console.log(`DESBORDE ${id} ${w} ${tema}: ${desborde}px`);
      await page.screenshot({ path: path.join(dest, `${id}__${w}__${tema}.png`), fullPage: true });
      n++;
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`${n} capturas -> ${dest}`);
