import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseServer } from '@/lib/supabase/server';
import { costoIaMesActual } from '@/lib/admin/negocio';
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

  // El widget de uso del sidebar (16-ago-2026): el costo de IA del mes,
  // medido con la misma agregación SQL de la consola. `null` = no se pudo
  // leer, y el widget lo dice — jamás un $0 con cara de medición.
  const usoIa = await costoIaMesActual().catch(() => null);

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <AdminChrome nombre={nombre ?? null} avatarUrl={avatarUrl ?? null} cerrarSesion={cerrarSesion} usoIa={usoIa}>
      {children}
    </AdminChrome>
  );
}
