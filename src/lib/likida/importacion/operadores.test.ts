// ═══════════════════════════════════════════════════════════════════════════
// ADM-2 (auditoría 24): «importar 3 operadores, 1 con teléfono repetido: 2
// creados, 1 error dicho por fila». Y lo que un import masivo puede hacer mal
// en silencio: duplicar por teléfono, cruzar flotas, o decir «creados: 200»
// cuando la base no escribió nada.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Op = [string, unknown[]];
type Resolver = (tabla: string, ops: Op[]) => unknown;
let resolver: Resolver = () => ({ data: null, error: null });
const from = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: (t: string) => from(t) }),
}));
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: unknown) => anotarBitacora(e as Record<string, unknown>) }));
vi.mock('../terminales', () => ({ resolverTerminalDeFlota: async (_t: string, id?: string | null) => (id ? id : null) }));

/** Un builder encadenable que recuerda sus llamadas y resuelve con `resolver`. */
function cadena(tabla: string) {
  const ops: Op[] = [];
  const nodo: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'range', 'limit', 'insert', 'upsert', 'update', 'maybeSingle', 'single']) {
    nodo[m] = (...a: unknown[]) => { ops.push([m, a]); return nodo; };
  }
  nodo.then = (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve().then(() => resolver(tabla, ops)).then(r, j);
  return nodo;
}

const { interpretarFilasOperadores, importarOperadores, validarOperadorImportado, plantillaOperadoresCsv, buscarOperadorPorTelefono } =
  await import('./operadores');
const { DatoInvalido } = await import('../errores');

beforeEach(() => {
  from.mockReset().mockImplementation((t: string) => cadena(t));
  anotarBitacora.mockClear();
  for (const f of Object.values(logger)) f.mockReset();
  resolver = () => ({ data: null, error: null });
});

const ENC = ['Nombre', 'Teléfono', 'Nº de empleado', 'RFC', 'Licencia', 'Tipo', 'Vence licencia'];

describe('interpretarFilasOperadores (pura)', () => {
  it('lee la plantilla real, normaliza el teléfono a 52+10 y descarta la fila de ejemplo con su motivo', () => {
    const csv = plantillaOperadoresCsv();
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const matriz = csv.replace('\uFEFF', '').trim().split('\r\n').map((l) => l.split(','));
    const r = interpretarFilasOperadores(matriz);
    expect(r.filas).toEqual([]);
    expect(r.descartadas).toEqual([{ fila: 2, motivo: 'es la fila de ejemplo de la plantilla' }]);
  });

  it('acepta encabezados del mundo real y el 521 de Meta; el teléfono repetido en el archivo se dice con la fila', () => {
    const r = interpretarFilasOperadores([
      ENC,
      ['Juan Pérez', '55 1234 5678', 'E-1', '', 'MEX1', 'E', '2027-03-15'],
      ['Pedro López', '+52 1 55 1234 5678', 'E-2', '', '', '', ''],   // la MISMA persona con el 1 de Telmex
      ['Ana Torres', '5219991112233', '', 'GODE561231GR8', '', '', '15/01/2027'],
    ]);
    expect(r.filas.map((f) => [f.fila, f.telefono, f.rfc])).toEqual([
      [2, '525512345678', null],
      [4, '529991112233', 'GODE561231GR8'],
    ]);
    expect(r.descartadas).toEqual([{ fila: 3, motivo: 'teléfono repetido en el archivo (ya viene en la fila 2)' }]);
  });

  it('sin columna de teléfono NO hay importación, y dice qué encabezados leyó', () => {
    const r = interpretarFilasOperadores([['Nombre', 'Empleado'], ['Juan Pérez', 'E-1']]);
    expect(r.filas).toEqual([]);
    expect(r.error).toMatch(/columna de teléfono/);
    expect(r.error).toContain('«Empleado»');
  });

  it('un número extranjero, un RFC con dígito mal y una fecha ilegible se descartan POR FILA, no tumban el archivo', () => {
    const r = interpretarFilasOperadores([
      ENC,
      ['John Doe', '+1 415 555 0100', '', '', '', '', ''],
      ['Ana Torres', '5512345678', '', 'GODE561231GR9', '', '', ''],
      ['Luis Mora', '5512345679', '', '', '', '', 'mañana'],
      ['Ok Bien', '5512345670', '', '', '', '', ''],
    ]);
    expect(r.filas.map((f) => f.nombre)).toEqual(['Ok Bien']);
    expect(r.descartadas.map((d) => d.fila)).toEqual([2, 3, 4]);
    expect(r.descartadas[0].motivo).toMatch(/celular mexicano/);
    expect(r.descartadas[1].motivo).toMatch(/dígito verificador/);
    expect(r.descartadas[2].motivo).toMatch(/AAAA-MM-DD/);
  });

  it('el tope de filas se DICE primero en descartadas y en error, con la cifra (FE-15)', () => {
    const matriz: unknown[][] = [ENC];
    for (let i = 0; i < 2_001; i++) matriz.push([`Chofer ${i}`, `55${String(10000000 + i)}`, '', '', '', '', '']);
    const r = interpretarFilasOperadores(matriz);
    expect(r.filas).toHaveLength(2_000);
    expect(r.descartadas[0].motivo).toMatch(/2,001 filas/);
    expect(r.error).toBe(r.descartadas[0].motivo);
  });

  it('validarOperadorImportado es la misma regla que el alta unitaria', () => {
    expect(() => validarOperadorImportado({ nombre: 'Jo', telefono: '5512345678' }, 1)).toThrow(DatoInvalido);
    expect(() => validarOperadorImportado({ nombre: 'Juan', telefono: '' }, 1)).toThrow(/sin teléfono/);
    expect(validarOperadorImportado({ nombre: '  Juan   Pérez ', telefono: '(55) 1234-5678', rfc: ' gode561231gr8 ' }, 7))
      .toMatchObject({ fila: 7, nombre: 'Juan Pérez', telefono: '525512345678', rfc: 'GODE561231GR8' });
  });
});

