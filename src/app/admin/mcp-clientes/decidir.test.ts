import { beforeEach, describe, expect, it, vi } from 'vitest';

const anotar = vi.fn();
const decidirCliente = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/guard', () => ({ requireSuperadmin: async () => ({ userId: 'su-1', tenantId: null }) }));
vi.mock('@/lib/mcp/oauth', () => ({ decidirCliente: (...a: unknown[]) => decidirCliente(...a) }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: (...a: unknown[]) => anotar(...a) }));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const { decidirYAnotar } = await import('./decidir');
const fd = () => { const f = new FormData(); f.set('cliente', '22222222-2222-4222-8222-222222222222'); return f; };

beforeEach(() => { anotar.mockReset(); decidirCliente.mockReset(); decidirCliente.mockResolvedValue({ ok: true, revocados: 3 }); });

describe('A37-S07-03 · la bitácora de decidir un cliente MCP no se pierde en silencio', () => {
  it('anotada a la primera: éxito normal', async () => {
    anotar.mockResolvedValue(true);
    const r = await decidirYAnotar('rechazado', fd());
    expect(r).toEqual({ ok: 'Cliente rechazado. Tokens vivos revocados: 3.' });
    expect(anotar).toHaveBeenCalledTimes(1);
  });
  it('falla la primera y la segunda sale: se reintentó, sin aviso de pérdida', async () => {
    anotar.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const r = await decidirYAnotar('aprobado', fd());
    expect(anotar).toHaveBeenCalledTimes(2);
    expect(r?.ok).toBe('Cliente aprobado: ya puede pedir consentimiento.');
  });
  it('falla siempre: la pantalla DICE que no quedó rastro', async () => {
    anotar.mockResolvedValue(false);
    const r = await decidirYAnotar('rechazado', fd());
    expect(anotar).toHaveBeenCalledTimes(2);
    expect(r?.ok).toContain('NO se pudo anotar en la bitácora');
  });
  it('si la decisión misma falla no se anota nada', async () => {
    decidirCliente.mockResolvedValue({ ok: false, error: 'no_valido', detalle: 'x' });
    expect(await decidirYAnotar('rechazado', fd())).toEqual({ error: 'x' });
    expect(anotar).not.toHaveBeenCalled();
  });
});
