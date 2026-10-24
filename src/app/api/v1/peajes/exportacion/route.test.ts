import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-A2-25: GET /v1/peajes/exportacion no entrega la bitácora conciliada (con GPS) a una flota con perfil restringido.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }));
vi.mock('@/app/api/v1/_comun', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return { ...real, abrir: (...a: [Request, string]) => abrir(...a) };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

let superficie = { estimulo: true, cfdiYTickets: true, bitacoraEstimulo: true, gps: true, cursos: true };
vi.mock('@/lib/likida/peajes/superficie_perfil', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  superficiePeajesDeTenant: async () => superficie,
}));
const bitacoraConciliada = vi.fn(async (..._a: unknown[]): Promise<unknown> => null);
vi.mock('@/lib/likida/peajes/bitacora_conciliada', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  bitacoraConciliada: (...a: unknown[]) => bitacoraConciliada(...a),
}));

const { GET } = await import('./route');
const ID = '4f1f6e2e-95c1-4c52-9f9e-3f6f6bd8d001';
const pedir = () => GET(new Request(`https://app.likida.ai/api/v1/peajes/exportacion?desglose=${ID}`));

beforeEach(() => {
  superficie = { estimulo: true, cfdiYTickets: true, bitacoraEstimulo: true, gps: true, cursos: true };
  bitacoraConciliada.mockClear();
});

describe('GET /v1/peajes/exportacion — perfil', () => {
  it('con perfil restringido niega (403) y NO lee la bitácora', async () => {
    superficie = { estimulo: false, cfdiYTickets: false, bitacoraEstimulo: false, gps: false, cursos: false };
    const r = await pedir();
    expect(r.status).toBe(403);
    expect(bitacoraConciliada).not.toHaveBeenCalled();
  });
  it('sin perfil sigue igual: llega a leer la bitácora (404 si no hay desglose)', async () => {
    const r = await pedir();
    expect(r.status).toBe(404);
    expect(bitacoraConciliada).toHaveBeenCalledTimes(1);
  });
});
