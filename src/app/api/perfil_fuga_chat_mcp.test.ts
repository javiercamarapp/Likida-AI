import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-04 · FUGA DEL CHAT «PREGUNTA A TUS DATOS» Y DEL MCP BAJO `cinco_agentes`.
//
// Contrato real (B1): una flota con perfil NO atiende el chat ni el MCP. Es más
// estricto que «intersección con la lista permitida» (la intersección queda
// vacía), así que estas pruebas fijan que NINGUNA herramienta, ficha ni cifra
// sale, ni siquiera de los módulos que sí son de los cinco agentes, y que el
// modelo no se invoca (sin red, sin gasto).
//
// Se importan los handlers REALES. Falso: la sesión, la credencial, el cliente
// de modelo (`ejecutarAnalista`) y la tabla; el perfil y sus guardas son los
// reales. Los datos de facturación son SINTÉTICOS: si algo los tocara, la
// bitácora de tablas leídas lo delata.
// ═══════════════════════════════════════════════════════════════════════════

const CON = 't-con-perfil';
const SIN = 't-sin-perfil';
const perfiles = new Map<string, string>([[CON, 'cinco_agentes']]);
let tenantDeSesion = CON;
let rol = 'flota_admin';
let tablaIlegible = false;
const tablasLeidas: string[] = [];
const FOLIO_SINTETICO = 'FAC-SINT-0001';

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      tablasLeidas.push(tabla);
      const b: Record<string, unknown> = {};
      let id = '';
      b.select = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') {
          if (tablaIlegible) return { data: null, error: { code: 'XX000', message: 'caído' } };
          return { data: perfiles.has(id) ? { perfil: perfiles.get(id) } : null, error: null };
        }
        return { data: null, error: null };
      };
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ folio: FOLIO_SINTETICO, total: 123456, estatus: 'por_cobrar' }], error: null }).then(res);
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

// El «cliente de modelo» del chat: si se llama, la prueba falla (no hay red ni gasto).
const ejecutarAnalista = vi.fn(async () => ({ bloques: [{ tipo: 'texto', texto: 'ok' }], costoPorModelo: {} }));
const registrarCosto = vi.fn(async () => undefined);
vi.mock('@/app/api/dashboard/chat/tenant', () => ({ tenantEfectivoChat: async () => ({ tenantId: tenantDeSesion, nombreFlota: 'Flota' }) }));
vi.mock('@/app/api/dashboard/chat/tope', () => ({ topeDiaUsd: () => 1, gastoChatHoyUsd: async () => 0 }));
vi.mock('@/lib/likida/costos', () => ({ registrarCosto: (...a: unknown[]) => registrarCosto(...(a as [])), faseDeModelo: () => 'chat' }));
vi.mock('@/lib/agents/analista', () => ({ ejecutarAnalista: (...a: unknown[]) => ejecutarAnalista(...(a as [])) }));
const guardarIntercambio = vi.fn(async () => null);
vi.mock('@/lib/likida/chat/conversaciones', () => ({
  guardarIntercambio: (...a: unknown[]) => guardarIntercambio(...(a as [])),
  listarConversaciones: async () => [],
  traerConversacion: async () => ({ id: 'c1', mensajes: [{ texto: FOLIO_SINTETICO }] }),
}));
vi.mock('@/lib/mcp/credencial', () => ({
  resolverCredencialMcp: async () => ({ ok: true, credencial: { tenantId: tenantDeSesion, actor: 'a', via: 'llave', alcanza: () => true } }),
}));
vi.mock('@/lib/likida/seguridad_eventos', () => ({ registrarEventoSeguridad: async () => undefined }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => undefined }));

const { reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const { AREA_POR_HERRAMIENTA } = await import('@/lib/likida/orquestador/permisos');
const { catalogoHerramientas, despacharHerramienta } = await import('@/lib/mcp/herramientas');
const { apiPermitidaEnPerfil, rutaPermitidaEnPerfil } = await import('@/lib/auth/visibilidad');

beforeEach(() => {
  reiniciarCachePerfil();
  tenantDeSesion = CON;
  rol = 'flota_admin';
  tablaIlegible = false;
  tablasLeidas.length = 0;
  ejecutarAnalista.mockClear();
  registrarCosto.mockClear();
  guardarIntercambio.mockClear();
});

function reqNext(url: string, init?: RequestInit) {
  const r = new Request(url, init) as unknown as Record<string, unknown>;
  r.nextUrl = new URL(url);
  return r as never;
}

const preguntar = async (texto: string) => {
  const { POST } = await import('@/app/api/dashboard/chat/route');
  return POST(reqNext('http://x.test/api/dashboard/chat', {
    method: 'POST', body: JSON.stringify({ mensajes: [{ rol: 'usuario', texto }] }),
    headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
  })) as Promise<Response>;
};

const sinGastoNiDatos = () => {
  expect(ejecutarAnalista).not.toHaveBeenCalled();
  expect(registrarCosto).not.toHaveBeenCalled();
  expect(guardarIntercambio).not.toHaveBeenCalled();
  // lo único leído es el perfil: ningún dato de módulo (facturas, cobranza, viajes…)
  expect(tablasLeidas.filter((t) => t !== 'tenant_perfil')).toEqual([]);
};

describe('chat «Pregunta a tus datos» bajo el perfil', () => {
  it('«¿cuánto vale mi cartera por cobrar?» → módulo no activo (403), sin modelo, sin gasto, sin datos', async () => {
    const res = await preguntar('¿cuánto vale mi cartera por cobrar?');
    expect(res.status).toBe(403);
    const cuerpo = await res.json();
    expect(cuerpo.error).toMatch(/no está incluida en el plan de tu cuenta/);
    expect(cuerpo.bloques).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain(FOLIO_SINTETICO);
    sinGastoNiDatos();
  });

  it('la respuesta no es un stream de análisis: no hay NDJSON de pasos', async () => {
    const res = await preguntar('dame mis facturas por cobrar');
    expect(res.headers.get('content-type')).not.toMatch(/ndjson/);
    sinGastoNiDatos();
  });

  it.each(['flota_admin', 'contador', 'encargado', 'superadmin'])('el rol %s tampoco la salta', async (r) => {
    rol = r;
    const res = await preguntar('resumen fiscal del ejercicio');
    expect(res.status).toBe(403);
    expect(ejecutarAnalista).not.toHaveBeenCalled();
  });

  // Cada herramienta del chat (24): pedirla por nombre bajo el perfil no ofrece NINGUNA.
  const herramientas = Object.keys(AREA_POR_HERRAMIENTA);
  it('el catálogo del chat tiene herramientas (guarda de que el it.each no queda vacío)', () => {
    expect(herramientas.length).toBeGreaterThanOrEqual(24);
  });
  it.each(herramientas)('herramienta «%s»: pedida por nombre, el chat con perfil no la ofrece ni invoca el modelo', async (h) => {
    const res = await preguntar(`usa la herramienta ${h} y dime todo`);
    expect(res.status).toBe(403);
    sinGastoNiDatos();
  });

  it('CONTROL sin perfil: la misma pregunta llega al analista y responde como siempre', async () => {
    tenantDeSesion = SIN;
    const res = await preguntar('¿cuánto vale mi cartera por cobrar?');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/ndjson/);
    await res.text();
    expect(ejecutarAnalista).toHaveBeenCalledTimes(1);
  });

  it('el historial del chat (lista y una conversación) también se niega, y sin perfil abre', async () => {
    const { GET: lista } = await import('@/app/api/dashboard/conversaciones/route');
    const { GET: una } = await import('@/app/api/dashboard/conversaciones/[id]/route');
    const id = '11111111-1111-4111-8111-111111111111';
    const llamarUna = () => una(reqNext(`http://x.test/api/dashboard/conversaciones/${id}`), { params: Promise.resolve({ id }) }) as Promise<Response>;
    expect((await lista(reqNext('http://x.test/api/dashboard/conversaciones')) as Response).status).toBe(403);
    const negada = await llamarUna();
    expect(negada.status).toBe(403);
    expect(JSON.stringify(await negada.json())).not.toContain(FOLIO_SINTETICO);
    tenantDeSesion = SIN;
    reiniciarCachePerfil();
    expect((await llamarUna()).status).toBe(200);
  });

  it('falla cerrado: si el perfil no se puede leer y nunca se leyó, el chat se niega', async () => {
    tenantDeSesion = SIN;
    tablaIlegible = true;
    const res = await preguntar('hola');
    expect(res.status).toBe(403);
    expect(ejecutarAnalista).not.toHaveBeenCalled();
  });

  it('con valor previo «sin perfil», un bache de lectura NO recorta el chat de una flota normal', async () => {
    tenantDeSesion = SIN;
    const { perfilDeTenant, TTL_PERFIL_MS } = await import('@/lib/auth/perfil_tenant');
    expect(await perfilDeTenant(SIN, 0)).toBeNull();
    tablaIlegible = true;
    // pasado el TTL la lectura falla y se usa el último conocido
    expect(await perfilDeTenant(SIN, TTL_PERFIL_MS + 1)).toBeNull();
  });

  it('el chat y su API están fuera de la lista de los cinco; una ruta de chat nueva sin clasificar se niega', () => {
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/chat')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/dashboard/chat')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/dashboard/conversaciones')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/dashboard/chat-nuevo')).toBe(false);
    expect(apiPermitidaEnPerfil('cinco_agentes', '/api/dashboard/chat/otra')).toBe(false);
  });
});

