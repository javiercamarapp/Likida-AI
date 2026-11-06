/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- lee las hojas del propio repo por rutas fijas relativas a este archivo. */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// CONTROLES FINOS, carril K2-1 (SPEC-CONTROLES-FINOS §2.4–§2.6): los overlays leen tokens y miden como Rovaq.
// Cada aserción cita la sección del spec que la motiva. Las hojas se parsean como texto: sin navegador.
const CSS = readFileSync(join(__dirname, 'overlay.css'), 'utf8');
const sin = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Cuerpo de la primera regla cuyo selector (lista completa antes de `{`) contiene exactamente ese selector. */
function regla(selector: string): string {
  for (const m of sin.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) return m[2];
  }
  throw new Error(`no encontré la regla ${selector}`);
}

describe('overlay.css fino (K2-1)', () => {
  it('el cajón y el modal: radio 12, título 15/600, cerrar 28x28 (32 en hoja)', () => {
    expect(regla('.rv-ov__panel')).toMatch(/border-radius:\s*12px/);
    const t = regla('.rv-ov__titulo');
    expect(t).toMatch(/font-size:\s*15px/);
    expect(t).toMatch(/font-weight:\s*600/);
    const c = regla('.rv-ov__cerrar');
    expect(c).toMatch(/width:\s*28px/);
    expect(c).toMatch(/height:\s*28px/);
    expect(sin).toMatch(/@media \(max-width: 819px\)[^@]*\.rv-ov__cerrar \{ width: 32px; height: 32px; \}/);
  });

  it('encabezado y pie leen el borde de reposo (1 px) en vez de un gris suelto', () => {
    expect(regla('.rv-ov__cab')).toMatch(/border-bottom:\s*1px solid var\(--borde-reposo,\s*var\(--line\)\)/);
    expect(regla('.rv-ov__pie')).toMatch(/border-top:\s*1px solid var\(--borde-reposo,\s*var\(--line\)\)/);
    expect(regla('.rv-ov__marca')).toMatch(/border-top:\s*1px solid var\(--borde-reposo,\s*var\(--line\)\)/);
  });

  it('el pie y la cabecera usan controles de 28 px (.rv-btn--sm dentro de .rv-ov)', () => {
    const r = regla('[data-ui="v2"] .rv-ov .rv-btn--sm');
    expect(r).toMatch(/min-height:\s*var\(--ov-btn-sm,\s*28px\)/);
  });

  it('popover y menú: radio 12, borde de reposo, item a la altura de control (32)', () => {
    const p = regla('.rv-pop');
    expect(p).toMatch(/border-radius:\s*12px/);
    expect(p).toMatch(/border:\s*1px solid var\(--borde-reposo,/);
    const i = regla('.rv-menu__item');
    expect(i).toMatch(/min-height:\s*var\(--ctl-h,\s*32px\)/);
    expect(i).toMatch(/font:\s*500 13px/);
    expect(regla('.rv-menu__item:hover')).toMatch(/background:\s*var\(--ui-soft,/);
  });

  it('tooltip corto: pastilla de tokens, radio --r-tip (8), padding 6x10, 12/500, sin ancho mínimo de 160', () => {
    const r = regla('.rv-pop--tip');
    expect(r).toMatch(/background:\s*var\(--tip-bg,/);
    expect(r).toMatch(/color:\s*var\(--tip-fg,/);
    expect(r).toMatch(/border-radius:\s*var\(--r-tip,\s*8px\)/);
    expect(r).toMatch(/padding:\s*6px 10px/);
    expect(r).toMatch(/font-size:\s*var\(--t-small\)/);
    expect(r).toMatch(/font-weight:\s*500/);
    expect(r).not.toMatch(/min-width:\s*160px/);
    expect(r).toMatch(/max-width:\s*min\(280px/);
  });

  it('la franja de marca del cajón mide 64 px de ancho y opacidad .6', () => {
    expect(sin).toMatch(/\.rv-ov__marca svg\s*\{[^}]*width:\s*64px/);
    expect(regla('.rv-ov__marca')).toMatch(/opacity:\s*\.6/);
  });

  it('movimiento: entradas <= 180 ms y sin desenfoque', () => {
    for (const m of sin.matchAll(/animation:[^;]*?(\d+)ms/g)) expect(Number(m[1])).toBeLessThanOrEqual(180);
    expect(sin).not.toMatch(/blur\(|backdrop-filter/);
  });

  it('ningún .rv-ov* / .rv-pop* se define en otra hoja (salvo ajustes de contexto con descendiente)', () => {
    const app = join(__dirname, '..');
    const css: string[] = [];
    const recorre = (d: string) => { for (const n of readdirSync(d)) { if (n === 'node_modules') continue; const p = join(d, n); if (statSync(p).isDirectory()) recorre(p); else if (p.endsWith('.css')) css.push(p); } };
    recorre(app);
    for (const f of css.filter((x) => !x.endsWith('/overlay.css') && !x.endsWith('globals.css'))) {
      const txt = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of txt.matchAll(/(^|\})\s*(?:\[data-ui="v2"\]\s*)?(\.rv-(?:ov|pop|menu)[\w-]*)\s*\{/g)) {
        if (!m[2].startsWith('.rv-pop--')) throw new Error(`${f} redefine ${m[2]}`);
      }
    }
  });
});
