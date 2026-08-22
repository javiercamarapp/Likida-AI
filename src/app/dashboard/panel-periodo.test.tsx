import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelPeriodo } from './panel-periodo';

// AUDITORÍA 18, ALTO (A13) — en la misma fila, "Liquidado" y "Top rutas" decían
// "No se pudo cargar" ante una consulta caída, y "Viajes" y "Gasto por
// categoría" afirmaban "Aún no hay…" con la misma consulta caída.
describe('PanelPeriodo — consulta caída no se pinta como vacío (A13)', () => {
  it('con las cuatro series en null ninguna tarjeta afirma ausencia', () => {
    const html = renderToStaticMarkup(
      <PanelPeriodo viajes={[]} porMes={[]} seriesKpis={null} gastoSemanalSeries={null}
        liquidadoSemanalSeries={null} topRutasSeries={null} />,
    );
    expect(html).not.toContain('Aún no hay viajes registrados en este periodo');
    expect(html).not.toContain('Aún no hay gastos capturados');
    expect(html).not.toContain('Aún no hay gasto asociado a una ruta');
    expect(html.match(/No se pudo cargar/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('con series cargadas pero vacías sí se dice que no hay nada (vacío real)', () => {
    const vacio = { semanal: [] as never[], mensual: [] as never[], historico: [] as never[] };
    const gastoVacio = { categorias: [] as string[], series: [] as Array<{ nombre: string; valores: number[] }> };
    const html = renderToStaticMarkup(
      <PanelPeriodo viajes={[]} porMes={[]}
        seriesKpis={{ semanal: [{ gastoTotal: 0, totalViajes: 0, costoPorViaje: null, liquidado: 0, viajesLiquidados: 0 }], mensual: [], historico: [] } as never}
        gastoSemanalSeries={{ semanal: gastoVacio, mensual: gastoVacio, historico: gastoVacio }}
        liquidadoSemanalSeries={vacio} topRutasSeries={vacio} />,
    );
    expect(html).toContain('Aún no hay viajes registrados en este periodo');
    expect(html).toContain('Aún no hay gastos capturados');
    expect(html).not.toContain('No se pudo cargar esta gráfica');
  });
});
