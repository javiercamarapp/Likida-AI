import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionInmovilizadas } from './inmovilizadas';

const nada = async () => {};
const acciones = { cargarInmovilizadas: nada, quitarInmovilizada: nada };
const v = (o = {}) => ({ id: 'w1', unidadId: 'u1', unidadEconomico: 'C2-08', desde: '2026-09-03', hasta: '2026-09-05', motivo: 'taller' as const, nota: null, ...o });

describe('SeccionInmovilizadas (A2 ola 1)', () => {
  it('sin ventanas: dice que la regla no corre y ofrece cargar el archivo', () => {
    const html = renderToStaticMarkup(<SeccionInmovilizadas datos={{ ventanas: [], puedeEditar: true, acciones }} />);
    expect(html).toContain('la regla «unidad inmovilizada» no corre');
    expect(html).toContain('name="archivo"');
    expect(html).toContain('Cargar unidades inmovilizadas');
    expect(html).toContain('Nada viene precargado');
  });
  it('lista las ventanas con unidad, motivo y fechas; «hasta» vacío = sigue inmovilizada', () => {
    const html = renderToStaticMarkup(<SeccionInmovilizadas datos={{ ventanas: [v(), v({ id: 'w2', unidadEconomico: 'C2-09', hasta: null, motivo: 'siniestro' })], puedeEditar: true, acciones }} />);
    expect(html).toContain('C2-08');
    expect(html).toContain('en taller desde el 2026-09-03 hasta el 2026-09-05');
    expect(html).toContain('siniestrada desde el 2026-09-03 (sigue inmovilizada)');
    expect(html).toContain('name="ventana" value="w1"');
  });
  it('sin permiso de edición no hay formulario ni botón de quitar', () => {
    const html = renderToStaticMarkup(<SeccionInmovilizadas datos={{ ventanas: [v()], puedeEditar: false, acciones }} />);
    expect(html).not.toContain('<form');
  });
  it('una lectura fallida no afirma «ninguna»', () => {
    const html = renderToStaticMarkup(<SeccionInmovilizadas datos={{ ventanas: null, puedeEditar: true, acciones }} />);
    expect(html).toContain('No se pudo leer la lista');
    expect(html).not.toContain('Ninguna unidad inmovilizada');
  });
});
