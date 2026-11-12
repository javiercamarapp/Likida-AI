import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard/agentes/peajes',
}));
const { default: CabeceraEscritorio } = await import('./cabecera-escritorio');

const FUENTES = ['cabecera-escritorio.tsx', 'navegacion-v2.tsx', 'sidebar-v2.tsx', 'cabecera-movil.tsx', 'menu-guia.tsx', 'barra-inferior.tsx'];
// eslint-disable-next-line security/detect-non-literal-fs-filename -- el nombre sale de la lista fija de este archivo (sin entrada de usuario).
const leer = (f: string) => readFileSync(join(process.cwd(), 'src/app/dashboard/shell', f), 'utf8');

describe('CabeceraEscritorio: título, Guía pegada al título y ⌘K visible (identidad Rovaq, S1)', () => {
  const html = renderToStaticMarkup(<CabeceraEscritorio rol="flota_admin" perfil="cinco_agentes" />);

  it('lleva el título con el nombre EXACTO de la entrada del menú, decorativo (el h1 de la página ya lo dice)', () => {
    expect(html).toContain('rv-cab-esc__titulo');
    expect(html).toContain('Conciliación de peajes');
    expect(html).toMatch(/class="rv-cab-esc__titulo" aria-hidden="true"/);
  });

  it('el orden es título, Guía: el botón Guía queda DESPUÉS del título y en el lado izquierdo', () => {
    const izq = html.indexOf('rv-cab-esc__izq');
    const der = html.indexOf('rv-cab-esc__der');
    const titulo = html.indexOf('rv-cab-esc__titulo');
    const guia = html.indexOf('rv-guia__btn');
    expect(izq).toBeGreaterThanOrEqual(0);
    expect(titulo).toBeGreaterThan(izq);
    expect(guia).toBeGreaterThan(titulo);
    expect(guia).toBeLessThan(der);
  });

  it('el buscador ⌘K tiene disparador visible con <kbd>, atajo anunciado y abre un diálogo', () => {
    expect(html).toContain('rv-cab-esc__buscar');
    expect(html).toMatch(/aria-keyshortcuts="Meta\+K Control\+K"/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('<kbd>⌘K</kbd>');
    expect(html.indexOf('rv-cab-esc__buscar')).toBeGreaterThan(html.indexOf('rv-cab-esc__der'));
  });

  it('la cabecera no trae botón de plegar (vive en la marca del sidebar) y no usa title=', () => {
    expect(html).not.toContain('rv-cab-esc__plegar');
    expect(html).not.toMatch(/title=/);
  });
});

describe('title= en el shell: ningún botón de solo icono lo usa', () => {
  it('los botones de icono del shell (plegar, Guía compacta, campana móvil) usan Tooltip', () => {
    for (const f of ['sidebar-v2.tsx', 'cabecera-movil.tsx']) {
      expect(leer(f), f).not.toMatch(/\btitle=/);
      expect(leer(f), f).toContain('Tooltip');
    }
    expect(leer('menu-guia.tsx')).not.toMatch(/\btitle=/);
  });

  it('la barra inferior móvil no repite con title= la etiqueta que ya muestra', () => {
    expect(leer('barra-inferior.tsx')).not.toMatch(/\btitle=/);
  });

  it('solo quedan title= en filas CON texto visible del árbol (se ven en el riel)', () => {
    const lineas = leer('navegacion-v2.tsx').split('\n').filter((l) => /\btitle=/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('{/*'));
    expect(lineas.length).toBeLessThanOrEqual(2);
    expect(FUENTES.length).toBeGreaterThan(0);
  });
});
