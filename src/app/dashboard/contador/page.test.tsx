import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEMO_CONFIG } from '@/lib/cuadra/config';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 10, BAJO (frontend) — "Tarjetas medio vacías en el panel fiscal".
// "El gasto del periodo" quedaba con ~450px de blanco bajo su mensaje de
// EstadoVacio, porque el grid (`grid grid-cols-1 lg:grid-cols-2`, por
// default `align-items: stretch`) la estiraba a la altura de "Estado del
// papel" — una tarjeta que SIEMPRE pinta cinco renglones y por eso siempre es
// más alta. Se lee como una sección rota.
//
// El arreglo es de layout, no de contenido: el grid pasa a `items-start`
// para que cada `ChartCard` mida lo que su propio contenido necesita (con su
// `minHeight` de `tamano="M"` como piso), sin que el vecino la estire.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/cuadra/config', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getConfig: vi.fn(async () => DEMO_CONFIG),
}));
vi.mock('@/lib/cuadra/fiscal', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  // Periodo SIN comprobantes: el estado que dispara el `EstadoVacio` corto
  // dentro de "El gasto del periodo, por su suerte fiscal".
  getGastosFiscales: vi.fn(async () => []),
  contarGastosDelTenant: vi.fn(async () => ({ total: 0, sinFecha: 0 })),
}));

const { Contenido } = await import('./page');

describe('el grid de "gasto del periodo" / "estado del papel" no se estira a la altura del vecino', () => {
  it('el contenedor de las dos tarjetas usa items-start, no el stretch por default de CSS grid', async () => {
    const el = await Contenido({ tenantId: 't1', sp: {} });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('grid grid-cols-1 lg:grid-cols-2 items-start gap-3');
  });

  it('con gastoTotal en 0, la tarjeta del gasto pinta el EstadoVacio corto (sin las HBars largas)', async () => {
    const el = await Contenido({ tenantId: 't1', sp: {} });
    const html = renderToStaticMarkup(el);
    expect(html).toContain('No hay gasto con fecha dentro de');
  });
});
