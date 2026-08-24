import { beforeEach, describe, expect, it, vi } from 'vitest';

type Fila = { id: string; evento: { from: string; type: 'text' }; intentos: number; claim_token: string; claim_owner: string };

const rpc = vi.fn();
const from = vi.fn(() => ({
  select: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc, from }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { reclamarPendiente, renovarLeasePendiente, marcarPendienteProcesado } = await import('./wa_pendientes');

let vigente: Fila | null;

beforeEach(() => {
  vi.clearAllMocks();
  vigente = null;
  rpc.mockImplementation(async (nombre: string, args: Record<string, unknown>) => {
    if (nombre === 'reclamar_wa_pendiente') {
      if (vigente) return { data: [], error: null };
      vigente = {
        id: String(args.p_id),
        evento: { from: '5219990000000', type: 'text' },
        intentos: 1,
        claim_token: 'token-a',
        claim_owner: String(args.p_owner),
      };
      const fila = vigente;
      return { data: [fila], error: null };
    }
    if (nombre === 'renovar_wa_pendiente') {
      const fila = vigente;
      const ok = fila?.claim_token === args.p_claim_token && fila?.claim_owner === args.p_owner;
      return { data: ok ? true : false, error: null };
    }
    if (nombre === 'completar_wa_pendiente') {
      const fila = vigente;
      const ok = fila?.claim_token === args.p_claim_token && fila?.claim_owner === args.p_owner;
      if (ok) vigente = null;
      return { data: ok, error: null };
    }
    throw new Error(`RPC no esperada: ${nombre}`);
  });
});

describe('leases/fencing de bandeja WhatsApp', () => {
  it('dos workers concurrentes: exactamente uno obtiene el lease', async () => {
    const [a, b] = await Promise.all([
      reclamarPendiente('wamid.concurrente', 0, 'worker-a'),
      reclamarPendiente('wamid.concurrente', 0, 'worker-b'),
    ]);

    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('renueva con el token vigente y rechaza el token ajeno', async () => {
    const claim = await reclamarPendiente('wamid.renew', 0, 'worker-a');
    expect(claim).not.toBeNull();
    if (!claim) throw new Error('claim missing');
    await expect(renovarLeasePendiente(claim.id, 'token-ajeno', claim.leaseOwner)).resolves.toBe(false);
    await expect(renovarLeasePendiente(claim.id, claim.leaseToken, claim.leaseOwner)).resolves.toBe(true);
  });

  it('un worker viejo no puede completar el claim recuperado por otro', async () => {
    const claim = await reclamarPendiente('wamid.fenced', 0, 'worker-a');
    expect(claim).not.toBeNull();
    if (!claim) throw new Error('claim missing');
    await expect(marcarPendienteProcesado(claim.id, 'token-viejo', claim.leaseOwner)).resolves.toBe(false);
    await expect(marcarPendienteProcesado(claim.id, claim.leaseToken, claim.leaseOwner)).resolves.toBe(true);
  });
});
