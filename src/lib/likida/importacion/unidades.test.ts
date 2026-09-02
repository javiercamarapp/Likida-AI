// ═══════════════════════════════════════════════════════════════════════════
// ADM-2 (auditoría 24): 800 tractos de un CSV. Placa obligatoria, en
// MAYÚSCULAS y única por flota; número económico idempotente por la base;
// reporte por fila; tandas de 200 que cuentan SOLO lo que entró.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Op = [string, unknown[]];
type Resolver = (tabla: string, ops: Op[]) => unknown;
let resolver: Resolver = () => ({ data: null, error: null });
const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => from(t) }) }));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown) => anotarBitacora(e as Record<string, unknown>) }));
vi.mock('../terminales', () => ({ resolverTerminalDeFlota: async (_t: string, id?: string | null) => (id ? id : null) }));

function cadena(tabla: string) {
  const ops: Op[] = [];
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'limit', 'insert', 'upsert', 'update', 'maybeSingle', 'single']) {
    nodo[m] = (...a: unknown[]) => { ops.push([m, a]); return nodo; };
  }
  nodo.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve().then(() => resolver(tabla, ops)).then(r, j);
  return nodo;
}

const { interpretarFilasUnidades, importarUnidades, validarUnidadImportada, normalizarPlaca, plantillaUnidadesCsv } =
  await import('./unidades');

beforeEach(() => {
  from.mockReset().mockImplementation((t: string) => cadena(t));
  anotarBitacora.mockClear();
  for (const f of Object.values(logger)) f.mockReset();
  resolver = () => ({ data: null, error: null });
});

const HOY = new Date('2026-09-01T12:00:00Z');
const ENC = ['Número económico', 'Placas', 'Marca', 'Modelo', 'Año', 'Póliza vence', 'Permiso SICT vence', 'Verificación vence'];

describe('la placa', () => {
  it('se guarda en MAYÚSCULAS y sin espacios/guiones repetidos', () => {
    expect(normalizarPlaca(' abc 123 4 ')).toBe('ABC-123-4');
    expect(normalizarPlaca('abc--123')).toBe('ABC-123');
    expect(normalizarPlaca('-ABC-')).toBe('ABC');
  });

  it('es obligatoria y solo admite letras, números y guion', () => {
    expect(() => validarUnidadImportada({ numeroEconomico: 'T-1', placas: '' }, 1, HOY)).toThrow(/sin placa/);
    expect(() => validarUnidadImportada({ numeroEconomico: 'T-1', placas: 'AB$12' }, 1, HOY)).toThrow(/letras, números ni guion/);
  });

  it('reusa validarUnidad: mismo tope de año y misma regla de fecha que el formulario', () => {
    expect(() => validarUnidadImportada({ numeroEconomico: 'T-1', placas: 'ABC1234', anio: '1919' }, 1, HOY)).toThrow(/1950/);
    expect(() => validarUnidadImportada({ numeroEconomico: 'T-1', placas: 'ABC1234', polizaVence: '2026-02-30' }, 1, HOY)).toThrow(/no es una fecha que exista/);
    expect(validarUnidadImportada({ numeroEconomico: ' T-1 ', placas: 'abc-123-4', anio: 2019, polizaVence: '2027-01-31' }, 3, HOY))
      .toMatchObject({ fila: 3, numeroEconomico: 'T-1', placas: 'ABC-123-4', anio: 2019, polizaVence: '2027-01-31', permisoSictVence: null, gpsProveedor: null });
  });
});

describe('interpretarFilasUnidades (pura)', () => {
  it('lee la plantilla real y descarta la fila de ejemplo', () => {
    const matriz = plantillaUnidadesCsv().replace('﻿', '').trim().split('\r\n').map((l) => l.split(','));
    const r = interpretarFilasUnidades(matriz, HOY);
    expect(r.filas).toEqual([]);
    expect(r.economicoDesdePlaca).toBe(false);
    expect(r.descartadas).toEqual([{ fila: 2, motivo: 'es la fila de ejemplo de la plantilla' }]);
  });

  it('acepta encabezados del mundo real, fechas dd/mm/aaaa y placas repetidas se dicen con la fila', () => {
    const r = interpretarFilasUnidades([
      ENC,
      ['T-01', 'abc-123-4', 'Kenworth', 'T680', 2019, '31/01/2027', '', ''],
      ['T-02', 'ABC 123 4', '', '', '', '', '', ''],            // la misma placa, escrita distinto
      ['T-03', 'XYZ-987-6', 'Freightliner', '', '2020', '', '2026-11-30', 45000 /* serial de Excel */],
    ], HOY);
    expect(r.filas.map((f) => [f.fila, f.numeroEconomico, f.placas, f.polizaVence, f.verificacionVence])).toEqual([
      [2, 'T-01', 'ABC-123-4', '2027-01-31', null],
      [4, 'T-03', 'XYZ-987-6', null, '2023-03-15'],
    ]);
    expect(r.descartadas).toEqual([{ fila: 3, motivo: 'placa ABC-123-4 repetida en el archivo (ya viene en la fila 2)' }]);
  });

  it('sin columna de número económico, la placa hace de económico — y se DICE', () => {
    const r = interpretarFilasUnidades([['Placa', 'Marca'], ['abc1234', 'Kenworth'], ['', 'Volvo']], HOY);
    expect(r.economicoDesdePlaca).toBe(true);
    expect(r.filas.map((f) => [f.numeroEconomico, f.placas])).toEqual([['ABC1234', 'ABC1234']]);
    expect(r.descartadas).toEqual([{ fila: 3, motivo: 'sin placa — es obligatoria' }]);
  });

  it('sin columna de placas no hay importación', () => {
    const r = interpretarFilasUnidades([['Unidad', 'Marca'], ['T-1', 'Kenworth']], HOY);
    expect(r.filas).toEqual([]);
    expect(r.error).toMatch(/columna de placas/);
  });
});

