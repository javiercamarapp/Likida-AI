/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-02 · FUGAS POR PÁGINA bajo el perfil `cinco_agentes`.
//
// (a) CADA `page.tsx` de /dashboard (las 68, enumeradas del disco) se prueba
//     por tabla: la ruta con la que la página llama a su puerta
//     (`resolverTenantEfectivo` / `requireSessionTenant`) se EXTRAE de su
//     propio código fuente, no de una lista escrita a mano. Se exige que
//       1. esa ruta de puerta sea la de la página (o su padre, en las dinámicas),
//       2. bajo el perfil, la puerta rebote a /dashboard si la página no está
//          permitida y abra si sí lo está,
//       3. SIN perfil la misma puerta abra para el dueño (el par de control:
//          sin perfil nada cambia).
// (b) La paleta ⌘K (`TODAS_LAS_RUTAS`) y `inicioDe`.
//
// Nada de nombres reales: la sesión y la tabla son sintéticas.
// ═══════════════════════════════════════════════════════════════════════════

const redirect = vi.fn((_: string) => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/navigation', () => ({ redirect: (a: string) => redirect(a) }));

const getSessionTenant = vi.fn();
vi.mock('./session', () => ({ getSessionTenant: (...a: unknown[]) => getSessionTenant(...a) }));
vi.mock('./admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('./mfa', async (orig) => ({ ...(await orig<Record<string, unknown>>()), mfaSuperadminObligatorio: () => false }));
vi.mock('./superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => 'ok' }));

const perfiles = new Map<string, string>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let id: string | null = null;
      b.select = () => b;
      b.eq = (_c: string, v: string) => { id = v; return b; };
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') return { data: perfiles.has(id ?? '') ? { perfil: perfiles.get(id!) } : null, error: null };
        if (tabla === 'tenant') return { data: { id, nombre: 'Flota' }, error: null };
        return { data: null, error: null };
      };
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => {} }));

const { resolverTenantEfectivo } = await import('./tenant-efectivo');
const { requireSessionTenant } = await import('./guard');
const { reiniciarCachePerfil } = await import('./perfil_tenant');
const { rutaPermitidaEnPerfil, rutaProximamenteEnPerfil, moduloProximamenteDeRuta, rutaProximamente, puedeVerRuta, inicioDe, areaDeRuta, RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES } =
  await import('./visibilidad');
const { TODAS_LAS_RUTAS } = await import('../../app/dashboard/rutas');

type ModuloPerfil = Parameters<typeof import('./visibilidad').rutaProximamente>[0];
const RAIZ = process.cwd();
const CON = 'tenant-con-perfil';
const SIN = 'tenant-sin-perfil';
const sesion = (tenantId: string, rol = 'flota_admin') => ({ userId: 'u1', tenantId, rol, nombre: 'Ana', operadorId: null, avatarUrl: null });

beforeEach(() => {
  reiniciarCachePerfil();
  perfiles.clear();
  perfiles.set(CON, 'cinco_agentes');
  redirect.mockClear();
  getSessionTenant.mockReset();
});

// ── Enumeración desde el disco ──────────────────────────────────────────────
function paginas(dir = 'src/app/dashboard', salida: string[] = []): string[] {
  for (const n of readdirSync(join(RAIZ, dir))) {
    const rel = join(dir, n);
    if (statSync(join(RAIZ, rel)).isDirectory()) paginas(rel, salida);
    else if (n === 'page.tsx') salida.push(rel);
  }
  return salida;
}

/** Ruta de URL de una página: src/app/dashboard/agentes/peajes/page.tsx → /dashboard/agentes/peajes. */
const rutaDe = (archivo: string) => '/' + relative('src/app', archivo).replace(/\/page\.tsx$/, '');

/**
 * La ruta con la que la página llama a su puerta, leída de su fuente. Resuelve
 * `RUTA` / `RUTA_PADRE` a su `const` y toma el literal directo cuando lo hay;
 * `/dashboard/${id}` (el detalle de liquidación) se pliega a su llave.
 */
