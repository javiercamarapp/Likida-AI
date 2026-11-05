/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio /admin */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// K3 · /admin pasa al sistema fino de controles: carga tokens.css y el marco lleva data-ui="v2" (los campos, chips, tooltips y
// cajones heredan alto 32, radio 8/12, borde 1 px y trazo 1.75). La fuente (Inter) NO cambia: no se carga fonts.css (D3).
const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('/admin: skin fino (K3)', () => {
  it('el layout carga tokens.css antes que las hojas del kit y no carga fonts.css', () => {
    const l = leer('layout.tsx');
    expect(l).toContain("import '../ui-v2/tokens.css';");
    expect(l.indexOf('tokens.css')).toBeLessThan(l.indexOf('componentes.css'));
    expect(l).not.toContain('fonts.css');
  });
  it('el marco lleva data-ui="v2" y el logo de 22 px', () => {
    const c = leer('chrome.tsx');
    expect(c).toMatch(/tema-neutro" data-ui="v2"/);
    expect(c).toContain('alto="h-[22px]"');
    expect(c).not.toContain('h-[18px]');
  });
  it('el ítem activo del menú es gris suave con peso 600, no pastilla negra', () => {
    const s = leer('sidebar-nav.tsx');
    expect(s).toContain("background: 'var(--nav-activo-bg)'");
    expect(s).toContain('font-semibold');
    expect(s).not.toMatch(/background:\s*'var\(--marca\)'/);
  });
  it('el botón de cerrar sesión (32x32) tiene zona táctil de 44 px', () => {
    const c = leer('chrome.tsx');
    expect(c).toMatch(/aria-label="Cerrar sesión"[\s\S]{0,400}relative[\s\S]{0,400}after:size-11/);
  });
  it('tokens.css no cambia nada fuera de un marco data-ui="v2" (el fondo global solo con :has)', () => {
    const t = readFileSync(join(__dirname, '../ui-v2/tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const sueltos = [...t.matchAll(/(?:^|\})\s*([^{}@]+)\{/g)].map((m) => m[1].trim()).filter((s) => s && !s.includes('data-ui="v2"'));
    expect(sueltos).toEqual([]);
  });
  it('/login no usa data-ui="v2" ni carga tokens.css', () => {
    const l = readFileSync(join(__dirname, '../login/page.tsx'), 'utf8') + readFileSync(join(__dirname, '../login/vista-login.tsx'), 'utf8');
    expect(l).not.toContain('data-ui="v2"');
    expect(l).not.toContain('tokens.css');
  });
});
