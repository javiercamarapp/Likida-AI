// ═══════════════════════════════════════════════════════════════════════════
// LA CARGA MASIVA CONTRA UNA BASE QUE APLICA LOS FILTROS Y LOS UNIQUE (W2).
//
// `operadores.test.ts` y `unidades.test.ts` prueban la lógica con dobles que
// cuentan llamadas. Lo que NO podían probar es lo que importa de una carga de 250
// filas: que el mismo archivo dos veces no duplique, que dos submits a la vez no
// dupliquen, que la vista previa prometa exactamente lo que la escritura hace,
// que un patio de otra flota no se cuele y que lo hostil se guarde como texto.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria, type Fila } from '@/lib/pruebas/tablas_en_memoria.fixture';

let base: BaseEnMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => base.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => true);
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (e: Record<string, unknown>) => anotarBitacora(e) }));

const { interpretarFilasOperadores, importarOperadores, planificarOperadores } = await import('./operadores');
const { interpretarFilasUnidades, importarUnidades, planificarUnidades } = await import('./unidades');
const { asignarPatios } = await import('./patios');
const { DatoInvalido } = await import('../errores');
const { getTerminales } = await import('../terminales');

const T = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AJENO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const UNICOS = [
  { tabla: 'operador', nombre: 'uq_operador_tenant_telefono_norm', columnas: ['tenant_id', 'telefono'] },
];

beforeEach(() => {
  base = crearBaseEnMemoria({
    terminal: [
      { id: NORTE, tenant_id: T, nombre: 'Patio Norte', ciudad: 'Monterrey' },
      { id: SUR, tenant_id: T, nombre: 'Patio Sur', ciudad: null },
      { id: AJENO, tenant_id: OTRA, nombre: 'Patio Ajeno', ciudad: null },
    ],
    operador: [], unidad: [],
  }, UNICOS, { operador: { activo: true }, unidad: { activo: true } });
  anotarBitacora.mockClear();
});

/** Un archivo de operadores de `n` filas, teléfonos 5500000001… */
function matrizOperadores(n: number, patio?: (i: number) => string): unknown[][] {
  const filas: unknown[][] = [['nombre', 'telefono', 'numero de empleado', 'patio']];
  for (let i = 1; i <= n; i++) filas.push([`Chofer Número ${i}`, `55${String(i).padStart(8, '0')}`, `E-${i}`, patio ? patio(i) : '']);
  return filas;
}
const opciones = { origen: 'panel' as const };

