import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { aLiquidacionExterna, type DesgloseBitacora } from './desglose_contrato';
import { netoEnCentavos } from './desglose_reglas';
import type { ResultadoDesglose } from './desglose_recibir';
import {
  desglosesDeCsv, esFormatoDesglose, fechaDeDesglose, importarDesglosesDeArchivo, MAX_BITACORAS_POR_ARCHIVO,
} from './desglose_csv';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

// Todo sintético: terminales, bitácoras, empleados e importes inventados.
const ENC = 'terminal;bitacora;poliza;numero_empleado;unidad;desde;hasta;dias;tipo;concepto;monto;vale;neto;tipo_operador';
const CSV_TRES = [
  ENC,
  // B-100: con vale (anticipo), neto 1 000,00 - 300,00 = 700,00
  'T1;B-100;P-1;E-1;U-10;2026-09-01;2026-09-06;6;percepcion;Sueldo;1000,00;;700,00;foraneo',
  'T1;B-100;P-1;E-1;U-10;2026-09-01;2026-09-06;6;deduccion;Anticipo;300,00;*257008;700,00;foraneo',
  // B-200: sin póliza
  'T1;B-200;;E-2;U-11;2026-09-01;2026-09-06;;percepcion;Sueldo;500,00;;;local',
  // B-300: neto negativo (deducciones > percepciones)
  'T2;B-300;P-3;E-3;U-12;2026-09-02;2026-09-05;;percepcion;Sueldo;200,00;;;foraneo',
  'T2;B-300;P-3;E-3;U-12;2026-09-02;2026-09-05;;deduccion;Anticipo;450,00;*9;;foraneo',
].join('\n');

/** Doble de `recibirDesglose`: aplica la misma regla de neto negativo que las guardas y recuerda lo recibido. */
function recibidor() {
  const vistos: DesgloseBitacora[] = [];
  const recibir = vi.fn(async (_t: string, d: DesgloseBitacora): Promise<ResultadoDesglose> => {
    vistos.push(d);
    return {
      estado: 'creada', liquidacionId: `liq-${vistos.length}`, claveExterna: `BIT-${d.bitacora}`, entregas: 1,
      retenida: netoEnCentavos(d) < 0, motivos: [], excepciones: [],
    };
  });
  return { recibir, vistos };
}

describe('desglosesDeCsv: 3 bitácoras sintéticas', () => {
  const r = desglosesDeCsv(CSV_TRES);

  it('agrupa por (terminal, bitácora): 2 importables y 1 excepción sin_poliza', () => {
    expect(r.problemas).toEqual([]);
    expect(r.desgloses.map((d) => d.bitacora)).toEqual(['B-100', 'B-300']);
    expect(r.excepciones).toEqual([{ clave: 'BIT-T1-B-200', motivo: 'sin_poliza' }]);
  });

  it('la bitácora con vale lleva el vale sin asterisco, el decimal con coma y el neto de la fuente', () => {
    const d = r.desgloses[0];
    expect(d.percepciones).toEqual([{ concepto: 'Sueldo', monto: 1000 }]);
    expect(d.deducciones).toEqual([{ concepto: 'Anticipo', monto: 300, vale: '257008' }]);
    expect(d).toMatchObject({ terminal: 'T1', poliza: 'P-1', unidad: 'U-10', desde: '2026-09-01', hasta: '2026-09-06', dias: 6, neto: 700, tipoOperador: 'foraneo' });
    expect(d.operador).toEqual({ numeroEmpleado: 'E-1' });
  });

  it('la de neto negativo entra (la retención es de las guardas, no del importador)', () => {
    expect(netoEnCentavos(r.desgloses[1])).toBe(-25000);
  });

  it('cada desglose pasa el contrato y se convierte a la liquidación vigente', () => {
    for (const d of r.desgloses) expect(() => aLiquidacionExterna(d, { sistemaOrigen: 'prueba' })).not.toThrow();
  });
});

