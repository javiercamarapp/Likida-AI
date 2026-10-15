/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex -- pruebas que leen archivos de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-PER-07 · SUSCRIPCIÓN / PLANES / PRECIOS DE LIKIDA bajo el perfil
// `cinco_agentes`, y /admin + /vendedor para el usuario de la flota.
//
// A diferencia de `page.test.tsx` (que sustituye las puertas), aquí las
// puertas son las REALES (`resolverTenantEfectivo` → `requireSessionTenant` →
// `exigirRutaDePerfil`) y solo se simulan la sesión y la tabla `tenant_perfil`.
// Lo que se vigila: con perfil la ruta rebota ANTES de leer un solo plan, la
// server action (POST directo) también, ningún texto del marco ni del Resumen
// trae un `$` de plan, el perfil no siembra `plan`/`suscripcion`, y /admin y
// /vendedor no existen para el dueño de la flota.
//
// Datos 100 % sintéticos.
// ═══════════════════════════════════════════════════════════════════════════

type Elemento = ReactElement<Record<string, unknown>>;

const dobles = vi.hoisted(() => ({
  getPlanes: vi.fn(),
  getSuscripcion: vi.fn(),
  getFacturasSaas: vi.fn(),
  getUso: vi.fn(),
  cambiarPlan: vi.fn(),
  crearPortal: vi.fn(),
  guardarDatosFiscales: vi.fn(),
  getDatosFiscales: vi.fn(),
  perfil: null as string | null,
  sesion: { userId: 'u-1', tenantId: 't-1', rol: 'flota_admin', nombre: 'Ana', operadorId: null, avatarUrl: null } as Record<string, unknown> | null,
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
}));

vi.mock('next/navigation', () => ({
  redirect: dobles.redirect,
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/env', () => ({ appUrl: () => 'https://app.sintetica.test' }));
vi.mock('@/lib/auth/session', () => ({ getSessionTenant: async () => dobles.sesion }));
vi.mock('@/lib/auth/admin-context', () => ({ leerSeleccionFlota: async () => null }));
vi.mock('@/lib/auth/superadmin-mfa', () => ({ veredictoMfaDeSesion: async () => 'ok' }));
vi.mock('@/lib/auth/mfa', async (orig) => ({ ...(await orig<Record<string, unknown>>()), mfaSuperadminObligatorio: () => false }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => {} }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantPedido: async (_a: unknown, t: string) => t }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') return { data: dobles.perfil ? { perfil: dobles.perfil } : null, error: null };
        if (tabla === 'app_user') return { data: { email: 'dueno@sintetica.test' }, error: null };
        if (tabla === 'tenant') return { data: { id: 't-1', nombre: 'Flota sintetica' }, error: null };
        return { data: null, error: null };
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/saas/suscripcion', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/suscripcion')>()),
  getPlanes: dobles.getPlanes,
  getSuscripcion: dobles.getSuscripcion,
  getFacturasSaas: dobles.getFacturasSaas,
  getUso: dobles.getUso,
  cambiarPlan: dobles.cambiarPlan,
}));
vi.mock('@/lib/saas/stripe', () => ({
  crearPortal: dobles.crearPortal, stripeConfigurado: () => true, modoStripe: () => 'live',
}));
vi.mock('@/lib/saas/transferencia', () => ({ datosBancarios: () => null }));
vi.mock('@/lib/saas/fiscal', async (importar) => ({
  ...(await importar<typeof import('@/lib/saas/fiscal')>()),
  getDatosFiscales: dobles.getDatosFiscales,
  guardarDatosFiscales: dobles.guardarDatosFiscales,
  estanCompletos: () => true,
}));

import { FormaConAviso } from '../../admin/ui/forma';
import SuscripcionPage from './page';
import { reiniciarCachePerfil } from '@/lib/auth/perfil_tenant';
import { requireSuperadmin, requireVendedor } from '@/lib/auth/guard';
import { RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, rutaPermitidaEnPerfil } from '@/lib/auth/visibilidad';
import DashboardChrome from '../chrome';
import { InicioCincoAgentes } from '../inicio-cinco-agentes';

const RAIZ = process.cwd();
const SP = Promise.resolve({});
const fd = (campos: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.set(k, v); return f; };
const PLAN_SINTETICO = { clave: 'plan-x', nombre: 'Plan X', precioMensual: 1234, stripePriceId: 'price_x' };

function formasConAviso(nodo: ReactNode, salida: Elemento[] = []): Elemento[] {
  if (Array.isArray(nodo)) { for (const hijo of nodo) formasConAviso(hijo, salida); return salida; }
  if (!isValidElement<Record<string, unknown>>(nodo)) return salida;
  if (nodo.type === FormaConAviso) salida.push(nodo);
  formasConAviso(nodo.props.children as ReactNode, salida);
  return salida;
}
const acciones = (pagina: ReactNode) =>
  formasConAviso(pagina).map((f) => f.props.accion as (previo: unknown, fd: FormData) => Promise<unknown>);

