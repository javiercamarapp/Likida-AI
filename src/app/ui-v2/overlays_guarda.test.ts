/* eslint-disable security/detect-non-literal-fs-filename -- recorre el propio árbol de src/app */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// GUARDA L3: un solo motor de overlays. Ningún <dialog>, role="dialog"/"alertdialog", aria-modal ni showModal() fuera de
// `ui-v2/componentes/overlay.tsx`; ningún velo `fixed inset-0` a mano (solo el fondo decorativo); y las medidas de
// overlay no se vuelven a definir en otras hojas de estilo.
const APP = join(__dirname, '..');
const SRC = join(APP, '..'); // se escanea todo `src`, no solo `src/app`
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
const todos = archivos(SRC);
const codigo = todos.filter((f) => /\.(tsx|ts)$/.test(f) && !/\.test\.|harness|\.tmp\./.test(f));
const MOTOR = join(APP, 'ui-v2/componentes/overlay.tsx');
const ESCRITOS = /<dialog|showModal\s*\(|createElement\(\s*['"`]dialog|role\s*[=:]\s*\{?\s*['"`]?(alert)?dialog|aria-modal|ariaModal/;

describe('overlays: un solo motor', () => {
  it('<dialog>, role=dialog/alertdialog, aria-modal y showModal() solo viven en overlay.tsx', () => {
    const fuera: string[] = [];
    for (const f of codigo) {
      if (f === MOTOR) continue;
      if (ESCRITOS.test(sinComentarios(readFileSync(f, 'utf8')))) fuera.push(relative(SRC, f));
    }
    expect(fuera, 'overlay propio fuera del motor').toEqual([]);
  });

  it('ningún velo `fixed inset-0` a mano (el fondo decorativo es la única excepción)', () => {
    const velos: string[] = [];
    for (const f of codigo) {
      if (/fixed\s+inset-(0|x-0|y-0)|inset-0 z-/.test(sinComentarios(readFileSync(f, 'utf8'))) && !f.endsWith('/app/fondo.tsx') && !f.endsWith('/admin/mapa-prospectos/calles.tsx') && !f.endsWith('/admin/ui/notificaciones.tsx')) velos.push(relative(SRC, f));
    }
    expect(velos).toEqual([]);
  });

  it('las clases rv-ov / rv-pop / rv-menu se definen SOLO en overlay.css', () => {
    const otras: string[] = [];
    for (const f of todos.filter((x) => x.endsWith('.css') && !x.endsWith('/overlay.css') && !x.endsWith('globals.css'))) {
      const css = sinComentarios(readFileSync(f, 'utf8'));
      // Se permiten ajustes de contexto (`.rv-ov .rv-item` del shell) y las variantes de contenido `.rv-pop--info`.
      // Selectores de TODAS las reglas, también con @media multilínea o listas en varias líneas.
      for (const trozo of css.split('{').slice(0, -1)) {
        const sel = trozo.slice(Math.max(trozo.lastIndexOf('}'), trozo.lastIndexOf(';')) + 1).trim();
        if (sel.startsWith('@')) continue;
        for (const parte of sel.split(',')) {
          const plano = parte.replace('[data-ui="v2"]', '').trim();
          if (/\s/.test(plano.replace(/\[[^\]]*\]/g, ''))) continue; // ajuste de contexto (`.rv-ov .rv-item`): no redefine el overlay
          const base = plano.split(/[:[]/)[0];
          if (/^\.rv-(ov|pop|menu)/.test(base) && !base.startsWith('.rv-pop--')) otras.push(`${relative(SRC, f)}: ${base}`);
        }
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
