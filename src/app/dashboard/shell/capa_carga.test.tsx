/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio repo por una ruta fija relativa a este archivo. */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Cargando from '../../cargando';
import { ChartState } from '../../ui-v2/graficas';
import { MARCA_CARGA_PAGINA, PENDIENTE } from './capa-carga';

// La señal «hay una pantalla de carga de PÁGINA pendiente» es un atributo explícito de `cargando.tsx` (loading.tsx), no una
// coincidencia de role/aria-label/clase: así una tarjeta en estado «cargando» (ChartState) jamás levanta la capa global ni se oculta.

const CSS = readFileSync(fileURLToPath(new URL('../../ui-v2/carga.css', import.meta.url)), 'utf8');

describe('selector de la pantalla de carga de página contra el DOM real', () => {
  it('cargando.tsx (loading.tsx) lleva la marca explícita', () => {
    expect(renderToStaticMarkup(<Cargando />)).toContain(`${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"`);
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
    expect(CSS).toContain(`[data-ui="v2"] .rv-contenido [${MARCA_CARGA_PAGINA.atributo}="${MARCA_CARGA_PAGINA.valor}"] { visibility: hidden; }`);
  });
});
