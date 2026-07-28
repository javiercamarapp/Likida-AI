import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 4 · ALTO — el historial no estaba ligado al viaje.
//
// `loadConversation(tenantId, telefono, viajeId)` usaba `viajeId` SOLO en el
// INSERT. En la rama de fila existente devolvía `estado.turns` sin filtrar, y
// `saveConversation` pone `viaje_id = null` al cerrar pero CONSERVA los turnos.
//
// Así que el último turno del viaje A —"Listo, cuadré tu viaje 👇 • Comprobado:
// $5,000.00 • Anticipo: $6,000.00"— entraba al prompt del viaje B, que tiene otro
// anticipo. Si el modelo repite una cifra, guardiaCifras lo tapa; si concluye
// "eso ya lo cerré", no lo tapa nada. Y se pagan tokens de un viaje ajeno en
// todos los turnos.
// ═══════════════════════════════════════════════════════════════════════════

const maybeSingle = vi.fn();
const insertSingle = vi.fn(async () => ({ data: { id: 'c-nueva' } }));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle }) }),
      }),
      insert: () => ({ select: () => ({ single: insertSingle }) }),
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { loadConversation } = await import('./conv');

const TURNOS = [
  { role: 'user' as const, content: 'listo' },
  { role: 'assistant' as const, content: 'Listo, cuadré tu viaje 👇 • Comprobado: $5,000.00 • Anticipo: $6,000.00' },
];

describe('loadConversation — los turnos pertenecen al viaje en el que se dijeron', () => {
  beforeEach(() => { maybeSingle.mockReset(); });

  it('mismo viaje: el historial se conserva (control)', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'c1', estado: { turns: TURNOS }, viaje_id: 'vA' } });
    const r = await loadConversation('t1', '+52', 'vA');
    expect(r.turns).toHaveLength(2);
  });

  it('viaje DISTINTO: no se arrastra el cuadre del anterior', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'c1', estado: { turns: TURNOS }, viaje_id: 'vA' } });
    const r = await loadConversation('t1', '+52', 'vB');
    expect(r.turns).toEqual([]);
  });

  it('la fila quedó sin viaje porque el anterior cerró: tampoco se arrastra', async () => {
    // Es el caso real: `saveConversation` pone viaje_id null al cerrar y deja los
    // turnos. El siguiente viaje del mismo teléfono los heredaba enteros.
    maybeSingle.mockResolvedValue({ data: { id: 'c1', estado: { turns: TURNOS }, viaje_id: null } });
    const r = await loadConversation('t1', '+52', 'vB');
    expect(r.turns).toEqual([]);
  });

  it('sin viaje en curso no se recicla el historial de uno pasado', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'c1', estado: { turns: TURNOS }, viaje_id: 'vA' } });
    const r = await loadConversation('t1', '+52', null);
    expect(r.turns).toEqual([]);
  });

  it('el id de la conversación se conserva siempre: se limpian los turnos, no la fila', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'c1', estado: { turns: TURNOS }, viaje_id: 'vA' } });
    expect((await loadConversation('t1', '+52', 'vB')).id).toBe('c1');
  });
});
