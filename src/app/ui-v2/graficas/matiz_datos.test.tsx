/* eslint-disable security/detect-non-literal-fs-filename -- lee el CSS del propio módulo por rutas fijas. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TiraKpi, Sparkline, Columnas } from './index';

// El COLOR DE DATOS (8 matices, como Vexa) debe llegar a la serie y al filete de 3 px de cada KPI; el cromo sigue en negro/gris.
// Esta prueba sigue la cadena completa: data-matiz en el HTML → regla `[data-matiz=N]` → `--cat` → `--chart-N` (claro y oscuro).

const sinComentarios = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const graf = sinComentarios('graficas.css');
const tokens = sinComentarios('tokens.css');
const MATICES = [1, 2, 3, 4, 5, 6, 7, 8] as const;

describe('el color de datos llega a series y filetes de KPI', () => {
  const items = MATICES.map((m) => ({ etiqueta: `Métrica ${m}`, valor: m * 10, matiz: m, serie: [1, 3, 2, 5, 4, 6] }));
  const html = renderToStaticMarkup(<TiraKpi items={items} />);

  it('cada celda lleva su data-matiz y su sparkline el mismo', () => {
    for (const m of MATICES) {
      expect(html, `celda del matiz ${m}`).toContain(`class="rv-kpi" data-matiz="${m}"`);
      expect(html, `sparkline del matiz ${m}`).toContain(`class="rv-spark" data-matiz="${m}"`);
    }
  });

  it('el CSS asigna --cat = --chart-N a KPI, serie y gráfica de cada matiz, y el filete de 3 px se pinta con --cat', () => {
    for (const m of MATICES) {
      for (const sel of ['.rv-kpi', '.rv-spark', '.rv-gr']) {
        expect(graf, `${sel}[data-matiz="${m}"]`).toMatch(new RegExp(`\\[data-ui="v2"\\] \\${sel}\\[data-matiz="${m}"\\][^{]*\\{[^}]*--cat: var\\(--chart-${m},`));
      }
    }
    expect(graf).toMatch(/\.rv-kpi \{[^}]*border-top: 3px solid var\(--cat, transparent\)/);
    expect(graf).toMatch(/\.rv-spark__area \{ fill: var\(--cat/);
  });

  it('los 8 --chart-N son ocho colores distintos en claro y en oscuro (no hay un matiz gris por omisión)', () => {
    const bloques = [...tokens.matchAll(/--chart-1:[^;]+;[^}]*?--chart-8:\s*(#[0-9a-f]{6})/gi)];
    expect(bloques).toHaveLength(2); // [claro, oscuro]
    for (const b of bloques) {
      const hex = [...b[0].matchAll(/--chart-\d:\s*(#[0-9a-f]{6})/gi)].map((x) => x[1].toLowerCase());
      expect(hex).toHaveLength(8);
      expect(new Set(hex).size).toBe(8);
    }
  });

  it('Sparkline y Columnas aceptan los 8 matices y lo declaran en el HTML', () => {
    for (const m of MATICES) {
      expect(renderToStaticMarkup(<Sparkline valores={[1, 3, 2, 5]} matiz={m} />)).toContain(`data-matiz="${m}"`);
      expect(renderToStaticMarkup(<Columnas etiqueta="x" matiz={m} datos={[{ etiqueta: 'a', valor: 2 }, { etiqueta: 'b', valor: 4 }]} />)).toContain(`data-matiz="${m}"`);
    }
  });
});