describe('desglosesDeCsv: encabezados, fechas y tipos', () => {
  it('encabezados con acentos y mayúsculas; separador coma; cargo/abono; fecha DD/MM/AAAA', () => {
    const csv = [
      'Terminal,Bitácora,Póliza,No. Empleado,Unidad,Fecha Inicio,Fecha Fin,Tipo,Descripción,Importe',
      'T1,B-1,P-1,E-1,U-1,01/09/2026,06/09/2026,CARGO,Sueldo,1000.50',
      'T1,B-1,P-1,E-1,U-1,01/09/2026,06/09/2026,Abono,Anticipo,200',
    ].join('\n');
    const r = desglosesDeCsv(csv);
    expect(r.problemas).toEqual([]);
    expect(r.desgloses).toHaveLength(1);
    expect(r.desgloses[0]).toMatchObject({ desde: '2026-09-01', hasta: '2026-09-06' });
    expect(r.desgloses[0].percepciones).toEqual([{ concepto: 'Sueldo', monto: 1000.5 }]);
    expect(r.desgloses[0].deducciones).toEqual([{ concepto: 'Anticipo', monto: 200 }]);
  });

  it('fecha como número de serie de Excel (46023 = 2026-01-01)', () => {
    const csv = [
      'bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto',
      'B-1,P-1,E-1,46023,46029,percepcion,Sueldo,10',
    ].join('\n');
    const r = desglosesDeCsv(csv);
    expect(r.desgloses[0]).toMatchObject({ desde: '2026-01-01', hasta: '2026-01-07' });
  });

  it('fechaDeDesglose: ISO, dmy, serial; fechas imposibles y basura son null', () => {
    expect(fechaDeDesglose('2026-09-01')).toBe('2026-09-01');
    expect(fechaDeDesglose('1/9/2026')).toBe('2026-09-01');
    expect(fechaDeDesglose('46023')).toBe('2026-01-01');
    for (const t of ['31/02/2026', '2026-02-30', 'ayer', '', '13/13/2026']) expect(fechaDeDesglose(t)).toBeNull();
  });

  it('una fila sin tipo es un problema con su número de fila y la bitácora no entra; las demás sí', () => {
    const csv = [
      'bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto',
      'B-1,P-1,E-1,2026-09-01,2026-09-02,percepcion,Sueldo,10',
      'B-2,P-2,E-2,2026-09-01,2026-09-02,percepcion,Sueldo,10',
      'B-2,P-2,E-2,2026-09-01,2026-09-02,,Anticipo,5',
    ].join('\n');
    const r = desglosesDeCsv(csv);
    expect(r.desgloses.map((d) => d.bitacora)).toEqual(['B-1']);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toMatchObject({ clave: 'BIT-B-2', fila: 4 });
    expect(r.problemas[0].motivo).toMatch(/tipo/);
  });

  it('valores distintos de encabezado dentro de una bitácora (otro empleado) la rechazan', () => {
    const csv = [
      'bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto',
      'B-1,P-1,E-1,2026-09-01,2026-09-02,percepcion,Sueldo,10',
      'B-1,P-1,E-9,2026-09-01,2026-09-02,deduccion,Anticipo,5',
    ].join('\n');
    const r = desglosesDeCsv(csv);
    expect(r.desgloses).toEqual([]);
    expect(r.problemas[0]).toMatchObject({ clave: 'BIT-B-1', fila: 3 });
  });

  it('monto vacío, ilegible o negativo es problema; monto 0 se ignora y se cuenta', () => {
    const csv = [
      'bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto',
      'B-1,P-1,E-1,2026-09-01,2026-09-02,percepcion,Sueldo,10',
      'B-1,P-1,E-1,2026-09-01,2026-09-02,deduccion,Nada,0',
      'B-2,P-2,E-2,2026-09-01,2026-09-02,percepcion,Sueldo,',
      'B-3,P-3,E-3,2026-09-01,2026-09-02,percepcion,Sueldo,-5',
      'B-4,P-4,E-4,2026-09-01,2026-09-02,percepcion,Sueldo,abc',
    ].join('\n');
    const r = desglosesDeCsv(csv);
    expect(r.desgloses.map((d) => d.bitacora)).toEqual(['B-1']);
    expect(r.desgloses[0].deducciones).toEqual([]);
    expect(r.renglonesEnCero).toBe(1);
    expect(r.problemas.map((p) => p.clave)).toEqual(['BIT-B-2', 'BIT-B-3', 'BIT-B-4']);
    expect(r.problemas.map((p) => p.fila)).toEqual([4, 5, 6]);
  });

  it('periodo incoherente, tipo_operador desconocido y bitácora solo de ceros se reportan', () => {
    const csv = [
      'bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto,tipo_operador',
      'B-1,P-1,E-1,2026-09-05,2026-09-01,percepcion,Sueldo,10,',
      'B-2,P-2,E-2,2026-09-01,2026-09-02,percepcion,Sueldo,10,extraterrestre',
      'B-3,P-3,E-3,2026-09-01,2026-09-02,percepcion,Sueldo,0,',
    ].join('\n');
    const r = desglosesDeCsv(csv);
    expect(r.desgloses).toEqual([]);
    expect(r.problemas.map((p) => p.clave)).toEqual(['BIT-B-1', 'BIT-B-2', 'BIT-B-3']);
  });

  it('faltan columnas obligatorias: un solo problema que las nombra; archivo vacío también', () => {
    const r = desglosesDeCsv('bitacora,concepto\nB-1,Sueldo');
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0].motivo).toMatch(/numero_empleado.*monto|monto/);
    expect(desglosesDeCsv('').problemas[0].motivo).toMatch(/vac/);
  });

  it('esFormatoDesglose distingue el export de bitácoras del CSV propio de Likida', () => {
    expect(esFormatoDesglose(ENC.split(';'))).toBe(true);
    expect(esFormatoDesglose('clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema'.split(','))).toBe(false);
  });
});

