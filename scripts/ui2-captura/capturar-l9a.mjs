// Captura las vistas del arnés L9a. Uso: node scripts/ui2-captura/capturar-l9a.mjs --out=DIR --dest=DIR [--vistas=a,b] [--anchos=1440x900,390x844]
// Documento = CSS compilado (v2full) + login.css + fuentes locales por archivo; la partícula del login se ejecuta de verdad.
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const OUT = arg.out ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l9a');
const dest = arg.dest ?? path.join(homedir(), 'likida-loop/cierre100/capt-l9a');
const F = path.join(homedir(), 'likida-loop/frontend-plan/fuentes-spike');
const V = path.join(homedir(), 'vexa/apps/web/public/fonts/login');
const ff = (fam, w, f) => `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:block;src:url('file://${f}') format('woff2')}`;
const fuentes = [
  ...[400, 500, 600, 700].map((w) => ff('Hanken Grotesk UI', w, `${F}/hankengrotesk-${w}.woff2`)),
  ...[400, 500].map((w) => ff('IBM Plex Mono', w, `${F}/plexmono-${w}.woff2`)),
  ff('Fraunces', 400, `${V}/fraunces-latin-400.woff2`),
  ff('Instrument Sans', '400 600', `${V}/instrument-sans-latin.woff2`),
  ff('Likida Login Mono', 400, `${V}/ibm-plex-mono-400.woff2`),
  `html{--font-sans-ui:'Hanken Grotesk UI';--font-display:'Hanken Grotesk UI';--font-mono:'IBM Plex Mono';--font-instrument:'Instrument Sans';--font-fraunces:'Fraunces'}`,
  `[data-ui="v2"]{--font-sans-ui:'Hanken Grotesk UI';--font-display:'Hanken Grotesk UI'}`,
].join('\n');
const css = readFileSync(path.join(OUT, 'v2full.css'), 'utf8') + '\n' + readFileSync(path.join(raiz, 'src/app/ui-v2/marco-publico.css'), 'utf8') + '\n' + readFileSync(path.join(raiz, 'src/app/login/login.css'), 'utf8') + '\n' + fuentes;
const motor = readFileSync(path.join(raiz, 'src/components/login/particle-engine.js'), 'utf8').replace(/export \{ Te as mountLoginParticles \};?/, 'window.mountLoginParticles = Te;');
const pub = path.join(raiz, 'public');
const dataUri = (f) => `data:image/png;base64,${readFileSync(path.join(pub, 'images', f)).toString('base64')}`;
const ANCHOS = (arg.anchos ?? '1440x900,390x844').split(',').map((a) => a.split('x').map(Number));
const vistas = readdirSync(path.join(OUT, 'vistas')).filter((f) => f.endsWith('.html') && !f.endsWith('.doc.html')).map((f) => f.replace('.html', '')).filter((v) => !arg.vistas || arg.vistas.split(',').some((s) => v.startsWith(s)));
mkdirSync(dest, { recursive: true });
const browser = await chromium.launch();
for (const [w, h] of ANCHOS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce', locale: 'es-MX' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  for (const v of vistas) {
    const cuerpo = readFileSync(path.join(OUT, 'vistas', `${v}.html`), 'utf8').replace(/url\(\/images\/([\w.-]+)\)/g, (_m, f) => `url(${dataUri(f)})`).replaceAll('src="/images/', `src="file://${pub}/images/`);
    const doc = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><style>${css}</style></head><body>${cuerpo}<script>${motor}\nconst c=document.querySelector('.login-artwork canvas');if(c&&matchMedia('(min-width:1024px)').matches){const m=()=>mountLoginParticles(c,'sphere',true);document.fonts.load('36px "Likida Login Mono"').then(m,m);}</script></body></html>`;
    const archivo = path.join(OUT, 'vistas', `${v}.doc.html`);
    writeFileSync(archivo, doc);
    for (const tema of ['claro', 'oscuro']) {
      await page.goto('file://' + archivo);
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'), tema);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(dest, `${v}__${w}__${tema === 'claro' ? 'light' : 'dark'}.png`), fullPage: v.startsWith('login') ? false : true });
    }
  }
  await ctx.close();
}
await browser.close();
console.log('listo', dest);
