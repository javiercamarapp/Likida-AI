import { describe, it, expect, vi, beforeEach } from 'vitest';

// listOperadores / reasignarOperador — la lectura y la escritura que Task 3
// del plan de roles necesita para que `encargado`/`flota_admin` puedan mover
// un viaje de un chofer a otro desde el panel.
const order = vi.fn();
const eqOperador = vi.fn(() => ({ order }));
const eqActivo = vi.fn(() => ({ eq: eqOperador }));
const select = vi.fn(() => ({ eq: eqActivo }));

const updateResult = vi.fn();
const eqTenantUpdate = vi.fn(() => updateResult());
const eqViajeUpdate = vi.fn(() => ({ eq: eqTenantUpdate }));
const update = vi.fn(() => ({ eq: eqViajeUpdate }));

const from = vi.fn((tabla: string) => (tabla === 'operador' ? { select } : { update }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (...a: unknown[]) => from(...(a as [string])) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { listOperadores, reasignarOperador } = await import('./repo');

describe('listOperadores', () => {
  beforeEach(() => { order.mockReset(); from.mockClear(); });

  it('trae solo los activos del tenant, ordenados por nombre', async () => {
    order.mockResolvedValue({ data: [{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }], error: null });
    const r = await listOperadores('t-1');
    expect(from).toHaveBeenCalledWith('operador');
    expect(eqActivo).toHaveBeenCalledWith('tenant_id', 't-1');
    expect(eqOperador).toHaveBeenCalledWith('activo', true);
    expect(order).toHaveBeenCalledWith('nombre');
    expect(r).toEqual([{ id: 'o-1', nombre: 'Juan Pérez' }, { id: 'o-2', nombre: 'Ana Ruiz' }]);
  });

  it('si la consulta falla, lanza — un listado vacío por error se leería como "sin choferes"', async () => {
    order.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(listOperadores('t-1')).rejects.toThrow('timeout');
  });
});

describe('reasignarOperador', () => {
  beforeEach(() => { updateResult.mockReset(); from.mockClear(); update.mockClear(); });

  it('actualiza operador_id del viaje, acotado por tenant', async () => {
    updateResult.mockResolvedValue({ error: null });
    await reasignarOperador('t-1', 'v-1', 'o-2');
    expect(from).toHaveBeenCalledWith('viaje');
    expect(update).toHaveBeenCalledWith({ operador_id: 'o-2' });
    expect(eqViajeUpdate).toHaveBeenCalledWith('id', 'v-1');
    expect(eqTenantUpdate).toHaveBeenCalledWith('tenant_id', 't-1');
  });

  it('si falla, lanza con el mensaje', async () => {
    updateResult.mockResolvedValue({ error: { message: 'operador no existe' } });
    await expect(reasignarOperador('t-1', 'v-1', 'o-x')).rejects.toThrow('operador no existe');
  });
});
