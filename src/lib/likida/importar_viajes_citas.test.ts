import { describe, it, expect } from 'vitest';
import { interpretarFilasViajes, leerFechaImportada, leerFechaHoraImportada } from './importar_viajes';

// T-A5-05: citas del programa de despacho (`dd/mm/aaaa h:mm`, hora local SIN zona). Fixtures sintéticos.
const ENC = ['Folio', 'Origen', 'Destino', 'Operador', 'Cita carga', 'Cita descarga'];
const archivo = (...filas: unknown[][]) => [ENC, ...filas];

describe('leerFechaHoraImportada', () => {
  it('«06/10/2026 7:00» en Matamoros (UTC-5 en octubre, aún con horario de verano) → 12:00Z', () => {
    expect(leerFechaHoraImportada('06/10/2026 7:00', 'America/Matamoros')).toBe('2026-10-06T12:00:00.000Z');
  });
  it('la misma hora en Ciudad de México (UTC-6) → 13:00Z', () => {
    expect(leerFechaHoraImportada('06/10/2026 7:00', 'America/Mexico_City')).toBe('2026-10-06T13:00:00.000Z');
  });
  it('lee dd/mm, nunca mm/dd: «05/10/2026 8:00» es 5 de octubre', () => {
    expect(leerFechaHoraImportada('05/10/2026 8:00', 'America/Mexico_City')).toBe('2026-10-05T14:00:00.000Z');
  });
  it('acepta aaaa-mm-dd hh:mm y serial de Excel con fracción', () => {
    expect(leerFechaHoraImportada('2026-10-06 07:00', 'America/Mexico_City')).toBe('2026-10-06T13:00:00.000Z');
    // 46301.2916666667 = 2026-10-06 07:00
    expect(leerFechaHoraImportada(46301 + 7 / 24, 'America/Mexico_City')).toBe('2026-10-06T13:00:00.000Z');
  });
  it('vacía = null; sin hora, texto o imposible = ilegible', () => {
    expect(leerFechaHoraImportada('')).toBeNull();
    expect(leerFechaHoraImportada(null)).toBeNull();
    expect(leerFechaHoraImportada('06/10/2026')).toBe('ilegible');
    expect(leerFechaHoraImportada(46301)).toBe('ilegible');
    expect(leerFechaHoraImportada('DIRECTO')).toBe('ilegible');
    expect(leerFechaHoraImportada('31/02/2026 7:00')).toBe('ilegible');
    expect(leerFechaHoraImportada('10/13/2026 7:00')).toBe('ilegible');
  });
});

describe('interpretarFilasViajes — citas', () => {
  it('guarda citaOrigen y citaDestino en UTC con la zona de la flota', () => {
    const r = interpretarFilasViajes(archivo(['SIN-0001', 'A', 'B', 'OPERADOR A', '06/10/2026 7:00', '07/10/2026 10:00']), { zona: 'America/Matamoros' });
    expect(r.viajes[0]).toMatchObject({ citaOrigen: '2026-10-06T12:00:00.000Z', citaDestino: '2026-10-07T15:00:00.000Z' });
    expect(r.citasIlegibles).toBeUndefined();
  });
  it('el encabezado «CITA» solo es la cita de carga', () => {
    const r = interpretarFilasViajes([['folio', 'operador', 'CITA'], ['SIN-0001', 'OPERADOR A', '06/10/2026 7:00']], { zona: 'America/Mexico_City' });
    expect(r.viajes[0].citaOrigen).toBe('2026-10-06T13:00:00.000Z');
    expect(r.viajes[0].citaDestino).toBeUndefined();
  });
  it('«CITA LIMITE» no se toma por cita (en el programa de referencia trae nombres)', () => {
    const r = interpretarFilasViajes([['folio', 'operador', 'cita limite'], ['SIN-0001', 'OPERADOR A', '06/10/2026 7:00']]);
    expect(r.viajes[0].citaOrigen).toBeUndefined();
    expect(r.viajes[0].citaDestino).toBeUndefined();
  });
  it('«DIRECTO» no tumba la fila: se importa sin cita y se dice', () => {
    const r = interpretarFilasViajes(archivo(['SIN-0002', 'A', 'B', 'OPERADOR B', 'DIRECTO', '']));
    expect(r.viajes).toHaveLength(1);
    expect(r.viajes[0].citaOrigen).toBeUndefined();
    expect(r.descartadas).toEqual([]);
    expect(r.citasIlegibles).toEqual([{ fila: 2, folio: 'SIN-0002', columna: 'cita carga', valor: 'DIRECTO' }]);
  });
  it('sin columnas de cita todo queda como antes', () => {
    const r = interpretarFilasViajes([['folio', 'operador'], ['SIN-0003', 'OPERADOR C']]);
    expect(r.viajes[0]).not.toHaveProperty('citaOrigen');
    expect(r.citasIlegibles).toBeUndefined();
  });
  it('la fecha del viaje sin hora sigue siendo válida como antes', () => {
    expect(leerFechaImportada('06/10/2026')).toBe('2026-10-06');
    const r = interpretarFilasViajes([['folio', 'fecha'], ['SIN-0004', '06/10/2026']]);
    expect(r.viajes[0].fechaInicio).toBe('2026-10-06');
  });
});

describe('archivoTraeCitas', () => {
  it('solo es verdad si hay columna de cita', async () => {
    const { archivoTraeCitas } = await import('./importar_viajes');
    expect(archivoTraeCitas([['folio', 'CITA']])).toBe(true);
    expect(archivoTraeCitas([['folio', 'Cita descarga']])).toBe(true);
    expect(archivoTraeCitas([['folio', 'operador']])).toBe(false);
    expect(archivoTraeCitas([])).toBe(false);
  });
});
