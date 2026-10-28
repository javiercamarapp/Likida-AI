// Fase 0.4: compara Inter / Hanken / sistema en v2 sobre las mismas vistas.
// Mide: ancho total de texto (suma de anchos de línea), elementos truncados/desbordados
// y desborde horizontal del documento, a 1440 y 412. Salida JSON en stdout.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(raiz, 'package.json'))('playwright');
const OUT = path.join(homedir(), 'likida-loop/frontend-plan/.arnes');
const vistas = readdirSync(path.join(OUT, 'vistas')).filter((f) => f.endsWith('.doc.html'));
const browser = await chromium.launch();
const res = {};
for (const fuente of ['inter', 'hanken', 'sistema']) {
  const fam = { inter: "'Inter'", hanken: "'Hanken Grotesk'", sistema: '-apple-system,system-ui' }[fuente];
  for (const w of [1440, 412]) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    let texto = 0, trunc = 0, desborde = 0, altoDoc = 0;
    for (const f of vistas) {
      await page.goto('file://' + path.join(OUT, 'vistas', f));
      await page.evaluate(([fam]) => {
        for (const l of document.querySelectorAll('link[rel=stylesheet]')) if (/\/v[12]\.css$/.test(l.href)) l.href = l.href.replace(/v[12]\.css$/, 'v2.css');
        document.querySelector('.tema-neutro').setAttribute('data-ui', 'v2');
        const s = document.createElement('style');
        s.textContent = `[data-ui="v2"]{--font-sans-ui:${fam};--font-display:${fam}}`; document.head.appendChild(s);
      }, [fam]);
      await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(80);
      const m = await page.evaluate(() => {
        let t = 0, tr = 0;
        const main = document.getElementById('contenido-principal');
        const rango = document.createRange();
        const it = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        for (let n = it.nextNode(); n; n = it.nextNode()) { if (!n.textContent.trim()) continue; rango.selectNodeContents(n); t += rango.getBoundingClientRect().width; }
        for (const e of main.querySelectorAll('*')) if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible' && e.children.length === 0) tr++;
        return { t, tr, dw: main.scrollWidth - main.clientWidth, h: main.scrollHeight };
      });
      texto += m.t; trunc += m.tr; desborde += m.dw > 1 ? 1 : 0; altoDoc += m.h;
    }
    res[`${fuente}@${w}`] = { texto_px: Math.round(texto), truncados: trunc, vistas_con_scroll_horizontal: desborde, alto_total_px: altoDoc };
    await page.close();
  }
}
await browser.close();
console.log(JSON.stringify(res, null, 1));
