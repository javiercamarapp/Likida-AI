import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import AdminChrome from './chrome';
import '../ui-v2/tokens.css';
import '../ui-v2/componentes.css';
import '../ui-v2/overlay.css';
import '../ui-v2/piezas.css';
import '../ui-v2/barra-periodo.css';

export const dynamic = 'force-dynamic';

// Plantilla del título de pestaña de /admin (cada page.tsx aporta su nombre).
export const metadata: Metadata = { title: { default: 'Admin · Likida', template: '%s · Admin · Likida' } };

/**
 * La puerta de /admin — el `requireSuperadmin()` vive AQUÍ y gatea el layout
 * entero: ninguna página nueva bajo /admin puede olvidarlo. El marco visual
 * vive en `chrome.tsx` (mismo reparto que /dashboard: layout = puerta,
 * chrome = dibujo verificable sin sesión).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { nombre, avatarUrl } = await requireSuperadmin();

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <AdminChrome nombre={nombre ?? null} avatarUrl={avatarUrl ?? null} cerrarSesion={cerrarSesion}>
      {children}
    </AdminChrome>
  );
}
