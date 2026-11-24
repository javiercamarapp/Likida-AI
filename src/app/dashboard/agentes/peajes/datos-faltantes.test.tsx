import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DatosFaltantes } from './datos-faltantes';
import { calcularDatosFaltantes, type EntradaDatosFaltantes } from '@/lib/likida/peajes/datos_faltantes';

// El panel «Datos que faltan»: una fila sin medir nunca pinta un número, y un cero solo sale de una medición completa.
const entrada = (extra: Partial<EntradaDatosFaltantes> = {}): EntradaDatosFaltantes => ({
  tags: { ok: true, datos: [{ tag: 'TAG-0001', unidadId: 'u-1', unidadEconomico: 'T-10', activo: true, bajaEn: null }, { tag: 'TAG-0002', unidadId: 'u-1', unidadEconomico: 'T-10', activo: true, bajaEn: null }] },
  casetas: { ok: true, datos: [{ id: 'c1', nombre: 'Caseta Ejemplo Norte', nombreNorm: 'caseta ejemplo norte', alias: [], lat: null, lng: null, radioM: 300, activa: true }] },
  tarifas: { ok: false, falta: 'el tarifario' },
  lineas: { ok: true, datos: [{ indice: 0, fecha: null, caseta: 'Caseta Ejemplo Norte', tag: 'TAG-0009', clase: null, unidadArchivo: null, unidadId: null }] },
  ...extra,
});

describe('<DatosFaltantes />', () => {
  it('pinta las filas con casos, ejemplo anonimizado y el «no medible» con su fuente', () => {
    const html = renderToStaticMarkup(<DatosFaltantes datos={calcularDatosFaltantes(entrada(), 1)} />);
    expect(html).toContain('Datos que faltan');
    expect(html).toContain('TAG sin unidad asignada');
    expect(html).toContain('TAG…09');
    expect(html).not.toContain('TAG-0009');
    expect(html).toContain('Aún no medible: falta el tarifario.');
    expect(html).toContain('1 de 1 caseta');
  });
  it('una fila sin medir no lleva número: solo el guion', () => {
    const html = renderToStaticMarkup(<DatosFaltantes datos={calcularDatosFaltantes(entrada({ lineas: { ok: false, falta: 'los renglones de los archivos de desglose' } }), 0)} />);
    expect(html).toContain('Aún no medible: falta los renglones de los archivos de desglose.');
    expect(html).not.toMatch(/Nada falta/);
  });
  it('sin archivos: «sin datos» con la advertencia de que no es lo mismo que nada falta', () => {
    const html = renderToStaticMarkup(<DatosFaltantes datos={calcularDatosFaltantes(entrada({ lineas: { ok: true, datos: [] } }), 0)} />);
    expect(html).toContain('Aún no hay archivos de desglose');
    expect(html).not.toContain('los 0 archivos');
    expect(html).toContain('Sin datos');
    expect(html).toContain('Esto no significa que no falte nada.');
  });
  it('todo sano: «Nada falta» solo cuando se midió', () => {
    const sano: EntradaDatosFaltantes = {
      tags: { ok: true, datos: [{ tag: 'TAG-0001', unidadId: 'u-1', unidadEconomico: 'T-10', activo: true, bajaEn: null }] },
      casetas: { ok: true, datos: [{ id: 'c1', nombre: 'caseta norte', nombreNorm: 'caseta norte', alias: [], lat: 19.4, lng: -99.1, radioM: 300, activa: true }] },
      tarifas: { ok: true, datos: [{ casetaNorm: 'caseta norte', clase: 5, vigenteDesde: '2026-01-01', vigenteHasta: null }] },
      lineas: { ok: true, datos: [{ indice: 0, fecha: '2026-10-05', caseta: 'caseta norte', tag: 'TAG-0001', clase: 5, unidadArchivo: 'T-10', unidadId: 'u-1' }] },
    };
    const html = renderToStaticMarkup(<DatosFaltantes datos={calcularDatosFaltantes(sano, 1)} />);
    expect(html.match(/Nada falta/g)?.length).toBe(8);
  });
  it('si el panel no se pudo calcular (null) lo dice y no pinta una tabla vacía', () => {
    const html = renderToStaticMarkup(<DatosFaltantes datos={null} />);
    expect(html).toContain('No se pudo calcular este panel. No es que no falte nada.');
    expect(html).not.toContain('<table');
  });
});