const tres = interpretarFilasOperadores([
  ENC,
  ['Juan Pérez', '5512345678', 'E-1', '', '', '', ''],
  ['Pedro López', '5512345679', 'E-2', '', '', '', ''],
  ['Ana Torres', '5512345670', 'E-3', '', '', '', ''],
]).filas;

describe('importarOperadores', () => {
  it('3 filas, 1 teléfono que ya está en la flota: 2 creados, 1 «ya estaba» con nombre, y UNA línea de bitácora con los ids', async () => {
    let insertadas: Array<Record<string, unknown>> = [];
    resolver = (tabla, ops) => {
      if (tabla !== 'operador') return { data: null, error: null };
      const ins = ops.find(([m]) => m === 'insert');
      if (ins) {
        insertadas = ins[1][0] as Array<Record<string, unknown>>;
        return { data: insertadas.map((f, i) => ({ id: `o-${i}`, telefono: f.telefono })), error: null };
      }
      // La lectura de existentes: Pedro ya está en ESTA flota, activo.
      return { data: [{ id: 'o-viejo', tenant_id: 't-1', nombre: 'Pedro L.', telefono: '525512345679', activo: true }], error: null };
    };

    const r = await importarOperadores('t-1', tres, { origen: 'panel', actor: { id: 'u-1' } });
    expect(r.creados.map((c) => [c.fila, c.id])).toEqual([[2, 'o-0'], [4, 'o-1']]);
    expect(r.duplicados).toEqual([{ fila: 3, id: 'o-viejo', telefono: '525512345679', motivo: 'ya estaba, a nombre de Pedro L.' }]);
    expect(r.errores).toEqual([]);
    expect(r.avisoPendiente).toBe(2);
    // Lo que se escribió es lo que se dijo: el tenant va en cada fila.
    expect(insertadas.every((f) => f.tenant_id === 't-1')).toBe(true);
    expect(insertadas.map((f) => f.telefono)).toEqual(['525512345678', '525512345670']);
    expect(anotarBitacora).toHaveBeenCalledTimes(1);
    expect(anotarBitacora.mock.calls[0][0]).toMatchObject({
      tenantId: 't-1', accion: 'operador.importados', actor: { id: 'u-1' },
      detalle: { origen: 'panel', creados: 2, duplicados: 1, errores: 0, ids: ['o-0', 'o-1'] },
    });
  });

  it('un teléfono ACTIVO en otra flota es un ERROR por fila (no se cruza dinero), y uno de baja en la propia pide reactivar', async () => {
    resolver = (tabla, ops) => {
      if (tabla !== 'operador') return { data: null, error: null };
      const ins = ops.find(([m]) => m === 'insert');
      if (ins) return { data: (ins[1][0] as Array<Record<string, unknown>>).map((f, i) => ({ id: `o-${i}`, telefono: f.telefono })), error: null };
      return { data: [
        { id: 'x', tenant_id: 'OTRA', nombre: 'Juan Ajeno', telefono: '5215512345678', activo: true },
        { id: 'y', tenant_id: 't-1', nombre: 'Pedro Baja', telefono: '525512345679', activo: false },
      ], error: null };
    };
    const r = await importarOperadores('t-1', tres, { origen: 'api' });
    expect(r.creados.map((c) => c.fila)).toEqual([4]);
    expect(r.errores.map((e) => e.fila)).toEqual([2, 3]);
    expect(r.errores[0].motivo).toMatch(/OTRA flota/);
    expect(r.errores[1].motivo).toMatch(/Pedro Baja.*reactívalo/);
  });

  it('el MISMO archivo dos veces no duplica: la segunda corrida reporta todo como «ya estaba» y no inserta', async () => {
    const inserts: number[] = [];
    resolver = (tabla, ops) => {
      if (ops.some(([m]) => m === 'insert')) { inserts.push(1); return { data: [], error: null }; }
      if (tabla !== 'operador') return { data: null, error: null };
      return { data: tres.map((f) => ({ id: `o-${f.fila}`, tenant_id: 't-1', nombre: f.nombre, telefono: f.telefono, activo: true })), error: null };
    };
    const r = await importarOperadores('t-1', tres, { origen: 'panel' });
    expect(r.creados).toEqual([]);
    expect(r.duplicados.map((d) => d.id)).toEqual(['o-2', 'o-3', 'o-4']);
    expect(inserts).toEqual([]);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('si NO se pudo leer qué teléfonos existen, no importa NADA y lo dice (fallar cerrado)', async () => {
    resolver = () => ({ data: null, error: { message: 'PostgREST 503' } });
    const r = await importarOperadores('t-1', tres, { origen: 'panel' });
    expect(r.error).toMatch(/no importé nada/);
    expect(r.creados).toEqual([]);
    expect(from.mock.calls.filter(([t]) => t === 'operador')).toHaveLength(1);
  });

  it('la carrera: la tanda choca contra el unique, se reintenta fila por fila y el perdedor dice «ya estaba», no «creados: 3»', async () => {
    let tandaIntentada = false;
    resolver = (tabla, ops) => {
      if (tabla !== 'operador') return { data: null, error: null };
      const ins = ops.find(([m]) => m === 'insert');
      if (!ins) {
        // Primera lectura: nada. Después del choque, la búsqueda del que ganó.
        const porTenant = ops.some(([m, a]) => m === 'eq' && a[0] === 'tenant_id');
        return porTenant
          ? { data: [{ id: 'o-gano', nombre: 'Pedro Rápido', numero_empleado: null, activo: true }], error: null }
          : { data: [], error: null };
      }
      const filas = ins[1][0];
      if (Array.isArray(filas)) {
        tandaIntentada = true;
        return { data: null, error: { message: 'duplicate key value violates unique constraint "uq_operador_tenant_telefono_norm"' } };
      }
      const f = filas as Record<string, unknown>;
      return f.telefono === '525512345679'
        ? { data: null, error: { message: 'duplicate key value violates unique constraint "uq_operador_telefono_activo"' } }
        : { data: { id: `o-${f.telefono}` }, error: null };
    };
    const r = await importarOperadores('t-1', tres, { origen: 'panel' });
    expect(tandaIntentada).toBe(true);
    expect(r.creados.map((c) => c.fila)).toEqual([2, 4]);
    expect(r.duplicados).toEqual([{ fila: 3, id: 'o-gano', telefono: '525512345679', motivo: 'ya estaba, a nombre de Pedro Rápido' }]);
  });

  it('un error de la base que NO es un choque detiene el import: las filas que faltaban salen como «no se intentó»', async () => {
    const muchas = interpretarFilasOperadores([
      ENC, ...Array.from({ length: 250 }, (_, i) => [`Chofer ${i}`, `55${String(20000000 + i)}`, '', '', '', '', '']),
    ]).filas;
    let tandas = 0;
    resolver = (tabla, ops) => {
      if (tabla !== 'operador') return { data: null, error: null };
      if (ops.some(([m]) => m === 'insert')) { tandas++; return { data: null, error: { message: 'canceling statement due to statement timeout' } }; }
      return { data: [], error: null };
    };
    const r = await importarOperadores('t-1', muchas, { origen: 'panel' });
    expect(tandas).toBe(1);                       // la segunda tanda ni se intentó
    expect(r.creados).toEqual([]);
    expect(r.errores).toHaveLength(250);
    expect(r.errores.filter((e) => /no se intentó/.test(e.motivo))).toHaveLength(50);
  });

  it('buscarOperadorPorTelefono busca por las variantes del número, anclado al tenant, y lanza si no pudo leer', async () => {
    resolver = (_t, ops) => {
      const inOp = ops.find(([m]) => m === 'in');
      expect((inOp![1][1] as string[])).toEqual(expect.arrayContaining(['525512345678', '5215512345678', '+525512345678']));
      expect(ops.some(([m, a]) => m === 'eq' && a[0] === 'tenant_id' && a[1] === 't-1')).toBe(true);
      return { data: [{ id: 'o-1', nombre: 'Juan', numero_empleado: 'E-1', activo: true }], error: null };
    };
    expect(await buscarOperadorPorTelefono('t-1', '525512345678')).toEqual({ id: 'o-1', nombre: 'Juan', numeroEmpleado: 'E-1', activo: true });
    resolver = () => ({ data: null, error: { message: 'caída' } });
    await expect(buscarOperadorPorTelefono('t-1', '525512345678')).rejects.toThrow(/caída/);
  });
});
