import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-05 · FUGA DE LA API /v1, DE /api/export/* Y DE LA EMISIÓN DE LLAVES
// BAJO EL PERFIL `cinco_agentes`.
//
// Se importan los handlers REALES de cada `route.ts` (enumerados con un glob:
// una ruta nueva entra sola a la tabla y, si nadie la clasifica, la prueba
// falla). Falso: la base (un proxy que registra tablas leídas y escrituras), la
// sesión y la verificación de la llave. Reales: `abrir()`, `resolverTenantApi`,
// el perfil y sus guardas. Todo con identificadores SINTÉTICOS; no se emite ni
// se usa ninguna llave real.
//
// La tabla de qué vive y qué no está ESCRITA AQUÍ a mano, independiente de
// `API_PERFIL_CINCO_AGENTES`: si alguien amplía la lista permitida sin pensar,
// esta prueba lo atrapa en vez de aceptarlo por construcción.
// ═══════════════════════════════════════════════════════════════════════════

const CON = 'tenant-sintetico-con-perfil';
const SIN = 'tenant-sintetico-sin-perfil';
const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';

const perfiles = new Map<string, string>([[CON, 'cinco_agentes']]);
let tablaPerfilAusente = false;
const tablasLeidas: string[] = [];
const escrituras: string[] = [];
const VERBOS_ESCRITURA = new Set(['insert', 'update', 'delete', 'upsert', 'rpc']);

function baseFalsa(tabla = ''): unknown {
  let id: string | null = null;
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (res: (v: unknown) => unknown) => {
          if (tabla === 'tenant_perfil' && tablaPerfilAusente) {
            return Promise.resolve({ data: null, error: { code: '42P01', message: 'no existe' }, count: null }).then(res);
          }
          return Promise.resolve({ data: [], error: null, count: 0 }).then(res);
        };
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => {
          if (tabla === 'tenant_perfil') {
            if (tablaPerfilAusente) return { data: null, error: { code: '42P01', message: 'no existe' } };
            return { data: perfiles.has(id ?? '') ? { perfil: perfiles.get(id!) } : null, error: null };
          }
          return { data: null, error: null };
        };
      }
      return (...args: unknown[]) => {
        if (VERBOS_ESCRITURA.has(prop)) escrituras.push(`${tabla}.${prop}`);
        if (prop === 'from') {
          tablasLeidas.push(String(args[0]));
          return baseFalsa(String(args[0]));
        }
        if (prop === 'eq' && (args[0] === 'tenant_id' || args[0] === 'id')) id = String(args[1]);
        return proxy;
      };
    },
    apply: () => proxy,
  });
  return proxy;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => baseFalsa() }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => baseFalsa() }));

const logWarn = vi.fn();
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: (...a: unknown[]) => logWarn(...a), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.1.1.1' }));

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({
  redirect: (a: string) => redirect(a),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({}),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn(), unstable_noStore: vi.fn() }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: vi.fn(), delete: vi.fn() }),
}));

// Sesión del panel (la vía de cookie). `null` = anónimo.
let sesion: { userId: string; tenantId: string; rol: string; nombre: string; operadorId: null; avatarUrl: null } | null = null;
const comoDueno = (tenantId: string) => ({ userId: 'u1', tenantId, rol: 'flota_admin', nombre: 'Persona Sintetica', operadorId: null, avatarUrl: null });
vi.mock('@/lib/auth/session', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSessionTenant: async () => sesion,
}));
vi.mock('@/lib/auth/admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('@/lib/auth/superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => 'ok' }));
vi.mock('@/lib/auth/api-superadmin', () => ({ rechazoMfaSuperadminApi: async () => null }));

// La llave: se doble SOLO la verificación contra la tabla; el resto (parseo del header) es real.
let tenantDeLlave = CON;
let areaDeLlave = 'administracion';
vi.mock('@/lib/auth/llave-api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolverLlave: async () => ({ ok: true, tenantId: tenantDeLlave, area: areaDeLlave, llaveId: 'llave-sintetica' }),
}));

const { reiniciarCachePerfil, MOTIVO_PERFIL_API } = await import('@/lib/auth/perfil_tenant');
const { apiPermitidaEnPerfil, rutaPermitidaEnPerfil, puedeVerRuta } = await import('@/lib/auth/visibilidad');

// ── Las rutas, enumeradas del árbol ─────────────────────────────────────────
type Manejador = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const CARGADORES = {
  ...import.meta.glob('./v1/**/route.ts'),
  ...import.meta.glob('./export/**/route.ts'),
} as Record<string, () => Promise<Record<string, unknown>>>;

