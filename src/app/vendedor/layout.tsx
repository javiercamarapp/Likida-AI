import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { requireVendedor } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import Fondo from '../fondo';
import { Logo } from '../logo';

export const dynamic = 'force-dynamic';

/**
 * El chrome de /vendedor — MÍNIMO a propósito: una barra con logo, quién
 * eres y salir. El vendedor tiene UNA pantalla (su tablero); un sidebar
 * anunciaría secciones que no existen, y un link que no lleva a nada es un
 * rótulo que miente.
 *
 * `requireVendedor()` vive AQUÍ, como `requireSuperadmin()` en
 * admin/layout.tsx: gatea el layout entero y ninguna página futura bajo
 * /vendedor puede olvidarlo. Es la SEGUNDA capa — la primera es el proxy
 * (`RUTAS_CON_SESION` incluye /vendedor) — y las dos tienen que fallar a la
 * vez para servir esto sin autorización.
 */
export default async function VendedorLayout({ children }: { children: React.ReactNode }) {
  const { nombre, rol } = await requireVendedor();

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <div className="min-h-dvh tema-neutro" style={{ fontFamily: 'var(--font-sans-ui), var(--font-sans)' }}>
      <Fondo />
      <div className="relative z-10 max-w-6xl mx-auto p-4 space-y-3">
        <header className="glass-panel rounded-2xl px-4 h-14 flex items-center gap-2.5">
          <Logo alto="h-5" />
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--line)' }}>
            VENDEDORES
          </span>
          {/* El superadmin entra por soporte y la cinta lo dice: sin ella,
              esta pantalla se confundiría con la vista real de un vendedor. */}
          {rol === 'superadmin' && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
              viendo como superadmin · todos los prospectos
            </span>
          )}
          <span className="ml-auto text-[13px] font-medium truncate">{nombre ?? ''}</span>
          <form action={cerrarSesion}>
            <button type="submit" title="Cerrar sesión"
              className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-85"
              style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              <LogOut width={14} height={14} strokeWidth={1.75} />
              Salir
            </button>
          </form>
        </header>
        {children}
      </div>
    </div>
  );
}
