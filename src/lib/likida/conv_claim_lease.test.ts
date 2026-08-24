import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { claimMessage, completarMessageClaim, releaseMessageClaim, LEASE_CLAIM_MS } = await import('./conv');
const { PRESUPUESTO_WEBHOOK_MS } = await import('./presupuesto');

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [{ estado: 'nuevo', lease_token: 'token-a', lease_owner: 'owner-a' }], error: null });
});

describe('claimMessage con fencing durable', () => {
  it('usa el RPC y devuelve nuevo con token', async () => {
    expect(await claimMessage('wamid.a', 'owner-a', true)).toEqual({ status: 'nuevo', token: 'token-a', owner: 'owner-a' });
    expect(rpc).toHaveBeenCalledWith('claim_wa_mensaje_procesado', expect.objectContaining({
      p_wa_message_id: 'wamid.a', p_lease_owner: 'owner-a', p_lease_seconds: Math.ceil(LEASE_CLAIM_MS / 1000),
    }));
  });

  it('un duplicado completado no recibe token', async () => {
    rpc.mockResolvedValue({ data: [{ estado: 'duplicado', lease_token: null }], error: null });
    expect(await claimMessage('wamid.b')).toBe('duplicado');
  });

  it('un claim fresco queda en curso y no se procesa', async () => {
    rpc.mockResolvedValue({ data: [{ estado: 'en_curso', lease_token: null }], error: null });
    expect(await claimMessage('wamid.c')).toBe('en_curso');
  });

  it('un error de RPC no se convierte en duplicado', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '503', message: 'database unavailable' } });
    expect(await claimMessage('wamid.d')).toBe('indeterminado');
    expect(logger.error).toHaveBeenCalledWith('wa.claim_error', expect.objectContaining({ id: 'wamid.d' }));
  });

  it('el lease supera maxDuration con margen', () => {
    expect(LEASE_CLAIM_MS).toBeGreaterThan(PRESUPUESTO_WEBHOOK_MS);
    expect(LEASE_CLAIM_MS).toBeLessThan(5 * 60_000);
  });
});

describe('complete/release fenced', () => {
  it('sella solamente con token y owner', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(completarMessageClaim('wamid.a', 'token-a', 'owner-a')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('complete_wa_mensaje_procesado', {
      p_wa_message_id: 'wamid.a', p_lease_token: 'token-a', p_lease_owner: 'owner-a',
    });
  });

  it('libera solamente con token y owner', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    await expect(releaseMessageClaim('wamid.a', 'token-a', 'owner-a')).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('fail_wa_mensaje_procesado', {
      p_wa_message_id: 'wamid.a', p_lease_token: 'token-a', p_lease_owner: 'owner-a',
    });
  });
});
