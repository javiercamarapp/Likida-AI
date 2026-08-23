import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { agruparPorSemana, AreaChartSimple, UMBRAL_AGRUPAR_SEMANA } from './charts';

// ═══════════════════════════════════════════════════════════════════════════
// FE-18 (auditoría prod) — "TODO EL HISTÓRICO" EN UNA TARJETA DE 640×240.
//
// `AreaChartSimple` pinta un `<g>` por punto, y dentro dos `<circle>`, un
// `<rect>` y un `<text>` de tooltip. El selector de /admin abría en "Todo": con
// un año de operación son ~365 puntos ≈ 1,800 nodos SVG, con los marcadores a
// menos de 2 px uno de otro —más juntos que su propio radio— y las etiquetas
// del eje encimadas. Ni se lee ni se puede señalar un día.
//
// Se agrupa por SEMANA pasando el trimestre, y el rótulo lo dice: una gráfica
// que suma siete días por punto sin avisar se compara contra la tarjeta diaria
// de al lado como si fueran la misma unidad.
// ═══════════════════════════════════════════════════════════════════════════

/** N días consecutivos desde 2026-01-01, con `valor = 1` cada uno. */
const serie = (n: number, valor = 1) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date('2026-01-01T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return { dia: d.toISOString().slice(0, 10), valor };
  });

describe('agruparPorSemana', () => {
  it('siete días con valor 1 son UNA semana con valor 7 — suma, no promedia', () => {
    const g = agruparPorSemana(serie(7));
    expect(g).toHaveLength(1);
    expect(g[0].valor).toBe(7);
  });

  it('no pierde ni inventa: el total agrupado es el total crudo', () => {
    const cruda = serie(365, 3);
    const total = (a: Array<{ valor: number }>) => a.reduce((s, d) => s + d.valor, 0);
    expect(total(agruparPorSemana(cruda))).toBe(total(cruda));
  });

  it('la ÚLTIMA cubeta es una semana completa que termina en el último día', () => {
    // 10 días: la última cubeta son los 7 finales, y los 3 que sobran forman
    // la primera. Al revés, el punto de "esta semana" estaría cortado y se
    // leería como una caída que no ocurrió.
    const g = agruparPorSemana(serie(10));
    expect(g).toHaveLength(2);
    expect(g[0].valor).toBe(3);
    expect(g[1].valor).toBe(7);
    expect(g[1].dia).toBe('2026-01-04');
  });

  it('cada cubeta se rotula con su PRIMER día', () => {
    const g = agruparPorSemana(serie(14));
    expect(g.map((d) => d.dia)).toEqual(['2026-01-01', '2026-01-08']);
  });

  it('una serie vacía sale vacía, no revienta', () => {
    expect(agruparPorSemana([])).toEqual([]);
  });
});

describe('AreaChartSimple agrupa sola pasando el trimestre', () => {
  // Se cuenta sobre el HTML SERVIDO (`renderToStaticMarkup`), que es el mismo
  // mecanismo que ya usan `kit.test.tsx` y `panel-periodo.test.tsx`: lo que
  // pesa es justamente lo que se manda por el cable.
  const circulos = (html: string) => (html.match(/<circle/g) ?? []).length;

  it('en el umbral NO agrupa: cada punto sigue siendo un día', () => {
    const html = renderToStaticMarkup(
      <AreaChartSimple datos={serie(UMBRAL_AGRUPAR_SEMANA)} etiquetaValor={(v) => String(v)} />,
    );
    expect(html).not.toContain('Agrupado por semana');
    // Dos círculos por punto (el área de hover y el marcador).
    expect(circulos(html)).toBe(UMBRAL_AGRUPAR_SEMANA * 2);
  });

  it('un año entero se agrupa, y el rótulo lo DICE', () => {
    const html = renderToStaticMarkup(
      <AreaChartSimple datos={serie(365)} etiquetaValor={(v) => String(v)} />,
    );
    expect(html).toContain('Agrupado por semana (53 semanas)');
    // 624 nodos `<circle>` menos que antes: 53 semanas, no 365 días.
    expect(circulos(html)).toBe(53 * 2);
    expect(circulos(html)).toBeLessThan(365 * 2);
  });

  it('la comparativa se agrupa con el MISMO criterio, no con otro', () => {
    // Dos granularidades en la misma gráfica mentirían la comparación igual
    // que dos escalas distintas.
    const html = renderToStaticMarkup(
      <AreaChartSimple datos={serie(365)} comparativa={serie(365, 2)} etiquetaValor={(v) => String(v)} />,
    );
    const punteada = /<path d="([^"]*)"[^>]*stroke-dasharray/.exec(html)
      ?? /stroke-dasharray[^>]*d="([^"]*)"/.exec(html);
    expect(punteada).not.toBeNull();
    // 53 vértices en la línea punteada = agrupada; 365 sería la cruda.
    expect((punteada![1]).split('L')).toHaveLength(53);
  });
});
