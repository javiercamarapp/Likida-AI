import { describe, it, expect, vi, beforeEach } from 'vitest';

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));
vi.mock('@/lib/meta/client', () => ({ enviarSolicitudUbicacion: vi.fn(async () => ({ ok: true })) }));

const listarSitios = vi.fn();
vi.mock('./repo_validacion', async (original) => ({ ...(await original<typeof import('./repo_validacion')>()), listarSitios: (...a: unknown[]) => listarSitios(...a) }));

const { puertosPatioReales } = await import('./patio_entrega');

const sitio = (n: number, activa = true) => ({ id: `p-${n}`, nombre: `Patio ${String(n).padStart(3, '0')}`, activa });

beforeEach(() => { listarSitios.mockReset(); logger.warn.mockClear(); });

// A37-S36-09: el catálogo se cortaba a 30 sin avisar; el patio esperado fuera del corte daba «sin_referencia» y un patio
// equivocado no generaba aviso al supervisor.
describe('A37-S36-09: el catálogo de patios no se corta en silencio', () => {
  it('pide más de 30 patios (una flota con 45 los ve todos)', async () => {
    listarSitios.mockImplementation(async (_t: string, o: { limite: number }) => {
      const todos = Array.from({ length: 45 }, (_, i) => sitio(i + 1));
      return { sitios: todos.slice(0, o.limite), hayMas: todos.length > o.limite };
    });
    const patios = await puertosPatioReales().patios('t1');
    expect(patios).toHaveLength(45);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('si aun así hay más, lo dice en el log con la flota (no se calla) y sigue con los patios activos que sí leyó', async () => {
    listarSitios.mockResolvedValue({ sitios: [sitio(1), sitio(2, false)], hayMas: true });
    const patios = await puertosPatioReales().patios('t1');
    expect(patios).toEqual([{ id: 'p-1', nombre: 'Patio 001' }]);
    expect(logger.warn).toHaveBeenCalledWith('conductor.patio_catalogo_truncado', expect.objectContaining({ tenant: 't1' }));
  });
});
