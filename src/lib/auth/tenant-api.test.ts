// ═══════════════════════════════════════════════════════════════════════════
// COBERTURA (ronda 16): tenant-api.ts estaba a 28% — el resolver del ?tenant=
// de las APIs (la puerta que evita escribir en la flota equivocada).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect, vi, beforeEach } from 'vitest';

const respuestas = new Map<string, { data: unknown; error: { message: string } | null }>();

function builder(tabla: string) {
  const b: Record<string, unknown> = {};
  const self = () => b;
  for (const m of ['select', 'eq']) b[m] = self;
  b.maybeSingle = async () => respuestas.get(tabla) ?? { data: null, error: null };
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
type Sesion = { tenantId: string | null; rol: string; userId: string; nombre: string | null };
const getSessionTenant = vi.fn(async (): Promise<Sesion> => ({
  tenantId: 't-sesion', rol: 'superadmin', userId: 'u-1', nombre: 'Javier',
}));
vi.mock('./session', () => ({ getSessionTenant }));
vi.mock('./tenant-demo', () => ({ tenantDemo: () => 't-demo' }));

// AUDITORÍA 25, SEGURIDAD (ALTO, línea 166, REINCIDENTE): el mismo veredicto
// de SEG-3 que gatea /admin — `mfaSuperadminObligatorio` se deja REAL para
// que la palanca de env sea la que se prueba, igual que en guard.test.ts.
const veredictoMfa = vi.fn(async (): Promise<string> => 'ok');
vi.mock('./mfa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  veredictoMfaSuperadmin: () => veredictoMfa(),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));

const { resolverTenantApi, resolverTenantPedido } = await import('./tenant-api');

beforeEach(() => {
  respuestas.clear();
  getSessionTenant.mockClear();
  veredictoMfa.mockClear();
  veredictoMfa.mockResolvedValue('ok');
  vi.unstubAllEnvs();
});

describe('resolverTenantApi — la puerta del ?tenant= de las APIs', () => {
  it('sin ?tenant= usa el tenant de la sesión', async () => {
    const r = await resolverTenantApi('https://x/api?otro=1');
    expect(r).toEqual({ ok: true, tenantId: 't-sesion', rol: 'superadmin' });
  });

  it('superadmin con ?tenant= válido resuelve al pedido', async () => {
    respuestas.set('tenant', { data: { id: 't-otra' }, error: null });
    const r = await resolverTenantApi('https://x/api?tenant=t-otra');
    expect(r.ok && r.tenantId).toBe('t-otra');
  });

  it('?tenant= que no existe cae silencioso a la sesión (un enlace viejo no debe fallar)', async () => {
    respuestas.set('tenant', { data: null, error: null });
    const r = await resolverTenantApi('https://x/api?tenant=no-existe');
    expect(r.ok && r.tenantId).toBe('t-sesion');
  });

  it('AUDITORÍA 13: bache de red (error) NO cae a la sesión — falla con 503', async () => {
    respuestas.set('tenant', { data: null, error: { message: 'fetch failed' } });
    const r = await resolverTenantApi('https://x/api?tenant=t-otra');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);
  });

  it('sin sesión → 401', async () => {
    getSessionTenant.mockResolvedValueOnce(null as unknown as Sesion);
    const r = await resolverTenantApi('https://x/api');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
  });

  it('resolverTenantPedido: sin pedido devuelve la sesión tal cual', async () => {
    expect(await resolverTenantPedido({ from: () => builder('tenant') } as never, 't-sesion', undefined)).toBe('t-sesion');
  });
});

describe('resolverTenantApi — SEG-3 también gatea /api (auditoría 25, línea 166)', () => {
  it('palanca APAGADA: entra igual que siempre y ni se pregunta por el factor', async () => {
    veredictoMfa.mockResolvedValue('inscribir');
    const r = await resolverTenantApi('https://x/api?otro=1');
    expect(r).toEqual({ ok: true, tenantId: 't-sesion', rol: 'superadmin' });
    expect(veredictoMfa).not.toHaveBeenCalled();
  });

  it.each(['inscribir', 'retar', 'no_verificable'])(
    'palanca puesta y veredicto %s: 403, sin resolver la flota pedida',
    async (veredicto) => {
      vi.stubEnv('LIKIDA_SUPERADMIN_MFA', 'obligatorio');
      veredictoMfa.mockResolvedValue(veredicto);
      const r = await resolverTenantApi('https://x/api?tenant=t-otra');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
    });

  it('palanca puesta y veredicto ok: resuelve normal', async () => {
    vi.stubEnv('LIKIDA_SUPERADMIN_MFA', 'obligatorio');
    veredictoMfa.mockResolvedValue('ok');
    const r = await resolverTenantApi('https://x/api?otro=1');
    expect(r).toEqual({ ok: true, tenantId: 't-sesion', rol: 'superadmin' });
  });

  it('un rol que NO es superadmin nunca pasa por esta exigencia', async () => {
    vi.stubEnv('LIKIDA_SUPERADMIN_MFA', 'obligatorio');
    getSessionTenant.mockResolvedValueOnce({ tenantId: 't-1', rol: 'flota_admin', userId: 'u-2', nombre: 'Ana' });
    veredictoMfa.mockResolvedValue('inscribir');
    const r = await resolverTenantApi('https://x/api');
    expect(r).toEqual({ ok: true, tenantId: 't-1', rol: 'flota_admin' });
    expect(veredictoMfa).not.toHaveBeenCalled();
  });
});
