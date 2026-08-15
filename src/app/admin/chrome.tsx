import Link from 'next/link';
import { LogOut } from 'lucide-react';
import Fondo from '../fondo';
import { MARCO_FILA, MARCO_SIDEBAR, MARCO_COLUMNA, MARCO_SCROLL, CLASE_COLUMNA_CENTRO } from '../marco';
import SidebarNav, { SidebarAbajoAdmin } from './sidebar-nav';
import { BotonSidebar } from '../boton-sidebar';
import CommandPalette from './command-palette';
import { Logo } from '../logo';

/**
 * El marco de /admin — GEMELO de `dashboard/chrome.tsx`, pieza por pieza
 * (14-ago-2026, pedido explícito: "el sidebar idéntico, y sin el asistente
 * de IA"). Puro dibujo, SIN autorización adentro, por la misma razón que su
 * gemelo: es lo que permite verificar el marco DE VERDAD en un render de
 * prueba sin sesión, en vez de verificar una copia que podría divergir. La
 * puerta vive en `layout.tsx`.
 *
 * EL ASISTENTE EXPANDIBLE SE FUE (14-ago-2026) — la misma decisión que el
 * rail del dashboard el 12-ago — y en la segunda pasada (mismo día) se
 * quitó también la página /admin/chat y sus entradas: /admin queda SIN
 * asistente de IA en ninguna forma. La campana de
 * alertas se mudó al Resumen (`consola.tsx`), donde se miran las señales.
 */
export default function AdminChrome({
  nombre, avatarUrl, cerrarSesion, children,
}: {
  nombre: string | null;
  avatarUrl: string | null;
  /** Server action. Opcional: el render de prueba no cierra sesión de nadie. */
  cerrarSesion?: () => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh tema-neutro" style={{ fontFamily: 'var(--font-sans-handle), var(--font-sans)' }}>
      <Fondo />
      <CommandPalette />
      <div className={MARCO_FILA}>
        <aside className={`${MARCO_SIDEBAR} sb-aside`}>
          <div className="px-3 py-3 flex items-center justify-center lg:justify-start gap-1.5 sb-centrable">
            <span className="sb-logo min-w-0"><Logo alto="h-[18px]" /></span>
            <span className="ml-auto hidden lg:block"><BotonSidebar /></span>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 space-y-2 pb-3">
            <SidebarNav />
          </nav>

          {/* El bloque inferior fijo con su propio fondo — gemelo del de
              chrome.tsx (la referencia Handle del 13-ago). */}
          <div className="px-2 pt-2 pb-1.5 space-y-0.5 shrink-0" style={{ background: 'var(--canvas)', borderTop: '1px solid var(--line)' }}>
            <SidebarAbajoAdmin />
          </div>

          {/* El user card de la referencia FlowAI, idéntico al del cliente:
              avatar + nombre + rol, salir como ícono. El avatar real si hay. */}
          <div className="px-2 pb-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="hairline rounded-xl p-2 flex items-center justify-center lg:justify-start gap-2 sb-centrable" style={{ background: 'var(--surface)' }}>
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- avatar chico de Storage, mismo criterio que perfil
                <img src={avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold" style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                  {(nombre ?? 'J')[0].toUpperCase()}
                </div>
              )}
              <div className="hidden lg:block min-w-0 flex-1 sb-texto">
                <Link href="/admin/mi-perfil" className="block text-[13px] font-medium hover:opacity-70 transition-opacity truncate leading-tight">
                  {nombre ?? 'Mi cuenta'}
                </Link>
                <div className="text-[10px] truncate" style={{ color: 'var(--faint)' }}>SUPERADMIN</div>
              </div>
              {cerrarSesion && (
                <form action={cerrarSesion} className="hidden lg:block shrink-0 sb-texto">
                  <button type="submit" title="Cerrar sesión" aria-label="Cerrar sesión"
                    className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--badbg)]"
                    style={{ color: 'var(--bad)' }}>
                    <LogOut width={14} height={14} strokeWidth={1.75} />
                  </button>
                </form>
              )}
            </div>
          </div>
        </aside>

        <div className={`${MARCO_COLUMNA} ${CLASE_COLUMNA_CENTRO}`}>
          <div className={MARCO_SCROLL}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
