import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, CRÍTICO (C5): UN MENSAJE MATADO A MEDIA CORRIDA QUEDABA
// ENVENENADO POR SU PROPIO CLAIM.
//
// `claimMessage` reclama en la primera línea de `processInbound`; si Vercel
// mata la invocación, nadie suelta el claim. El reintento de la bandeja
// durable recibía 'duplicado' —"ya hecho"— y el cron sellaba como procesado un
// mensaje que nunca corrió. Con la 0149 la fila distingue reclamado de
// completado, y ante 23505 se decide con un UPDATE anclado:
//   · huérfano (sin completar, más viejo que el lease) → se retoma → 'nuevo'
//   · completado → 'duplicado'
//   · fresco sin completar → 'en_curso'
// ═══════════════════════════════════════════════════════════════════════════

type Resp = { data: unknown; error: { code?: string; message: string } | null };
const insert = vi.fn<() => Promise<Resp>>();
const retomar = vi.fn<() => Promise<Resp>>();
const relectura = vi.fn<() => Promise<Resp>>();
const update = vi.fn();

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== 'wa_mensaje_procesado') throw new Error(`tabla inesperada ${tabla}`);
      return {
        insert: () => insert(),
        update: (v: Record<string, unknown>) => {
          update(v);
          // El UPDATE de retomar encadena eq.is.lt.select; el de completar, solo eq.
          const nodo = {
            eq: () => ({ ...nodo, then: (r: (x: Resp) => void) => Promise.resolve({ data: null, error: null }).then(r) }),
            is: () => nodo,
            lt: () => nodo,
            select: () => retomar(),
          };
          return nodo;
        },
        select: () => ({ eq: () => ({ maybeSingle: () => relectura() }) }),
      };
    },
  }),
}));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { claimMessage, completarMessageClaim, LEASE_CLAIM_MS } = await import('./conv');
const { PRESUPUESTO_WEBHOOK_MS } = await import('./presupuesto');

const choca = { data: null, error: { code: '23505', message: 'duplicate key' } };

beforeEach(() => {
  vi.clearAllMocks();
  insert.mockResolvedValue({ data: null, error: null });
  retomar.mockResolvedValue({ data: [], error: null });
  relectura.mockResolvedValue({ data: null, error: null });
});

describe('claimMessage ante una fila que ya existe', () => {
  it('control: sin choque es nuevo y no relee nada', async () => {
    expect(await claimMessage('wamid.a')).toBe('nuevo');
    expect(retomar).not.toHaveBeenCalled();
  });

  it('claim huérfano (sin completar, más viejo que el lease): se RETOMA y es nuevo', async () => {
    insert.mockResolvedValue(choca);
    retomar.mockResolvedValue({ data: [{ wa_message_id: 'wamid.a' }], error: null });
    expect(await claimMessage('wamid.a')).toBe('nuevo');
    expect(logger.warn).toHaveBeenCalledWith('wa.claim_retomado', expect.objectContaining({ id: 'wamid.a' }));
    // El retome refresca created_at: el lease vuelve a correr para ESTA invocación.
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ created_at: expect.any(String) }));
  });

  it('claim completado: duplicado de verdad, no se reprocesa', async () => {
    insert.mockResolvedValue(choca);
    relectura.mockResolvedValue({ data: { completado_en: '2026-08-22T10:00:00Z' }, error: null });
    expect(await claimMessage('wamid.b')).toBe('duplicado');
  });

  it('claim fresco sin completar: otra invocación lo tiene → en_curso, ni hecho ni reprocesado', async () => {
    insert.mockResolvedValue(choca);
    relectura.mockResolvedValue({ data: { completado_en: null }, error: null });
    expect(await claimMessage('wamid.c')).toBe('en_curso');
  });

  it('si no se pudo releer, NO se inventa ni "hecho" ni "nuevo": en_curso y se grita', async () => {
    insert.mockResolvedValue(choca);
    retomar.mockResolvedValue({ data: null, error: { code: '42703', message: 'column completado_en does not exist' } });
    expect(await claimMessage('wamid.d')).toBe('en_curso');
    expect(logger.error).toHaveBeenCalledWith('wa.claim_relectura_fallo', expect.objectContaining({ id: 'wamid.d' }));
  });

  it('el lease es MAYOR que el maxDuration: un claim más joven puede estar vivo', () => {
    expect(LEASE_CLAIM_MS).toBeGreaterThan(PRESUPUESTO_WEBHOOK_MS);
    // y menor que los 5 min del cron: el huérfano se retoma a la primera vuelta.
    expect(LEASE_CLAIM_MS).toBeLessThan(5 * 60_000);
  });
});

describe('completarMessageClaim', () => {
  it('sella completado_en y nunca lanza', async () => {
    await expect(completarMessageClaim('wamid.a')).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ completado_en: expect.any(String) }));
  });
});
