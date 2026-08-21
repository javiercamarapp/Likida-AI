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

// `select()` encadena CUALQUIER número de `.eq()` antes de `maybeSingle()`:
// `loadConversation` filtra por (tenant_id, telefono) —dos `.eq()`— y el
// LEE-MODIFICA-ESCRIBE de `saveConversation` (auditoría 2, ronda 2) filtra
// solo por `id` —uno—. Las dos formas terminan en el mismo `maybeSingle`.
function nodoEncadenable(): { eq: () => ReturnType<typeof nodoEncadenable>; maybeSingle: typeof maybeSingle } {
  const nodo = { eq: () => nodoEncadenable(), maybeSingle };
  return nodo;
}

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => nodoEncadenable(),
      insert: () => ({ select: () => ({ single: insertSingle }) }),
      update: (...a: unknown[]) => { update(...a); return { eq: () => Promise.resolve(updateResult) }; },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger }));

const { loadConversation, saveConversation, ConsultaFallida } = await import('./conv');

let updateResult: { error: { message: string } | null } = { error: null };

beforeEach(() => {
  // Default seguro para el SELECT previo que ahora hace `saveConversation`:
  // "no había fila" — cada prueba que necesite algo distinto lo pisa.
  maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  update.mockClear();
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

describe('saveConversation — fusiona en vez de pisar (auditoría 2, ronda 2)', () => {
  it('un viajePendiente de despacho_wa SOBREVIVE a un guardado normal de turnos', async () => {
    // El dueño-que-maneja: despacho_wa ya dejó un pendiente en esta MISMA fila
    // (mismo tenant+teléfono) cuando llega el turno de chofer que guarda sus
    // propios turnos. Antes esto pisaba `estado` entero y el pendiente
    // desaparecía sin que el jefe se enterara.
    maybeSingle.mockResolvedValue({
      data: { estado: { viajePendiente: { operadorId: 'op-9', en: '2026-08-14T17:00:00Z' } } },
      error: null,
    });
    await saveConversation('c1', [{ role: 'user', content: 'ya llegué' }], 'v1', { intentosConfirmacion: 1 });

    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0] as { estado: Record<string, unknown>; viaje_id: string | null };
    expect(payload.estado.viajePendiente).toEqual({ operadorId: 'op-9', en: '2026-08-14T17:00:00Z' });
    expect(payload.estado.turns).toEqual([{ role: 'user', content: 'ya llegué' }]);
    expect(payload.estado.intentosConfirmacion).toBe(1);
    // `saveConversation` SÍ maneja viaje_id — eso no cambió.
    expect(payload.viaje_id).toBe('v1');
  });

  it('un asignacionPendiente de asignar_wa también sobrevive', async () => {
    maybeSingle.mockResolvedValue({
      data: { estado: { asignacionPendiente: { viajeId: 'v7', accion: 'unidad', en: '2026-08-14T17:00:00Z' } } },
      error: null,
    });
    await saveConversation('c1', [{ role: 'assistant', content: 'listo' }], null);

    const payload = update.mock.calls[0][0] as { estado: Record<string, unknown> };
    expect(payload.estado.asignacionPendiente).toEqual({ viajeId: 'v7', accion: 'unidad', en: '2026-08-14T17:00:00Z' });
    expect(payload.estado.turns).toEqual([{ role: 'assistant', content: 'listo' }]);
  });

  it('marcas OMITIDAS se siguen borrando — eso sigue siendo a propósito', async () => {
    maybeSingle.mockResolvedValue({
      data: { estado: { intentosConfirmacion: 2, cierreSinComprobantes: true } },
      error: null,
    });
    await saveConversation('c1', [], 'v1');   // sin marcas: default {}

    const payload = update.mock.calls[0][0] as { estado: Record<string, unknown> };
    expect(payload.estado.intentosConfirmacion).toBeUndefined();
    expect(payload.estado.cierreSinComprobantes).toBeUndefined();
  });
});
