import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// FASE 1 · SEG-ADMIN-DOS-CASOS (checklist 31 v2, #10 — `conv.ts:697`).
//
// `saveConversation` actualizaba `wa_conversacion` ancladA SOLO por `id`, sin
// `tenant_id` — a diferencia de prácticamente cualquier otro UPDATE del
// repo (patrón `cambiarRolUsuario`/`desactivarUsuario`). `wa_conversacion`
// SÍ tiene `tenant_id` (0047, `uq_wa_conversacion_tenant_telefono_norm`), así
// que el filtro es gratis. No es un IDOR explotable hoy —`convId` nunca viaja
// en una entrada de usuario, siempre nace de `loadConversation(tenantId, …)`—
// pero es la misma defensa en profundidad que ya exige CLAUDE.md para todo
// lo que escribe `supabaseAdmin`: anclar el WHERE al tenant, no solo al id.
// ═══════════════════════════════════════════════════════════════════════════

type Filtro = { metodo: string; args: unknown[] };

let filtrosSelect: Filtro[] = [];
let filtrosUpdate: Filtro[] = [];
let respSelect: { data: unknown; error: { message: string } | null } = { data: null, error: null };
let respUpdate: { error: { message: string } | null } = { error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => {
        const nodo: Record<string, unknown> = {};
        nodo.eq = (...a: unknown[]) => { filtrosSelect.push({ metodo: 'eq', args: a }); return nodo; };
        nodo.maybeSingle = async () => respSelect;
        return nodo;
      },
      update: (payload: unknown) => {
        const nodo: Record<string, unknown> = { payload };
        nodo.eq = (...a: unknown[]) => { filtrosUpdate.push({ metodo: 'eq', args: a }); return nodo; };
        nodo.then = (res: (v: unknown) => unknown) => Promise.resolve(respUpdate).then(res);
        return nodo;
      },
    }),
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { saveConversation } = await import('./conv');

beforeEach(() => {
  filtrosSelect = [];
  filtrosUpdate = [];
  respSelect = { data: { estado: {} }, error: null };
  respUpdate = { error: null };
});

describe('saveConversation — anclada a tenant_id, no solo al id', () => {
  it('la LECTURA del estado previo filtra por tenant_id Y por id', async () => {
    await saveConversation('t-mia', 'conv-1', [], null);
    const eqs = filtrosSelect.map((f) => [String(f.args[0]), f.args[1]]);
    expect(eqs).toContainEqual(['id', 'conv-1']);
    expect(eqs).toContainEqual(['tenant_id', 't-mia']);
  });

  it('el UPDATE va anclado por tenant_id Y por id — no solo por id', async () => {
    await saveConversation('t-mia', 'conv-1', [], null);
    const eqs = filtrosUpdate.map((f) => [String(f.args[0]), f.args[1]]);
    expect(eqs).toContainEqual(['id', 'conv-1']);
    expect(eqs).toContainEqual(['tenant_id', 't-mia']);
  });

  it('un tenant distinto al de la fila no la toca (lectura devuelve null y se escribe limpio)', async () => {
    respSelect = { data: null, error: null };
    await saveConversation('t-otro', 'conv-1', [{ role: 'user', content: 'hola' }], null);
    expect(filtrosSelect.map((f) => [String(f.args[0]), f.args[1]])).toContainEqual(['tenant_id', 't-otro']);
    expect(filtrosUpdate.map((f) => [String(f.args[0]), f.args[1]])).toContainEqual(['tenant_id', 't-otro']);
  });

  it('exige el tenantId en su firma (no se puede llamar sin él)', () => {
    expect(saveConversation.length).toBeGreaterThanOrEqual(2);
  });
});
