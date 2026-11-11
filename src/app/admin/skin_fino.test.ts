/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio /admin */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// K3 · /admin pasa al sistema fino de controles: carga tokens.css y el marco lleva data-ui="v2" (los campos, chips, tooltips y
// cajones heredan alto 32, radio 8/12, borde 1 px y trazo 1.75). R8 (7-nov-2026): se unifica la fuente con el dashboard (Hanken, fonts.css) y el marco usa `.rv-*` de shell.css.
const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8');

describe('/admin: skin fino (K3)', () => {
  it('el layout carga tokens.css antes que las hojas del kit y SÍ carga fonts.css (decisión de unificar la fuente, 7-nov-2026; reemplaza a D3)', () => {
    const l = leer('layout.tsx');
    expect(l).toContain("import '../ui-v2/tokens.css';");
    expect(l.indexOf('tokens.css')).toBeLessThan(l.indexOf('componentes.css'));
    expect(l).toContain("import '../ui-v2/fonts.css';");
    expect(l).toContain("import '../ui-v2/shell.css';");
  });
  it('el marco lleva data-ui="v2" y usa las clases del marco del dashboard (CLASES_V2)', () => {
    const c = leer('chrome.tsx');
    expect(c).toContain('data-ui="v2"');
    expect(c).toContain('CLASES_V2.raiz');
    expect(c).toContain('CLASES_V2.columna');
    expect(c).not.toContain('glass-panel');
  });
  it('el ítem activo se marca con aria-current (el activo gris lo pinta .rv-item de shell.css, no una pastilla negra)', () => {
    const s = leer('sidebar-nav.tsx');
    expect(s).toContain('aria-current');
    expect(s).toContain('className="rv-item"');
    expect(s).not.toMatch(/background:\s*'var\(--marca\)'/);
  });
  it('el botón de cerrar sesión usa .rv-icono-boton (32x32, zona táctil de 44 px por ::after en shell.css)', () => {
    // El botón vive en un componente de cliente (para leer el idioma activo); el <form> sigue en el servidor.
    expect(leer('chrome.tsx')).toMatch(/<form action=\{cerrarSesion\}[\s\S]{0,120}<BotonSalirAdmin \/>/);
    expect(leer('salir-admin.tsx')).toMatch(/aria-label=\{t\('pie\.cuenta\.salir'\)\}[\s\S]{0,100}rv-icono-boton/);
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
