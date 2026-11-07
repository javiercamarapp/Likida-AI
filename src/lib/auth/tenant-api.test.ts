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
const leerSeleccionFlota = vi.fn(async (): Promise<string | null> => null);
vi.mock('./admin-context', () => ({ leerSeleccionFlota: () => leerSeleccionFlota() }));

// AUDITORÍA 25, SEGURIDAD (ALTO, línea 166, REINCIDENTE): el mismo veredicto
// de SEG-3 que gatea /admin — `mfaSuperadminObligatorio` se deja REAL para
// que la palanca de env sea la que se prueba, igual que en guard.test.ts.
const veredictoMfa = vi.fn(async (): Promise<string> => 'ok');
vi.mock('./mfa', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  veredictoMfaSuperadmin: () => veredictoMfa(),
}));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({}) }));

const registrarExporteDinero = vi.fn(async (..._a: unknown[]) => {});
vi.mock('@/lib/seguridad/registro_acceso', async (original) => ({ ...(await original<Record<string, unknown>>()), registrarExporteDinero: (...a: unknown[]) => registrarExporteDinero(...a), registrarMfaFallido: vi.fn() }));

const { resolverTenantApi, resolverTenantPedido } = await import('./tenant-api');

beforeEach(() => {
  respuestas.clear();
  getSessionTenant.mockClear();
  veredictoMfa.mockClear();
  leerSeleccionFlota.mockReset();
  leerSeleccionFlota.mockResolvedValue(null);
  veredictoMfa.mockResolvedValue('ok');
  vi.unstubAllEnvs();
});