const tres = interpretarFilasUnidades([
  ENC,
  ['T-01', 'AAA-111-1', '', '', '', '', '', ''],
  ['T-02', 'BBB-222-2', '', '', '', '', '', ''],
  ['T-03', 'CCC-333-3', '', '', '', '', '', ''],
], HOY).filas;

describe('importarUnidades', () => {
  it('2 nuevas, 1 económico que ya está: solo lo que la base devolvió cuenta como creado; terminal en cada fila; bitácora con ids', async () => {
    let upsert: Array<Record<string, unknown>> = [];
    resolver = (tabla, ops) => {
      if (tabla !== 'unidad') return { data: null, error: null };
      const up = ops.find(([m]) => m === 'upsert');
      if (up) {
        upsert = up[1][0] as Array<Record<string, unknown>>;
        expect(up[1][1]).toEqual({ onConflict: 'tenant_id,numero_economico', ignoreDuplicates: true });
        return { data: upsert.map((f, i) => ({ id: `u-${i}`, numero_economico: f.numero_economico })), error: null };
      }
      return { data: [{ id: 'u-viejo', numero_economico: 'T-02', placas: 'bbb-222-2' }], error: null, count: 1 };
    };
    const r = await importarUnidades('t-1', tres, { origen: 'panel', terminalId: 'term-9', actor: { id: 'u-1' } });
    expect(r.creadas.map((c) => [c.fila, c.id, c.placas])).toEqual([[2, 'u-0', 'AAA-111-1'], [4, 'u-1', 'CCC-333-3']]);
    expect(r.duplicadas).toEqual([{ fila: 3, id: 'u-viejo', numeroEconomico: 'T-02', motivo: 'ya estaba (mismo número económico); no se tocó lo que hay' }]);
    expect(r.errores).toEqual([]);
    expect(upsert.every((f) => f.tenant_id === 't-1' && f.terminal_id === 'term-9')).toBe(true);
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({
      accion: 'unidad.importadas', entidad: 'tenant', detalle: { creadas: 2, duplicadas: 1, errores: 0, ids: ['u-0', 'u-1'], terminalId: 'term-9' },
    });
  });

  it('una placa que ya es de OTRA unidad de la flota es un error por fila que nombra a esa unidad', async () => {
    resolver = (tabla, ops) => {
      if (tabla !== 'unidad') return { data: null, error: null };
      const up = ops.find(([m]) => m === 'upsert');
      if (up) return { data: (up[1][0] as Array<Record<string, unknown>>).map((f, i) => ({ id: `u-${i}`, numero_economico: f.numero_economico })), error: null };
      return { data: [{ id: 'u-x', numero_economico: 'T-99', placas: 'aaa 111 1' }], error: null, count: 1 };
    };
    const r = await importarUnidades('t-1', tres, { origen: 'api' });
    expect(r.errores).toEqual([{ fila: 2, motivo: 'la placa AAA-111-1 ya es de la unidad T-99; una placa es de un solo camión' }]);
    expect(r.creadas.map((c) => c.numeroEconomico)).toEqual(['T-02', 'T-03']);
  });

  it('la carrera: lo que el upsert NO devolvió es «ya estaba», nunca «creadas: 3»', async () => {
    resolver = (tabla, ops) => {
      if (tabla !== 'unidad') return { data: null, error: null };
      if (ops.some(([m]) => m === 'upsert')) return { data: [{ id: 'u-1', numero_economico: 'T-01' }], error: null };
      return { data: [], error: null, count: 0 };
    };
    const r = await importarUnidades('t-1', tres, { origen: 'panel' });
    expect(r.creadas.map((c) => c.numeroEconomico)).toEqual(['T-01']);
    expect(r.duplicadas.map((d) => [d.numeroEconomico, d.id])).toEqual([['T-02', null], ['T-03', null]]);
  });

  it('si no se pudo leer el parque entero, no importa nada y lo dice', async () => {
    resolver = () => ({ data: null, error: { message: 'PostgREST 503' } });
    const r = await importarUnidades('t-1', tres, { origen: 'panel' });
    expect(r.error).toMatch(/no importé nada/);
    expect(r.creadas).toEqual([]);
  });

  it('un archivo de 450 filas va en tandas de 200 y un fallo de la base detiene lo que sigue', async () => {
    const muchas = interpretarFilasUnidades([
      ENC, ...Array.from({ length: 450 }, (_, i) => [`T-${i}`, `PL-${i}`, '', '', '', '', '', '']),
    ], HOY).filas;
    const tamanos: number[] = [];
    resolver = (tabla, ops) => {
      if (tabla !== 'unidad') return { data: null, error: null };
      const up = ops.find(([m]) => m === 'upsert');
      if (!up) return { data: [], error: null, count: 0 };
      const filas = up[1][0] as Array<Record<string, unknown>>;
      tamanos.push(filas.length);
      if (tamanos.length === 2) return { data: null, error: { message: 'canceling statement due to statement timeout' } };
      return { data: filas.map((f, i) => ({ id: `u-${tamanos.length}-${i}`, numero_economico: f.numero_economico })), error: null };
    };
    const r = await importarUnidades('t-1', muchas, { origen: 'panel' });
    expect(tamanos).toEqual([200, 200]);           // la tercera no se intentó
    expect(r.creadas).toHaveLength(200);
    expect(r.errores).toHaveLength(250);
    expect(r.errores.filter((e) => /no se intentó/.test(e.motivo))).toHaveLength(50);
  });
});
