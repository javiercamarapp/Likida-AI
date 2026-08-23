import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelPeriodo } from './panel-periodo';

// AUDITORÍA 18, ALTO (A13) — en la misma fila, "Liquidado" y "Top rutas" decían
// "No se pudo cargar" ante una consulta caída, y "Viajes" y "Gasto por
// categoría" afirmaban "Aún no hay…" con la misma consulta caída.
describe('PanelPeriodo — consulta caída no se pinta como vacío (A13)', () => {
  it('con las cuatro series en null ninguna tarjeta afirma ausencia', () => {
    const html = renderToStaticMarkup(
      <PanelPeriodo viajes={[]} porMes={[]} hoy="2026-08-22" seriesKpis={null} gastoSemanalSeries={null}
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
      <PanelPeriodo viajes={[]} porMes={[]} hoy="2026-08-22"
        seriesKpis={{ semanal: [{ gastoTotal: 0, totalViajes: 0, costoPorViaje: null, liquidado: 0, viajesLiquidados: 0 }], mensual: [], historico: [] } as never}
        gastoSemanalSeries={{ semanal: gastoVacio, mensual: gastoVacio, historico: gastoVacio }}
        liquidadoSemanalSeries={vacio} topRutasSeries={vacio} />,
    );
    expect(html).toContain('Aún no hay viajes registrados en este periodo');
    expect(html).toContain('Aún no hay gastos capturados');
    expect(html).not.toContain('No se pudo cargar esta gráfica');
  });
});

// AUDITORÍA 18, ALTO (A11) — bajo el pill en "Semanal", la tarjeta de viajes
// cuenta 7 días y la de dinero 35; en el HTML cada una tiene que decirlo.
describe('PanelPeriodo — cada tarjeta rotula su ventana real (A11)', () => {
  it('en el render inicial (Semanal) Viajes dice 7 días y Liquidado 5 semanas', () => {
    const html = renderToStaticMarkup(
      <PanelPeriodo viajes={[]} porMes={[]} hoy="2026-08-22" seriesKpis={null} gastoSemanalSeries={null}
        liquidadoSemanalSeries={null} topRutasSeries={null} />,
    );
    expect(html).toMatch(/Viajes[^<]*<span[^>]*>· últimos 7 días/);
    expect(html).toMatch(/Liquidado[^<]*<span[^>]*>· últimas 5 semanas/);
    expect(html).toMatch(/Gasto por categoría[^<]*<span[^>]*>· últimas 5 semanas/);
    expect(html).toMatch(/Top rutas por gasto[^<]*<span[^>]*>· últimas 5 semanas/);
  });
});