function puertaDe(archivo: string): string | 'REDIRECT_PURO' | null {
  const src = readFileSync(join(RAIZ, archivo), 'utf8');
  const m = /(?:resolverTenantEfectivo|requireSessionTenant)\(\s*(RUTA_PADRE|RUTA|'[^']*'|`[^`]*`)/.exec(src);
  if (!m) return /\bredirect\(/.test(src) && !/resolverTenantEfectivo|requireSessionTenant/.test(src) ? 'REDIRECT_PURO' : null;
  const arg = m[1];
  if (arg.startsWith("'")) return arg.slice(1, -1);
  if (arg.startsWith('`')) return arg === '`/dashboard/${id}`' ? '/dashboard/[id]' : null;
  const c = new RegExp(`const ${arg} = '([^']+)'`).exec(src);
  return c ? c[1] : null;
}

const TABLA = paginas().sort().map((archivo) => ({ archivo, ruta: rutaDe(archivo), puerta: puertaDe(archivo) }));
const GATEADAS = TABLA.filter((p) => p.puerta !== 'REDIRECT_PURO');
/** La clave con la que el perfil clasifica la página: su puerta (o la ruta, si la página es la dinámica de liquidación). */
const clave = (p: { puerta: string | null }) => p.puerta as string;
/** Ejemplo concreto de la ruta que la puerta recibe (la dinámica del detalle recibe un uuid real). */
const concreta = (g: string) => (g === '/dashboard/[id]' ? '/dashboard/0f8fad5b-d9cb-469f-a165-70867728950e' : g);
/** La función de puerta que la propia página usa: el detalle de liquidación entra por `requireSessionTenant`, el resto por `resolverTenantEfectivo`. */
const abrirPuerta = (g: string) => (g === '/dashboard/[id]' ? requireSessionTenant(concreta(g)) : resolverTenantEfectivo(g, {}));

describe('(a) las 70 páginas: enumeración y puerta', () => {
  it('hay 70 page.tsx en /dashboard (cuenta independiente del disco) y todas se leen', () => {
    expect(TABLA).toHaveLength(70);
    expect(new Set(TABLA.map((p) => p.archivo)).size).toBe(70);
  });

  it('solo /dashboard/integraciones es un redirect puro (su destino ya gatea); las otras 69 llaman a su puerta', () => {
    expect(TABLA.filter((p) => p.puerta === 'REDIRECT_PURO').map((p) => p.ruta)).toEqual(['/dashboard/integraciones']);
    expect(TABLA.filter((p) => p.puerta === null).map((p) => p.archivo)).toEqual([]);
    expect(GATEADAS).toHaveLength(69);
    const src = readFileSync(join(RAIZ, 'src/app/dashboard/integraciones/page.tsx'), 'utf8');
    expect(src).toContain('/dashboard/conexiones');
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/conexiones')).toBe(true);
  });

  it.each(GATEADAS.map((p) => [p.ruta, p.puerta] as const))('%s: su puerta (%s) es la de la página o la de su padre, nunca una más permisiva de otra pantalla', (ruta, puerta) => {
    const g = puerta as string;
    const ok = g === ruta
      || ruta.startsWith(g + '/')
      || (g === '/dashboard/[id]' && ruta === '/dashboard/[id]');
    expect(ok, `${ruta} gatea con ${g}`).toBe(true);
    // El perfil no puede abrir la página si su puerta está cerrada ni al revés: la clase de la página es la de su puerta.
    expect(rutaPermitidaEnPerfil('cinco_agentes', concreta(g))).toBe(
      g === '/dashboard/[id]' ? true : Object.keys(RUTAS_PERFIL_CINCO_AGENTES).includes(g),
    );
  });
});

describe('(a) bajo el perfil, cada página no permitida rebota y cada permitida abre', () => {
  const permitidas = new Set(Object.keys(RUTAS_PERFIL_CINCO_AGENTES));
  const negadas = GATEADAS.filter((p) => !permitidas.has(clave(p)));
  const permitidasEnLista = GATEADAS.filter((p) => permitidas.has(clave(p)));
  // A4/A5 se encendieron el 18-oct-2026: ya no hay módulo «próximamente», así que las 11 rutas que antes
  // mandaban a esa pantalla ahora abren como cualquier otra permitida.
  const proximamente = permitidasEnLista.filter((p) => rutaProximamenteEnPerfil('cinco_agentes', clave(p)));
  const abiertas = permitidasEnLista.filter((p) => !rutaProximamenteEnPerfil('cinco_agentes', clave(p)));

  it('el reparto es el de la matriz de T-PER-01 con A4/A5 encendidos: 31 negadas, 38 abiertas (ARCO pasó a base: A37-TRANSVERSAL-06) (+2: el catálogo y la configuración del Agente de Carta Porte, A3) y 0 «Próximamente»', () => {
    expect(negadas.length).toBe(31);
    expect(abiertas.length).toBe(38);
    expect(proximamente.length).toBe(0);
    expect(negadas.length + abiertas.length + proximamente.length + 1).toBe(70);
  });

  it.each(negadas.map((p) => [p.ruta, clave(p)] as const))('%s (puerta %s): CON perfil rebota a /dashboard', async (_ruta, puerta) => {
    getSessionTenant.mockResolvedValue(sesion(CON));
    await expect(resolverTenantEfectivo(puerta, {})).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/dashboard');
  });

  it.each(proximamente.map((p) => [p.ruta, clave(p)] as const))('%s (puerta %s): CON perfil manda a su pantalla «Próximamente», sin servir la página real', async (_ruta, puerta) => {
    getSessionTenant.mockResolvedValue(sesion(CON));
    await expect(abrirPuerta(puerta)).rejects.toThrow('NEXT_REDIRECT');
    const modulo = moduloProximamenteDeRuta('cinco_agentes', puerta) as ModuloPerfil;
    expect(redirect).toHaveBeenCalledWith(rutaProximamente(modulo));
  });

  it.each(abiertas.map((p) => [p.ruta, clave(p)] as const))('%s (puerta %s): CON perfil abre para el dueño', async (_ruta, puerta) => {
    getSessionTenant.mockResolvedValue(sesion(CON));
    const r = await abrirPuerta(puerta);
    expect(r.tenantId).toBe(CON);
    expect(redirect).not.toHaveBeenCalled();
  });

  it('las rutas negadas incluyen todo lo de dinero/fiscal/sistema de 12 §3 que tiene página', () => {
    const paginasNegadas = new Set(negadas.map((p) => p.ruta));
    for (const r of RUTAS_STAND_BY_PERFIL_CINCO_AGENTES) {
      const tienePagina = TABLA.some((p) => p.ruta === r);
      if (tienePagina) expect(paginasNegadas.has(r), r).toBe(true);
    }
  });
});

describe('(a) par de control SIN perfil: la misma puerta abre para el dueño, como hoy', () => {
  // Solo las rutas que AREA_POR_RUTA conoce se abren (las demás las niega puedeVerRuta con o sin perfil, y eso no cambia).
  const conocidas = GATEADAS.filter((p) => p.puerta === '/dashboard/[id]' || areaDeRuta(clave(p)) !== undefined);

  it('el control cubre casi todas las páginas (las desconocidas, si hay, son las dinámicas hijas)', () => {
    expect(conocidas.length).toBeGreaterThanOrEqual(55);
  });

  it.each(conocidas.map((p) => [p.ruta, clave(p)] as const))('%s: SIN perfil abre', async (_ruta, puerta) => {
    getSessionTenant.mockResolvedValue(sesion(SIN));
    const r = await abrirPuerta(puerta);
    expect(r.tenantId).toBe(SIN);
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('(b) ⌘K / paleta: TODAS_LAS_RUTAS', () => {
  const permitidas = Object.keys(RUTAS_PERFIL_CINCO_AGENTES);
  const hrefs = TODAS_LAS_RUTAS.map((r) => r.href);

  it('cada entrada de la paleta está clasificada en una de las dos listas (ninguna cae a «sin dueño»)', () => {
    const sinDueno = hrefs.filter((h) => !permitidas.includes(h) && !RUTAS_STAND_BY_PERFIL_CINCO_AGENTES.includes(h));
    expect(sinDueno).toEqual([]);
  });

  it('CON perfil el dueño solo ve en la paleta rutas permitidas, y ninguna de stand-by', () => {
    const visibles = hrefs.filter((h) => puedeVerRuta('flota_admin', h, 'cinco_agentes'));
    expect(visibles.length).toBeGreaterThan(5);
    for (const h of visibles) expect(permitidas, h).toContain(h);
    for (const h of visibles) expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, h).not.toContain(h);
    for (const prohibida of ['/dashboard/chat', '/dashboard/facturacion', '/dashboard/suscripcion', '/dashboard/llaves-api', '/dashboard/timbrado']) {
      expect(visibles, prohibida).not.toContain(prohibida);
    }
  });

  it('SIN perfil la paleta es la de hoy: las mismas entradas que el rol ya veía, incluidas chat y suscripción', () => {
    const sinPerfil = hrefs.filter((h) => puedeVerRuta('flota_admin', h));
    expect(sinPerfil).toEqual(hrefs.filter((h) => puedeVerRuta('flota_admin', h, null)));
    expect(sinPerfil).toEqual(hrefs.filter((h) => puedeVerRuta('flota_admin', h, undefined)));
    expect(sinPerfil).toContain('/dashboard/chat');
    expect(sinPerfil).toContain('/dashboard/suscripcion');
    expect(sinPerfil.length).toBeGreaterThan(hrefs.filter((h) => puedeVerRuta('flota_admin', h, 'cinco_agentes')).length);
  });

  it('el perfil solo quita: lo que el encargado no veía por rol sigue sin verlo, y lo que sí veía se recorta igual', () => {
    for (const h of hrefs) {
      if (!puedeVerRuta('encargado', h)) expect(puedeVerRuta('encargado', h, 'cinco_agentes'), h).toBe(false);
      if (puedeVerRuta('encargado', h, 'cinco_agentes')) expect(permitidas, h).toContain(h);
    }
  });

  it('el superadmin que mira una flota con perfil ve la misma paleta que el dueño (el perfil no distingue rol)', () => {
    const dueno = hrefs.filter((h) => puedeVerRuta('flota_admin', h, 'cinco_agentes'));
    expect(hrefs.filter((h) => puedeVerRuta('superadmin', h, 'cinco_agentes'))).toEqual(dueno);
  });
});

describe('(b) inicioDe bajo el perfil: a dónde se rebota a cada rol', () => {
  it('el dueño, el superadmin y el encargado aterrizan en /dashboard, que SIEMPRE está en la lista', () => {
    for (const rol of ['flota_admin', 'superadmin', 'encargado']) {
      const destino = inicioDe(rol);
      expect(destino, rol).toBe('/dashboard');
      expect(rutaPermitidaEnPerfil('cinco_agentes', destino), rol).toBe(true);
      expect(puedeVerRuta(rol, destino, 'cinco_agentes'), rol).toBe(true);
    }
  });

  it('sin perfil, inicioDe no cambia: el contador sigue aterrizando en su panel', () => {
    expect(inicioDe('contador')).toBe('/dashboard/contador');
    expect(puedeVerRuta('contador', '/dashboard/contador')).toBe(true);
  });

  it('rutas de stand-by del dueño rebotan a /dashboard, no a otra pantalla de stand-by (sin bucle)', async () => {
    getSessionTenant.mockResolvedValue(sesion(CON));
    for (const ruta of ['/dashboard/chat', '/dashboard/suscripcion', '/dashboard/contador']) {
      redirect.mockClear();
      await expect(resolverTenantEfectivo(ruta, {}), ruta).rejects.toThrow('NEXT_REDIRECT');
      expect(redirect).toHaveBeenCalledTimes(1);
      const destino = redirect.mock.calls[0][0].split('?')[0];
      expect(rutaPermitidaEnPerfil('cinco_agentes', destino), `${ruta} → ${destino}`).toBe(true);
    }
  });

  // T-PER-02 (corregido el 21-oct-2026): el contador es un rol de solo `dinero`. Bajo el perfil,
  // `/dashboard` no es suyo (rebota a su casa, /dashboard/contador) y su casa quedaba en stand-by
  // (rebotaba a /dashboard): bucle de redirecciones. El rebote de `exigirRutaDePerfil` ahora es
  // consciente del rol (`inicioDe(rol, perfil)`) y aterriza al contador en la ventana del Agente de
  // Liquidación (A1, `dinero` y permitida en la lista cerrada) en vez de insistir en /dashboard.
  it('el contador bajo el perfil termina en una pantalla que abre, sin bucle de redirecciones', async () => {
    getSessionTenant.mockResolvedValue(sesion(CON, 'contador'));
    const saltos: string[] = [];
    let actual = '/dashboard';
    let abrio = false;
    for (let i = 0; i < 4 && !abrio; i++) {
      redirect.mockClear();
      try {
        await resolverTenantEfectivo(actual, {});
        abrio = true;
      } catch {
        actual = redirect.mock.calls[0][0].split('?')[0];
        saltos.push(actual);
      }
    }
    expect(abrio, `saltos: ${saltos.join(' → ')}`).toBe(true);
  });
});