describe('operadores — idempotencia y carreras', () => {
  it('250 choferes se crean, y el MISMO archivo otra vez no duplica ni uno', async () => {
    const lectura = interpretarFilasOperadores(matrizOperadores(250));
    expect(lectura.filas).toHaveLength(250);
    const a = await importarOperadores(T, lectura.filas, opciones);
    expect(a.creados).toHaveLength(250);
    const b = await importarOperadores(T, lectura.filas, opciones);
    expect(b.creados).toHaveLength(0);
    expect(b.duplicados).toHaveLength(250);
    expect(base.tabla('operador')).toHaveLength(250);
  });

  it('DOS submits simultáneos del mismo archivo: 100 filas, no 200; el perdedor reporta «ya estaba»', async () => {
    const filas = interpretarFilasOperadores(matrizOperadores(100)).filas;
    const [a, b] = await Promise.all([importarOperadores(T, filas, opciones), importarOperadores(T, filas, opciones)]);
    expect(base.tabla('operador')).toHaveLength(100);
    expect(a.creados.length + b.creados.length).toBe(100);
    expect(a.duplicados.length + b.duplicados.length).toBe(100);
    expect(a.errores).toEqual([]);
    expect(b.errores).toEqual([]);
  });

  it('un teléfono activo de OTRA flota se rechaza por fila (no se crea, no se cruza)', async () => {
    base.tabla('operador').push({ id: 'o-1', tenant_id: OTRA, nombre: 'Ajeno', telefono: '525500000002', activo: true });
    const filas = interpretarFilasOperadores(matrizOperadores(3)).filas;
    const r = await importarOperadores(T, filas, opciones);
    expect(r.creados).toHaveLength(2);
    expect(r.errores).toEqual([{ fila: 3, motivo: expect.stringMatching(/OTRA flota/) }]);
    expect(base.tabla('operador').filter((o) => o.tenant_id === T)).toHaveLength(2);
  });

  it('uno propio dado de baja se dice (reactívalo), no se duplica', async () => {
    base.tabla('operador').push({ id: 'o-1', tenant_id: T, nombre: 'Viejo', telefono: '525500000001', activo: false });
    const r = await importarOperadores(T, interpretarFilasOperadores(matrizOperadores(1)).filas, opciones);
    expect(r.errores[0].motivo).toMatch(/dado de baja en tu flota/);
    expect(base.tabla('operador')).toHaveLength(1);
  });

  it('un fallo de la base a media carga deja lo anterior intacto y dice cuáles filas no se intentaron', async () => {
    // 450 filas = 3 tandas de 200/200/50: la segunda falla.
    const filas = interpretarFilasOperadores(matrizOperadores(450)).filas;
    // La primera tanda (200) entra; la segunda falla; la tercera ya no se intenta.
    base.fallarProxima('operador', 'insert', { message: 'conexión perdida' }, 1);
    const r = await importarOperadores(T, filas, opciones);
    expect(r.creados).toHaveLength(200);
    expect(r.errores).toHaveLength(250);
    expect(r.errores.filter((e) => /no se pudo escribir/.test(e.motivo))).toHaveLength(200);
    expect(r.errores.filter((e) => /no se intentó/.test(e.motivo))).toHaveLength(50);
    // Lo creado coincide con lo que hay en la base: no se dice «creados» sin escribir.
    expect(base.tabla('operador')).toHaveLength(r.creados.length);
  });
});

describe('operadores — la vista previa promete lo que la escritura hace', () => {
  it('planificar clasifica igual que importar y NO escribe', async () => {
    base.tabla('operador').push({ id: 'o-1', tenant_id: T, nombre: 'Ya Estaba', telefono: '525500000001', activo: true });
    base.tabla('operador').push({ id: 'o-2', tenant_id: OTRA, nombre: 'Ajeno', telefono: '525500000002', activo: true });
    const filas = interpretarFilasOperadores(matrizOperadores(4)).filas;
    const escrituras = () => base.bitacora.filter((b) => b.op === 'insert' || b.op === 'update').length;
    const plan = await planificarOperadores(T, filas);
    expect(escrituras()).toBe(0);
    expect(plan.nuevas.map((f) => f.fila)).toEqual([4, 5]);
    expect(plan.duplicados.map((d) => d.fila)).toEqual([2]);
    expect(plan.errores.map((e) => e.fila)).toEqual([3]);

    const r = await importarOperadores(T, filas, opciones);
    expect(r.creados.map((c) => c.fila)).toEqual(plan.nuevas.map((f) => f.fila));
    expect(r.duplicados.map((d) => d.fila)).toEqual(plan.duplicados.map((d) => d.fila));
    expect(r.errores.map((e) => e.fila)).toEqual(plan.errores.map((e) => e.fila));
  });

  it('si no puede leer los teléfonos existentes, NO afirma nada (falla cerrado)', async () => {
    base.fallarProxima('operador', 'select', { message: 'se cayó' });
    const plan = await planificarOperadores(T, interpretarFilasOperadores(matrizOperadores(2)).filas);
    expect(plan.error).toMatch(/No pude comprobar/);
    expect(plan.nuevas).toEqual([]);
  });
});

