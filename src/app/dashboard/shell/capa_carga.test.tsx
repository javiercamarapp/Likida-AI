/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EsqPagina } from '../../ui-v2/componentes';
import Cargando from '../../cargando';
import Loading from '../loading';
import { ChartState } from '../../ui-v2/graficas';
import { anotarVista, CLAVE_TELON, leerPrimeraVez, MARCA_CARGA_PAGINA, PENDIENTE } from './capa-carga';

// La señal «hay una pantalla de carga de PÁGINA pendiente» es un atributo explícito de `cargando.tsx` (loading.tsx), no una
// coincidencia de role/aria-label/clase: así una tarjeta en estado «cargando» (ChartState) jamás levanta la capa global ni se oculta.

const CSS = readFileSync(fileURLToPath(new URL('../../ui-v2/carga.css', import.meta.url)), 'utf8');

describe('selector de la pantalla de carga de página contra el DOM real', () => {
  it('loading.tsx (esqueleto de la pantalla) lleva la marca explícita', () => {
    expect(renderToStaticMarkup(<Loading />)).toContain(`${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"`);
    expect(renderToStaticMarkup(<EsqPagina />)).toContain(`${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"`);
  });

  it('cargando.tsx (la pantalla de carga de /admin) conserva su marca', () => {
    expect(renderToStaticMarkup(<Cargando />)).toContain(`${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"`);
  });

  it('el esqueleto de la pantalla no lleva logo: el logo es del telón de la primera carga', () => {
    expect(renderToStaticMarkup(<Loading />)).not.toContain('likida-respira');
  });

  it('ChartState «cargando» — con o sin mensaje — NO lleva la marca', () => {
    for (const mensaje of [undefined, 'Cargando']) {
      const html = renderToStaticMarkup(<ChartState estado="cargando" mensaje={mensaje} />);
      expect(html).toContain('role="status"');
      expect(html).not.toContain(MARCA_CARGA_PAGINA.atributo);
    }
  });

  it('el selector del controlador y el del CSS son el mismo atributo, sin :has (sin SyntaxError en navegadores viejos)', () => {
    expect(PENDIENTE).toBe(`.rv-contenido [${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"]`);
    expect(PENDIENTE).not.toContain(':has');
    // El esqueleto de página YA NO se oculta: se ve en cada navegación (solo la primera carga de la sesión lo tapa el telón).
    expect(CSS).not.toContain(`[${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"] { visibility: hidden; }`);
  });
});


describe('«solo la primera carga de la sesión» (sessionStorage con try/catch)', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const almacen = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };

  it('sin la marca es la primera vez; tras anotar, ya no', () => {
    vi.stubGlobal('window', { sessionStorage: almacen() });
    expect(leerPrimeraVez()).toBe(true);
    anotarVista();
    expect(leerPrimeraVez()).toBe(false);
    expect(CLAVE_TELON).toBe('likida.telon.visto');
  });

  it('si el almacenamiento lanza (modo privado, bloqueado), no revienta: cuenta como primera vez y anotar no falla', () => {
    const lanza = () => { throw new Error('bloqueado'); };
    vi.stubGlobal('window', { sessionStorage: { getItem: lanza, setItem: lanza } });
    expect(leerPrimeraVez()).toBe(true);
    expect(() => anotarVista()).not.toThrow();
  });
});
