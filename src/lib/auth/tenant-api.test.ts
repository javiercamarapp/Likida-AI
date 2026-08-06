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

const { resolverTenantApi, resolverTenantPedido } = await import('./tenant-api');

beforeEach(() => { respuestas.clear(); getSessionTenant.mockClear(); });

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
