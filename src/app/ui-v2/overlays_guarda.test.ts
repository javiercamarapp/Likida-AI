/* eslint-disable security/detect-non-literal-fs-filename -- recorre el propio árbol de src/app */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// GUARDA L3: un solo motor de overlays. Ningún <dialog>, role="dialog"/"alertdialog", aria-modal ni showModal() fuera de
// `ui-v2/componentes/overlay.tsx`; ningún velo `fixed inset-0` a mano (solo el fondo decorativo); y las medidas de
// overlay no se vuelven a definir en otras hojas de estilo.
const APP = join(__dirname, '..');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

function archivos(dir: string, salida: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) archivos(p, salida);
    else salida.push(p);
  }
  return salida;
}
const todos = archivos(APP);
const codigo = todos.filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.|harness|\.tmp\./.test(f));
const MOTOR = join(APP, 'ui-v2/componentes/overlay.tsx');

describe('overlays: un solo motor', () => {
  it('<dialog>, role=dialog/alertdialog, aria-modal y showModal() solo viven en overlay.tsx', () => {
    const fuera: string[] = [];
    for (const f of codigo) {
      if (f === MOTOR) continue;
      if (/<dialog|showModal\s*\(|role=["']?(alert)?dialog|aria-modal/.test(sinComentarios(readFileSync(f, 'utf8')))) fuera.push(relative(APP, f));
    }
    expect(fuera, 'overlay propio fuera del motor').toEqual([]);
  });

  it('ningún velo `fixed inset-0` a mano (el fondo decorativo es la única excepción)', () => {
    const velos: string[] = [];
    for (const f of codigo) {
      if (/fixed inset-0|inset-0 z-/.test(sinComentarios(readFileSync(f, 'utf8'))) && !f.endsWith('/app/fondo.tsx') && !f.endsWith('/admin/mapa-prospectos/calles.tsx')) velos.push(relative(APP, f));
    }
    expect(velos).toEqual([]);
  });

  it('las clases rv-ov / rv-pop / rv-menu se definen SOLO en overlay.css', () => {
    const otras: string[] = [];
    for (const f of todos.filter((x) => x.endsWith('.css') && !x.endsWith('/overlay.css') && !x.endsWith('globals.css'))) {
      const css = sinComentarios(readFileSync(f, 'utf8'));
      // Se permiten ajustes de contexto (p. ej. `.rv-ov .rv-item` del shell) y las variantes de contenido `.rv-pop--info`.
      for (const m of css.matchAll(/(?:^|\n|\})\s*(?:\[data-ui="v2"\]\s*)?(\.rv-(?:ov|pop|menu)(?:__[a-z]+|--[a-z]+)?(?:\[[^\]]*\])?)\s*(?:[,{:])/g)) {
        if (!m[1].startsWith('.rv-pop--')) otras.push(`${relative(APP, f)}: ${m[1]}`);
      }
    }
    expect(otras).toEqual([]);
  });

  it('overlay.css respeta el contrato: entrada ≤ 180 ms y sin blur', () => {
    const css = sinComentarios(readFileSync(join(APP, 'ui-v2/overlay.css'), 'utf8'));
    expect(css).not.toMatch(/backdrop-filter|:not\(\[open\]\)[^{]*\{[^}]*animation/);
    for (const m of css.matchAll(/animation:[^;}]*?(\d+)ms/g)) expect(Number(m[1])).toBeLessThanOrEqual(180);
    // (que todo @keyframes/animation viva dentro de no-preference lo comprueba movimiento_css.test.ts sobre cada .css)
  });

  it('el motor no escribe style="" en el marcado (CSP con nonce); solo asigna por CSSOM al arrastrar o colocar', () => {
    const src = sinComentarios(readFileSync(MOTOR, 'utf8'));
    expect(src).not.toMatch(/dangerouslySetInnerHTML|<style/);
  });
});
