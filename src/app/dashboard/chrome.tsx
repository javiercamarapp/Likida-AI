import Link from 'next/link';
import { LogOut } from 'lucide-react';
import FondoShader from '../admin/fondo-shader';
import SidebarNav from './sidebar-nav';
import AvisoRol from './aviso-rol';
import RailAsistente from './rail';

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
/** Cómo se lee cada rol en el badge del sidebar. Las cinco claves son el
 *  dominio REAL de `app_user.rol` (0044_rol_encargado.sql:23) — no una
 *  etiqueta de adorno: decía "FLOTA" fijo para todos, y quien entra es un
 *  `flota_admin`, un contador o un encargado, que no ven lo mismo. Un rol
 *  nuevo cae al `??` y sale con su clave cruda, nunca vacío. */
const ROL_BADGE: Record<string, string> = {
  flota_admin: 'ADMIN FLOTA',
  encargado: 'ENCARGADO',
  contador: 'CONTADOR',
  operador: 'OPERADOR',
  superadmin: 'SUPERADMIN',
};

export default function DashboardChrome({
  nombre, rol, cerrarSesion, children,
}: {
  nombre: string | null;
  rol: string;
  /** Server action. Opcional: el render de prueba no cierra sesión de nadie. */
  cerrarSesion?: () => Promise<void>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh" style={{ fontFamily: 'var(--font-sans-handle), var(--font-sans)' }}>
      <FondoShader />
      {/* `gap-3 p-3` (antes 4): con el rail fijo en TODAS las páginas la
          columna del centro perdió ~300px, así que cada píxel de margen que
          no aporta se recorta. El sidebar baja de 232 a 208 por lo mismo. */}
      <div className="min-h-dvh flex items-start gap-3 p-3 relative z-10">
        <aside className="glass-panel w-[64px] lg:w-[208px] shrink-0 flex flex-col h-[calc(100dvh-1.5rem)] sticky top-3 self-start overflow-hidden">
          <div className="px-3 py-3 flex items-center justify-center lg:justify-start gap-1.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo estático, no next/image en el resto del repo */}
            <img src="/images/logo.png" alt="Likida" className="h-[18px] w-auto" />
            <span className="hidden lg:inline text-[9px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
              {ROL_BADGE[rol] ?? rol.toUpperCase()}
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 space-y-2 pb-3">
            <SidebarNav rol={rol} />
          </nav>

          <div className="px-2 pb-2 pt-2" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="flex items-center justify-center lg:justify-start gap-2 px-2 py-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[11px] font-semibold" style={{ background: 'var(--ink)', color: 'var(--bg)' }}>
                {(nombre ?? 'F')[0].toUpperCase()}
              </div>
              <Link href="/cuenta" className="hidden lg:block text-[13px] font-medium hover:opacity-70 transition-opacity truncate">
                {nombre ?? 'Mi cuenta'}
              </Link>
            </div>

            {cerrarSesion && (
              <form action={cerrarSesion} className="mt-0.5">
                <button type="submit" title="Cerrar sesión"
                  className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-[13px] font-medium transition-opacity hover:opacity-85"
                  style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
                  <LogOut width={14} height={14} strokeWidth={1.75} />
                  <span className="hidden lg:inline">Cerrar sesión</span>
                </button>
              </form>
            )}
          </div>
        </aside>

        <div className="flex-1 min-w-0 h-[calc(100dvh-1.5rem)] overflow-y-auto">
          <AvisoRol rolReal={rol} />
          {children}
        </div>

        {/* El rail, fijo a la derecha en las 20 páginas. */}
        <RailAsistente />
      </div>
    </div>
  );
}
