import { describe, it, expect, vi, beforeEach } from 'vitest';

// A37-S11-06 — GET /v1/peajes/desgloses documenta `limite` 1-50: la ruta lo hace cumplir (400 por encima), en vez de
// aceptar hasta 200 y lanzar ~800 conteos exactos contra un maxDuration de 30 s.

const abrir = vi.fn(async (_req: Request, _area: string): Promise<Record<string, unknown>> => ({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }));
vi.mock('@/app/api/v1/_comun', async (orig) => ({ ...(await orig<Record<string, unknown>>()), abrir: (...a: [Request, string]) => abrir(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => { throw new Error('sin base en pruebas'); } }) }));

const listarDesgloses = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
vi.mock('@/lib/likida/intake/desglose_peaje', () => ({ listarDesgloses: (...a: unknown[]) => listarDesgloses(...a) }));

const { GET } = await import('./route');
const B = 'https://app.likida.ai/api/v1/peajes/desgloses';

beforeEach(() => { listarDesgloses.mockClear(); abrir.mockReset().mockResolvedValue({ ok: true, tenantId: 't-1', rol: 'llave:dinero' }); });

describe('GET /v1/peajes/desgloses: el límite documentado se hace cumplir', () => {
  it('limite=51 y limite=200 → 400 sin tocar la base', async () => {
    for (const l of [51, 200]) {
      const r = await GET(new Request(`${B}?limite=${l}`));
      expect(r.status, String(l)).toBe(400);
      expect(((await r.json()) as { error: { codigo: string } }).error.codigo).toBe('parametro_invalido');
    }
    expect(listarDesgloses).not.toHaveBeenCalled();
  });

  it('limite=50 (el máximo) y el defecto pasan; se pide una fila de más para medir hayMas', async () => {
    expect((await GET(new Request(`${B}?limite=50`))).status).toBe(200);
    expect(listarDesgloses).toHaveBeenLastCalledWith('t-1', 51);
    expect((await GET(new Request(B))).status).toBe(200);
    expect(listarDesgloses).toHaveBeenLastCalledWith('t-1', 51);
  });
});
