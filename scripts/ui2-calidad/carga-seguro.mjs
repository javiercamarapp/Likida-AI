// Seguro de la capa de carga SIN controlador (hidratación rota, chunk JS bloqueado, JS desactivado) y con cualquier preferencia
// de movimiento: a los 20 s la capa se retira y el marco queda VISIBLE (no una página en blanco). El HTML es el del arnés estático
// (el controlador cliente nunca corre aquí, que es exactamente el caso a cubrir) y NO se fuerza `data-estado="oculta"`.
//   node scripts/ui2-calidad/carga-seguro.mjs [--trabajo=DIR]      (un Chromium; ~25 s; bajo heavy.sh)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(raiz, 'package.json'))('playwright');
const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const TRABAJO = arg.trabajo ?? path.join(homedir(), 'likida-loop/frontend-plan/rovaq-method/.trabajo');
const htmlSrc = path.join(TRABAJO, 'c/vistas/c01-resumen-vacio.html');
const css = path.join(TRABAJO, 'c/v2full.css');
if (!existsSync(htmlSrc) || !existsSync(css)) { console.error('Falta render.sh: ' + htmlSrc); process.exit(2); }
const cuerpo = readFileSync(htmlSrc, 'utf8');
if (!cuerpo.includes('data-estado="inicial"')) { console.error('El HTML no trae la capa en data-estado="inicial"'); process.exit(2); }
const doc = path.join(TRABAJO, 'c/carga-seguro.html');
writeFileSync(doc, `<!doctype html><html lang="es" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="file://${css}"></head><body>${cuerpo}</body></html>`);

const CASOS = [
  { nombre: 'JS activo pero sin hidratar · movimiento normal', js: true, mov: 'no-preference' },
  { nombre: 'JS activo pero sin hidratar · reduced-motion', js: true, mov: 'reduce' },
  { nombre: 'JS desactivado · movimiento normal', js: false, mov: 'no-preference' },
  { nombre: 'JS desactivado · reduced-motion', js: false, mov: 'reduce' },
];
const medir = () => {
  const marco = document.querySelector('.rv-fila');
  const capa = document.querySelector('#rv-carga');
  const cs = getComputedStyle(capa);
  const tapa = cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none';
  const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
  return { marcoVisible: getComputedStyle(marco).visibility === 'visible', capaTapa: tapa, golpeaEnMarco: !!el && !!el.closest('.rv-fila'), golpeaEnCapa: !!el && !!el.closest('#rv-carga') };
};
const browser = await chromium.launch();
const paginas = [];
for (const c of CASOS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: c.js, reducedMotion: c.mov });
  const p = await ctx.newPage();
  await p.goto('file://' + doc);
  paginas.push([c, p]);
}
// t≈1 s: la capa está arriba (salvo sin JS, donde nunca se muestra) — sanidad de que se mide el estado inicial real.
await paginas[0][1].waitForTimeout(1000);
const inicial = await paginas[0][1].evaluate(medir);
let fallos = 0;
if (!inicial.capaTapa || inicial.marcoVisible) { console.log('ROJO sanidad: a 1 s la capa debe tapar el marco', JSON.stringify(inicial)); fallos++; }
await paginas[0][1].waitForTimeout(19800); // ≈ 20.8 s desde la carga
for (const [c, p] of paginas) {
  const r = await p.evaluate(medir);
  const ok = r.marcoVisible && !r.capaTapa && r.golpeaEnMarco && !r.golpeaEnCapa;
  console.log((ok ? 'OK    ' : 'ROJO  ') + c.nombre + ' → ' + JSON.stringify(r));
  if (!ok) fallos++;
}
await browser.close();
process.exit(fallos ? 1 : 0);
