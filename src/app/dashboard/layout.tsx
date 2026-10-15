import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { leerSeleccionFlota } from '@/lib/auth/admin-context';
import { topeDiaUsd, gastoChatHoyUsd } from '@/app/api/dashboard/chat/tope';
import DashboardChrome from './chrome';
import { PulsoProducto } from './pulso-producto';
import { AvisoLegalPendiente } from './aviso-legal';

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
  // El perfil de la flota (0770) recorta el menú. Para un superadmin es la flota
  // que eligió en el selector; con `?tenant=` el layout no ve el parámetro (limitación
  // de Next), pero las PÁGINAS sí aplican el perfil de la flota que miran.
  const tenantDelMenu = sesion.tenantId ?? (sesion.rol === 'superadmin' ? await leerSeleccionFlota() : null);
  const perfil = await perfilDeTenant(tenantDelMenu);

  let usoIa: { pct: number } | null | undefined;
  if (!perfil && sesion.rol !== 'superadmin' && sesion.tenantId && puedeVerArea(sesion.rol, 'dinero')) {
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
    <DashboardChrome nombre={sesion.nombre} rol={sesion.rol} cerrarSesion={cerrarSesion} usoIa={usoIa} perfil={perfil}>
      {/* El pulso de producto (0251): un POST de fuego-y-olvido por cambio de
          ruta. El servidor decide tenant (sesión) y pantalla (catálogo
          cerrado); el superadmin en preview se descarta allá. */}
      <PulsoProducto />
      <AvisoLegalPendiente sesion={sesion} />
      {children}
    </DashboardChrome>
  );
}
