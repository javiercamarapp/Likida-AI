import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

let base: BaseEnMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => base.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => true);
vi.mock('./bitacora_escritura', () => ({ anotarBitacora: (e: Record<string, unknown>) => anotarBitacora(e) }));

const { asignarSinPatio, contarSinPatio, asignarTerminalJefe, eliminarTerminal } = await import('./terminales');

const T = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SUR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AJENO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const J1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const J2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

beforeEach(() => {
  base = crearBaseEnMemoria({
    terminal: [
      { id: NORTE, tenant_id: T, nombre: 'Patio Norte' }, { id: SUR, tenant_id: T, nombre: 'Patio Sur' },
      { id: AJENO, tenant_id: OTRA, nombre: 'Patio Ajeno' },
    ],
    operador: [
      { id: '00000000-0000-4000-8000-000000000001', tenant_id: T, activo: true, terminal_id: null },
      { id: '00000000-0000-4000-8000-000000000002', tenant_id: T, activo: true, terminal_id: SUR },
      { id: '00000000-0000-4000-8000-000000000003', tenant_id: T, activo: false, terminal_id: null },
      { id: '00000000-0000-4000-8000-000000000004', tenant_id: OTRA, activo: true, terminal_id: null },
    ],
    unidad: [],
    app_user: [
      { id: J1, tenant_id: T, rol: 'encargado', terminal_id: null },
      { id: J2, tenant_id: T, rol: 'flota_admin', terminal_id: null },
    ],
  });
  anotarBitacora.mockClear();
});

describe('asignarSinPatio contra una base que aplica los filtros', () => {
  it('mueve SOLO a los activos de ESTA flota sin patio; no pisa a quien ya tiene patio ni toca otra flota', async () => {
    expect(await contarSinPatio(T)).toEqual({ operadores: 1, unidades: 0 });
    const n = await asignarSinPatio('operador', T, NORTE, { id: 'u-1' });
    expect(n).toBe(1);
    const filas = base.tabla('operador');
    expect(filas[0].terminal_id).toBe(NORTE);
    expect(filas[1].terminal_id).toBe(SUR); // ya tenía patio: no se pisa
    expect(filas[2].terminal_id).toBeNull(); // de baja: no se mueve
    expect(filas[3].terminal_id).toBeNull(); // otra flota: ni se toca
  });

  it('es idempotente: la segunda vez no mueve nada ni deja bitácora', async () => {
    await asignarSinPatio('operador', T, NORTE);
    anotarBitacora.mockClear();
    expect(await asignarSinPatio('operador', T, NORTE)).toBe(0);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('un patio de OTRA flota no se puede usar', async () => {
    await expect(asignarSinPatio('operador', T, AJENO)).rejects.toThrow(/no existe en tu flota/);
    expect(base.tabla('operador')[0].terminal_id).toBeNull();
  });
});

describe('asignarTerminalJefe — solo a usuarios con rol encargado de ESTA flota', () => {
  it('amarra al encargado', async () => {
    await asignarTerminalJefe(T, J1, NORTE, { id: 'u-1' });
    expect(base.tabla('app_user')[0].terminal_id).toBe(NORTE);
  });

  it('NO amarra a un dueño (no limitaría nada y confundiría la ficha)', async () => {
    await expect(asignarTerminalJefe(T, J2, NORTE)).rejects.toThrow(/rol «Encargado»/);
    expect(base.tabla('app_user')[1].terminal_id).toBeNull();
  });

  it('un usuario de otra flota no se toca', async () => {
    await expect(asignarTerminalJefe(OTRA, J1, NORTE)).rejects.toThrow();
  });

  it('soltar el patio (null) devuelve al jefe a «toda la flota»', async () => {
    await asignarTerminalJefe(T, J1, NORTE);
    await asignarTerminalJefe(T, J1, null);
    expect(base.tabla('app_user')[0].terminal_id).toBeNull();
  });
});

describe('eliminarTerminal contra la base', () => {
  it('con jefes asignados NO se borra, y el patio sigue ahí', async () => {
    base.rpcRespuesta('terminales_conteos_tenant', () => ({
      data: [{ terminal_id: NORTE, operadores: 0, unidades: 0, jefes: 1 }, { terminal_id: SUR, operadores: 1, unidades: 0, jefes: 0 }], error: null,
    }));
    await expect(eliminarTerminal(T, NORTE)).rejects.toThrow(/jefe de tráfico asignado/);
    expect(base.tabla('terminal').some((t) => t.id === NORTE)).toBe(true);
  });

  it('sin jefes se borra; el patio ajeno no se puede borrar desde esta flota', async () => {
    base.rpcRespuesta('terminales_conteos_tenant', () => ({
      data: [{ terminal_id: NORTE, operadores: 0, unidades: 0, jefes: 0 }, { terminal_id: SUR, operadores: 1, unidades: 0, jefes: 0 }], error: null,
    }));
    await eliminarTerminal(T, NORTE);
    expect(base.tabla('terminal').some((t) => t.id === NORTE)).toBe(false);
    await expect(eliminarTerminal(T, AJENO)).rejects.toThrow(/No se encontró ese patio/);
    expect(base.tabla('terminal').some((t) => t.id === AJENO)).toBe(true);
  });
});
