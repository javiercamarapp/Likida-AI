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

function pintar(operadores: Array<{ id: string; nombre: string }> | null, operador: string | null = null) {
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
      operador={operador}
      operadores={operadores}
      abrir={null}
      puedeCorregir={false}
      puedeDeclararPolitica={false}
      anularMarca={accionOk}
      capturarMarca={accionOk}
      cerrarElDia={accionOk}
      declararPolitica={accionOk}
      alertaConfig={null}
      alertaConfigIlegible={false}
      alertas={[]}
      puedeConfigurarAlerta={false}
      guardarAlerta={accionOk}
    />,
  );
}

describe('Jornada — selector de operador (FE-19)', () => {
  // R8: el filtro vive en el cajón de «Filtros» (se monta al abrir; el contenido abierto se prueba en barra_periodo_comportamiento).
  it('con catálogo, la barra ofrece «Filtros» y el operador elegido sale como chip con su nombre y una «x» que lo quita', () => {
    const html = pintar([{ id: 'o1', nombre: 'J. Pérez' }, { id: 'o2', nombre: 'M. López' }], 'o2');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('M. López');
    expect(html).toContain('aria-label="Quitar M. López"');
    expect(html).toContain('Del 01 ago 2026 al 14 ago 2026');
    expect(html).not.toMatch(/Quitar J\. Pérez/);
  });

  it('sin catálogo (lectura caída), lo dice — no rompe la página — y el filtro por URL sigue valiendo', () => {
    const html = pintar(null);
    expect(html).toContain('No se pudo leer el catálogo de operadores');
    expect(html).toContain('<code>?operador=</code>');
  });
});
