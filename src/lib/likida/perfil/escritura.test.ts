import { describe, it, expect, vi, beforeEach } from 'vitest';

// El escritor de `tenant.perfil` (Fase 3).
//
// AUDITORÍA 24, H20/H21/H22 (integración): `guardarPerfilPatch` dejó de
// leer-mezclar-escribir en dos statements (una carrera de "lost update" —
// dos respuestas de la entrevista de onboarding casi juntas se pisaban) y
// pasa por la RPC atómica `tenant_perfil_merge` (mig. 0296): la base hace
// la lectura Y la escritura en el MISMO UPDATE. Esta prueba mockea la RPC,
// no el select+update viejo.

const llamadasRpc: Array<{ fn: string; args: Record<string, unknown> }> = [];
let respRpc: { data: unknown; error: { message: string } | null } = { data: {}, error: null };

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      llamadasRpc.push({ fn, args });
      return Promise.resolve(respRpc);
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { guardarDeclaracionEstimuloPeaje, guardarPerfilPatch } = await import('../repo');

beforeEach(() => {
  llamadasRpc.length = 0;
  respRpc = { data: {}, error: null };
});

describe('guardarDeclaracionEstimuloPeaje', () => {
  it('llama tenant_perfil_merge con el patch de declararUmbralPeaje y el actor', async () => {
    await guardarDeclaracionEstimuloPeaje('t-1', true, false, 'user-9');

    expect(llamadasRpc).toHaveLength(1);
    expect(llamadasRpc[0].fn).toBe('tenant_perfil_merge');
    expect(llamadasRpc[0].args.p_tenant_id).toBe('t-1');
    expect(llamadasRpc[0].args.p_actualizado_por).toBe('user-9');
    const patch = llamadasRpc[0].args.p_patch as Record<string, unknown>;
    expect(patch.ingresosMenoresA300M).toEqual({ valor: true, procedencia: 'declarado' });
    expect(patch.parteRelacionada).toEqual({ valor: false, procedencia: 'declarado' });
    expect(patch).not.toHaveProperty('ingresosAnualesMxn');
    // No manda `otraLlave` ni ninguna llave existente: el merge SUPERFICIAL
    // en la base (`perfil || p_patch`) es lo que preserva lo que ya había.
    expect(Object.keys(patch).sort()).toEqual(['ingresosMenoresA300M', 'parteRelacionada']);
  });

  it('un error de la RPC LANZA: no se da por guardado lo que no se pudo mezclar', async () => {
    respRpc = { data: null, error: { message: 'timeout' } };
    await expect(guardarDeclaracionEstimuloPeaje('t-1', true, false, 'user-9')).rejects.toThrow(/perfil: timeout/);
  });

  it('tenant ausente LANZA, no inventa una fila (la RPC lo dice en su propio error)', async () => {
    respRpc = { data: null, error: { message: 'tenant_perfil_merge: tenant t-fantasma no encontrado o sin permiso de escritura' } };
    await expect(guardarDeclaracionEstimuloPeaje('t-fantasma', true, false, null)).rejects.toThrow(/no encontrado/);
  });

  it('un error de la RPC en la segunda llamada también LANZA', async () => {
    respRpc = { data: null, error: { message: 'fk' } };
    await expect(guardarDeclaracionEstimuloPeaje('t-1', false, true, 'user-9')).rejects.toThrow(/perfil: fk/);
  });
});

describe('guardarPerfilPatch', () => {
  it('manda el patch tal cual a tenant_perfil_merge — el merge superficial lo hace la base, no Node', async () => {
    await guardarPerfilPatch('t-1', { gps: { valor: 'wialon', procedencia: 'declarado' } }, 'user-9');

    expect(llamadasRpc).toHaveLength(1);
    expect(llamadasRpc[0].fn).toBe('tenant_perfil_merge');
    expect(llamadasRpc[0].args).toEqual({
      p_tenant_id: 't-1',
      p_patch: { gps: { valor: 'wialon', procedencia: 'declarado' } },
      p_actualizado_por: 'user-9',
    });
  });
});