describe('operadores — patios por fila', () => {
  async function filasConPatio(patio: (i: number) => string) {
    const lectura = interpretarFilasOperadores(matrizOperadores(4, patio));
    const patios = await getTerminales(T);
    return asignarPatios(lectura.filas, patios, { tipo: 'flota' });
  }

  it('cada chofer queda en el patio que dice su fila', async () => {
    const { filas } = await filasConPatio((i) => (i <= 2 ? 'Patio Norte' : ' patio sur '));
    await importarOperadores(T, filas, opciones);
    const rows = base.tabla('operador');
    expect(rows.filter((o) => o.terminal_id === NORTE)).toHaveLength(2);
    expect(rows.filter((o) => o.terminal_id === SUR)).toHaveLength(2);
  });

  it('un patio de OTRA flota (por una fila armada a mano) hace fallar la carga entera, sin escribir nada', async () => {
    const filas = interpretarFilasOperadores(matrizOperadores(2)).filas.map((f) => ({ ...f, terminalId: AJENO }));
    await expect(importarOperadores(T, filas, opciones)).rejects.toThrow(DatoInvalido);
    expect(base.tabla('operador')).toHaveLength(0);
  });

  it('sin patio por fila usa el patio general de la carga', async () => {
    const filas = interpretarFilasOperadores(matrizOperadores(2)).filas;
    await importarOperadores(T, filas, { ...opciones, terminalId: SUR });
    expect(base.tabla('operador').every((o) => o.terminal_id === SUR)).toBe(true);
  });
});

describe('operadores — entradas hostiles', () => {
  it('fórmulas de hoja de cálculo, HTML e inyección se guardan como TEXTO LITERAL: ni se ejecutan ni rompen la carga', async () => {
    const hostiles = ['=HYPERLINK("http://x","ok")', "'; drop table operador;--", '<img src=x onerror=alert(1)>', '+cmd|calc!A0'];
    const matriz: unknown[][] = [['nombre', 'telefono']];
    hostiles.forEach((h, i) => matriz.push([`${h} Pérez`, `55${String(i + 1).padStart(8, '0')}`]));
    const lectura = interpretarFilasOperadores(matriz);
    expect(lectura.filas).toHaveLength(4);
    const r = await importarOperadores(T, lectura.filas, opciones);
    expect(r.creados).toHaveLength(4);
    expect(base.tabla('operador').map((o) => o.nombre)).toEqual(hostiles.map((h) => `${h} Pérez`));
    expect(base.tabla('terminal')).toHaveLength(3); // nada se «ejecutó»
  });

  it('teléfonos basura se descartan por fila con motivo, y el resto entra', () => {
    const lectura = interpretarFilasOperadores([
      ['nombre', 'telefono'],
      ['Ana Ruiz', '123'], ['Beto Cruz', 'no tengo'], ['Carla Díaz', '5512345678'],
    ]);
    expect(lectura.filas).toHaveLength(1);
    expect(lectura.descartadas.map((d) => d.fila)).toEqual([2, 3]);
  });

  it('un archivo con más del tope de filas dice el tope y NO importa a medias en silencio', () => {
    const lectura = interpretarFilasOperadores(matrizOperadores(2_500));
    expect(lectura.error).toMatch(/tope es 2,000/);
    expect(lectura.filas).toHaveLength(2_000);
  });
});

// ── Unidades ───────────────────────────────────────────────────────────────

function matrizUnidades(n: number, patio?: (i: number) => string): unknown[][] {
  const filas: unknown[][] = [['numero economico', 'placas', 'marca', 'patio']];
  for (let i = 1; i <= n; i++) filas.push([`T-${String(i).padStart(3, '0')}`, `AB-${String(i).padStart(4, '0')}`, 'Kenworth', patio ? patio(i) : '']);
  return filas;
}

