import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LAS SUPERFICIES DE API BAJO EL PERFIL `cinco_agentes` (0770): chat, MCP, /v1
// (por llave y por sesión), exports y el resto de /api/dashboard responden
// DENEGADO a una flota con perfil, y responden como siempre a una sin perfil.
//
// Se importan los handlers REALES de cada ruta. Lo único falso es la sesión, la
// credencial y la tabla `tenant_perfil` — el perfil y sus guardas son los reales.
// ═══════════════════════════════════════════════════════════════════════════

const CON = 't-con-perfil';
const SIN = 't-sin-perfil';
const perfiles = new Map<string, string>([[CON, 'cinco_agentes']]);
let tenantDeSesion = CON;
let rol = 'flota_admin';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let id = '';
      b.select = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = async () => ({
        data: tabla === 'tenant_perfil' && perfiles.has(id) ? { perfil: perfiles.get(id) } : null, error: null,
      });
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.1.1.1' }));
vi.mock('@/lib/auth/session', () => ({
  getSessionTenant: async () => ({ userId: 'u1', tenantId: tenantDeSesion, rol, nombre: 'Ana', operadorId: null, avatarUrl: null }),
  SIN_ROL: 'sin_rol',
}));
vi.mock('@/lib/auth/api-superadmin', () => ({ rechazoMfaSuperadminApi: async () => null }));

// chat: sus dependencias de modelo y costo.
const ejecutarAnalista = vi.fn(async () => ({ bloques: [{ tipo: 'texto', texto: 'ok' }], costoPorModelo: {} }));
vi.mock('@/app/api/dashboard/chat/tenant', () => ({ tenantEfectivoChat: async () => ({ tenantId: tenantDeSesion, nombreFlota: 'Flota' }) }));
vi.mock('@/app/api/dashboard/chat/tope', () => ({ topeDiaUsd: () => 1, gastoChatHoyUsd: async () => 0 }));
vi.mock('@/lib/likida/costos', () => ({ registrarCosto: async () => undefined, faseDeModelo: () => 'chat' }));
vi.mock('@/lib/agents/analista', () => ({ ejecutarAnalista: (...a: unknown[]) => ejecutarAnalista(...(a as [])) }));
vi.mock('@/lib/likida/chat/conversaciones', () => ({ guardarIntercambio: async () => null, listarConversaciones: async () => [] }));

// /v1 por llave y MCP: la credencial.
vi.mock('@/lib/auth/llave-api', () => ({
  llaveDelHeader: (h: string | null) => (h?.startsWith('Bearer ') ? h.slice(7) : null),
  resolverLlave: async () => ({ ok: true, tenantId: tenantDeSesion, area: 'administracion', llaveId: 'k1' }),
}));
vi.mock('@/lib/mcp/credencial', () => ({
  resolverCredencialMcp: async () => ({ ok: true, credencial: { tenantId: tenantDeSesion, actor: 'a', via: 'llave', alcanza: () => true } }),
}));
vi.mock('@/lib/likida/clientes', () => ({ getPanelClientes: async () => ({ clientes: [] }) }));
vi.mock('@/lib/likida/seguridad_eventos', () => ({ registrarEventoSeguridad: async () => undefined }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => undefined }));

const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
beforeEach(() => {
  reiniciarCachePerfil();
  tenantDeSesion = CON;
  rol = 'flota_admin';
  ejecutarAnalista.mockClear();
});

function reqNext(url: string, init?: RequestInit) {
  const r = new Request(url, init) as unknown as Record<string, unknown>;
  r.nextUrl = new URL(url);
  return r as never;
}

describe('chat «Pregunta a tus datos»', () => {
  const llamar = async () => {
    const { POST } = await import('@/app/api/dashboard/chat/route');
    return POST(reqNext('http://x.test/api/dashboard/chat', {
      method: 'POST', body: JSON.stringify({ mensajes: [{ rol: 'usuario', texto: '¿cuánto llevo?' }] }),
      headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
    })) as Promise<Response>;
  };
  it('bajo el perfil: 403 y el analista NO se toca (no gasta modelo)', async () => {
    const res = await llamar();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/plan de tu cuenta/);
    expect(ejecutarAnalista).not.toHaveBeenCalled();
  });
  it('sin perfil: responde como siempre', async () => {
    tenantDeSesion = SIN;
    const res = await llamar();
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });
  it('el historial del chat también se niega', async () => {
    const { GET } = await import('@/app/api/dashboard/conversaciones/route');
    expect((await GET(reqNext('http://x.test/api/dashboard/conversaciones')) as Response).status).toBe(403);
    tenantDeSesion = SIN;
    reiniciarCachePerfil();
    expect((await GET(reqNext('http://x.test/api/dashboard/conversaciones')) as Response).status).toBe(200);
  });
});

