import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// ═══════════════════════════════════════════════════════════════════════════
// EL MENÚ Y EL RESUMEN BAJO EL PERFIL `cinco_agentes` (0770).
// ═══════════════════════════════════════════════════════════════════════════

let ruta = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => ruta,
  useSearchParams: () => new URLSearchParams(''),
  redirect: (d: string) => { throw new Error(`REDIRECT:${d}`); },
}));

const { default: SidebarNav, SidebarAbajo } = await import('./sidebar-nav');
const { FICHAS_CINCO_AGENTES } = await import('./inicio-cinco-agentes');
const { RUTAS_PERFIL_CINCO_AGENTES, moduloProximamenteDeRuta, rutaProximamente } = await import('@/lib/auth/visibilidad');
// Un módulo «próximamente» (fase 1) enlaza a su pantalla de anuncio, no a la función.
const destinoEnMenu = (href: string) => { const m = moduloProximamenteDeRuta('cinco_agentes', href); return m ? rutaProximamente(m) : href; };
const enlacesPermitidos = () => [...Object.keys(RUTAS_PERFIL_CINCO_AGENTES), ...['vigia', 'conductor'].map((m) => rutaProximamente(m as 'vigia'))];

const hrefsDe = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
const PROHIBIDAS = [
  '/dashboard/chat', '/dashboard/facturacion', '/dashboard/clientes', '/dashboard/suscripcion', '/dashboard/llaves-api',
  '/dashboard/sesiones-mcp', '/dashboard/usuarios', '/dashboard/agentes/facturas', '/dashboard/agentes/cobranza',
  '/dashboard/agentes/proveedores', '/dashboard/timbrado', '/dashboard/descarga-sat', '/dashboard/configuracion',
  '/dashboard/rentabilidad', '/dashboard/reglas', '/dashboard/convenios', '/dashboard/jornada', '/dashboard/patios',
];

describe('sidebar', () => {
  it('SIN perfil el dueño ve el menú completo (regresión)', () => {
    const hrefs = hrefsDe(renderToStaticMarkup(<SidebarNav rol="flota_admin" />) + renderToStaticMarkup(<SidebarAbajo rol="flota_admin" />));
    // Acordeón: solo la sección abierta pinta sus items; el chat es de primer nivel.
    expect(hrefs).toContain('/dashboard/chat');
    expect(hrefs).toContain('/dashboard/suscripcion');
  });

  it('CON perfil, ningún link apunta fuera de la lista cerrada', () => {
    const html = renderToStaticMarkup(<SidebarNav rol="flota_admin" perfil="cinco_agentes" />)
      + renderToStaticMarkup(<SidebarAbajo rol="flota_admin" perfil="cinco_agentes" usoIa={{ pct: 10 }} />);
    const hrefs = hrefsDe(html);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) expect(enlacesPermitidos(), h).toContain(h);
    for (const p of PROHIBIDAS) expect(hrefs).not.toContain(p);
    expect(html).not.toContain('Pregunta a tus datos');
    expect(html).not.toContain('Análisis con IA');
  });

  it('CON perfil la sección Automatizaciones muestra los cinco agentes y no los de stand-by', () => {
    ruta = '/dashboard/agentes/peajes';
    const hrefs = hrefsDe(renderToStaticMarkup(<SidebarNav rol="flota_admin" perfil="cinco_agentes" />));
    ruta = '/dashboard';
    for (const f of FICHAS_CINCO_AGENTES) expect(hrefs, f.nombre).toContain(destinoEnMenu(f.href));
    for (const p of ['/dashboard/agentes/facturas', '/dashboard/agentes/cobranza', '/dashboard/agentes/proveedores']) expect(hrefs).not.toContain(p);
  });

  it('SIN perfil esa misma sección sí trae facturas, cobranza y proveedores (regresión)', () => {
    ruta = '/dashboard/agentes/peajes';
    const hrefs = hrefsDe(renderToStaticMarkup(<SidebarNav rol="flota_admin" />));
    ruta = '/dashboard';
    for (const p of ['/dashboard/agentes/facturas', '/dashboard/agentes/cobranza', '/dashboard/agentes/proveedores']) expect(hrefs).toContain(p);
  });
});