describe('unidades — idempotencia, carreras y vista previa', () => {
  it('250 camiones se crean y el mismo archivo otra vez no duplica', async () => {
    const lectura = interpretarFilasUnidades(matrizUnidades(250));
    expect(lectura.filas).toHaveLength(250);
    const a = await importarUnidades(T, lectura.filas, opciones);
    expect(a.creadas).toHaveLength(250);
    const b = await importarUnidades(T, lectura.filas, opciones);
    expect(b.creadas).toHaveLength(0);
    expect(b.duplicadas).toHaveLength(250);
    expect(base.tabla('unidad')).toHaveLength(250);
  });

  it('dos submits simultáneos: ninguna unidad se duplica', async () => {
    const filas = interpretarFilasUnidades(matrizUnidades(60)).filas;
    const [a, b] = await Promise.all([importarUnidades(T, filas, opciones), importarUnidades(T, filas, opciones)]);
    expect(base.tabla('unidad')).toHaveLength(60);
    expect(a.creadas.length + b.creadas.length).toBe(60);
  });

  it('una placa que ya es de otro económico se rechaza por fila, diciendo de cuál', async () => {
    base.tabla('unidad').push({ id: 'u-1', tenant_id: T, numero_economico: 'VIEJO-1', placas: 'AB-0001' });
    const filas = interpretarFilasUnidades(matrizUnidades(2)).filas;
    const r = await importarUnidades(T, filas, opciones);
    expect(r.creadas.map((c) => c.numeroEconomico)).toEqual(['T-002']);
    expect(r.errores[0].motivo).toMatch(/placa AB-0001 ya es de la unidad VIEJO-1/);
  });

  it('el parque de OTRA flota no cuenta: el mismo económico en dos flotas es legítimo', async () => {
    base.tabla('unidad').push({ id: 'u-1', tenant_id: OTRA, numero_economico: 'T-001', placas: 'ZZ-9999' });
    const r = await importarUnidades(T, interpretarFilasUnidades(matrizUnidades(1)).filas, opciones);
    expect(r.creadas).toHaveLength(1);
  });

  it('planificar clasifica igual que importar y no escribe', async () => {
    base.tabla('unidad').push({ id: 'u-1', tenant_id: T, numero_economico: 'T-001', placas: 'AB-0001' });
    base.tabla('unidad').push({ id: 'u-2', tenant_id: T, numero_economico: 'OTRO', placas: 'AB-0002' });
    const filas = interpretarFilasUnidades(matrizUnidades(3)).filas;
    const escrituras = () => base.bitacora.filter((b) => b.op === 'insert' || b.op === 'update').length;
    const plan = await planificarUnidades(T, filas);
    expect(escrituras()).toBe(0);
    expect(plan.duplicadas.map((d) => d.fila)).toEqual([2]);
    expect(plan.errores.map((e) => e.fila)).toEqual([3]);
    expect(plan.nuevas.map((f) => f.fila)).toEqual([4]);
    const r = await importarUnidades(T, filas, opciones);
    expect(r.creadas.map((c) => c.fila)).toEqual([4]);
  });

  it('no poder leer el parque: no afirma nada y no importa', async () => {
    base.fallarProxima('unidad', 'select', { message: 'se cayó' });
    const r = await importarUnidades(T, interpretarFilasUnidades(matrizUnidades(2)).filas, opciones);
    expect(r.error).toMatch(/No pude leer el parque/);
    expect(base.tabla('unidad')).toHaveLength(0);
  });
});

describe('unidades — patios por fila', () => {
  it('cada camión queda en el patio de su fila; un patio de otra flota hace fallar la carga entera', async () => {
    const lectura = interpretarFilasUnidades(matrizUnidades(4, (i) => (i % 2 ? 'Patio Norte' : 'Patio Sur')));
    const patios = await getTerminales(T);
    const { filas } = asignarPatios(lectura.filas, patios, { tipo: 'flota' });
    await importarUnidades(T, filas, opciones);
    expect(base.tabla('unidad').filter((u) => u.terminal_id === NORTE)).toHaveLength(2);
    expect(base.tabla('unidad').filter((u) => u.terminal_id === SUR)).toHaveLength(2);

    const ajenas = interpretarFilasUnidades(matrizUnidades(1)).filas.map((f) => ({ ...f, numeroEconomico: 'X-1', placas: 'ZZ-0001', terminalId: AJENO }));
    await expect(importarUnidades(T, ajenas, opciones)).rejects.toThrow(DatoInvalido);
  });

  it('un jefe CON patio carga todo en el suyo y se descarta lo que nombra otro patio', async () => {
    const lectura = interpretarFilasUnidades(matrizUnidades(3, (i) => (i === 2 ? 'Patio Sur' : '')));
    const patios = await getTerminales(T);
    const r = asignarPatios(lectura.filas, patios, { tipo: 'patio', terminalId: NORTE });
    expect(r.descartadas.map((d) => d.fila)).toEqual([3]);
    await importarUnidades(T, r.filas, opciones);
    expect(base.tabla('unidad')).toHaveLength(2);
    expect(base.tabla('unidad').every((u: Fila) => u.terminal_id === NORTE)).toBe(true);
  });
});
