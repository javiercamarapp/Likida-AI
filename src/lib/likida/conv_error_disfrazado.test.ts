import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 8 · ALTO (operabilidad) — sexto sitio del patrón "un fallo de
// consulta disfrazado del valor que significa 'no hay'". `loadConversation` y
// `saveConversation` eran las únicas vecinas de `getOpenViaje`/
// `resolveOperador` que descartaban `error`.
// ═══════════════════════════════════════════════════════════════════════════

const maybeSingle = vi.fn();
const update = vi.fn();
const insertSingle = vi.fn(async () => ({ data: { id: 'c-nueva' } }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle }) }) }),
      insert: () => ({ select: () => ({ single: insertSingle }) }),
      update: (...a: unknown[]) => { update(...a); return { eq: () => Promise.resolve(updateResult) }; },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { loadConversation, saveConversation, ConsultaFallida } = await import('./conv');

let updateResult: { error: { message: string } | null } = { error: null };

beforeEach(() => {
  maybeSingle.mockReset(); update.mockClear();
  logger.error.mockReset();
  updateResult = { error: null };
});

describe('loadConversation — un fallo de consulta ya no se lee como "no existe"', () => {
  it('con error de Supabase, lanza ConsultaFallida (no cae al INSERT)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: '57014 statement timeout' } });
    await expect(loadConversation('t1', '+52', 'v1')).rejects.toThrow(ConsultaFallida);
  });

  it('control: sin fila y SIN error, sí es "no existe" y crea una nueva (comportamiento correcto)', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const r = await loadConversation('t1', '+52', 'v1');
    expect(r.id).toBe('c-nueva');
  });
});

describe('saveConversation — el fallo ya no es completamente silencioso', () => {
  it('con error de Supabase, lo registra como ERROR (no se traga)', async () => {
    updateResult = { error: { message: 'convId vacío no matchea ninguna fila' } };
    await saveConversation('', [], 'v1');
    expect(logger.error).toHaveBeenCalledWith('conv.no_se_guardo', expect.objectContaining({ convId: '' }));
  });

  it('NO lanza — la respuesta ya pudo haberse entregado, no debe disparar un segundo mensaje de error', async () => {
    updateResult = { error: { message: 'boom' } };
    await expect(saveConversation('c1', [], 'v1')).resolves.toBeUndefined();
  });

  it('control: sin error, no registra nada', async () => {
    updateResult = { error: null };
    await saveConversation('c1', [], 'v1');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
