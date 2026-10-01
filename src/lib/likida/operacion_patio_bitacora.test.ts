// ═══════════════════════════════════════════════════════════════════════════
// LA UNIDAD GANA PATIO Y BITÁCORA (W2 «producto»): `crearUnidad`/`editarUnidad`
// con `terminalId` validado contra la flota, y firmadas cuando hay actor.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

let base: BaseEnMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => base.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const anotarBitacora = vi.fn(async (_e: Record<string, unknown>) => true);
vi.mock('./bitacora_escritura', () => ({ anotarBitacora: (e: Record<string, unknown>) => anotarBitacora(e) }));

const { crearUnidad, editarUnidad } = await import('./operacion');
const { DatoInvalido } = await import('./errores');

const T = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AJENO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNIDAD = { numeroEconomico: '47', placas: 'ABC-123-A' };

beforeEach(() => {
  base = crearBaseEnMemoria({
    terminal: [{ id: NORTE, tenant_id: T, nombre: 'Patio Norte' }, { id: AJENO, tenant_id: OTRA, nombre: 'Patio Ajeno' }],
    unidad: [],
  }, [], { unidad: { activo: true } });
  anotarBitacora.mockClear();
});

describe('crearUnidad con patio', () => {
  it('escribe terminal_id cuando el patio es de la flota', async () => {
    await crearUnidad(T, { ...UNIDAD, terminalId: NORTE });
    expect(base.tabla('unidad')[0]).toMatchObject({ numero_economico: '47', terminal_id: NORTE });
  });

  it('sin terminalId (o vacío) la unidad nace sin patio, como siempre (la API por llave no cambia)', async () => {
    await crearUnidad(T, UNIDAD);
    await crearUnidad(T, { numeroEconomico: '48', placas: 'ABC-124-A', terminalId: '' });
    expect(base.tabla('unidad').every((u) => u.terminal_id === undefined)).toBe(true);
  });

  it('un patio de OTRA flota se rebota ANTES de insertar, diciendo qué pasó', async () => {
    await expect(crearUnidad(T, { ...UNIDAD, terminalId: AJENO })).rejects.toThrow(/no existe en tu flota/);
    expect(base.tabla('unidad')).toHaveLength(0);
  });

  it('con actor firma «unidad.creada» con el id y sin placas ni datos personales; sin actor (API) no escribe bitácora', async () => {
    const id = await crearUnidad(T, { ...UNIDAD, terminalId: NORTE }, { id: 'u-1' });
    expect(anotarBitacora).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T, accion: 'unidad.creada', entidad: 'unidad', entidadId: id, actor: { id: 'u-1' },
    }));
    expect(JSON.stringify(anotarBitacora.mock.calls[0][0])).not.toContain('ABC-123-A');
    anotarBitacora.mockClear();
    await crearUnidad(T, { numeroEconomico: '48' });
    expect(anotarBitacora).not.toHaveBeenCalled();
  });
});

describe('editarUnidad con patio', () => {
  const idUnidad = '00000000-0000-4000-8000-0000000000aa';
  beforeEach(() => { base.tabla('unidad').push({ id: idUnidad, tenant_id: T, numero_economico: '47', placas: 'ABC-123-A', activo: true, terminal_id: null }); });

  it('si la edición NO manda terminalId, el patio actual no se toca', async () => {
    base.tabla('unidad')[0].terminal_id = NORTE;
    await editarUnidad(T, idUnidad, { ...UNIDAD, marca: 'Volvo' });
    expect(base.tabla('unidad')[0]).toMatchObject({ marca: 'Volvo', terminal_id: NORTE });
  });

  it('con terminalId lo mueve; con null/vacío la deja sin patio', async () => {
    await editarUnidad(T, idUnidad, { ...UNIDAD, terminalId: NORTE });
    expect(base.tabla('unidad')[0].terminal_id).toBe(NORTE);
    await editarUnidad(T, idUnidad, { ...UNIDAD, terminalId: null });
    expect(base.tabla('unidad')[0].terminal_id).toBeNull();
  });

  it('un patio ajeno hace fallar la edición sin tocar la fila', async () => {
    await expect(editarUnidad(T, idUnidad, { ...UNIDAD, marca: 'Volvo', terminalId: AJENO })).rejects.toThrow(DatoInvalido);
    expect(base.tabla('unidad')[0].marca).toBeUndefined();
  });

  it('la unidad de OTRA flota no se edita (cero filas) y no deja bitácora', async () => {
    base.tabla('unidad')[0].tenant_id = OTRA;
    await expect(editarUnidad(T, idUnidad, UNIDAD, { id: 'u-1' })).rejects.toThrow(/No se encontró esa unidad/);
    expect(anotarBitacora).not.toHaveBeenCalled();
  });

  it('con actor firma «unidad.editada»', async () => {
    await editarUnidad(T, idUnidad, UNIDAD, { id: 'u-1' });
    expect(anotarBitacora).toHaveBeenCalledWith(expect.objectContaining({ accion: 'unidad.editada', entidadId: idUnidad, actor: { id: 'u-1' } }));
  });
});
