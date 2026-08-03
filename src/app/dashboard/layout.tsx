import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';
import DashboardChrome from './chrome';

export const dynamic = 'force-dynamic';

/**
 * La puerta de /dashboard — el panel del CLIENTE (flota_admin). El marco
 * visual vive en `chrome.tsx`; aquí solo la autorización.
 *
 * El gate es DELIBERADAMENTE ligero (solo "hay sesión"): la resolución real
 * de tenant/rol/superadmin-viendo-flota vive en `resolverTenantEfectivo` y
 * la corre CADA página, porque necesita sus propios `searchParams`
 * (`?tenant=`/`?vista=demo`) — algo que un layout de Next.js no recibe. Sin
 * sesión del todo, no hace falta esperar a la página para rebotar a /login.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sesion = await getSessionTenant();
  if (!sesion) redirect('/login?next=%2Fdashboard');

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <DashboardChrome nombre={sesion.nombre} rol={sesion.rol} cerrarSesion={cerrarSesion}>
      {children}
    </DashboardChrome>
  );
}
