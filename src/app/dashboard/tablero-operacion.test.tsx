import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableroCifras } from './tablero-operacion';
import type { TableroOperacion } from '@/lib/likida/operacion';

// ═══════════════════════════════════════════════════════════════════════════
// Movida de `despacho/vista.test.tsx` el 10-ago-2026 junto con el componente
// que prueba (ver comentario en `tablero-operacion.tsx`).
//
// AUDITORÍA 10, MEDIO — "Sin evidencia de entrega" (40% visible) y "Unidades
// disponibles" (46% visible) a 1440px. La causa no era solo `truncate`
// (ver kit.test.tsx): `xl:grid-cols-6` asumía que el ancho de la VENTANA es
// el ancho disponible para la grilla, y no lo es — sidebar (232px) + rail
// del asistente (276px) + paddings del marco dejan ~1100px de contenido
// real a 1440px de ventana. Se prueba contra el CÓDIGO FUENTE del
// componente REAL — mismo patrón que `dashboard/estado.test.ts`.
// ═══════════════════════════════════════════════════════════════════════════

const TABLERO: TableroOperacion = {
  viajesActivos: 4,
  sinUnidad: 1,
  unidadesDisponibles: 3,
  unidadesEnTaller: 1,
  incidenciasAbiertas: 2,
  podPendientes: 1,
};

describe('TableroCifras — la grilla ya no aprieta a 6 columnas', () => {
  it('el HTML servido no pide xl:grid-cols-6', () => {
    const html = renderToStaticMarkup(<TableroCifras t={TABLERO} />);
    expect(html).not.toContain('xl:grid-cols-6');
  });

  it('se queda en md:grid-cols-3 (el ancho que sí le alcanza al rótulo)', () => {
    const html = renderToStaticMarkup(<TableroCifras t={TABLERO} />);
    expect(html).toContain('md:grid-cols-3');
  });

  it('los rótulos accionables e informativos siguen en el DOM', () => {
    const html = renderToStaticMarkup(<TableroCifras t={TABLERO} />);
    expect(html).toContain('Sin evidencia de entrega');
    expect(html).toContain('Unidades disponibles');
  });
});
