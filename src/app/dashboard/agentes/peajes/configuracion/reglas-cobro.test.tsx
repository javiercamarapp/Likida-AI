import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionReglasCobro, type ReglasCobroVista } from './reglas-cobro';
import type { ReglaCasetaVista } from '@/lib/likida/peajes/revision_cobros';

const nada = async () => {};
const acciones = { guardarReglaCaseta: nada, cargarCoordenadas: nada, altaBajaTag: nada, quitarBajaTag: nada };
const caseta = (p: Partial<ReglaCasetaVista> & { id: string; nombre: string }): ReglaCasetaVista => ({
  nombreNorm: p.nombre.toLowerCase(), lat: null, lng: null, clasesPermitidas: [], noCruzar: false, nota: null, crucesVistos: 10, ultimaVez: null, ...p,
});
const pintar = (d: Partial<ReglasCobroVista>) => renderToStaticMarkup(<SeccionReglasCobro datos={{ casetas: [], bajas: [], acciones, ...d }} />);

describe('la sección de reglas de cobro', () => {
  it('dice que nada viene precargado y no inventa casetas ni bajas', () => {
    const html = pintar({});
    expect(html).toContain('Nada viene precargado');
    expect(html).toContain('Aún no hay casetas');
    expect(html).toContain('Ningún TAG dado de baja');
    expect(html.toLowerCase()).not.toContain("caseta prohibida ejemplo");
  });
  it('las casetas con regla van primero, con su clase extra y «no debe cruzarse» marcados', () => {
    const html = pintar({ casetas: [
      caseta({ id: '1', nombre: 'CASETA COMUN', crucesVistos: 900 }),
      caseta({ id: '2', nombre: 'CASETA PASADA', clasesPermitidas: [1], crucesVistos: 5 }),
      caseta({ id: '3', nombre: 'PLAZA PROHIBIDA', noCruzar: true, lat: 25.5, lng: -100.2 }),
    ] });
    expect(html.indexOf('CASETA PASADA')).toBeLessThan(html.indexOf('CASETA COMUN'));
    expect(html.indexOf('PLAZA PROHIBIDA')).toBeLessThan(html.indexOf('CASETA COMUN'));
    expect(html).toContain('value="1"');
    expect(html).toMatch(/name="no_cruzar"[^>]*checked/);
    expect(html).toContain('25.5, -100.2');
  });
  it('un nombre de caseta con HTML se escapa', () => {
    expect(pintar({ casetas: [caseta({ id: '1', nombre: '<img src=x>' })] })).not.toContain('<img src=x>');
  });
  it('un fallo de lectura se dice, no se pinta como "no hay nada"', () => {
    const html = pintar({ casetas: null, bajas: null });
    expect(html).toContain('No se pudo leer el catálogo de casetas ahora mismo');
    expect(html).toContain('No se pudo leer la lista de bajas ahora mismo');
    expect(html).not.toContain('Aún no hay casetas');
  });
  it('muestra las bajas con su fecha y motivo', () => {
    const html = pintar({ bajas: [{ id: 'b1', tag: 'IMDM00000001', tagOriginal: 'IMDM 0000 0001', bajaEn: '2026-03-04', motivo: 'Unidad siniestrada' }] });
    expect(html).toContain('IMDM 0000 0001');
    expect(html).toContain('de baja desde el 2026-03-04');
    expect(html).toContain('Unidad siniestrada');
  });
});
