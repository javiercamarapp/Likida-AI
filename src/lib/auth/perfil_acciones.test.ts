/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidElement } from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-03 · PRUEBAS DE FUGA DE LAS SERVER ACTIONS BAJO EL PERFIL `cinco_agentes`.
//
// Una server action es un POST invocable por quien conozca su id, con o sin la
// página: redirigir la página NO la cierra. Esta prueba cubre lo que
// `src/app/dashboard/perfil_acciones.test.ts` (escaneo de /dashboard, clase y
// ruta de cada puerta) no cubre:
//
//  (a) ESCANEO COMPLETO de src/app/{dashboard,admin,vendedor}: toda directiva
//      `'use server'` real aparece clasificada. /dashboard se cierra con el
//      perfil; /admin y /vendedor son de OTRO rol (superadmin / vendedor) y se
//      cierran con su propia puerta — un archivo nuevo sin clasificar rompe.
//  (b) EJECUCIÓN: diez pantallas en stand-by se renderizan ANTES del perfil
//      (así nace el formulario que el navegador deja abierto), el perfil se
//      aplica DESPUÉS, y cada acción que la página entregó se invoca como un
//      POST tardío: debe rechazar (redirect a /dashboard) SIN un solo
//      insert/update/delete/upsert/rpc. El control sin perfil prueba que la
//      invocación sí llega a la lógica (si no, el rechazo no probaría nada).
//
// Lo único falso es la sesión y la base; el perfil y las puertas son los reales.
// ═══════════════════════════════════════════════════════════════════════════

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
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const getSessionTenant = vi.fn();
vi.mock('@/lib/auth/session', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getSessionTenant: (...a: unknown[]) => getSessionTenant(...a),
}));
vi.mock('@/lib/auth/admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('@/lib/auth/superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => 'ok' }));

// ── Base falsa: registra TODA escritura; las lecturas devuelven vacío salvo el perfil ──
const perfiles = new Map<string, string>();
const escrituras: string[] = [];
const VERBOS_ESCRITURA = new Set(['insert', 'update', 'delete', 'upsert', 'rpc']);

