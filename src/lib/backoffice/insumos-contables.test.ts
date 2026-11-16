import { afterEach, describe, expect, it, vi } from 'vitest';
import { NO_DISPONIBLE } from './lectura';

// El paquete contable pide los gastos al lote C por import dinámico protegido: si el otro lote no está o falla, la respuesta es
// «No disponible. No es cero.», jamás una lista vacía.
afterEach(() => { vi.resetModules(); vi.doUnmock('./gastos'); });

describe('insumosGastos', () => {
  it('entrega tal cual la lectura del lote C', async () => {
    vi.resetModules();
    vi.doMock('./gastos', () => ({ getGastosDelMes: async (periodo: string) => ({ estado: 'ok', dato: [{ id: periodo }] }) }));
    const { insumosGastos } = await import('./insumos-contables');
    expect(await insumosGastos('2026-10-01')).toEqual({ estado: 'ok', dato: [{ id: '2026-10-01' }] });
  });

  it('si el módulo no trae la función, no hay dato (no disponible)', async () => {
    vi.resetModules();
    vi.doMock('./gastos', () => ({}));
    const { insumosGastos } = await import('./insumos-contables');
    expect(await insumosGastos('2026-10-01')).toEqual(NO_DISPONIBLE);
  });

  it('si el módulo falla al cargar o al leer, tampoco hay dato: nunca un arreglo vacío', async () => {
    vi.resetModules();
    vi.doMock('./gastos', () => ({ getGastosDelMes: async () => { throw new Error('caída'); } }));
    const { insumosGastos } = await import('./insumos-contables');
    expect(await insumosGastos('2026-10-01')).toEqual(NO_DISPONIBLE);
  });
});
