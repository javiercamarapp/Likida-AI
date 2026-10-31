/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo (o de UI2_CSS_DIR en la prueba de rojo) */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EncabezadoPagina } from './componentes';
import { reglasSinAmbito } from './css_reglas';
import snapshot from './__fixtures__/v1_reglas_sin_ambito.json';

// INVARIANCIA v1. /dashboard/puesta-en-marcha pinta EncabezadoPagina/Drawer/Chip/Switch de ui-v2 TAMBIÉN para
// tenants v1, y layout.tsx carga componentes.css y graficas.css en todo /dashboard. Por eso toda regla de esos
// archivos que NO cuelga de [data-ui="v2"] debe ser exactamente la que ya había antes del rediseño.
const DIR = process.env.UI2_CSS_DIR ?? __dirname;

describe.each(['componentes', 'graficas'] as const)('v1 intacto · %s.css', (archivo) => {
  const actuales = reglasSinAmbito(readFileSync(join(DIR, `${archivo}.css`), 'utf8')).sort();
  const esperadas = [...snapshot[archivo]].sort();
  it('las reglas sin [data-ui="v2"] son idénticas a las de antes del rediseño', () => {
    expect(actuales.filter((r) => !esperadas.includes(r)), 'reglas sin ámbito NUEVAS o cambiadas (tocan v1)').toEqual([]);
    expect(esperadas.filter((r) => !actuales.includes(r)), 'reglas v1 que desaparecieron').toEqual([]);
  });
});

describe('v1 intacto · marcado', () => {
  it('el rótulo del encabezado conserva etiqueta-mono (la pantalla v1 lo usa)', () => {
    expect(renderToStaticMarkup(<EncabezadoPagina area="Puesta en marcha" titulo="x" />)).toContain('rv-encabezado__rotulo etiqueta-mono');
  });
});
