import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftRight, LogOut } from 'lucide-react';
import Notificaciones from './notificaciones';
import { calcularAlertas } from './calcular-alertas';
import PerfilMenu from './perfil';
import SidebarNav from './sidebar-nav';
import SidebarNavIconos from './sidebar-nav-iconos';
import Fondo from '../fondo';
import AsistenteExpandible from './asistente-expandible';
import { MARCO_FILA, MARCO_SIDEBAR } from '../marco';
import CommandPalette from './command-palette';
import BuscadorTrigger from './buscador-trigger';
import { Logo } from '../logo';

export const dynamic = 'force-dynamic';

const ITEM = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)] transition-colors';
const ICONO = { width: 16, height: 16, strokeWidth: 1.75, color: 'var(--muted)' } as const;

/**
 * Sidebar persistente de /admin — la consola de negocio de Javier. El
 * `requireSuperadmin()` vive AQUÍ: gatea el layout entero, así que ninguna
 * página nueva bajo /admin puede olvidarlo.
 *
 * El fondo de TODA la consola es un shader WebGL animado monocromo
 * (`fondo-shader.tsx`, tipo "shadow blending") en vez del JPG estático que
 * había antes — sidebar, header y tarjetas son paneles "glass" SOBREPUESTOS
 * con espacio real entre sí (el `p-4 gap-4` de abajo), no regiones pegadas
 * con hairline como antes.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { nombre, avatarUrl } = await requireSuperadmin();

  // Las alertas viven aquí (no en admin/page.tsx) para que la campana esté
  // en el sidebar — visible en TODO /admin, no solo en Inicio — junto al
  // perfil, como pidió el usuario. Sí duplica el fetch de getResumenNegocio
  // con el de page.tsx; aceptable hoy (pocas filas, un solo tenant real).
  const [r, conversaciones] = await Promise.all([getResumenNegocio(), getConversacionesActivas()]);
  const alertas = calcularAlertas(r, conversaciones);

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="min-h-dvh" style={{ fontFamily: 'var(--font-sans-handle), var(--font-sans)' }}>
      <Fondo />
      {/* `dvh` en vez de `vh` a propósito: en iOS Safari, `100vh` cuenta el
          espacio DETRÁS de la barra de direcciones colapsable, así que la
          altura calculada no es la que realmente se ve — eso rompe el
          `sticky` del header cuando el navegador recalcula al hacer scroll.
          `dvh` (dynamic viewport height) sigue el viewport visual real. */}
      <CommandPalette />
      <div className={MARCO_FILA}>
        {/* `w-[72px] lg:w-[232px]` — colapsa a solo íconos entre `md` y
            `lg` (§G del complemento: "Sidebar colapsa a íconos en
            pantallas medianas"), responsive por CSS, no un toggle manual.
            `SidebarNav` (con texto, acordeón) se oculta con `hidden
            lg:block`; `SidebarNavIconos` (lista plana con tooltip) es su
            reverso `lg:hidden`. */}
        <aside className={MARCO_SIDEBAR}>
          <div className="px-4 py-4 flex items-center justify-center lg:justify-start gap-2">
            <Logo alto="h-5" />
            <span className="hidden lg:inline text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
              ADMIN
            </span>
          </div>

          <div className="hidden lg:block px-2.5 pb-1">
            <BuscadorTrigger />
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 space-y-3 pb-4">
            <div className="hidden lg:block"><SidebarNav /></div>
            <div className="lg:hidden"><SidebarNavIconos /></div>
          </nav>

          <div className="px-2.5 pb-2.5 pt-2.5" style={{ borderTop: '1px solid var(--line)' }}>
            <Link href="/dashboard?vista=demo" title="Ver panel de flota (demo)"
              className={`${ITEM} justify-center lg:justify-start`} style={{ color: 'var(--muted)' }}>
              <ArrowLeftRight {...ICONO} /> <span className="hidden lg:inline">Ver panel de flota (demo)</span>
            </Link>
            {/* El chip de perfil ya NO abre un popup — pedido explícito:
                quitar el menú, el avatar+nombre lleva directo a
                /admin/mi-perfil (perfil.tsx). "Cerrar sesión" quedó
                aparte, como su propio botón siempre visible, no escondido
                dentro de un menú. Espacio libre entre aquí y el botón de
                cerrar sesión a propósito — para las categorías que el
                usuario dijo que agregará después. */}
            <div className="flex items-center justify-center lg:justify-start px-2.5 py-2.5 mt-1">
              <PerfilMenu nombre={nombre ?? 'Javier'} avatarUrl={avatarUrl} />
              <div className="hidden lg:block ml-auto"><Notificaciones alertas={alertas} /></div>
            </div>

            <form action={cerrarSesion} className="mt-2">
              <button type="submit" title="Cerrar sesión"
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-85"
                style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
                <LogOut width={15} height={15} strokeWidth={1.75} />
                <span className="hidden lg:inline">Cerrar sesión</span>
              </button>
            </form>
          </div>
        </aside>

        {/* Columna de contenido: SU PROPIO scroll (`overflow-y-auto`), no el
            de la página — así el `sticky` del header y del panel derecho de
            admin/page.tsx tienen un solo ancestro de scroll inequívoco, en
            vez de depender del scroll del documento a través de varios
            niveles de flexbox anidados (el patrón anterior fallaba en
            Safari/iOS incluso con `items-start` + `dvh`). */}
        {/* EL ASISTENTE VIVE AQUÍ, no en admin/page.tsx: así está en TODAS las
            páginas de /admin y no solo en Inicio — igual que el rail de
            /dashboard, que ya vivía en su marco. El `resumen` ya se traía
            arriba para las alertas de la campana, así que no cuesta un
            fetch extra. */}
        <div className="flex-1 min-w-0 h-[calc(100dvh-2rem)] overflow-y-auto">
          <AsistenteExpandible main={children} resumen={r} />
        </div>
      </div>
    </div>
  );
}