describe('importarDesglosesDeArchivo', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  it('CSV: manda a recibir solo los importables y reporta la excepción sin_poliza y la retenida', async () => {
    const { recibir, vistos } = recibidor();
    const r = await importarDesglosesDeArchivo('t1', 'export.csv', bytes(CSV_TRES), { recibir });
    expect(recibir).toHaveBeenCalledTimes(2);
    expect(vistos.map((d) => d.bitacora)).toEqual(['B-100', 'B-300']);
    expect(r).toMatchObject({ recibidas: 2, retenidas: 1, idempotentes: 0, correcciones: 0, problemas: [] });
    expect(r.excepciones).toEqual([{ clave: 'BIT-T1-B-200', motivo: 'sin_poliza' }]);
    expect(r.error).toBeUndefined();
  });

  it('A37-A1-liquidaciones-19: CSV en Windows-1252 conserva los acentos del concepto', async () => {
    const { recibir, vistos } = recibidor();
    const ansi = Uint8Array.from(Array.from(CSV_TRES.replace('Sueldo', 'Vi\u00e1ticos'), (c) => c.charCodeAt(0)));
    await importarDesglosesDeArchivo('t1', 'export.csv', ansi, { recibir });
    const conceptos = vistos.flatMap((d) => [...d.percepciones, ...d.deducciones].map((r) => r.concepto));
    expect(conceptos).toContain('Viáticos');
    expect(conceptos.join('')).not.toContain('\uFFFD');
  });

  it('Excel (.xlsx): fecha serial y montos numéricos', async () => {
    const hoja = XLSX.utils.aoa_to_sheet([
      ['Bitácora', 'Póliza', 'No. Empleado', 'Desde', 'Hasta', 'Tipo', 'Concepto', 'Monto'],
      ['B-1', 'P-1', 'E-1', 46023, 46029, 'Percepción', 'Sueldo', 1000.5],
      ['B-1', 'P-1', 'E-1', 46023, 46029, 'Deducción', 'Anticipo', 200],
    ]);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Hoja1');
    const buf = XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const { recibir, vistos } = recibidor();
    const r = await importarDesglosesDeArchivo('t1', 'export.xlsx', new Uint8Array(buf), { recibir });
    expect(r.problemas).toEqual([]);
    expect(r.recibidas).toBe(1);
    expect(vistos[0]).toMatchObject({ desde: '2026-01-01', hasta: '2026-01-07' });
    expect(vistos[0].percepciones[0].monto).toBe(1000.5);
  });

  it('cuenta idempotentes y correcciones, y un fallo de guardado de una no frena a las demás', async () => {
    let n = 0;
    const recibir = vi.fn(async (_t: string, d: DesgloseBitacora): Promise<ResultadoDesglose> => {
      n++;
      if (d.bitacora === 'B-100') return { estado: 'idempotente', liquidacionId: 'x', claveExterna: 'k' };
      if (n === 2) throw new Error('storage caído con datos del operador E-3');
      return { estado: 'correccion_pendiente', liquidacionId: 'y', claveExterna: 'k' };
    });
    const csv = [
      'bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto',
      'B-100,P,E-1,2026-09-01,2026-09-02,percepcion,Sueldo,10',
      'B-200,P,E-2,2026-09-01,2026-09-02,percepcion,Sueldo,10',
      'B-300,P,E-3,2026-09-01,2026-09-02,percepcion,Sueldo,10',
    ].join('\n');
    const r = await importarDesglosesDeArchivo('t1', 'a.csv', bytes(csv), { recibir });
    expect(r).toMatchObject({ recibidas: 0, idempotentes: 1, correcciones: 1 });
    expect(r.excepciones).toEqual([{ clave: 'BIT-B-300', motivo: 'correccion_pendiente' }]);
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0].motivo).not.toMatch(/E-3|storage/);
  });

  it('archivo vacío, formato ilegible y CSV propio de Likida dan error sin llamar a recibir', async () => {
    const { recibir } = recibidor();
    expect((await importarDesglosesDeArchivo('t1', 'a.csv', new Uint8Array(0), { recibir })).error).toMatch(/vac/);
    expect((await importarDesglosesDeArchivo('t1', 'a.pdf', bytes('x'), { recibir })).error).toBeTruthy();
    const propio = 'clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema\nA,E1,2026-09-01,2026-09-02,Sueldo,percepcion,10,10';
    expect((await importarDesglosesDeArchivo('t1', 'a.csv', bytes(propio), { recibir })).error).toMatch(/export de bit/);
    expect(recibir).not.toHaveBeenCalled();
  });

  it(`más de ${MAX_BITACORAS_POR_ARCHIVO} bitácoras: error, nada se recibe`, async () => {
    const filas = ['bitacora,poliza,numero_empleado,desde,hasta,tipo,concepto,monto'];
    for (let i = 0; i <= MAX_BITACORAS_POR_ARCHIVO; i++) filas.push(`B-${i},P,E-1,2026-09-01,2026-09-02,percepcion,Sueldo,10`);
    const { recibir } = recibidor();
    const r = await importarDesglosesDeArchivo('t1', 'a.csv', bytes(filas.join('\n')), { recibir });
    expect(r.error).toMatch(/máximo/);
    expect(recibir).not.toHaveBeenCalled();
  });
});
