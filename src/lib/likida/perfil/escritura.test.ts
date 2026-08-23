import { describe, it, expect, vi, beforeEach } from 'vitest';

// El escritor de `tenant.perfil` (Fase 3): lee-mezcla-escribe el jsonb y
// manda `perfil_actualizado_por` en el MISMO UPDATE (el trigger de 0169
// no tiene otra forma de saber quién fue). Un SELECT caído LANZA — no se
// da por guardada una declaración que no se pudo mezclar.

const updates: Array<Record<string, unknown>> = [];
let respLectura: { data: unknown; error: { message: string } | null } = { data: { perfil: {} }, error: null };
let respEscritura: { data: unknown; error: { message: string } | null } = { data: null, error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const n: Record<string, unknown> = {};
      n.select = () => n;
      n.eq = () => n;
      n.maybeSingle = () => Promise.resolve(respLectura);
      n.update = (payload: Record<string, unknown>) => {
        updates.push(payload);
        return { eq: () => Promise.resolve(respEscritura) };
      };
      return n;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { guardarDeclaracionEstimuloPeaje } = await import('../repo');

beforeEach(() => {
  updates.length = 0;
  respLectura = { data: { perfil: { otraLlave: 1 } }, error: null };
  respEscritura = { data: null, error: null };
});

describe('guardarDeclaracionEstimuloPeaje', () => {
  it('mezcla el umbral sobre el perfil existente y sella quién lo cambió en el mismo UPDATE', async () => {
    await guardarDeclaracionEstimuloPeaje('t-1', true, false, 'user-9');

    expect(updates).toHaveLength(1);
    expect(updates[0].perfil_actualizado_por).toBe('user-9');
    const perfil = updates[0].perfil as Record<string, unknown>;
    expect(perfil.otraLlave).toBe(1);
    expect(perfil.ingresosMenoresA300M).toEqual({ valor: true, procedencia: 'declarado' });
    expect(perfil.parteRelacionada).toEqual({ valor: false, procedencia: 'declarado' });
    expect(perfil).not.toHaveProperty('ingresosAnualesMxn');
  });

  it('un SELECT caído LANZA: no se da por guardado lo que no se pudo mezclar', async () => {
    respLectura = { data: null, error: { message: 'timeout' } };
    await expect(guardarDeclaracionEstimuloPeaje('t-1', true, false, 'user-9')).rejects.toThrow(/perfil: timeout/);
    expect(updates).toHaveLength(0);
  });

  it('tenant ausente LANZA, no inventa una fila', async () => {
    respLectura = { data: null, error: null };
    await expect(guardarDeclaracionEstimuloPeaje('t-fantasma', true, false, null)).rejects.toThrow(/no encontrado/);
    expect(updates).toHaveLength(0);
  });

  it('un UPDATE caído LANZA', async () => {
    respEscritura = { data: null, error: { message: 'fk' } };
    await expect(guardarDeclaracionEstimuloPeaje('t-1', false, true, 'user-9')).rejects.toThrow(/perfil: fk/);
  });
});
