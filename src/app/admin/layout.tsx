import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import AdminChrome from './chrome';

export const dynamic = 'force-dynamic';

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
