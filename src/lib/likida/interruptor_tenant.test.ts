import { describe, it, expect, vi, beforeEach } from 'vitest';

// AUDITORÍA ADVERSARIAL BAJO (21-oct-2026): `pipelineTenantApagado` comparaba
// `(await perfilDeTenant(...)) !== null` — "cualquier perfil no nulo", no específicamente
// `=== 'cinco_agentes'`. Hoy es inofensivo porque `PerfilTenant` (auth/visibilidad.ts:362) solo
// admite 'cinco_agentes', pero es fragilidad latente: la tabla real (CHECK) nunca deja ver un
// segundo valor, así que esta prueba mockea `perfilDeTenant` DIRECTO (no la tabla) para demostrar,
// con un perfil hipotético distinto de 'cinco_agentes', que YA NO apaga OCR/cuadre para ese tenant.
// `interruptor_tenant_perfil.test.ts` ya cubre el camino real (único perfil existente); esta prueba
// es la del contrato de comparación explícita.

let filaPalanca: { apagado: boolean } | null = null;
const perfilMock = vi.fn();

vi.mock('@/lib/auth/perfil_tenant', () => ({
  perfilDeTenant: (...args: unknown[]) => perfilMock(...args),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: filaPalanca, error: null });
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (p: unknown) => p }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { pipelineTenantApagado } = await import('./interruptor_tenant');

beforeEach(() => {
  filaPalanca = null;
  perfilMock.mockReset();
});

describe('pipelineTenantApagado — comparación explícita contra cinco_agentes', () => {
  it('perfil cinco_agentes: apaga ocr y cuadre, whatsapp sigue vivo', async () => {
    perfilMock.mockResolvedValue('cinco_agentes');
    expect(await pipelineTenantApagado('t1', 'ocr')).toBe(true);
    expect(await pipelineTenantApagado('t1', 'cuadre')).toBe(true);
    expect(await pipelineTenantApagado('t1', 'whatsapp')).toBe(false);
  });

  it('un SEGUNDO perfil hipotético (≠ cinco_agentes) ya NO apaga ocr/cuadre — con `!== null` sí lo apagaba', async () => {
    perfilMock.mockResolvedValue('segundo_perfil_hipotetico');
    expect(await pipelineTenantApagado('t2', 'ocr')).toBe(false);
    expect(await pipelineTenantApagado('t2', 'cuadre')).toBe(false);
    expect(await pipelineTenantApagado('t2', 'whatsapp')).toBe(false);
  });

  it('sin perfil (null): manda la palanca de siempre', async () => {
    perfilMock.mockResolvedValue(null);
    filaPalanca = { apagado: true };
    expect(await pipelineTenantApagado('t3', 'ocr')).toBe(true);
    filaPalanca = null;
    expect(await pipelineTenantApagado('t3', 'ocr')).toBe(false);
  });
});