describe('MCP', () => {
  const llamar = async (metodo = 'tools/list') => {
    const { POST } = await import('@/app/api/mcp/route');
    return POST(new Request('http://x.test/api/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params: { name: 'search', arguments: {} } }),
    })) as Promise<Response>;
  };
  it('bajo el perfil: 403 en tools/list y en tools/call — ninguna herramienta responde', async () => {
    expect((await llamar('tools/list')).status).toBe(403);
    expect((await llamar('tools/call')).status).toBe(403);
  });
  it('sin perfil: tools/list responde como siempre', async () => {
    tenantDeSesion = SIN;
    const res = await llamar('tools/list');
    expect(res.status).toBe(200);
    expect((await res.json()).result.tools.length).toBeGreaterThan(0);
  });
  it('el despacho también se cierra solo (segunda capa) para cualquier otro llamador', async () => {
    const { despacharHerramienta } = await import('@/lib/mcp/herramientas');
    const r = await despacharHerramienta('search', { consulta: 'x' }, CON, () => true);
    expect(r).toMatchObject({ ok: false, tipo: 'sin_permiso' });
  });
});

describe('/v1', () => {
  const clientes = async (conLlave: boolean) => {
    const { GET } = await import('@/app/api/v1/clientes/route');
    return GET(new Request('http://x.test/api/v1/clientes', conLlave ? { headers: { authorization: 'Bearer k' } } : undefined)) as Promise<Response>;
  };
  it('un recurso de stand-by (clientes) se niega bajo el perfil, con llave y con sesión', async () => {
    for (const conLlave of [true, false]) {
      reiniciarCachePerfil();
      const res = await clientes(conLlave);
      expect(res.status, conLlave ? 'llave' : 'sesión').toBe(403);
    }
  });
  it('sin perfil el mismo recurso abre', async () => {
    tenantDeSesion = SIN;
    const { abrir } = await import('@/app/api/v1/_comun');
    const acc = await abrir(new Request('http://x.test/api/v1/clientes', { headers: { authorization: 'Bearer k' } }), 'dinero');
    expect(acc.ok).toBe(true);
    // y la ruta real ya no responde 403 por perfil (el 500 de aquí es solo el lector falso)
    expect((await clientes(true)).status).not.toBe(403);
  });
  it('un recurso de los cinco agentes (viajes) NO lo corta el perfil', async () => {
    const { abrir } = await import('@/app/api/v1/_comun');
    const acc = await abrir(new Request('http://x.test/api/v1/viajes', { headers: { authorization: 'Bearer k' } }), 'operacion');
    expect(acc.ok).toBe(true);
  });
});

describe('exports y sesión de API', () => {
  it('resolverTenantApi niega un export de stand-by y deja pasar uno de los cinco', async () => {
    const { resolverTenantApi } = await import('@/lib/auth/tenant-api');
    const poliza = await resolverTenantApi('http://x.test/api/export/poliza?mes=2026-09');
    expect(poliza).toMatchObject({ ok: false, status: 403 });
    const liquidaciones = await resolverTenantApi('http://x.test/api/export/liquidaciones');
    expect(liquidaciones).toMatchObject({ ok: true, tenantId: CON });
    tenantDeSesion = SIN;
    reiniciarCachePerfil();
    expect(await resolverTenantApi('http://x.test/api/export/poliza')).toMatchObject({ ok: true });
  });
  it('un export NUEVO que nadie clasifique se niega bajo el perfil', async () => {
    const { resolverTenantApi } = await import('@/lib/auth/tenant-api');
    expect(await resolverTenantApi('http://x.test/api/export/reporte-nuevo')).toMatchObject({ ok: false, status: 403 });
  });
});