function baseFalsa(tabla = ''): unknown {
  let id: string | null = null;
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop: string) {
      if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
      if (prop === 'maybeSingle' || prop === 'single') {
        return async () => {
          if (tabla === 'tenant_perfil') return { data: perfiles.has(id ?? '') ? { perfil: perfiles.get(id!) } : null, error: null };
          if (tabla === 'tenant') return { data: { id, nombre: 'Flota Sintetica', plan: 'demo' }, error: null };
          return { data: null, error: null };
        };
      }
      return (...args: unknown[]) => {
        if (VERBOS_ESCRITURA.has(prop)) escrituras.push(`${tabla}.${prop}`);
        if (prop === 'from') return baseFalsa(String(args[0]));
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

const { reiniciarCachePerfil } = await import('./perfil_tenant');
const { rutaPermitidaEnPerfil } = await import('./visibilidad');

const CON = 'tenant-sintetico-con-perfil';
const dueno = (tenantId: string) => ({ userId: 'u1', tenantId, rol: 'flota_admin', nombre: 'Persona Sintetica', operadorId: null, avatarUrl: null });

// ═══════════════════════════════════════════════════════════════════════════
// (a) ESCANEO
// ═══════════════════════════════════════════════════════════════════════════

type Clase = 'perfil_permitido' | 'perfil_standby' | 'perfil_sin_datos' | 'consola_superadmin' | 'zona_vendedor' | 'sin_datos';

const SRC = join(process.cwd(), 'src/app');
const ZONAS = ['dashboard', 'admin', 'vendedor'] as const;

/** Directiva REAL: sentencia `'use server'` en una línea propia (no un comentario que la mencione). */
const DIRECTIVA = /^[ \t]*['"]use server['"];?[ \t]*$/m;

function archivos(dir: string, salida: string[] = []): string[] {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivos(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\./.test(nombre) && DIRECTIVA.test(readFileSync(ruta, 'utf8'))) salida.push(relative(SRC, ruta));
  }
  return salida;
}

const ENCONTRADOS = ZONAS.flatMap((z) => archivos(join(SRC, z))).sort();

/**
 * /dashboard: la clase de cada archivo la fija perfil_acciones.test.ts (junto a
 * la pantalla) y aquí se DERIVA de la ruta que el archivo pasa a su puerta, para
 * no duplicar la lista: se exige que sea coherente con el perfil real.
 */
const PUERTA_DASHBOARD = /\b(resolverTenantEfectivo|requireSessionTenant|exigirVerRuta)\(\s*([^,)]+)/g;
const PUERTA_SUPERADMIN = /\b(requireSuperadmin|ejecutarComoSuperadmin)\b/;
const PUERTA_VENDEDOR = /\b(requireVendedor|ejecutarComoVendedor)\b/;

/** Archivos que cierran SOLO la sesión de quien los invoca; no leen ni escriben datos de ninguna flota. */
const SIN_DATOS = new Set(['dashboard/layout.tsx', 'admin/layout.tsx', 'vendedor/layout.tsx']);

function clasificar(a: string): Clase {
  if (SIN_DATOS.has(a)) return 'sin_datos';
  const fuente = readFileSync(join(SRC, a), 'utf8');
  if (a.startsWith('admin/')) return PUERTA_SUPERADMIN.test(fuente) ? 'consola_superadmin' : 'perfil_sin_datos';
  if (a.startsWith('vendedor/')) return PUERTA_VENDEDOR.test(fuente) ? 'zona_vendedor' : 'perfil_sin_datos';
  const consts = new Map<string, string>();
  for (const m of fuente.matchAll(/const (RUTA\w*)\s*=\s*['"`]([^'"`]+)['"`]/g)) consts.set(m[1], m[2]);
  const rutas: string[] = [];
  for (const m of fuente.matchAll(PUERTA_DASHBOARD)) {
    const arg = m[2].trim();
    if (consts.has(arg)) rutas.push(consts.get(arg)!);
    else if (/^['"`]/.test(arg)) rutas.push(arg.slice(1, -1).replace(/\$\{[^}]+\}/g, '0f8fad5b-d9cb-469f-a165-70867728950e'));
  }
  if (rutas.length === 0) return 'perfil_sin_datos';
  const permitidas = rutas.map((r) => rutaPermitidaEnPerfil('cinco_agentes', r));
  if (permitidas.every(Boolean)) return 'perfil_permitido';
  if (permitidas.every((p) => !p)) return 'perfil_standby';
  return 'perfil_sin_datos'; // mezcla: lo atrapa la prueba de coherencia
}

/** Clasificación MANUAL de /admin y /vendedor (no dependen del perfil de flota: otro rol, otra puerta). */
const FUERA_DEL_PERFIL: Record<string, Clase> = {
  'admin/layout.tsx': 'sin_datos',
  'vendedor/layout.tsx': 'sin_datos',
  'admin/agentes/[id]/insumos/page.tsx': 'consola_superadmin',
  'admin/agentes/page.tsx': 'consola_superadmin',
  'admin/aprobaciones/page.tsx': 'consola_superadmin',
  'admin/compliance/page.tsx': 'consola_superadmin',
  'admin/costos-facturacion/page.tsx': 'consola_superadmin',
  'admin/crecimiento/acciones.ts': 'consola_superadmin',
  'admin/elegir-flota/page.tsx': 'consola_superadmin',
  'admin/evals/page.tsx': 'consola_superadmin',
  'admin/flotas/[id]/page.tsx': 'consola_superadmin',
  'admin/flotas/page.tsx': 'consola_superadmin',
  'admin/mapa-prospectos/acciones-exportar.ts': 'consola_superadmin',
  'admin/marketing/page.tsx': 'consola_superadmin',
  'admin/mcp-clientes/page.tsx': 'consola_superadmin',
  'admin/mi-perfil/page.tsx': 'consola_superadmin',
  'admin/observabilidad/page.tsx': 'consola_superadmin',
  'admin/soporte/page.tsx': 'consola_superadmin',
  'admin/techo-ia/acciones.ts': 'consola_superadmin',
  'admin/tu-turno/page.tsx': 'consola_superadmin',
  'admin/usuarios/nuevo/page.tsx': 'consola_superadmin',
  'admin/vendedores/acciones.ts': 'consola_superadmin',
  'vendedor/panel-vendedor.tsx': 'zona_vendedor',
};

describe('(a) escaneo de las server actions de dashboard, admin y vendedor', () => {
  it('hay archivos que revisar (la prueba no se salta en silencio)', () => {
    expect(ENCONTRADOS.filter((a) => a.startsWith('dashboard/')).length).toBeGreaterThanOrEqual(58);
    expect(ENCONTRADOS.filter((a) => a.startsWith('admin/')).length).toBeGreaterThan(0);
    expect(ENCONTRADOS.filter((a) => a.startsWith('vendedor/')).length).toBeGreaterThan(0);
  });

  it('TODO archivo de admin/vendedor con la directiva está clasificado, y la lista no apunta a archivos que ya no existen', () => {
    const ajenos = ENCONTRADOS.filter((a) => !a.startsWith('dashboard/'));
    expect(ajenos.filter((a) => !(a in FUERA_DEL_PERFIL))).toEqual([]);
    expect(Object.keys(FUERA_DEL_PERFIL).filter((a) => !ajenos.includes(a))).toEqual([]);
  });

  it.each(ENCONTRADOS.filter((a) => a.startsWith('dashboard/')))('%s: llama a una puerta de /dashboard cuyo veredicto del perfil es coherente (no mezcla permitida y stand-by)', (a) => {
    const clase = clasificar(a);
    if (SIN_DATOS.has(a)) return expect(clase).toBe('sin_datos');
    // El aviso por agente gatea con la ruta del agente (argumento dinámico `objetivo.ruta`): no hay literal que clasificar aquí;
    // perfil_acciones.test.ts de /dashboard exige ese argumento exacto y el catálogo de agentes lo cubre.
    if (a === 'dashboard/agentes/seccion-notificaciones.tsx') return expect(readFileSync(join(SRC, a), 'utf8')).toMatch(/requireSessionTenant\(\s*objetivo\.ruta/);
    expect(['perfil_permitido', 'perfil_standby']).toContain(clase);
  });

  it.each(ENCONTRADOS.filter((a) => a in FUERA_DEL_PERFIL))('%s: la puerta del archivo es la de su rol, no la del perfil de flota', (a) => {
    expect(clasificar(a)).toBe(FUERA_DEL_PERFIL[a]);
  });

  it('ninguna acción de admin/vendedor deja pasar a un flota_admin: las puertas lo mandan a /dashboard o a su casa', async () => {
    const { requireSuperadmin, requireVendedor } = await import('./guard');
    for (const rol of ['flota_admin', 'contador', 'encargado']) {
      getSessionTenant.mockResolvedValue({ ...dueno(CON), rol });
      redirect.mockClear();
      await expect(requireSuperadmin()).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledWith('/dashboard');
      redirect.mockClear();
      await expect(requireVendedor()).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledTimes(1);
      expect(redirect.mock.calls[0][0]).not.toMatch(/^\/(admin|vendedor)/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// (b) EJECUCIÓN: diez pantallas en stand-by, POST tardío con el perfil ya aplicado
// ═══════════════════════════════════════════════════════════════════════════

type Pagina = (props: { searchParams: Promise<Record<string, string>>; params?: Promise<Record<string, string>> }) => Promise<unknown>;

const STAND_BY: { nombre: string; ruta: string; cargar: () => Promise<{ default: Pagina }> }[] = [
  { nombre: 'facturación', ruta: '/dashboard/facturacion', cargar: () => import('@/app/dashboard/facturacion/page') as never },
  { nombre: 'cobranza', ruta: '/dashboard/agentes/cobranza', cargar: () => import('@/app/dashboard/agentes/cobranza/page') as never },
  { nombre: 'proveedores', ruta: '/dashboard/agentes/proveedores', cargar: () => import('@/app/dashboard/agentes/proveedores/page') as never },
  { nombre: 'llaves-api', ruta: '/dashboard/llaves-api', cargar: () => import('@/app/dashboard/llaves-api/page') as never },
  { nombre: 'usuarios', ruta: '/dashboard/usuarios', cargar: () => import('@/app/dashboard/usuarios/page') as never },
  { nombre: 'sesiones-mcp', ruta: '/dashboard/sesiones-mcp', cargar: () => import('@/app/dashboard/sesiones-mcp/page') as never },
  { nombre: 'reglas', ruta: '/dashboard/reglas', cargar: () => import('@/app/dashboard/reglas/page') as never },
  { nombre: 'clientes', ruta: '/dashboard/clientes', cargar: () => import('@/app/dashboard/clientes/page') as never },
  { nombre: 'convenios', ruta: '/dashboard/convenios', cargar: () => import('@/app/dashboard/convenios/page') as never },
  { nombre: 'cotizaciones', ruta: '/dashboard/cotizaciones', cargar: () => import('@/app/dashboard/cotizaciones/page') as never },
];

type Accion = (...args: unknown[]) => Promise<unknown>;

/** Toda función ASYNC que la página entrega como prop (las server actions); recorre elementos, objetos y arreglos. */
function accionesDe(nodo: unknown, salida = new Set<Accion>(), visto = new Set<unknown>()): Set<Accion> {
  if (nodo === null || typeof nodo !== 'object' && typeof nodo !== 'function') return salida;
  if (visto.has(nodo)) return salida;
  visto.add(nodo);
  if (typeof nodo === 'function') {
    if (nodo.constructor.name === 'AsyncFunction') salida.add(nodo as Accion);
    return salida;
  }
  if (Array.isArray(nodo)) { for (const x of nodo) accionesDe(x, salida, visto); return salida; }
  if (isValidElement(nodo)) {
    for (const v of Object.values(nodo.props as Record<string, unknown>)) accionesDe(v, salida, visto);
    return salida;
  }
  for (const v of Object.values(nodo as Record<string, unknown>)) accionesDe(v, salida, visto);
  return salida;
}

const SP = { searchParams: Promise.resolve({}), params: Promise.resolve({}) };

/** Invoca una acción con la forma que declara (`(estado, formData)` o `(formData)`), como lo haría el navegador. */
async function invocar(a: Accion): Promise<'redirect' | 'devolvio' | 'otro_error'> {
  const fd = new FormData();
  fd.set('id', '0f8fad5b-d9cb-469f-a165-70867728950e');
  try {
    if (a.length >= 2) await a(null, fd);
    else if (a.length === 1) await a(fd);
    else await a();
    return 'devolvio';
  } catch (e) {
    return (e as Error).message === 'NEXT_REDIRECT' ? 'redirect' : 'otro_error';
  }
}

beforeEach(() => {
  reiniciarCachePerfil();
  perfiles.clear();
  escrituras.length = 0;
  redirect.mockClear();
  getSessionTenant.mockReset();
  getSessionTenant.mockResolvedValue(dueno(CON));
});

describe.each(STAND_BY)('(b) $nombre ($ruta): las acciones que entregó la página, con el perfil ya aplicado', ({ ruta, cargar }) => {
  it('la ruta de la pantalla está en stand-by del perfil (la muestra es de verdad de stand-by)', () => {
    expect(rutaPermitidaEnPerfil('cinco_agentes', ruta)).toBe(false);
  });

  it('rechaza cada acción con redirect a /dashboard y SIN una sola escritura; sin perfil la misma invocación sí entra a la lógica', async () => {
    const Pagina = (await cargar()).default;

    // 1) La pantalla nace SIN perfil (formulario abierto en el navegador).
    const arbol = await Pagina(SP);
    const acciones = [...accionesDe(arbol)];
    console.info(`[T-PER-03] ${ruta}: ${acciones.length} acciones entregadas`);
    expect(acciones.length, `la página ${ruta} no entregó ninguna server action: la prueba no probaría nada`).toBeGreaterThan(0);

    // Control: sin perfil, ninguna invocación se rechaza POR EL PERFIL.
    redirect.mockClear();
    for (const a of acciones) await invocar(a);
    expect(redirect.mock.calls.filter(([r]) => r === '/dashboard'), 'sin perfil no debe haber rechazo por perfil').toEqual([]);

    // 2) Se aplica el perfil (30 s de TTL en producción; aquí se reinicia la caché).
    perfiles.set(CON, 'cinco_agentes');
    reiniciarCachePerfil();
    escrituras.length = 0;
    redirect.mockClear();

    // 3) POST tardío de CADA acción.
    for (const a of acciones) {
      const resultado = await invocar(a);
      expect(resultado, `una acción de ${ruta} no rechazó bajo el perfil`).toBe('redirect');
    }
    expect(redirect.mock.calls.every(([r]) => r === '/dashboard')).toBe(true);
    expect(escrituras, 'ninguna acción bajo el perfil toca insert/update/delete/upsert/rpc').toEqual([]);
  });
});

describe('(b) una acción exportada de un módulo de stand-by (importada tal cual) y la muestra completa', () => {
  it('facturas/acciones-control rechaza sin escribir bajo el perfil', async () => {
    const acciones = await import('@/app/dashboard/agentes/facturas/acciones-control');
    perfiles.set(CON, 'cinco_agentes');
    reiniciarCachePerfil();
    for (const nombre of Object.keys(acciones).filter((k) => typeof (acciones as Record<string, unknown>)[k] === 'function')) {
      expect(await invocar((acciones as unknown as Record<string, Accion>)[nombre]), nombre).toBe('redirect');
    }
    expect(escrituras).toEqual([]);
  });

  it('la muestra son 10 pantallas distintas, todas de stand-by', () => {
    expect(new Set(STAND_BY.map((p) => p.ruta)).size).toBe(10);
  });
});
