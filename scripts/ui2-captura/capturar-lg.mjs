/* eslint-disable security/detect-non-literal-fs-filename -- el arnés lee y escribe rutas de salida propias */
// Capturas del lote 7: empaqueta lg.muestrario.tsx con las piezas REALES, compila el CSS REAL (Tailwind de globals + capa v2) y
// fotografía 1440 y 390 en claro y oscuro. Uso: node scripts/ui2-captura/capturar-lg.mjs [--dest=DIR]
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(raiz, 'package.json'));
const { chromium } = require('playwright');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const { build } = await import(require.resolve('vite'));
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
const dest = arg.dest ?? path.join(homedir(), 'likida-loop/cierre100/capt-lg');
mkdirSync(dest, { recursive: true });
const src = path.join(raiz, 'src');

// 1) CSS: globals.css (Tailwind escaneando solo lo que usa el muestrario) + toda la capa v2 como la importa dashboard/layout.tsx.
const globals = readFileSync(path.join(src, 'app/globals.css'), 'utf8');
const base = globals.replace('@import "tailwindcss";', `@import "tailwindcss" source(none);\n@source "${src}/app/dashboard/configuracion";\n@source "${src}/app/dashboard/clientes";\n@source "${src}/app/dashboard/convenios";\n@source "${src}/app/ui-v2";`);
const capa = ['tokens', 'shell', 'carga', 'componentes', 'overlay', 'piezas', 'graficas', 'movimiento', 'paginas', 'paginas-dominio'].map((n) => `@import "./ui-v2/${n}.css";`).join('\n');
const entradaCss = path.join(src, 'app', '.arnes-lg.css');
writeFileSync(entradaCss, `${base}\n${capa}\n`);
let css;
try { css = (await postcss([tailwind({ base: raiz })]).process(readFileSync(entradaCss, 'utf8'), { from: entradaCss })).css; } finally { unlinkSync(entradaCss); }

// 2) JS: el muestrario con next/link y next/navigation sustituidos (el navegador no los necesita).
const fx = path.join(src, 'app/ui-v2/__fixtures__');
const r = await build({
  configFile: false, logLevel: 'error', root: raiz,
  resolve: { alias: { '@': src, 'next/link': path.join(fx, 'next-link-prueba.tsx'), 'next/navigation': path.join(fx, 'next-navigation-prueba.ts') } },
  define: { 'process.env.NODE_ENV': '"production"' },
  build: { write: false, minify: false, lib: { entry: path.join(raiz, 'scripts/ui2-captura/lg.muestrario.tsx'), formats: ['iife'], name: 'LG', fileName: 'lg' } },
});
const js = (Array.isArray(r) ? r[0] : r).output.find((o) => o.type === 'chunk').code;

const fuentes = readFileSync(path.join(homedir(), 'likida-loop/frontend-plan/.arnes/fuentes.css'), 'utf8');
const doc = `<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><style>${css}\n${fuentes}</style></head><body><div id="raiz"></div><script>${js.replace(/<\/script>/g, '<\\/script>')}</script></body></html>`;
writeFileSync(path.join(dest, '_muestrario.html'), doc);

const browser = await chromium.launch();
for (const [w, h, nombre] of [[1440, 1500, '1440'], [390, 2700, '390']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', locale: 'es-MX' });
  const page = await ctx.newPage();
  for (const tema of ['claro', 'oscuro']) {
    await page.goto('file://' + path.join(dest, '_muestrario.html'));
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t === 'claro' ? 'light' : 'dark'), tema);
    await page.waitForSelector('#c-col svg');
    await page.waitForTimeout(250);
    const tag = `${nombre}-${tema}`;
    const foto = (n) => page.screenshot({ path: path.join(dest, `${n}-${tag}.png`), fullPage: false });
    await foto('base');
    // Tooltip de columnas (foco por teclado), con variación contra la semana anterior
    await page.focus('#c-col [data-i="6"]'); await page.waitForTimeout(120); await foto('tip-columnas');
    // Estados: parcial, sin dato y estimado (la tercera columna sin dato; la última parcial)
    await page.focus('#c-hueco [data-i="5"]'); await page.waitForTimeout(120); await foto('tip-parcial');
    await page.focus('#c-hueco [data-i="2"]'); await page.waitForTimeout(120); await foto('tip-sin-dato');
    // Área: crosshair + tooltip con el teclado
    await page.focus('#c-area svg'); await page.keyboard.press('End'); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(120); await foto('tip-area');
    // Agrupadas: todas las series y el total
    await page.focus('#c-agr [data-i="2"]'); await page.waitForTimeout(120); await foto('tip-agrupadas');
    // Tabla alterna abierta
    await page.evaluate(() => { document.activeElement?.blur(); document.querySelectorAll('details.rv-tabla-grafica').forEach((d) => { d.open = true; }); });
    await page.waitForTimeout(120); await foto('tablas');
  }
  await ctx.close();
}
await browser.close();
console.log('listo', dest);
