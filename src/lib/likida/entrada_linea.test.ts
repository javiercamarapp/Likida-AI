import { describe, it, expect, vi, beforeEach } from 'vitest';

const filtros: Array<[string, unknown]> = [];
let operadores: unknown[] = [];
let cuentas: unknown[] = [];
let vigiaTenant: string | null = null;
let errorOperador: string | null = null;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'in', 'or', 'order', 'limit']) q[m] = () => q;
      q.eq = (c: string, v: unknown) => { filtros.push([`${tabla}.${c}`, v]); return q; };
      q.then = (res: (v: unknown) => unknown) => res(
        tabla === 'operador'
          ? { data: operadores, error: errorOperador ? { message: errorOperador } : null }
          : { data: cuentas, error: null },
      );
      return q;
    },
  }),
}));
vi.mock('./vigia/repo', () => ({ crearRepoVigia: () => ({ contactoPorTelefono: async () => (vigiaTenant ? { tenantId: vigiaTenant } : null) }) }));
vi.mock('./presupuesto', () => ({ acotada: (p: unknown) => p }));
const resolverCanal = vi.fn(async (_t: string) => ({ phoneNumberId: 'LINEA_A', token: 'TOK', origen: 'tenant' as const, lineaId: 'l1' }));
vi.mock('@/lib/meta/canal', () => ({ resolverCanal: (t: string) => resolverCanal(t) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { remitenteEnTenant, responderPorLinea } = await import('./entrada_linea');

beforeEach(() => { filtros.length = 0; operadores = []; cuentas = []; vigiaTenant = null; errorOperador = null; vi.restoreAllMocks(); });

describe('remitenteEnTenant', () => {
  it('filtra SIEMPRE por el tenant de la línea', async () => {
    operadores = [{ id: 'o1' }];
    expect(await remitenteEnTenant('tenant-a', '5219991110009')).toBe(true);
    expect(filtros).toContainEqual(['operador.tenant_id', 'tenant-a']);
  });
  it('no existe en ese tenant → false (un contacto del Vigía de OTRO tenant no cuenta)', async () => {
    vigiaTenant = 'tenant-b';
    expect(await remitenteEnTenant('tenant-a', '5219991110009')).toBe(false);
  });
  it('cuenta de oficina dada de baja no cuenta', async () => {
    cuentas = [{ id: 'u1', activo: false }];
    expect(await remitenteEnTenant('tenant-a', '5219991110009')).toBe(false);
  });
  it('un fallo de lectura lanza (no se lee como «no registrado»)', async () => {
    errorOperador = 'boom';
    await expect(remitenteEnTenant('tenant-a', '5219991110009')).rejects.toThrow();
  });
});

describe('responderPorLinea', () => {
  it('responde por el phone_number_id y el token de la línea del tenant', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    expect(await responderPorLinea('tenant-a', '5219991110009', 'hola')).toBe(true);
    expect(resolverCanal).toHaveBeenCalledWith('tenant-a');
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/LINEA_A/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOK');
  });
  it('si el canal no está disponible no lanza ni cae a plataforma', async () => {
    resolverCanal.mockRejectedValueOnce(new Error('pausada'));
    const f = vi.spyOn(globalThis, 'fetch');
    expect(await responderPorLinea('tenant-a', '5219991110009', 'hola')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
