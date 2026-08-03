import Link from 'next/link';
import { LogOut } from 'lucide-react';
import FondoShader from '../admin/fondo-shader';
import SidebarNav from './sidebar-nav';

/**
 * El marco visual de /dashboard — fondo shader, sidebar glass con el logo,
 * navegación, perfil y cerrar sesión. SIN autorización adentro a propósito:
 * la puerta vive en `layout.tsx` (y la resolución de tenant, en cada
 * página), y así este archivo es puro dibujo.
 *
 * Separarlo del layout no es ceremonia: es lo que permite verificar el
 * marco DE VERDAD en un render de prueba (screenshot headless) en vez de
 * verificar una copia del marco que podría haber divergido del real. Un
 * layout con `redirect()` adentro no se puede renderizar sin sesión.
 */
export default function DashboardChrome({
  nombre, cerrarSesion, children,
}: {
  nombre: string | null;
  /** Server action. Opcional: el render de prueba no cierra sesión de nadie. */
  cerrarSesion?: () => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh" style={{ fontFamily: 'var(--font-sans-handle), var(--font-sans)' }}>
      <FondoShader />
      <div className="min-h-dvh flex items-start gap-4 p-4 relative z-10">
        <aside className="glass-panel w-[72px] lg:w-[232px] shrink-0 flex flex-col h-[calc(100dvh-2rem)] sticky top-4 self-start overflow-hidden">
          <div className="px-4 py-4 flex items-center justify-center lg:justify-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
            <img src="/images/logo.png" alt="Likida" className="h-5 w-auto" />
            <span className="hidden lg:inline text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
              FLOTA
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 space-y-3 pb-4">
            <SidebarNav />
          </nav>

          <div className="px-2.5 pb-2.5 pt-2.5" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2.5">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>
                {(nombre ?? 'F')[0].toUpperCase()}
              </div>
              <Link href="/cuenta" className="hidden lg:block text-sm font-medium hover:opacity-70 transition-opacity truncate">
                {nombre ?? 'Mi cuenta'}
              </Link>
            </div>

            {cerrarSesion && (
              <form action={cerrarSesion} className="mt-1">
                <button type="submit" title="Cerrar sesión"
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-85"
                  style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
                  <LogOut width={15} height={15} strokeWidth={1.75} />
                  <span className="hidden lg:inline">Cerrar sesión</span>
                </button>
              </form>
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 h-[calc(100dvh-2rem)] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