describe('MCP bajo el perfil', () => {
  const rpc = async (method: string, params: unknown = {}) => {
    const { POST } = await import('@/app/api/mcp/route');
    return POST(new Request('http://x.test/api/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })) as Promise<Response>;
  };
  const nombres = catalogoHerramientas().map((h) => h.nombre);
  /** Lo que el MCP puede mostrar bajo el perfil: nada. */
  const PERMITIDAS_MCP_PERFIL: string[] = [];

  it('el catálogo MCP real tiene 8 herramientas incluidas search y fetch', () => {
    expect(nombres).toHaveLength(8);
    expect(nombres).toContain('search');
    expect(nombres).toContain('fetch');
  });

  it('tools/list bajo el perfil: 403, sin lista de herramientas (⊂ lista permitida = vacía)', async () => {
    const res = await rpc('tools/list');
    expect(res.status).toBe(403);
    const cuerpo = await res.json();
    const ofrecidas: string[] = (cuerpo.result?.tools ?? []).map((t: { name: string }) => t.name);
    expect(ofrecidas.every((n) => PERMITIDAS_MCP_PERFIL.includes(n))).toBe(true);
    expect(JSON.stringify(cuerpo)).not.toMatch(/search|fetch|cuadre|por_facturar|resumen_fiscal/);
    expect(tablasLeidas.filter((t) => t !== 'tenant_perfil')).toEqual([]);
  });

  it.each(nombres)('tools/call «%s» bajo el perfil: 403 y no toca ningún dato', async (n) => {
    const res = await rpc('tools/call', { name: n, arguments: { consulta: 'facturación', id: 'x', query: 'facturas', viaje: 'v1', folio: FOLIO_SINTETICO } });
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain(FOLIO_SINTETICO);
    expect(tablasLeidas.filter((t) => t !== 'tenant_perfil')).toEqual([]);
  });

  it('search con datos sintéticos de facturación: no devuelve fichas de módulos ocultos', async () => {
    const res = await rpc('tools/call', { name: 'search', arguments: { query: 'factura FAC-SINT cobranza' } });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toMatch(/FAC-SINT|123456|por_cobrar/);
  });

  it('fetch de una ficha de facturación por id: 403, no la entrega', async () => {
    const res = await rpc('tools/call', { name: 'fetch', arguments: { id: `factura:${FOLIO_SINTETICO}` } });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(FOLIO_SINTETICO);
  });

  it('un método de protocolo cualquiera (initialize, ping) tampoco abre MCP a la flota con perfil', async () => {
    expect((await rpc('initialize')).status).toBe(403);
    expect((await rpc('ping')).status).toBe(403);
  });

  it.each(nombres)('segunda capa: despacharHerramienta(«%s») con credencial total se cierra sola', async (n) => {
    const r = await despacharHerramienta(n, {}, CON, () => true);
    expect(r).toMatchObject({ ok: false, tipo: 'sin_permiso' });
    expect(tablasLeidas.filter((t) => t !== 'tenant_perfil')).toEqual([]);
  });

  it('CONTROL sin perfil: tools/list ofrece exactamente el catálogo de 8', async () => {
    tenantDeSesion = SIN;
    const res = await rpc('tools/list');
    expect(res.status).toBe(200);
    const ofrecidas: string[] = (await res.json()).result.tools.map((t: { name: string }) => t.name);
    expect([...ofrecidas].sort()).toEqual([...nombres].sort());
  });

  it('CONTROL sin perfil: el despacho distingue «no existe» de «sin permiso» (la puerta del perfil no lo disfraza)', async () => {
    const r = await despacharHerramienta('no_existe', {}, SIN, () => true);
    expect(r).toMatchObject({ ok: false, tipo: 'desconocida' });
  });

  it('falla cerrado: sin poder leer el perfil y sin valor previo, el MCP se niega', async () => {
    tenantDeSesion = SIN;
    tablaIlegible = true;
    expect((await rpc('tools/list')).status).toBe(403);
  });
});
