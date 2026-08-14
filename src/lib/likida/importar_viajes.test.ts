import { describe, it, expect } from 'vitest';
import { interpretarFilasViajes, leerCifraImportada, leerFechaImportada } from './importar_viajes';

// Solo el motor PURO: la inserción por lotes y el dedup contra la base son
// el patrón de siempre (folios existentes se consultan y se saltan).

describe('leerCifraImportada — el dinero del TMS ajeno', () => {
  it('lee los formatos reales', () => {
    expect(leerCifraImportada(8000)).toBe(8000);
    expect(leerCifraImportada('$8,000.50')).toBe(8000.5);
    expect(leerCifraImportada('8000,50')).toBe(8000.5);
    expect(leerCifraImportada('1.234,56')).toBe(1234.56);
    expect(leerCifraImportada('1,234.56')).toBe(1234.56);
  });

  it('vacío es null; basura es ilegible — nunca un cero inventado', () => {
    expect(leerCifraImportada('')).toBeNull();
    expect(leerCifraImportada(null)).toBeNull();
    expect(leerCifraImportada('ocho mil')).toBe('ilegible');
    expect(leerCifraImportada(-100)).toBe('ilegible');
  });
});

describe('leerFechaImportada', () => {
  it('ISO, dd/mm/aaaa y serial de Excel', () => {
    expect(leerFechaImportada('2026-08-01')).toBe('2026-08-01');
    expect(leerFechaImportada('01/08/2026')).toBe('2026-08-01');
    expect(leerFechaImportada('1-8-2026')).toBe('2026-08-01');
    expect(leerFechaImportada(46235)).toBe('2026-08-01');
  });

  it('mes 13 o texto raro es ilegible, no una fecha adivinada', () => {
    expect(leerFechaImportada('13/13/2026')).toBe('ilegible');
    expect(leerFechaImportada('agosto')).toBe('ilegible');
    expect(leerFechaImportada('')).toBeNull();
  });
});

describe('interpretarFilasViajes — el export del TMS', () => {
  const ENC = ['Folio', 'Origen', 'Destino', 'Fecha inicio', 'Anticipo', 'Operador'];

  it('lee las filas buenas con encabezados reales, acentos incluidos', () => {
    const r = interpretarFilasViajes([
      ['FOLIO', 'ORIGEN', 'DESTINO', 'FECHA', 'ANTICIPO', 'CHOFER'],
      ['V-100', 'Guadalajara', 'Nuevo Laredo', '05/08/2026', '$8,000.00', 'Juan Pérez'],
      ['V-101', 'GDL', 'CDMX', '2026-08-06', '', ''],
    ]);
    expect(r.error).toBeUndefined();
    expect(r.viajes).toHaveLength(2);
    expect(r.viajes[0]).toEqual({
      folio: 'V-100', origen: 'Guadalajara', destino: 'Nuevo Laredo',
      fechaInicio: '2026-08-05', anticipo: 8000, operadorNombre: 'Juan Pérez',
    });
    expect(r.viajes[1].anticipo).toBeNull();
  });

  it('sin columna de folio no hay importación — el dedup depende de él', () => {
    const r = interpretarFilasViajes([['Ruta', 'Fecha'], ['GDL-MTY', '01/08/2026']]);
    expect(r.error).toContain('columna del folio');
    expect(r.viajes).toHaveLength(0);
  });

  it('las filas malas se descartan CON su motivo y su número de fila', () => {
    const r = interpretarFilasViajes([
      ENC,
      ['', 'GDL', 'MTY', '', '', ''],
      ['V-1', 'GDL', 'MTY', '99/99/2026', '', ''],
      ['V-2', 'GDL', 'MTY', '', 'mil pesos', ''],
      ['V-3', 'GDL', 'MTY', '', '', ''],
      ['V-3', 'otra vez', '', '', '', ''],
    ]);
    expect(r.viajes.map((v) => v.folio)).toEqual(['V-3']);
    expect(r.descartadas).toEqual([
      { fila: 2, motivo: 'sin folio' },
      { fila: 3, motivo: 'fecha ilegible (V-1)' },
      { fila: 4, motivo: 'anticipo ilegible (V-2)' },
      { fila: 6, motivo: 'folio repetido en el archivo (V-3)' },
    ]);
  });

  it('las filas totalmente vacías se ignoran sin ruido', () => {
    const r = interpretarFilasViajes([ENC, ['', '', '', '', '', ''], ['V-9', 'GDL', 'MTY', '', '', '']]);
    expect(r.viajes).toHaveLength(1);
    expect(r.descartadas).toHaveLength(0);
  });
});