const sesionDe = (rol: string, tenantId: string | null = 't-1') =>
  ({ userId: 'u-1', tenantId, rol, nombre: 'Ana', operadorId: null, avatarUrl: null });

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarCachePerfil();
  dobles.perfil = null;
  dobles.sesion = sesionDe('flota_admin');
  dobles.getPlanes.mockResolvedValue([PLAN_SINTETICO]);
  dobles.getSuscripcion.mockResolvedValue(null);
  dobles.getFacturasSaas.mockResolvedValue([]);
  dobles.getUso.mockResolvedValue(null);
  dobles.getDatosFiscales.mockResolvedValue({
    rfc: 'TIN010101AB1', razonSocial: 'FLOTA SINTETICA SA DE CV', regimenFiscal: '601', codigoPostal: '97000', // grep-limpio:ok
    usoCfdi: 'G03', email: null, domicilioFiscal: null,
  });
});

describe('la pantalla de Suscripción bajo el perfil', () => {
  it('par de control SIN perfil: el dueño abre la pantalla y se leen los planes de Likida', async () => {
    await expect(SuscripcionPage({ searchParams: SP })).resolves.toBeTruthy();
    expect(dobles.getPlanes).toHaveBeenCalledTimes(1);
  });

  it('CON perfil la ruta rebota a /dashboard y NO se lee un solo plan, suscripción, factura ni dato fiscal', async () => {
    dobles.perfil = 'cinco_agentes';
    await expect(SuscripcionPage({ searchParams: SP })).rejects.toThrow('REDIRECT:/dashboard');
    for (const d of [dobles.getPlanes, dobles.getSuscripcion, dobles.getFacturasSaas, dobles.getUso, dobles.getDatosFiscales]) {
      expect(d).not.toHaveBeenCalled();
    }
  });

  it('CON perfil el rebote es el mismo para dueño y para contador (el perfil quita encima del rol)', async () => {
    dobles.perfil = 'cinco_agentes';
    for (const rol of ['flota_admin', 'contador', 'encargado']) {
      dobles.sesion = sesionDe(rol);
      await expect(SuscripcionPage({ searchParams: SP }), rol).rejects.toThrow(/REDIRECT:\/dashboard/);
    }
    expect(dobles.getPlanes).not.toHaveBeenCalled();
  });

  it('CON perfil las server actions (POST directo, sin pasar por la página) también se cierran: no se cambia plan ni se guardan datos fiscales ni se abre el portal', async () => {
    // Las acciones se extraen del render SIN perfil (así existen en el navegador)…
    const pagina = await SuscripcionPage({ searchParams: SP });
    const todas = acciones(pagina);
    expect(todas.length).toBeGreaterThan(0);
    dobles.getPlanes.mockClear();
    // …y se invocan DESPUÉS de que la flota recibe el perfil.
    dobles.perfil = 'cinco_agentes';
    reiniciarCachePerfil();
    for (const accion of todas) {
      // La puerta corta con un redirect; alguna acción lo atrapa en su propio try/catch y lo devuelve como `{ error }`.
      // Las dos formas son un cierre: lo que NO puede pasar es un `{ ok }` ni un efecto aguas abajo.
      const r = await accion(null, fd({ plan: 'plan-x', tenantId: 't-1', rfc: 'TIN010101AB1' })).catch((e: Error) => e); // grep-limpio:ok
      if (!(r instanceof Error)) expect(r).toEqual(expect.objectContaining({ error: expect.any(String) }));
      else expect(r.message).toBe('REDIRECT:/dashboard');
    }
    expect(dobles.cambiarPlan).not.toHaveBeenCalled();
    expect(dobles.guardarDatosFiscales).not.toHaveBeenCalled();
    expect(dobles.crearPortal).not.toHaveBeenCalled();
  });

  it('la ruta está en el stand-by del perfil y NO en la lista permitida (ni ella ni su variante con query)', () => {
    expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES).toContain('/dashboard/suscripcion');
    expect(Object.keys(RUTAS_PERFIL_CINCO_AGENTES)).not.toContain('/dashboard/suscripcion');
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/suscripcion')).toBe(false);
    expect(rutaPermitidaEnPerfil('cinco_agentes', '/dashboard/suscripcion/?plan=pro#x')).toBe(false);
    // Un nombre de perfil desconocido falla cerrado (la ruta se niega). La ruta sigue disponible SIN perfil: lo fija el par de control de la pantalla, arriba.
    expect(rutaPermitidaEnPerfil('sin-perfil-desconocido', '/dashboard/suscripcion')).toBe(false);
  });
});

