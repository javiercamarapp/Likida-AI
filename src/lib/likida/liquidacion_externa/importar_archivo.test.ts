import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { importarLiquidacionesDeArchivo, textoDeArchivoLiquidaciones } = await import('./importar_archivo');

const CSV = [
  'clave_externa,numero_empleado,periodo_desde,periodo_hasta,folios_viaje,concepto,tipo,monto,total_sistema',
  'LQ-1,E1,2026-09-01,2026-09-07,F-1,Sueldo,percepcion,1000.00,900.00',
  'LQ-1,E1,2026-09-01,2026-09-07,F-1,Anticipo,deduccion,100.00,900.00',
  'LQ-2,E2,2026-09-01,2026-09-07,F-1,Sueldo,percepcion,500.00,500.00',
  'LQ-3,E3,2026-09-01,2026-09-07,F-1,Sueldo,percepcion,500.00,999.00',
].join('\n');
const bytes = (s: string) => new TextEncoder().encode(s);

function deps(existentes: Record<string, string> = {}) {
  const recibidas: string[] = []; const entregadas: string[] = [];
  return {
    recibidas, entregadas,
    d: {
      buscar: async (_t: string, c: string) => (c in existentes ? ({ huella: existentes[c] } as never) : null),
      recibir: async (_t: string, datos: { claveExterna: string }) => { recibidas.push(datos.claveExterna); return { liquidacion: { id: datos.claveExterna } as never }; },
      entregar: async (l: { id?: string }) => { entregadas.push(String(l.id)); },
    },
  };
}

describe('importar liquidaciones desde el archivo de la flota', () => {
  it('recibe y entrega las válidas; reporta con su clave la que no cuadra, sin frenar a las demás', async () => {
    const x = deps();
    const r = await importarLiquidacionesDeArchivo('t', 'liq.csv', bytes(CSV), x.d);
    expect(r.recibidas).toBe(2);
    expect(x.recibidas).toEqual(['LQ-1', 'LQ-2']);
    expect(x.entregadas).toEqual(['LQ-1', 'LQ-2']);
    expect(r.problemas.some((p) => p.clave === 'LQ-3' && /no es la suma/.test(p.motivo))).toBe(true);
  });

  it('repetir el archivo no entrega otra vez (misma clave y mismo contenido) y no sobrescribe contenido distinto', async () => {
    const primero = deps();
    await importarLiquidacionesDeArchivo('t', 'liq.csv', bytes(CSV), primero.d);
    // La huella real de LQ-2 sale de lo que se recibió: se arma con el mismo camino.
    const { huellaContenido, validarLiquidacionExterna } = await import('./esquema');
    const h2 = huellaContenido(validarLiquidacionExterna({
      claveExterna: 'LQ-2', sistemaOrigen: 'Archivo de la flota', operador: { numeroEmpleado: 'E2' }, viajes: ['F-1'], periodo: { desde: '2026-09-01', hasta: '2026-09-07' },
      conceptos: [{ descripcion: 'Sueldo', tipo: 'percepcion', monto: 500 }], total: 500, moneda: 'MXN',
    }));
    const x = deps({ 'LQ-1': 'otra-huella', 'LQ-2': h2 });
    const r = await importarLiquidacionesDeArchivo('t', 'liq.csv', bytes(CSV), x.d);
    expect(r.repetidas).toBe(1);
    expect(r.recibidas).toBe(0);
    expect(x.entregadas).toEqual([]);
    expect(r.problemas.some((p) => p.clave === 'LQ-1' && /OTRO contenido/.test(p.motivo))).toBe(true);
  });

  it('archivo vacío o de tipo desconocido: error de lectura, nada se recibe', async () => {
    const x = deps();
    expect((await importarLiquidacionesDeArchivo('t', 'a.csv', bytes(''), x.d)).error).toMatch(/vacío/);
    expect((await importarLiquidacionesDeArchivo('t', 'a.pdf', bytes('x'), x.d)).error).toMatch(/\.pdf/);
    expect(x.recibidas).toEqual([]);
  });

  it('un CSV con BOM se lee', () => {
    const r = textoDeArchivoLiquidaciones('a.csv', bytes('﻿clave_externa,x'));
    expect(r.ok && r.texto.startsWith('clave_externa')).toBe(true);
  });

  it('un Excel con las fechas como NÚMERO DE SERIE (lo que guarda Excel) se acepta, no se rechaza', async () => {
    const XLSX = await import('xlsx');
    // 46023 = 2026-01-01 y 46029 = 2026-01-07 en el calendario de Excel; el segundo con fracción de hora.
    const hoja = XLSX.utils.aoa_to_sheet([
      ['clave_externa', 'numero_empleado', 'periodo_desde', 'periodo_hasta', 'folios_viaje', 'concepto', 'tipo', 'monto', 'total_sistema'],
      ['LQ-X1', 'E1', 46023, 46029.5, 'F-1', 'Sueldo', 'percepcion', 1000, 1000],
    ]);
    const libro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(libro, hoja, 'H');
    const xlsx = new Uint8Array(XLSX.write(libro, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
    const recibidos: Array<{ periodo: { desde: string; hasta: string } }> = [];
    const x = deps();
    const r = await importarLiquidacionesDeArchivo('t', 'liq.xlsx', xlsx, {
      ...x.d, recibir: async (_t, datos) => { recibidos.push(datos as never); return { liquidacion: { id: datos.claveExterna } as never }; },
    });
    expect(r.problemas).toEqual([]);
    expect(r.recibidas).toBe(1);
    expect(recibidos[0].periodo).toEqual({ desde: '2026-01-01', hasta: '2026-01-07' });
  });

  it('un número que NO parece fecha de Excel sigue rechazándose con el motivo del periodo', async () => {
    const csv = 'clave_externa,numero_empleado,periodo_desde,periodo_hasta,concepto,tipo,monto,total_sistema\nLQ-Y,E1,1500,99,Sueldo,percepcion,10,10';
    const r = await importarLiquidacionesDeArchivo('t', 'liq.csv', bytes(csv), deps().d);
    expect(r.recibidas).toBe(0);
    expect(r.problemas[0].motivo).toMatch(/periodo ilegible/);
  });
});