describe('Resumen', () => {
  it('las cinco fichas apuntan a rutas permitidas del perfil y no hablan de dinero ni de chat', () => {
    expect(FICHAS_CINCO_AGENTES).toHaveLength(5);
    for (const f of FICHAS_CINCO_AGENTES) {
      expect(Object.keys(RUTAS_PERFIL_CINCO_AGENTES), f.nombre).toContain(f.href);
      expect(`${f.nombre} ${f.descripcion}`).not.toMatch(/\$|plan|precio|suscripci|chat|factur|cobranza/i);
    }
  });
});

describe('/dashboard bajo el perfil', () => {
  beforeEach(() => vi.resetModules());

  async function pagina(perfil: string | null, onboardingCompleto: boolean) {
    vi.doMock('@/lib/auth/tenant-efectivo', () => ({
      resolverTenantEfectivo: async () => ({ tenantId: 't1', tenantNombre: null, nombre: 'Ana', rol: 'flota_admin', tenantExiste: true }),
    }));
    vi.doMock('@/lib/auth/perfil_tenant', () => ({ perfilDeTenant: async () => perfil }));
    vi.doMock('@/lib/likida/repo', () => ({ getPerfilCrudo: async () => ({}) }));
    vi.doMock('@/lib/likida/perfil/preguntas', () => ({ onboardingFiscalListo: () => onboardingCompleto, onboardingPospuesto: () => false }));
    vi.doMock('./inicio-contenido', () => ({ InicioContenido: function InicioContenido() { return null; } }));
    vi.doMock('./inicio-operacion', () => ({ InicioOperacion: function InicioOperacion() { return null; } }));
    vi.doMock('./inicio-cinco-agentes', () => ({ InicioCincoAgentes: function InicioCincoAgentes() { return null; } }));
    const { default: Pagina } = await import('./page');
    return Pagina({ searchParams: Promise.resolve({}) }) as Promise<{ type: { name: string } }>;
  }

  it('con perfil muestra el Resumen de los cinco y NO manda al onboarding (que está en stand-by)', async () => {
    const el = await pagina('cinco_agentes', false);
    expect(el.type.name).toBe('InicioCincoAgentes');
  });

  it('sin perfil y con el onboarding pendiente manda al onboarding, como siempre', async () => {
    await expect(pagina(null, false)).rejects.toThrow('REDIRECT:/dashboard/onboarding');
  });

  it('sin perfil y con el onboarding listo muestra el Resumen del dueño, como siempre', async () => {
    const el = await pagina(null, true);
    expect(el.type.name).toBe('InicioContenido');
  });
});

describe('«Próximamente» en el menú y en el Resumen (fase 1)', () => {
  it('el menú enseña vigía y conductor con la etiqueta «Próximamente» y su link va al anuncio, no a la función', () => {
    ruta = '/dashboard/agentes/peajes';
    const html = renderToStaticMarkup(<SidebarNav rol="flota_admin" perfil="cinco_agentes" />);
    ruta = '/dashboard';
    const hrefs = hrefsDe(html);
    expect(hrefs).toContain('/dashboard/proximamente/vigia');
    expect(hrefs).toContain('/dashboard/proximamente/conductor');
    for (const p of ['/dashboard/agentes/vigia', '/dashboard/agentes/conductores']) expect(hrefs).not.toContain(p);
    expect(html).toContain('Servicio al cliente');
    expect(html).toContain('Comunicación con operadores');
    expect((html.match(/Próximamente<\/span>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('A1, A2 y A3 siguen enlazando a su función, sin etiqueta', () => {
    ruta = '/dashboard/agentes/peajes';
    const html = renderToStaticMarkup(<SidebarNav rol="flota_admin" perfil="cinco_agentes" />);
    ruta = '/dashboard';
    const hrefs = hrefsDe(html);
    for (const p of ['/dashboard/agentes/liquidacion', '/dashboard/agentes/peajes', '/dashboard/agentes/carta-porte']) expect(hrefs).toContain(p);
  });

  it('SIN perfil el menú no cambia: nada de «Próximamente», links a las funciones', () => {
    ruta = '/dashboard/agentes/peajes';
    const html = renderToStaticMarkup(<SidebarNav rol="flota_admin" />);
    ruta = '/dashboard';
    expect(html).not.toContain('Próximamente');
    expect(hrefsDe(html)).toContain('/dashboard/agentes/vigia');
    expect(hrefsDe(html)).not.toContain('/dashboard/proximamente/vigia');
  });
});
