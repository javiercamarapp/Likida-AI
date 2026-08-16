import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { topeDiaUsd, gastoChatHoyUsd } from '@/app/api/dashboard/chat/tope';
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

  // El widget de uso del sidebar (16-ago-2026): cuánto del presupuesto
  // diario de análisis con IA lleva usado HOY el tenant — el MISMO número
  // que frena al endpoint del chat (./api/dashboard/chat/tope.ts). Solo
  // para roles reales con acceso al análisis: en el preview del superadmin
  // el tenant de la sesión no es el que se está viendo, y un widget con el
  // tenant equivocado mentiría. `null` = no se pudo leer, y se dice.
  let usoIa: { pct: number } | null | undefined;
  if (sesion.rol !== 'superadmin' && sesion.tenantId && puedeVerArea(sesion.rol, 'dinero')) {
    try {
      const hoyUsd = await gastoChatHoyUsd(sesion.tenantId);
      const tope = topeDiaUsd();
      usoIa = { pct: tope > 0 ? Math.min(100, Math.round((hoyUsd / tope) * 100)) : 0 };
    } catch {
      usoIa = null;
    }
  }

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  return (
    <DashboardChrome nombre={sesion.nombre} rol={sesion.rol} cerrarSesion={cerrarSesion} usoIa={usoIa}>
      {children}
    </DashboardChrome>
  );
}
