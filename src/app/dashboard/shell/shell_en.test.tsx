import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(), usePathname: () => '/dashboard/agentes/peajes', useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));
const { default: DashboardChromeV2 } = await import('./chrome-v2');
const { default: AdminChrome } = await import('../../admin/chrome');
const { HojaMasVista } = await import('./hoja-mas');
const { NavAdmin } = await import('../../admin/sidebar-nav');
const { default: FilaPuestaProbe } = await import('./menu-cuenta');
const { IdiomaProvider } = await import('@/lib/i18n/proveedor');
const { shell: shellEn } = await import('@/lib/i18n/en/shell');
const { paletaDelDashboard, filtrarPaleta } = await import('./paleta-datos');
const { crearTraductor } = await import('@/lib/i18n/traducir');
const { shell: shellEs } = await import('@/lib/i18n/es/shell');
const { menuPorPerfil } = await import('./menu-por-perfil');

const en = (nodo: React.ReactNode) => renderToStaticMarkup(<IdiomaProvider idioma="en" diccionarios={{ shell: shellEn }}>{nodo}</IdiomaProvider>);
const es = (nodo: React.ReactNode) => renderToStaticMarkup(nodo);

/** Texto y atributos visibles: lo que una persona lee o escucha. */
function legible(html: string): string {
  return [...html.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)].map((m) => m[1]).join(' | ') + ' || ' + html.replace(/<[^>]*>/g, ' ');
}
const ESPANOL = /\b(Saltar|Navegación|Resumen|Viajes|Equipo|Cuenta|Cerrar sesión|Notificaciones|Ayuda|Más|Cargando|Reintentar|Menú|Mi perfil|Configuración|Próximamente|Pendientes)\b/;

describe('el marco del dashboard en inglés (i18n P1)', () => {
  const marco = (idiomaEn: boolean, rol = 'flota_admin', perfil: 'cinco_agentes' | null = null) => {
    const nodo = (
      <DashboardChromeV2 nombre="Ana Pérez" rol={rol} perfil={perfil} cerrarSesion={async () => {}} insignias={{ '/dashboard/puesta-en-marcha': '2/6', '/dashboard/notificaciones': '3' }}>
        <p>contenido</p>
      </DashboardChromeV2>
    );
    return idiomaEn ? en(nodo) : es(nodo);
  };

  it('traduce navegación, cabeceras, barra móvil, telón, pie y menú de cuenta, sin español suelto', () => {
    const h = marco(true);
    const visible = legible(h);
    for (const t of ['Skip to content', 'Main navigation', 'Mobile navigation', 'Trips', 'Team', 'Overview', 'Operations', 'Money and tax', 'Loading', 'Likida, go to home', 'Notices', 'Collapse the menu', 'Search', 'Fleet owner']) {
      expect(visible, t).toContain(t);
    }
    expect(visible).not.toMatch(ESPANOL);
  });

  it('para el perfil de cinco agentes traduce también los grupos y «Setup»', () => {
    const visible = legible(marco(true, 'flota_admin', 'cinco_agentes'));
    for (const t of ['Agents', 'Account and connections', 'Setup', 'Automatic settlement', 'Customer service']) expect(visible, t).toContain(t);
    expect(visible).not.toMatch(ESPANOL);
  });

  it('sin proveedor sigue diciendo lo de siempre, en español', () => {
    const visible = legible(marco(false));
    for (const t of ['Saltar al contenido', 'Navegación principal', 'Navegación móvil', 'Viajes', 'Dueño de la flota']) expect(visible, t).toContain(t);
    expect(visible).not.toContain('Skip to content');
  });

  it('la hoja «Más» abierta se titula «Full menu» y su árbol cabe en inglés', () => {
    const menu = menuPorPerfil('flota_admin', null);
    const h = en(<HojaMasVista abierta alCerrar={() => {}} menu={menu} sufijo="" pathname="/dashboard" pie={<p>pie</p>} />);
    expect(h).toContain('Full menu');
    expect(h).toContain('Trips');
    expect(h).not.toContain('Menú completo');
  });

  it('el menú de la cuenta abierto traduce sus filas (Ayuda → Help, Mi cuenta → My account)', () => {
    const menu = menuPorPerfil('flota_admin', null);
    const h = en(<FilaPuestaProbe nombre="Ana" rol="flota_admin" rolEtiqueta="Fleet owner" sufijo="" filas={menu.pie.filter((i) => i.href !== '/dashboard/notificaciones')} usoIaPct={40} iniciales="A" abiertoInicial />);
    for (const t of ['AI analysis · today', 'My profile', 'Help', 'My account', 'Plan and billing']) expect(h, t).toContain(t);
    expect(h).not.toMatch(/Análisis con IA|Mi cuenta|Ayuda/);
  });
});

describe('⌘K del dashboard en inglés', () => {
  const tEn = crearTraductor<typeof shellEs>('en', shellEn, shellEs);
  it('muestra los nombres en inglés y sigue encontrando por el nombre en español y por el inglés', () => {
    const lista = paletaDelDashboard('flota_admin', null, tEn);
    const mapa = lista.find((d) => d.href === '/dashboard/mapa');
    expect(mapa?.etiqueta).toBe('Trips · Map');
    expect(filtrarPaleta(lista, 'trips').map((d) => d.href)).toContain('/dashboard/mapa');
    expect(filtrarPaleta(lista, 'viajes').map((d) => d.href)).toContain('/dashboard/mapa');
    expect(filtrarPaleta(lista, 'grua').map((d) => d.href)).toContain('/dashboard/asistencia');
  });
  it('sin traductor no cambia nada', () => {
    expect(paletaDelDashboard('flota_admin', null).find((d) => d.href === '/dashboard/mapa')?.etiqueta).toBe('Viajes · Mapa');
  });
});

describe('el marco de /admin en inglés (i18n P1)', () => {
  const admin = (nodo: boolean) => {
    const marco = <AdminChrome nombre="Javier" avatarUrl={null} cerrarSesion={async () => {}} flotas={[{ id: 'a', nombre: 'Flota A' }]} flotaActual="a"><p>contenido</p></AdminChrome>;
    return nodo ? en(marco) : es(marco);
  };
  it('traduce secciones, entradas, pie, cabecera y barra móvil', () => {
    const h = admin(true);
    const visible = legible(h);
    for (const t of ['Console navigation', 'Business', 'System', 'Inbox', 'Customers', 'Sign out', 'View as', 'Customer dashboard', 'Superadmin', 'Mobile navigation', 'Search']) {
      expect(visible, t).toContain(t);
    }
    // (El panel del Copiloto es de otro paquete y sigue en español: por eso no se busca «Negocio» en todo el marco.)
    expect(visible).not.toMatch(/Navegación|Bandeja|Cerrar sesión|Panel del cliente|Ver como\b/);
    expect(en(<NavAdmin />)).not.toMatch(/Negocio|Sistema|Control de|Bandeja/);
  });
  it('sin proveedor sigue en español', () => {
    const visible = legible(admin(false));
    for (const t of ['Navegación de la consola', 'Negocio', 'Bandeja', 'Cerrar sesión', 'Panel del cliente']) expect(visible, t).toContain(t);
  });
});
