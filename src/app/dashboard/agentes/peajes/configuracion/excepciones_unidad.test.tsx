import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SeccionReglasCobro, type ReglasCobroVista } from './reglas-cobro';
import type { ReglaCasetaVista, ExcepcionUnidadVista } from '@/lib/likida/peajes/revision_cobros';

const nada = async () => {};
const acciones = { guardarReglaCaseta: nada, cargarCoordenadas: nada, altaBajaTag: nada, quitarBajaTag: nada, guardarExcepcionUnidad: nada, quitarExcepcionUnidad: nada };
const caseta = (p: Partial<ReglaCasetaVista> & { id: string; nombre: string }): ReglaCasetaVista => ({
  nombreNorm: p.nombre.toLowerCase(), lat: null, lng: null, clasesPermitidas: [], noCruzar: false, nota: null, crucesVistos: 10, ultimaVez: null, ...p,
});
const exc = (p: Partial<ExcepcionUnidadVista> = {}): ExcepcionUnidadVista => ({ id: 'e1', casetaNorm: 'plaza prohibida', unidad: 'TC9001', unidadNorm: 'tc9001', nota: null, ...p });
const pintar = (d: Partial<ReglasCobroVista>) => renderToStaticMarkup(<SeccionReglasCobro datos={{ casetas: [], bajas: [], acciones, ...d }} />);

describe('excepciones por unidad en la configuración', () => {
  it('sin acciones de excepción (pantalla antigua) la sección no se pinta', () => {
    const html = renderToStaticMarkup(<SeccionReglasCobro datos={{ casetas: [], bajas: [], excepciones: [], acciones: { guardarReglaCaseta: nada, cargarCoordenadas: nada, altaBajaTag: nada, quitarBajaTag: nada } }} />);
    expect(html).not.toContain('excepciones-unidad');
  });

  it('una flota nueva ve la lista vacía y la indicación de marcar primero una caseta', () => {
    const html = pintar({ casetas: [caseta({ id: '1', nombre: 'CASETA COMUN' })], excepciones: [] });
    expect(html).toContain('Ninguna unidad exceptuada');
    expect(html).toContain('Primero marca una caseta como «No debe cruzarse»');
    expect(html).not.toContain('Exceptuar unidad');
  });

  it('el selector solo ofrece casetas marcadas «no debe cruzarse»', () => {
    const html = pintar({ casetas: [caseta({ id: '1', nombre: 'CASETA COMUN' }), caseta({ id: '2', nombre: 'PLAZA PROHIBIDA', noCruzar: true })], excepciones: [] });
    expect(html).toContain('Exceptuar unidad');
    expect(html).toMatch(/<option value="PLAZA PROHIBIDA">/);
    expect(html).not.toMatch(/<option value="CASETA COMUN">/);
  });

  it('muestra las excepciones con la caseta, la unidad y la nota, con botón para quitarlas', () => {
    const html = pintar({ casetas: [caseta({ id: '2', nombre: 'PLAZA PROHIBIDA', noCruzar: true })], excepciones: [exc({ nota: 'Atiende rescates' })] });
    expect(html).toContain('TC9001');
    expect(html).toContain('puede cruzar PLAZA PROHIBIDA');
    expect(html).toContain('Atiende rescates');
    expect(html).toContain('Quitar la excepción de TC9001');
  });

  it('un fallo de lectura se dice, no se pinta como «ninguna»', () => {
    const html = pintar({ casetas: [caseta({ id: '2', nombre: 'PLAZA PROHIBIDA', noCruzar: true })], excepciones: null });
    expect(html).toContain('No se pudo leer la lista de excepciones ahora mismo');
    expect(html).not.toContain('Ninguna unidad exceptuada');
  });

  it('un texto con HTML se escapa', () => {
    const html = pintar({ casetas: [caseta({ id: '2', nombre: 'PLAZA PROHIBIDA', noCruzar: true })], excepciones: [exc({ unidad: '<img src=x>', nota: '<script>x</script>' })] });
    expect(html).not.toContain('<img src=x>');
    expect(html).not.toContain('<script>x</script>');
  });
});
