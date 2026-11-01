import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { reglasSinAmbito } from './css_reglas';
import { AreaMini, BarList, Cifra, Columnas, ColumnasAgrupadas, DonaMini, TiraCifras } from './graficas';
import { EstadoError, Tarjeta } from './componentes';
import Loading from '../dashboard/loading';
import { Proximamente } from '../dashboard/proximamente/proximamente';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

// ROLLBACK A v1: un tenant con tenant_ui='v1' ve las pantallas migradas SIN la capa [data-ui="v2"]. Las clases nuevas (marco, tarjeta, error,
// esqueletos, nota/atención/error de la cifra) deben traer una regla BASE sin ámbito (en paginas.css, que el snapshot de v1 no vigila) para que
// haya aire, caja y altura. Aquí se renderizan dos vistas migradas (Próximamente y el esqueleto de página) y se cruzan sus clases con el CSS.
const css = readFileSync(join(__dirname, 'paginas.css'), 'utf8');
const base = reglasSinAmbito(css).join('\n');

function clasesDe(html: string): string[] {
  return [...new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^rv-(marco|tarjeta|error|esq|kpi__(nota|atencion|error))/.test(c)))];
}

describe('fallback v1 de las piezas L2b', () => {
  const vistas: Record<string, string> = {
    proximamente: renderToStaticMarkup(<Proximamente contenido={{ nombre: 'Módulo', queHara: 'x', puntos: ['a'] }} hrefResumen="/dashboard" />),
    carga: renderToStaticMarkup(<Loading />),
    estados: renderToStaticMarkup(<><Tarjeta titulo="T" estado="error" reintentar /><EstadoError>x</EstadoError><TiraCifras><Cifra etiqueta="A" valor="1" nota="n" tono="warn" /><Cifra etiqueta="B" valor={null} estado="error" /></TiraCifras></>),
  };
  for (const [nombre, html] of Object.entries(vistas)) {
    it(`${nombre}: no pinta data-ui="v2" y cada clase nueva tiene regla base sin ámbito`, () => {
      expect(html).not.toContain('data-ui="v2"');
      const sin = clasesDe(html).filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(base));
      expect(sin).toEqual([]);
    });
  }
  it('el marco da padding y separación en v1 (MARCO_SCROLL ya no los da)', () => {
    expect(base).toMatch(/\.rv-marco \{[^}]*padding: 20px/);
    expect(base).toMatch(/\.rv-marco \{[^}]*gap: 12px/);
  });
  it('los esqueletos reservan altura y los errores llevan caja', () => {
    expect(base).toMatch(/\.rv-esq-fila \{[^}]*height: 40px/);
    expect(base).toMatch(/\.rv-esq-cuerpo\[data-alto="240"\] \{ height: 240px/);
    expect(base).toMatch(/\.rv-error \{[^}]*border: 1px solid/);
  });
});

// LG: las gráficas interactivas también se pintan con tenant_ui='v1' (Gasto por categoría, chat): cada clase de gráfica debe traer regla BASE
// sin ámbito, y la cinta táctil NO puede quedar visible por omisión.
describe('fallback v1 de las gráficas interactivas', () => {
  const html = renderToStaticMarkup(
    <>
      <Columnas etiqueta="C" datos={[{ etiqueta: 'a', valor: 2 }, { etiqueta: 'b', valor: null }, { etiqueta: 'c', valor: 4, parcial: true }]} />
      <ColumnasAgrupadas etiqueta="G" categorias={['S1', 'S2']} series={[{ nombre: 'A', valores: [1, 2] }, { nombre: 'B', valores: [3, null] }]} parciales={[1]} />
      <AreaMini etiqueta="A" valores={[1, null, 3, 4]} etiquetas={['a', 'b', 'c', 'd']} />
      <DonaMini etiqueta="D" gajos={[{ etiqueta: 'x', valor: 2 }, { etiqueta: 'y', valor: 1 }]} />
      <BarList etiqueta="B" items={[{ clave: 'a', etiqueta: 'a', valor: 3 }, { clave: 'b', etiqueta: 'b', valor: null }]} />
    </>,
  );
  const CLASES = ['rv-gr', 'rv-gr-plot', 'rv-gr-cinta', 'rv-gr__marca', 'rv-gr__nota', 'rv-gr__rejilla', 'rv-colum__base', 'rv-colum__golpe', 'rv-colum__barra', 'rv-colum__trama-raya',
    'rv-area__linea', 'rv-area__relleno', 'rv-area__punto', 'rv-leyenda-fina', 'rv-leyenda-series', 'rv-gt__sw', 'rv-tabla-grafica__caja', 'rv-dona__gajo', 'rv-dona__borde', 'rv-dona__leyenda', 'rv-barlist', 'rv-barlist__pista', 'rv-barlist__relleno', 'rv-sr'];
  it('no pinta data-ui="v2" y todas las clases que usa tienen regla base sin ámbito', () => {
    expect(html).not.toContain('data-ui="v2"');
    const usadas = CLASES.filter((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(html));
    expect(usadas.length).toBeGreaterThan(18);
    const sin = usadas.filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(base));
    expect(sin).toEqual([]);
  });
  it('la cinta táctil está oculta por omisión y el SVG no hereda 16 px de texto', () => {
    expect(base).toMatch(/\.rv-gr-cinta \{ display: none; \}/);
    expect(base).toMatch(/\.rv-gr__marca[^{]*\{[^}]*font: 500 12px/);
  });
});
