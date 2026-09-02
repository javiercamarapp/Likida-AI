import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FilaAcciones } from './acciones';
import type { OpcionViaje } from '@/lib/likida/repo_paginado';

// ═══════════════════════════════════════════════════════════════════════════
// FE-3 (auditoría 24): "Adjuntar a…" ofrecía un `<select>` con los viajes
// vivos entre los 100 más recientes — el huérfano típico es de un viaje de
// 1-3 días atrás, que a 500 viajes/día ya no está en esa ventana. Ahora es un
// buscador (`ComboViaje`) que le pregunta al servidor por folio/operador, sin
// mandar ningún catálogo completo al cliente.
// ═══════════════════════════════════════════════════════════════════════════

const accionOk = async () => null;
const buscarOk = async (): Promise<OpcionViaje[]> => [{ id: 'v1', etiqueta: 'F-1041 · León → CDMX · J. Pérez' }];

function pintar(hayViajesVivos: boolean) {
  return renderToStaticMarkup(
    <FilaAcciones
      huerfanoId="h1" hayViajesVivos={hayViajesVivos} sinMonto={false}
      buscarViaje={buscarOk} adjuntar={accionOk} descartar={accionOk}
    />,
  );
}

describe('Huérfanos — combo de búsqueda de viaje (FE-3)', () => {
  it('con viajes vivos: pinta un buscador (combobox), no un <select> con catálogo completo', () => {
    const html = pintar(true);
    expect(html).toContain('role="combobox"');
    expect(html).not.toContain('<select');
    // Ya no confiesa una ventana de "los N más recientes": el buscador
    // pregunta a la flota entera.
    expect(html).not.toMatch(/más recientes/);
  });

  it('sin ningún viaje vivo: dice que no hay a dónde adjuntar, sin pintar el buscador', () => {
    const html = pintar(false);
    expect(html).toContain('Sin viajes abiertos');
    expect(html).not.toContain('role="combobox"');
  });
});
