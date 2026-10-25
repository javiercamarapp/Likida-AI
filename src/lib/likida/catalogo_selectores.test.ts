import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

// A37-S18-06 — los selectores de cliente/geocerca no se truncan en silencio a 500 ni a 1,000.

const estado = vi.hoisted(() => ({ db: null as unknown as BaseEnMemoria }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => estado.db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { clientesActivosCompletos, geocercasActivasCompletas } = await import('./catalogo_selectores');

const T = 't-1';
const cliente = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `c${String(n).padStart(5, '0')}`, tenant_id: T, nombre: `Cliente ${String(n).padStart(5, '0')}`, activo: true, dias_credito: 30, geocerca_id: null, ...extra,
});

beforeEach(() => {
  estado.db = crearBaseEnMemoria({
    cliente: [
      ...Array.from({ length: 1_250 }, (_, i) => cliente(i + 1)),
      cliente(9_001, { activo: false }),               // dado de baja: no se ofrece
      { ...cliente(9_002), tenant_id: 'otra-flota' },  // de otra flota: nunca
    ],
    geocerca: Array.from({ length: 620 }, (_, i) => ({ id: `g${i}`, tenant_id: T, nombre: `Sitio ${String(i).padStart(4, '0')}`, activa: true })),
  });
});

describe('clientesActivosCompletos', () => {
  it('trae los 1,250 clientes activos de la flota — el cliente 1,001 en adelante SÍ aparece (antes: tope silencioso de 1,000 / 500)', async () => {
    const r = await clientesActivosCompletos(T);
    expect(r).toHaveLength(1_250);
    expect(r.at(-1)?.nombre).toBe('Cliente 01250');
    expect(r.some((c) => c.id === 'c09001' || c.id === 'c09002')).toBe(false);
  });

  it('conserva los días de crédito y el vínculo con la geocerca', async () => {
    estado.db = crearBaseEnMemoria({ cliente: [cliente(1, { dias_credito: 15, geocerca_id: 'g1' }), cliente(2, { dias_credito: null })] });
    const r = await clientesActivosCompletos(T);
    expect(r[0]).toMatchObject({ diasCredito: 15, geocercaId: 'g1' });
    expect(r[1]).toMatchObject({ diasCredito: null, geocercaId: null });
  });

  it('una lectura caída LANZA: no se ofrece una lista corta como si fuera la completa', async () => {
    estado.db.fallarProxima('cliente', 'select', { message: 'base caída' } as never);
    await expect(clientesActivosCompletos(T)).rejects.toThrow(/base caída/);
  });
});

describe('geocercasActivasCompletas', () => {
  it('trae las 620 geocercas activas (antes: .limit(500))', async () => {
    expect(await geocercasActivasCompletas(T)).toHaveLength(620);
  });
});
