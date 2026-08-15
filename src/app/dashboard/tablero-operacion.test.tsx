import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TableroCifras, TablaViajesOperacion, type FilaViajeOperacion } from './tablero-operacion';
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

// ── La tabla de viajes del ENCARGADO (14-ago-2026) ─────────────────────────
//
// NO es `TablaViajes` (resumen-visual.tsx): aquella imprime el anticipo y el
// "Ver" al detalle de la liquidación — pantallas de dinero. Esta prueba
// vigila que la versión del encargado no las herede por accidente: el tipo
// `FilaViajeOperacion` ya no tiene campo de anticipo, pero el tipo no impide
// que alguien agregue una columna nueva con un `mxn()` adentro.

function fila(extra: Partial<FilaViajeOperacion>): FilaViajeOperacion {
  return {
    id: 'v1', folio: 'VJ-001', origen: 'CDMX', destino: 'Monterrey',
    estatus: 'abierto', operadorNombre: 'Juan Pérez', fechaInicio: '2026-08-10',
    ...extra,
  };
}

describe('TablaViajesOperacion — folio/ruta/chofer/estatus/fecha, CERO pesos', () => {
  it('pinta las columnas del encargado y ningún signo de pesos', () => {
    const html = renderToStaticMarkup(<TablaViajesOperacion viajes={[fila({})]} />);
    expect(html).toContain('VJ-001');
    expect(html).toContain('CDMX → Monterrey');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('Abierto');
    // La garantía del rol: ni la columna ni el símbolo del dueño.
    expect(html).not.toContain('Anticipo');
    expect(html).not.toContain('$');
  });

  it('sin chofer asignado lo dice, y un estatus fuera del dominio se pinta crudo', () => {
    const html = renderToStaticMarkup(
      <TablaViajesOperacion viajes={[fila({ id: 'v2', operadorNombre: null, estatus: 'raro' })]} />,
    );
    expect(html).toContain('Sin asignar');
    expect(html).toContain('raro');
  });

  it('vacía no inventa filas: dice que aún no hay viajes', () => {
    const html = renderToStaticMarkup(<TablaViajesOperacion viajes={[]} />);
    expect(html).toContain('Aún no hay viajes registrados');
    expect(html).not.toContain('<table');
  });

  it('con más de 8 enseña los 8 más recientes y LO DICE — el tope no es silencioso', () => {
    const muchas = Array.from({ length: 12 }, (_, i) => fila({ id: `v${i}`, folio: `VJ-${i}` }));
    const html = renderToStaticMarkup(<TablaViajesOperacion viajes={muchas} />);
    expect(html).toContain('Los 8 más recientes de 12 cargados');
    expect(html).not.toContain('VJ-11');
  });
});