describe('ningún texto de la app bajo el perfil trae un «$» de plan', () => {
  const chrome = (rol: string) => renderToStaticMarkup(
    <DashboardChrome nombre="Ana" rol={rol} cerrarSesion={async () => {}} usoIa={undefined} perfil="cinco_agentes">
      <main>contenido</main>
    </DashboardChrome>,
  );
  const texto = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const PLANES = /\$|MXN|\/\s*mes|mensualidad|plan\s+(pro|básico|basico|x)\b|precio|suscripci|facturaci[oó]n/i;

  it.each(['flota_admin', 'superadmin', 'encargado', 'contador'])('el marco (layout + menú) con perfil no tiene «$», precios ni «Plan y facturación» (%s)', (rol) => {
    expect(texto(chrome(rol))).not.toMatch(PLANES);
  });

  it('el Resumen del perfil (árbol de render, con sus cinco fichas) no tiene «$» ni texto de plan', async () => {
    const arbol = await InicioCincoAgentes({ tenantId: 't-1', tenantNombre: 'Flota sintetica', nombre: 'Ana' }).catch(() => null);
    // Si el Resumen necesita más contexto del que esta prueba simula, no se calla: se falla.
    expect(arbol, 'el Resumen del perfil no se pudo montar con datos sintéticos').not.toBeNull();
    const html = renderToStaticMarkup(arbol as ReactElement);
    expect(texto(html)).not.toMatch(PLANES);
  });
});

describe('el perfil no siembra plan, suscripción ni precios', () => {
  const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
  // Solo código ejecutable: se quitan comentarios `--`, `#` y `/* */` (las notas pueden decir «plan»; lo que cuenta es lo que corre).
  const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)(--|#).*$/, '')).join('\n');
  const TABLAS_DE_PLAN = /\b(suscripcion|plan|factura_saas|tenant_plan|stripe_[a-z_]+)\b/i;

  it('la migración 0770 solo crea `tenant_perfil` y no toca tablas de plan/suscripción', () => {
    const sql = sinComentarios(leer('supabase/migrations/0770_tenant_perfil.sql'));
    expect(sql).toMatch(/tenant_perfil/);
    expect(sql).not.toMatch(TABLAS_DE_PLAN);
  });

  it.each(['aplicar-cinco-agentes.sh', 'revertir-cinco-agentes.sh', '_comun-cinco-agentes.sh', 'verificar-cinco-agentes.sh'])(
    'scripts/perfil/%s no escribe plan, suscripción ni precios', (script) => {
      const codigo = sinComentarios(leer(`scripts/perfil/${script}`));
      expect(codigo).not.toMatch(TABLAS_DE_PLAN);
      // Aplicar no actualiza la fila de `tenant` (donde vive el texto `plan`).
      expect(codigo).not.toMatch(/update\s+public\.tenant\b/i);
    },
  );

  it('el repo público no recibe precios: ni el perfil ni el Resumen del perfil tienen un monto literal', () => {
    for (const rel of ['src/app/dashboard/inicio-cinco-agentes.tsx', 'src/lib/auth/perfil_tenant.ts']) {
      expect(sinComentarios(leer(rel)), rel).not.toMatch(/\$\s?\d|\b\d{1,3}(,\d{3})+\s?(mxn|pesos)\b/i);
    }
  });
});

describe('/admin y /vendedor para el usuario de la flota con perfil', () => {
  beforeEach(() => { dobles.perfil = 'cinco_agentes'; });

  it.each(['flota_admin', 'encargado', 'contador'])('/admin (requireSuperadmin) rebota a /dashboard para %s', async (rol) => {
    dobles.sesion = sesionDe(rol);
    await expect(requireSuperadmin()).rejects.toThrow('REDIRECT:/dashboard');
  });

  it.each(['flota_admin', 'encargado', 'contador'])('/vendedor (requireVendedor) rebota para %s y nunca a una pantalla de plan', async (rol) => {
    dobles.sesion = sesionDe(rol);
    await expect(requireVendedor()).rejects.toThrow(/^REDIRECT:\/dashboard(\/contador)?$/);
  });

  it('sin sesión ambas puertas mandan al login (nunca sirven la pantalla)', async () => {
    dobles.sesion = null;
    await expect(requireSuperadmin()).rejects.toThrow(/REDIRECT:\/login/);
    await expect(requireVendedor()).rejects.toThrow(/REDIRECT:\/login/);
  });

  it('ni el menú ni la paleta de rutas de la flota con perfil apuntan a /admin o /vendedor', () => {
    const fuentes = ['src/app/dashboard/sidebar-nav.tsx', 'src/app/dashboard/chrome.tsx', 'src/app/dashboard/inicio-cinco-agentes.tsx'];
    for (const rel of fuentes) {
      const enlaces = [...readFileSync(join(RAIZ, rel), 'utf8').matchAll(/href=\{?[`'"]\/(admin|vendedor)\b/g)];
      expect(enlaces.map((m) => m[0]), rel).toEqual([]);
    }
    for (const ruta of Object.keys(RUTAS_PERFIL_CINCO_AGENTES)) expect(ruta).not.toMatch(/^\/(admin|vendedor)/);
  });
});
