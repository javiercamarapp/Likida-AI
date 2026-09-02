import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaJornada } from './vista';

// ═══════════════════════════════════════════════════════════════════════════
// FE-19 (auditoría 24): el filtro `?operador=` ya existía en el servidor
// (`leerJornadas`) pero la pantalla no tenía de dónde elegirlo — con
// cientos de choferes, la ventana de 14 días nace truncada casi siempre
// (300 operadores × 14 días = 4,200 > 900, el tope de `leerJornadas`), y la
// única salida era teclear el id del operador en la URL a mano.
// ═══════════════════════════════════════════════════════════════════════════

const accionOk = async () => ({ ok: true as const, mensaje: 'ok' });

function pintar(operadores: Array<{ id: string; nombre: string }> | null) {
  return renderToStaticMarkup(
    <VistaJornada
      filas={[]}
      semanas={[]}
      motivoIlegible={null}
      truncada={false}
      politica={null}
      desde="2026-08-01"
      hasta="2026-08-14"
      sufijo=""
      operador={null}
      operadores={operadores}
      abrir={null}
      puedeCorregir={false}
      anularMarca={accionOk}
      capturarMarca={accionOk}
      cerrarElDia={accionOk}
      declararPolitica={accionOk}
    />,
  );
}

describe('Jornada — selector de operador (FE-19)', () => {
  it('con catálogo, pinta un <select> con cada operador como opción', () => {
    const html = pintar([{ id: 'o1', nombre: 'J. Pérez' }, { id: 'o2', nombre: 'M. López' }]);
    expect(html).toContain('<select');
    expect(html).toContain('J. Pérez');
    expect(html).toContain('M. López');
  });

  it('sin catálogo (lectura caída), el select se deshabilita y lo dice — no rompe la página', () => {
    const html = pintar(null);
    expect(html).toContain('disabled=""');
    expect(html).toContain('No se pudo leer el catálogo de operadores');
  });
});
