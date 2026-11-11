/* eslint-disable security/detect-non-literal-fs-filename -- lee archivos del propio repo */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R8 (7-nov-2026): el sidebar de /admin y el del dashboard comparten las clases del sistema (shell.css), el marco (CLASES_V2) y el riel.
const leer = (f: string) => readFileSync(join(__dirname, f), 'utf8');
const CLASES = ['rv-sb__marca', 'rv-sb__logo', 'rv-sb__plegar', 'rv-grupo__t', 'rv-grupo__tog', 'rv-grupo__cuerpo', 'rv-lista', 'rv-item', 'rv-item__ico', 'rv-item__txt'];

describe('sidebar de /admin = sidebar del dashboard (mismas clases del sistema)', () => {
  const admin = leer('sidebar-nav.tsx') + leer('chrome.tsx');
  const dash = leer('../dashboard/shell/sidebar-v2.tsx') + leer('../dashboard/shell/navegacion-v2.tsx');
  it.each(CLASES)('ambos usan %s', (c) => {
    expect(admin).toContain(c);
    expect(dash).toContain(c);
  });
  it('usan el mismo ancho/colapso: useRiel y ALTO_LOGO_PX', () => {
    for (const t of [admin, dash]) {
      expect(t).toContain('useRiel');
      expect(t).toContain('ALTO_LOGO_PX');
    }
  });
  it('admin no trae un ancho propio: 232/72 salen de shell.css', () => {
    expect(admin).not.toMatch(/w-\[232px\]|w-\[72px\]|glass-panel/);
  });
  it('conserva la lista de rutas de rutas.ts: las secciones salen de SECCIONES (Agentes, Negocio, Control, Sistema; sin «Plataforma»)', () => {
    const s = leer('sidebar-nav.tsx');
    expect(s).toContain('SECCIONES');
    expect(s).not.toMatch(/PLATAFORMA|Plataforma/);
    // Cada sección trae su icono en el riel (72 px): sin él, la sección desaparece al plegar el menú.
    for (const n of ['Agentes', 'Negocio', 'Control', 'Sistema']) expect(s).toMatch(new RegExp(`${n}: \\w+`));
  });
});