const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

interface Endpoint { ruta: string; raiz: 'v1' | 'export'; recurso: string; pathname: string; metodo: typeof METODOS[number]; cargar: () => Promise<Record<string, unknown>> }

const RUTAS: { clave: string; raiz: 'v1' | 'export'; recurso: string; pathname: string }[] = Object.keys(CARGADORES)
  .filter((k) => !k.startsWith('./v1/openapi/'))
  .sort()
  .map((clave) => {
    const bajo = clave.replace(/^\.\//, '').replace(/\/route\.ts$/, '');
    const [raiz, recurso] = bajo.split('/') as ['v1' | 'export', string];
    return { clave, raiz, recurso, pathname: `/api/${bajo.replace(/\[[^\]]+\]/g, UUID)}` };
  });

// Qué sigue vivo bajo el perfil, escrito a mano desde la ficha (T-PER-05) y la
// lista de B1. Todo lo demás debe contestar 403 por perfil.
const V1_PERMITIDOS = ['viajes', 'hitos', 'sitios', 'unidades', 'operadores', 'peajes', 'conductor', 'estadias', 'evidencias', 'liquidaciones-externas'];
// DECISIÓN PENDIENTE (preguntas-javier.md, T-PER-05): la ficha manda 403 a las
// «liquidaciones propias»; la lista vigente de B1 las deja vivas porque
// `/dashboard/[id]` (revisión de lo cuadrado) está en la lista. Aquí se fija lo
// que HOY hace el producto, sin pronunciarse; si Javier decide cerrarlas, estos
// nombres pasan a la lista de negados y se cambia `API_PERFIL_CINCO_AGENTES`.
const V1_VIVOS_POR_DECIDIR = ['liquidaciones'];
const EXPORT_PERMITIDOS = [
  'liquidaciones-externas', 'bitacora-peaje', 'bitacora-conciliada', 'peajes-reclamacion',
  'carta-porte-docs', 'carta-porte-xml', 'vigia-faqs',
];
const EXPORT_VIVOS_POR_DECIDIR = ['liquidaciones', 'pdf'];
const V1_STAND_BY = ['clientes'];
const EXPORT_STAND_BY = ['poliza', 'facturas-proveedor', 'convenios', 'jornada'];

const viveBajoPerfil = (raiz: 'v1' | 'export', recurso: string) =>
  raiz === 'v1'
    ? [...V1_PERMITIDOS, ...V1_VIVOS_POR_DECIDIR].includes(recurso)
    : [...EXPORT_PERMITIDOS, ...EXPORT_VIVOS_POR_DECIDIR].includes(recurso);

async function endpoints(raiz: 'v1' | 'export'): Promise<Endpoint[]> {
  const salida: Endpoint[] = [];
  for (const r of RUTAS.filter((x) => x.raiz === raiz)) {
    const mod = await CARGADORES[r.clave]();
    for (const m of METODOS) {
      if (typeof mod[m] === 'function') salida.push({ ruta: r.clave, raiz, recurso: r.recurso, pathname: r.pathname, metodo: m, cargar: async () => mod });
    }
  }
  return salida;
}

const V1 = await endpoints('v1');
const EXPORT = await endpoints('export');

type Via = 'llave' | 'cookie';

interface Resultado { status: number; porPerfil: boolean; cuerpo: string; lanzo: boolean }

async function llamar(e: Endpoint, via: Via): Promise<Resultado> {
  const mod = await e.cargar();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (via === 'llave') headers.authorization = 'Bearer lk_live_sintetica';
  else {
    // La cookie escribe solo desde nuestro sitio: se simula el origen propio para que la puerta del perfil sea la que decida.
    headers.origin = 'https://app.likida.ai';
    headers['sec-fetch-site'] = 'same-origin';
  }
  const cuerpo = e.metodo === 'GET' || e.metodo === 'DELETE' ? undefined : '{}';
  const req = new Request(`https://app.likida.ai${e.pathname}`, { method: e.metodo, headers, body: cuerpo });
  try {
    const r = await (mod[e.metodo] as Manejador)(req, { params: Promise.resolve({ id: UUID }) });
    const texto = await r.text();
    return { status: r.status, porPerfil: r.status === 403 && texto.includes(MOTIVO_PERFIL_API), cuerpo: texto, lanzo: false };
  } catch {
    // Una ruta permitida que revienta contra la base falsa SÍ pasó la puerta del perfil (ahí no lanza nada).
    return { status: 0, porPerfil: false, cuerpo: '', lanzo: true };
  }
}

const negosPorPerfil = () => logWarn.mock.calls.filter(([m]) => m === 'perfil_tenant.api_negada').length;
const lecturasDeDatos = () => tablasLeidas.filter((t) => t !== 'tenant_perfil');

beforeEach(() => {
  reiniciarCachePerfil();
  perfiles.clear();
  perfiles.set(CON, 'cinco_agentes');
  tablaPerfilAusente = false;
  tablasLeidas.length = 0;
  escrituras.length = 0;
  logWarn.mockClear();
  redirect.mockClear();
  tenantDeLlave = CON;
  areaDeLlave = 'administracion';
  sesion = null;
});

// ═══════════════════════════════════════════════════════════════════════════
// 0) El inventario no se queda atrás
// ═══════════════════════════════════════════════════════════════════════════
describe('(0) el inventario de rutas está clasificado a mano', () => {
  it('se encontraron las rutas esperadas (si el glob falla, la prueba no probaría nada)', () => {
    expect(RUTAS.filter((r) => r.raiz === 'v1').length).toBeGreaterThanOrEqual(13);
    expect(RUTAS.filter((r) => r.raiz === 'export').length).toBe(13);
    expect(V1.length).toBeGreaterThanOrEqual(25);
    expect(EXPORT.length).toBe(13);
  });

  it('cada recurso de /v1 y /export está en una de las listas de esta prueba (una ruta nueva sin clasificar la pone en rojo)', () => {
    const conocidos = {
      v1: [...V1_PERMITIDOS, ...V1_VIVOS_POR_DECIDIR, ...V1_STAND_BY],
      export: [...EXPORT_PERMITIDOS, ...EXPORT_VIVOS_POR_DECIDIR, ...EXPORT_STAND_BY],
    };
    const sinClasificar = RUTAS.filter((r) => !conocidos[r.raiz].includes(r.recurso)).map((r) => `${r.raiz}/${r.recurso}`);
    expect(sinClasificar).toEqual([]);
  });

  it('la lista de esta prueba coincide con la del producto en los dos sentidos', () => {
    for (const r of RUTAS) {
      expect(apiPermitidaEnPerfil('cinco_agentes', r.pathname), `${r.raiz}/${r.recurso}`).toBe(viveBajoPerfil(r.raiz, r.recurso));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 1) /v1 por LLAVE de área `administracion` (la que «ve todo»)
// ═══════════════════════════════════════════════════════════════════════════
describe('(1) /v1 con llave `administracion`: recurso × perfil', () => {
  it.each(V1.map((e) => [`${e.metodo} ${e.pathname}`, e] as const))('CON perfil · %s', async (_n, e) => {
    const r = await llamar(e, 'llave');
    if (viveBajoPerfil('v1', e.recurso)) {
      expect(r.porPerfil, `${e.pathname} vivo bajo el perfil no debe negarse por perfil`).toBe(false);
      expect(negosPorPerfil()).toBe(0);
    } else {
      expect(r.status).toBe(403);
      expect(r.porPerfil).toBe(true);
      expect(JSON.parse(r.cuerpo).error.codigo).toBe('sin_permiso');
      expect(JSON.parse(r.cuerpo).error.mensaje).toBe(MOTIVO_PERFIL_API);
      expect(lecturasDeDatos(), 'una ruta negada no toca ninguna tabla de datos').toEqual([]);
      expect(escrituras, 'ni escribe').toEqual([]);
    }
  });

  it.each(V1.map((e) => [`${e.metodo} ${e.pathname}`, e] as const))('SIN perfil · %s: ningún rechazo por perfil', async (_n, e) => {
    tenantDeLlave = SIN;
    const r = await llamar(e, 'llave');
    expect(r.porPerfil).toBe(false);
    expect(negosPorPerfil()).toBe(0);
  });

  it('el par «sin perfil» es idéntico al de hoy: mismos estados que con la tabla de perfiles AUSENTE (antes de la 0770)', async () => {
    tenantDeLlave = SIN;
    const sinFila: Record<string, number> = {};
    for (const e of V1) { reiniciarCachePerfil(); sinFila[`${e.metodo} ${e.pathname}`] = (await llamar(e, 'llave')).status; }
    tablaPerfilAusente = true;
    const sinTabla: Record<string, number> = {};
    for (const e of V1) { reiniciarCachePerfil(); sinTabla[`${e.metodo} ${e.pathname}`] = (await llamar(e, 'llave')).status; }
    expect(sinFila).toEqual(sinTabla);
  });

  it('una llave de área menor sigue siendo menor: con perfil NO sube de nivel por pasar la puerta', async () => {
    areaDeLlave = 'operacion';
    const dinero = V1.find((e) => e.pathname === '/api/v1/liquidaciones' && e.metodo === 'GET')!;
    const r = await llamar(dinero, 'llave');
    expect(r.status).toBe(403);
    expect(r.porPerfil, 'el rechazo es por el área de la llave, no por el perfil').toBe(false);
  });

  it('una llave emitida ANTES del perfil (mismo tenant) queda recortada en cuanto el perfil se aplica, sin reemitirla', async () => {
    tenantDeLlave = CON;
    perfiles.delete(CON);
    reiniciarCachePerfil();
    const clientes = V1.find((e) => e.pathname === '/api/v1/clientes')!;
    expect((await llamar(clientes, 'llave')).porPerfil).toBe(false); // antes: abierta como siempre
    perfiles.set(CON, 'cinco_agentes');
    reiniciarCachePerfil(); // (en producción vence el TTL de 30 s)
    const despues = await llamar(clientes, 'llave');
    expect(despues.status).toBe(403);
    expect(despues.porPerfil).toBe(true);
  });

  it('el `?tenant=` no cambia de flota ni esquiva el perfil', async () => {
    const e = V1.find((x) => x.pathname === '/api/v1/clientes')!;
    const mod = await e.cargar();
    const r = await (mod.GET as Manejador)(
      new Request(`https://app.likida.ai${e.pathname}?tenant=${SIN}`, { headers: { authorization: 'Bearer lk_live_sintetica' } }),
      { params: Promise.resolve({}) },
    );
    expect(r.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2) /v1 y /api/export/* por SESIÓN del panel (cookie)
// ═══════════════════════════════════════════════════════════════════════════
describe('(2) por cookie de flota_admin: /v1 (lecturas) y /api/export/*', () => {
  const V1_GET = V1.filter((e) => e.metodo === 'GET');

  it.each(V1_GET.map((e) => [e.pathname, e] as const))('v1 · CON perfil · GET %s', async (_n, e) => {
    sesion = comoDueno(CON);
    const r = await llamar(e, 'cookie');
    if (viveBajoPerfil('v1', e.recurso)) expect(r.porPerfil).toBe(false);
    else {
      expect(r.status).toBe(403);
      expect(r.porPerfil).toBe(true);
      expect(lecturasDeDatos()).toEqual([]);
    }
  });

  it.each(EXPORT.map((e) => [e.pathname, e] as const))('export · CON perfil · %s', async (_n, e) => {
    sesion = comoDueno(CON);
    const r = await llamar(e, 'cookie');
    if (viveBajoPerfil('export', e.recurso)) {
      expect(r.porPerfil, `${e.pathname} vivo bajo el perfil no debe negarse por perfil`).toBe(false);
      expect(negosPorPerfil()).toBe(0);
    } else {
      expect(r.status).toBe(403);
      expect(r.cuerpo).toBe(MOTIVO_PERFIL_API);
      expect(lecturasDeDatos(), 'el export negado no lee datos').toEqual([]);
    }
  });

  it.each(EXPORT.map((e) => [e.pathname, e] as const))('export · SIN perfil · %s: nada se niega por perfil', async (_n, e) => {
    sesion = comoDueno(SIN);
    const r = await llamar(e, 'cookie');
    expect(r.porPerfil).toBe(false);
    expect(negosPorPerfil()).toBe(0);
  });

  it('export: el par «sin perfil» es idéntico con la tabla de perfiles ausente', async () => {
    sesion = comoDueno(SIN);
    const a: Record<string, number> = {};
    for (const e of EXPORT) { reiniciarCachePerfil(); a[e.pathname] = (await llamar(e, 'cookie')).status; }
    tablaPerfilAusente = true;
    const b: Record<string, number> = {};
    for (const e of EXPORT) { reiniciarCachePerfil(); b[e.pathname] = (await llamar(e, 'cookie')).status; }
    expect(a).toEqual(b);
  });

  it('un superadmin pidiendo `?tenant=` de la flota con perfil tampoco abre un export de stand-by', async () => {
    sesion = { ...comoDueno(SIN), rol: 'superadmin' };
    const e = EXPORT.find((x) => x.recurso === 'poliza')!;
    const mod = await e.cargar();
    const r = await (mod.GET as Manejador)(new Request(`https://app.likida.ai${e.pathname}?tenant=${UUID}`), { params: Promise.resolve({}) });
    // El tenant efectivo del superadmin aquí es el suyo (sin perfil); lo que se fija es que NO hay un camino que ignore el perfil de la flota efectiva.
    expect(r.status === 403 ? await r.text() : MOTIVO_PERFIL_API).toBe(MOTIVO_PERFIL_API);
  });

  it('anónimo: 401 en export y /v1, con y sin perfil de por medio (nunca datos)', async () => {
    sesion = null;
    for (const e of [...EXPORT, ...V1.filter((x) => x.metodo === 'GET')]) {
      const r = await llamar(e, 'cookie');
      expect([401, 403], e.pathname).toContain(r.status);
    }
    expect(lecturasDeDatos()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3) openapi: no anuncia lo que el perfil niega
// ═══════════════════════════════════════════════════════════════════════════
describe('(3) /v1/openapi bajo el perfil', () => {
  async function documento(headers: Record<string, string> = {}) {
    const { GET } = await import('./v1/openapi/route');
    const r = await GET(new Request('https://app.likida.ai/api/v1/openapi', { headers }));
    return { r, doc: (await r.json()) as { paths: Record<string, unknown> } };
  }
  const primerSegmento = (p: string) => p.replace(/^\/v1\//, '').split('/')[0];

  it('con llave de una flota con perfil: solo rutas permitidas (más el propio documento) y sin cache público', async () => {
    const { r, doc } = await documento({ authorization: 'Bearer lk_live_sintetica' });
    const rutas = Object.keys(doc.paths);
    expect(rutas.length).toBeGreaterThan(5);
    for (const p of rutas) {
      const seg = primerSegmento(p);
      expect(seg === 'openapi' || [...V1_PERMITIDOS, ...V1_VIVOS_POR_DECIDIR].includes(seg), `${p} no debería anunciarse bajo el perfil`).toBe(true);
    }
    expect(rutas.some((p) => p.startsWith('/v1/clientes'))).toBe(false);
    expect(r.headers.get('cache-control')).toMatch(/private|no-store/);
  });

  it('con sesión de una flota con perfil: igual de recortado', async () => {
    sesion = comoDueno(CON);
    const { doc } = await documento();
    expect(Object.keys(doc.paths).some((p) => p.startsWith('/v1/clientes'))).toBe(false);
  });

  it('con llave de una flota SIN perfil, o anónimo: el documento completo de siempre (cache público incluido)', async () => {
    tenantDeLlave = SIN;
    const conLlave = await documento({ authorization: 'Bearer lk_live_sintetica' });
    expect(Object.keys(conLlave.doc.paths)).toContain('/v1/clientes');
    expect(conLlave.r.headers.get('cache-control')).toMatch(/public/);
    const anonimo = await documento();
    expect(Object.keys(anonimo.doc.paths)).toContain('/v1/clientes');
    expect(Object.keys(anonimo.doc.paths)).toEqual(Object.keys(conLlave.doc.paths));
  });

  it('el recorte solo QUITA: lo que queda es un subconjunto exacto del documento completo', async () => {
    const completo = await documento();
    tenantDeLlave = CON;
    const recortado = await documento({ authorization: 'Bearer lk_live_sintetica' });
    for (const [p, def] of Object.entries(recortado.doc.paths)) expect(def).toEqual(completo.doc.paths[p]);
    expect(Object.keys(recortado.doc.paths).length).toBeLessThan(Object.keys(completo.doc.paths).length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4) Emisión de llaves y puertas de usuarios/sesiones MCP
// ═══════════════════════════════════════════════════════════════════════════
describe('(4) emisión de llaves de API y de sesiones MCP bajo el perfil', () => {
  it('llaves-api, sesiones-mcp y usuarios están fuera de la lista del perfil y el dueño no los ve', () => {
    for (const ruta of ['/dashboard/llaves-api', '/dashboard/sesiones-mcp', '/dashboard/usuarios']) {
      expect(rutaPermitidaEnPerfil('cinco_agentes', ruta), ruta).toBe(false);
      expect(puedeVerRuta('flota_admin', ruta, 'cinco_agentes'), `${ruta} oculto al dueño bajo el perfil`).toBe(false);
      expect(puedeVerRuta('flota_admin', ruta), `${ruta} sin perfil se ve como siempre`).toBe(true);
    }
  });

  it('el formulario abierto ANTES del perfil: emitir una llave después del perfil rebota a /dashboard y no escribe en tenant_api_key', async () => {
    sesion = comoDueno(CON);
    perfiles.delete(CON);
    reiniciarCachePerfil();
    const Pagina = (await import('@/app/dashboard/llaves-api/page')).default as (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    const arbol = await Pagina({ searchParams: Promise.resolve({}) });
    const acciones = accionesDe(arbol);
    expect(acciones.length, 'la página entrega sus server actions').toBeGreaterThanOrEqual(2);

    // Control: SIN perfil, emitir llega a crear la llave (la base es falsa: no hay llave real).
    escrituras.length = 0;
    const fd = new FormData();
    fd.set('nombre', 'integracion sintetica'); fd.set('area', 'operacion'); fd.set('vigencia', '365'); fd.set('id', UUID);
    for (const a of acciones) { try { await (a.length >= 2 ? a(null, fd) : a(fd)); } catch { /* redirect o error de la base falsa */ } }
    expect(redirect.mock.calls.filter(([r]) => r === '/dashboard'), 'sin perfil nada rebota por perfil').toEqual([]);
    expect(escrituras.some((w) => w.startsWith('tenant_api_key')), 'sin perfil la emisión llega a la tabla de llaves').toBe(true);

    // Con el perfil aplicado: cada acción rebota y no hay una sola escritura.
    perfiles.set(CON, 'cinco_agentes');
    reiniciarCachePerfil();
    escrituras.length = 0;
    redirect.mockClear();
    for (const a of acciones) {
      await expect(a.length >= 2 ? a(null, fd) : a(fd)).rejects.toThrow('NEXT_REDIRECT');
    }
    expect(redirect.mock.calls.every(([r]) => r === '/dashboard')).toBe(true);
    expect(escrituras, 'emitir ni revocar llaves escribe nada bajo el perfil').toEqual([]);
  });

  it('las sesiones MCP: sus acciones rebotan igual y el MCP mismo no atiende (la credencial emitida antes tampoco sirve)', async () => {
    sesion = comoDueno(CON);
    perfiles.delete(CON);
    reiniciarCachePerfil();
    const Pagina = (await import('@/app/dashboard/sesiones-mcp/page')).default as (p: { searchParams: Promise<Record<string, string>> }) => Promise<unknown>;
    const acciones = accionesDe(await Pagina({ searchParams: Promise.resolve({}) }));
    expect(acciones.length).toBeGreaterThanOrEqual(1);
    perfiles.set(CON, 'cinco_agentes');
    reiniciarCachePerfil();
    escrituras.length = 0;
    const fd = new FormData();
    fd.set('id', UUID); fd.set('nombre', 'sesion sintetica');
    for (const a of acciones) await expect(a.length >= 2 ? a(null, fd) : a(fd)).rejects.toThrow('NEXT_REDIRECT');
    expect(escrituras).toEqual([]);
  });
});

type Accion = (...args: unknown[]) => Promise<unknown>;
/** Toda función ASYNC que la página entrega como prop (las server actions). */
function accionesDe(nodo: unknown, salida: Accion[] = [], visto = new Set<unknown>()): Accion[] {
  if (nodo === null || (typeof nodo !== 'object' && typeof nodo !== 'function')) return salida;
  if (visto.has(nodo)) return salida;
  visto.add(nodo);
  if (typeof nodo === 'function') {
    if (nodo.constructor.name === 'AsyncFunction') salida.push(nodo as Accion);
    return salida;
  }
  if (Array.isArray(nodo)) { for (const x of nodo) accionesDe(x, salida, visto); return salida; }
  const props = (nodo as { props?: Record<string, unknown> }).props;
  for (const v of Object.values(props ?? (nodo as Record<string, unknown>))) accionesDe(v, salida, visto);
  return salida;
}
