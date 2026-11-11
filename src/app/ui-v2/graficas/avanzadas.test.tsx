import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ColumnasApiladas, Columnas, Embudo, MapaCalor, TiraCifras, nivelCalor } from './index';

describe('gráficas avanzadas (B2)', () => {
  it('nivelCalor: nulo = sin dato, 0 = nivel 0, cuartiles del máximo', () => {
    expect(nivelCalor(null, 10)).toBeNull();
    expect(nivelCalor(0, 10)).toBe(0);
    expect(nivelCalor(1, 10)).toBe(1);
    expect(nivelCalor(5, 10)).toBe(2);
    expect(nivelCalor(10, 10)).toBe(4);
  });
  it('Embudo: cifra exacta, parte de la primera etapa y conversión; la etapa sin dato sale sin tasa inventada', () => {
    const h = renderToStaticMarkup(<Embudo etiqueta="Embudo" etapas={[{ etiqueta: 'Leads', valor: 200 }, { etiqueta: 'Citas', valor: 50 }, { etiqueta: 'Cierres', valor: null }]} />);
    expect(h).toContain('25.0% de «Leads»');
    expect(h).toContain('de «Leads»');
    expect(h).toContain('sin dato');
    expect(h).toContain('data-desconocido');
    expect(h).toContain('Ver como tabla');
    expect(h).not.toContain('NaN');
  });
  it('Embudo: sin datos = mensaje que dice qué falta, no barras en cero', () => {
    const h = renderToStaticMarkup(<Embudo etiqueta="E" etapas={[{ etiqueta: 'A', valor: null }, { etiqueta: 'B', valor: 0 }]} />);
    expect(h).toContain('Sin datos en el periodo');
    expect(h).not.toContain('rv-embudo__barra');
  });
  it('MapaCalor: la celda sin dato lleva s/d y trama; la cifra va en el título y en la tabla', () => {
    const h = renderToStaticMarkup(<MapaCalor etiqueta="Visitas" columnas={['L', 'M']} filas={[{ etiqueta: 'Sem 1', valores: [4, null] }, { etiqueta: 'Sem 2', valores: [0, 8] }]} />);
    expect(h).toContain('title="Sem 1 · M: s/d"');
    expect(h).toContain('data-sd');
    expect(h).toContain('title="Sem 2 · M: 8"');
    expect(h).toContain('data-nivel="4"');
    expect(h).toContain('Ver como tabla');
  });
  it('MapaCalor: todo nulo = vacío explícito', () => {
    expect(renderToStaticMarkup(<MapaCalor etiqueta="V" columnas={['L']} filas={[{ etiqueta: 'a', valores: [null] }]} />)).toContain('Sin datos en el periodo');
  });
  it('ColumnasApiladas: total impreso, tramos con nombre en el título, nulos sin pintar y tabla con total', () => {
    const h = renderToStaticMarkup(<ColumnasApiladas etiqueta="Por canal" series={['Web', 'Referidos']} periodos={[{ etiqueta: 'Ene', partes: [3, 1] }, { etiqueta: 'Feb', partes: [2, null] }]} />);
    expect(h).toContain('title="Ene · Web: 3"');
    expect(h).not.toContain('Feb · Referidos');
    expect(h).toContain('>4<');
    expect(h).toContain('>Total</th>');
    expect(h).toContain('Referidos');
  });
  it('ColumnasApiladas: sin datos = vacío explícito', () => {
    expect(renderToStaticMarkup(<ColumnasApiladas etiqueta="X" series={['a']} periodos={[{ etiqueta: 'Ene', partes: [null] }]} />)).toContain('Sin datos en el periodo');
  });
  it('CSS: ningún hex fuera de la sombra; elevación, entradas y animaciones solo en no-preference', () => {
    const completo = readFileSync(join(__dirname, '..', 'graficas.css'), 'utf8');
    const css = completo.slice(completo.lastIndexOf('/*', completo.indexOf('GRÁFICAS AVANZADAS Y MOVIMIENTO DE TARJETA'))).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css.replace(/var\(--sh-hover,[^)]*\)/g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const i = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(i).toBeGreaterThan(-1);
    expect(css.slice(0, i)).not.toMatch(/\banimation\s*:/);
    expect(css.slice(0, i)).not.toContain('data-lift');
  });
  it('Columnas con tinta neutra lo declara en data-tinta; el matiz sigue siendo el valor por omisión', () => {
    const datos = [{ etiqueta: 'a', valor: 1 }, { etiqueta: 'b', valor: 2 }];
    expect(renderToStaticMarkup(<Columnas datos={datos} etiqueta="C" tinta="neutra" />)).toContain('data-tinta="neutra"');
    expect(renderToStaticMarkup(<Columnas datos={datos} etiqueta="C" />)).not.toContain('data-tinta');
  });
  it('Tarjeta y TiraCifras marcan elevación y entrada solo si se piden (Rovaq data-lift / data-entra)', async () => {
    const { Tarjeta } = await import('../componentes');
    const con = renderToStaticMarkup(<Tarjeta titulo="T" elevar entra="tarjeta">x</Tarjeta>);
    expect(con).toContain('data-lift="true"');
    expect(con).toContain('data-entra="tarjeta"');
    const sin = renderToStaticMarkup(<Tarjeta titulo="T">x</Tarjeta>);
    expect(sin).not.toContain('data-lift');
    expect(sin).not.toContain('data-entra');
    const tira = renderToStaticMarkup(<TiraCifras items={[{ etiqueta: 'A', valor: 1 }]} elevar entra="tarjeta" />);
    expect(tira).toContain('data-lift="true"');
    expect(tira).toContain('data-entra="tarjeta"');
    expect(renderToStaticMarkup(<TiraCifras items={[{ etiqueta: 'A', valor: 1 }]} />)).not.toContain('data-lift');
  });
});
