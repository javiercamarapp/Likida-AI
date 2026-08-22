import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 18, MEDIO (M22) + ALTO (A23): la bandeja durable insertaba N veces
// en serie, sin techo, ANTES de contestarle a Meta. 22 fotos = 22 viajes de
// red antes del 200; uno colgado se llevaba la invocación. Ahora es UN upsert
// del lote, con `ignoreDuplicates` (la reentrega de Meta no es pérdida) y bajo
// `acotada`.
// ═══════════════════════════════════════════════════════════════════════════

const upsert = vi.fn();
const from = vi.fn((_t: string) => ({ upsert: (...a: unknown[]) => upsert(...a) }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => from(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { guardarEventosPendientes } = await import('./wa_pendientes');

const msgs = Array.from({ length: 22 }, (_, i) => ({ from: '521999', type: 'image' as const, mediaId: `m${i}`, waMessageId: `wamid.${i}` }));

beforeEach(() => { vi.clearAllMocks(); upsert.mockResolvedValue({ data: null, error: null }); });

describe('guardarEventosPendientes', () => {
  it('22 mensajes = UN viaje de red, no 22', async () => {
    const r = await guardarEventosPendientes(msgs);
    expect(from).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
    const [filas, opts] = upsert.mock.calls[0] as [Array<{ id: string }>, Record<string, unknown>];
    expect(filas).toHaveLength(22);
    expect(filas[5].id).toBe('wamid.5');
    // La reentrega de Meta choca con la PK y NO es error: DO NOTHING.
    expect(opts).toMatchObject({ onConflict: 'id', ignoreDuplicates: true });
    expect(r).toMatchObject({ guardados: 22, fallidos: 0 });
    expect(r.filas.every((f) => f.guardado)).toBe(true);
  });

  it('si el lote falla, TODOS cuentan como no guardados (el webhook contesta 503 y Meta reentrega)', async () => {
    upsert.mockResolvedValue({ data: null, error: { message: 'conexión rechazada' } });
    const r = await guardarEventosPendientes(msgs.slice(0, 3));
    expect(r).toMatchObject({ guardados: 0, fallidos: 3 });
    expect(r.filas.every((f) => !f.guardado)).toBe(true);
    expect(logger.error).toHaveBeenCalledWith('wa.pendiente_no_guardado', expect.objectContaining({ ids: ['wamid.0', 'wamid.1', 'wamid.2'] }));
  });

  it('una excepción tampoco lanza: se reporta como fallidos', async () => {
    upsert.mockRejectedValue(new Error('boom'));
    await expect(guardarEventosPendientes(msgs.slice(0, 1))).resolves.toMatchObject({ guardados: 0, fallidos: 1 });
  });

  it('con lote vacío no toca la base', async () => {
    await guardarEventosPendientes([]);
    expect(from).not.toHaveBeenCalled();
  });
});