describe('resolverTenantApi — registra quién descarga dinero (CT-SEG-11)', () => {
  it('una descarga autorizada se anota con url, flota, rol y usuario', async () => {
    registrarExporteDinero.mockClear();
    const r = await resolverTenantApi('https://x/api/export/poliza?formato=sap_b1');
    expect(r.ok).toBe(true);
    expect(registrarExporteDinero).toHaveBeenCalledWith({ url: 'https://x/api/export/poliza?formato=sap_b1', tenantId: 't-sesion', rol: 'superadmin', userId: 'u-1' });
  });
  it('una puerta que NIEGA no anota el exporte (no hubo descarga autorizada)', async () => {
    registrarExporteDinero.mockClear();
    getSessionTenant.mockResolvedValueOnce(null as never);
    const r = await resolverTenantApi('https://x/api/export/poliza');
    expect(r.ok).toBe(false);
    expect(registrarExporteDinero).not.toHaveBeenCalled();
  });
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

describe('resolverTenantApi — A37-S24-03: la flota elegida por cookie manda sobre la demo', () => {
  const superSinFlota = (): Sesion => ({ tenantId: null, rol: 'superadmin', userId: 'u-1', nombre: 'Javier' });

  it('superadmin sin tenant propio y SIN ?tenant= usa la flota de la cookie, no la demo', async () => {
    getSessionTenant.mockResolvedValueOnce(superSinFlota());
    leerSeleccionFlota.mockResolvedValue('t-elegida');
    const r = await resolverTenantApi('https://x/api/export/poliza');
    expect(r).toEqual({ ok: true, tenantId: 't-elegida', rol: 'superadmin' });
  });

  it('sin cookie sigue cayendo a la demo (comportamiento previo)', async () => {
    getSessionTenant.mockResolvedValueOnce(superSinFlota());
    const r = await resolverTenantApi('https://x/api/export/poliza');
    expect(r.ok && r.tenantId).toBe('t-demo');
  });

  it('un ?tenant= válido sigue mandando sobre la cookie', async () => {
    getSessionTenant.mockResolvedValueOnce(superSinFlota());
    leerSeleccionFlota.mockResolvedValue('t-elegida');
    respuestas.set('tenant', { data: { id: 't-otra' }, error: null });
    const r = await resolverTenantApi('https://x/api?tenant=t-otra');
    expect(r.ok && r.tenantId).toBe('t-otra');
  });

  it('si la cookie no se puede leer (fuera de petición) cae a la demo en vez de lanzar', async () => {
    getSessionTenant.mockResolvedValueOnce(superSinFlota());
    leerSeleccionFlota.mockRejectedValue(new Error('cookies() fuera de petición'));
    const r = await resolverTenantApi('https://x/api/export/poliza');
    expect(r.ok && r.tenantId).toBe('t-demo');
  });

  it('un usuario NO superadmin jamás usa la cookie de selección', async () => {
    getSessionTenant.mockResolvedValueOnce({ tenantId: null, rol: 'contador', userId: 'u-2', nombre: null });
    leerSeleccionFlota.mockResolvedValue('t-elegida');
    const r = await resolverTenantApi('https://x/api/export/poliza');
    expect(r.ok).toBe(false);
    expect(leerSeleccionFlota).not.toHaveBeenCalled();
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

describe('resolverTenantApi — el rol nomina (0949) no tiene ninguna API de sesión', () => {
  const URLS = [
    'https://x/api/export/liquidaciones', 'https://x/api/export/liquidaciones-externas?tenant=t-otra', 'https://x/api/export/pdf/abc',
    'https://x/api/export/poliza', 'https://x/api/v1/liquidaciones', 'https://x/api/v1/viajes', 'https://x/api/dashboard/chat',
    'https://x/api/dashboard/conversaciones', 'https://x/api/dashboard/evento',
  ];

  it('responde 403 en TODAS (export, v1 por cookie, dashboard), sin siquiera consultar la flota pedida', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: 't-sesion', rol: 'nomina', userId: 'u-n', nombre: 'RH' });
    respuestas.set('tenant', { data: { id: 't-otra' }, error: null });
    for (const url of URLS) {
      const r = await resolverTenantApi(url);
      expect(r.ok, url).toBe(false);
      if (!r.ok) expect(r.status, url).toBe(403);
    }
  });

  it('los demás roles de oficina siguen resolviendo igual', async () => {
    for (const rol of ['flota_admin', 'contador', 'encargado']) {
      getSessionTenant.mockResolvedValue({ tenantId: 't-sesion', rol, userId: 'u-1', nombre: 'X' });
      const r = await resolverTenantApi('https://x/api/export/liquidaciones');
      expect(r).toEqual({ ok: true, tenantId: 't-sesion', rol });
    }
  });
});

// F9 (CT-SEG-05): TOTP escalonado en exportes de dinero. Apagado por omisión (D8).
describe('resolverTenantApi: segundo factor escalonado en exportes de dinero', () => {
  const sbSinFactor = { auth: { mfa: {
    listFactors: async () => ({ data: { totp: [] }, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1' }, error: null }),
  } } };
  it('apagado: dueño sin factor descarga como siempre', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-1', nombre: 'X' });
    const r = await resolverTenantApi('https://x/api/export/liquidaciones');
    expect(r.ok).toBe(true);
  });
  it('encendido: dueño sin factor recibe 403 en dinero, pero no en un exporte que no es de dinero', async () => {
    vi.stubEnv('LIKIDA_TOTP_ESCALONADO', 'obligatorio');
    const srv = await import('@/lib/supabase/server');
    vi.spyOn(srv, 'supabaseServer').mockResolvedValue(sbSinFactor as never);
    try {
      getSessionTenant.mockResolvedValue({ tenantId: 't-sesion', rol: 'flota_admin', userId: 'u-1', nombre: 'X' });
      const r = await resolverTenantApi('https://x/api/export/liquidaciones');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.status).toBe(403);
      expect((await resolverTenantApi('https://x/api/export/jornada')).ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    }
  });
});

// R7-A2: el PDF de liquidación y las tarifas de convenios también piden el segundo factor (la bitácora conserva su lista).
describe('resolverTenantApi: segundo factor en PDF de liquidación y convenios completos (R7-A2)', () => {
  const sbSinFactor = { auth: { mfa: {
    listFactors: async () => ({ data: { totp: [] }, error: null }),
    getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1' }, error: null }),
  } } };
  const PDF = 'https://x/api/export/pdf/11111111-1111-4111-8111-111111111111';
  async function conPalanca<T>(f: () => Promise<T>): Promise<T> {
    vi.stubEnv('LIKIDA_TOTP_ESCALONADO', 'obligatorio');
    const srv = await import('@/lib/supabase/server');
    vi.spyOn(srv, 'supabaseServer').mockResolvedValue(sbSinFactor as never);
    getSessionTenant.mockResolvedValue({ tenantId: 't-sesion', rol: 'contador', userId: 'u-1', nombre: 'X' });
    try { return await f(); } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); }
  }
  it.each([PDF, 'https://x/api/export/convenios?tipo=completo'])('encendido y sin factor: 403 en %s', async (u) => {
    const r = await conPalanca(() => resolverTenantApi(u));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(403); expect(r.motivo).toMatch(/segundo factor/); }
  });
  it.each([
    'https://x/api/export/convenios', 'https://x/api/export/convenios?tipo=instrucciones', 'https://x/api/export/convenios?tipo=texto',
    'https://x/api/export/convenios?tipo=plantilla', 'https://x/api/export/jornada',
  ])('encendido y sin factor: %s sigue abierta', async (u) => {
    expect((await conPalanca(() => resolverTenantApi(u))).ok).toBe(true);
  });
  it('apagado (por omisión) el PDF se descarga como siempre', async () => {
    getSessionTenant.mockResolvedValue({ tenantId: 't-sesion', rol: 'contador', userId: 'u-1', nombre: 'X' });
    expect((await resolverTenantApi(PDF)).ok).toBe(true);
  });
});
