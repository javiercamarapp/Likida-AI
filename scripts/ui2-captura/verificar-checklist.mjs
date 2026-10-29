// Mide en Chromium los puntos del checklist del spike (PLAN-MAESTRO §3-Fase 0.3)
// sobre el CSS compilado: lo que importa es el estilo CALCULADO, no el texto del CSS.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { chromium } = createRequire(path.join(raiz, 'package.json'))('playwright');
const OUT = path.join(homedir(), 'likida-loop/frontend-plan/.arnes');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const res = {};
for (const modo of ['v1', 'v1-tokens', 'v2']) {
  for (const tema of ['light', 'dark']) {
    await page.goto('file://' + path.join(OUT, 'vistas', '09-botones-chips.doc.html'));
    await page.evaluate(([m, t]) => {
      document.documentElement.setAttribute('data-theme', t);
      if (m === 'v2') document.querySelector('.tema-neutro').setAttribute('data-ui', 'v2');
    }, [modo, tema]);
    // v1 sin tokens.css: se mide con la hoja v1; las otras con la v2
    await page.evaluate((m) => { for (const l of document.querySelectorAll('link[rel=stylesheet]')) if (/\/v[12]\.css$/.test(l.href)) l.href = l.href.replace(/v[12]\.css$/, m === 'v1' ? 'v1.css' : 'v2.css'); }, modo);
    await page.waitForTimeout(150);
    res[`${modo}/${tema}`] = await page.evaluate(() => {
      const raiz = document.querySelector('.tema-neutro');
      const cs = (el) => getComputedStyle(el);
      const mk = (cls, tag = 'div') => { const e = document.createElement(tag); e.className = cls; e.textContent = 'x'; raiz.appendChild(e); return e; };
      const r = {};
      r.radius_lg = cs(mk('rounded-lg')).borderRadius;
      r.radius_xl = cs(mk('rounded-xl')).borderRadius;
      r.radius_2xl = cs(mk('rounded-2xl')).borderRadius;
      r.radius_md = cs(mk('rounded-md')).borderRadius;
      r.card_radius = cs(mk('card')).borderRadius;
      r.card_shadow = cs(mk('card')).boxShadow;
      r.glass_panel_radius = cs(mk('glass-panel')).borderRadius;
      r.texto_10 = cs(mk('text-[10px]')).fontSize;
      r.texto_10_5 = cs(mk('text-[10.5px]')).fontSize;
      r.texto_11 = cs(mk('text-[11px]')).fontSize;
      r.texto_12_5 = cs(mk('text-[12.5px]')).fontSize;
      const v = (n) => cs(raiz).getPropertyValue(n).trim();
      for (const n of ['--bg', '--surface', '--panel', '--canvas', '--ink', '--muted', '--line', '--marca', '--marca-fg', '--accent', '--ok', '--bad', '--warn', '--g5', '--color-bg', '--color-surface', '--color-ink', '--color-ok', '--color-bad', '--color-warn', '--senal', '--info', '--radius-lg', '--radius-xl', '--radius-2xl'])
        r['var' + n] = v(n);
      const tabla = document.querySelector('.card table tbody tr');
      r.tabla_divisor = tabla ? cs(tabla).borderBottomStyle : null;
      r.body_bg = cs(document.body).backgroundColor;
      r.chrome_font = cs(raiz).fontFamily.slice(0, 40);
      return r;
    });
  }
}
await browser.close();
writeFileSync(path.join(OUT, '..', 'spike', 'checklist.json'), JSON.stringify(res, null, 1));
for (const [k, r] of Object.entries(res)) console.log(k, JSON.stringify(r));
