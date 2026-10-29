import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { versionUi } from '@/lib/auth/version_ui';
import { leerSeleccionFlota } from '@/lib/auth/admin-context';
import { topeDiaUsd, gastoChatHoyUsd } from '@/app/api/dashboard/chat/tope';
import DashboardChrome from './chrome';
import DashboardChromeV2 from './shell/chrome-v2';
// UI v2 (rediseño): el CSS se importa SOLO aquí (CSS por ruta; nunca desde globals.css, para que no llegue a login, landing
// ni /admin). Todo cuelga de `[data-ui="v2"]`: sin ese atributo en el div raíz del chrome estos archivos son inertes y v1
// pinta idéntico (se mide con capturas). Las fuentes solo se descargan si algún texto bajo el alcance las usa.
import '../ui-v2/tokens.css';
import '../ui-v2/fonts.css';
import '../ui-v2/shell.css';
// Piezas del carril B (botones, chips, drawers, KPI, gráficas, recorrido) y páginas del carril C. Nadie las importaba todavía.
import '../ui-v2/componentes.css';
import '../ui-v2/graficas.css';
import '../ui-v2/movimiento.css';
import '../ui-v2/paginas.css';
import '../ui-v2/paginas-dominio.css';
import '../ui-v2/premium.css';
import { PulsoProducto } from './pulso-producto';
import { AvisoLegalPendiente } from './aviso-legal';
import { TourProvider } from '../ui-v2/movimiento/tour';
import { RECORRIDOS_DASHBOARD, rutasDeRecorridos } from './recorridos/dueno';
import { insigniaDeCookie, nombreCookieAvance } from './puesta-en-marcha/progreso';

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
  // La versión de interfaz (`tenant_ui`; sin fila = v1) se lee en el MISMO Promise.all que el perfil. `versionUi` nunca lanza
  // y falla hacia v1: un bache de lectura deja el panel de siempre, no el nuevo.
  const jarra = await cookies();
  const [perfil, ui] = await Promise.all([
    perfilDeTenant(tenantDelMenu),
    versionUi(tenantDelMenu, sesion.rol, jarra),
  ]);

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

  // El chrome de siempre NO se toca; v2 es otro componente con el mismo contrato de props.
  const Chrome = ui === 'v2' ? DashboardChromeV2 : DashboardChrome;

  // Solo v2: el avance de «Puesta en marcha» como insignia del menú (la pantalla del asistente deja en una cookie solo
  // «listos/total»; `insigniaDeCookie` descarta cualquier otro valor) y el motor del recorrido guiado, que nunca se abre
  // solo. Los pasos del recorrido se limitan a las rutas que ESTE rol ve en ESTE perfil.
  const v2 = ui === 'v2';
  const avance = v2 && perfil && tenantDelMenu ? insigniaDeCookie(jarra.get(nombreCookieAvance(tenantDelMenu))?.value) : null;
  const rutasDelRecorrido = rutasDeRecorridos().filter((r) => puedeVerRuta(sesion.rol, r, perfil));
  const contenido = (
    <>
      {/* El pulso de producto (0251): un POST de fuego-y-olvido por cambio de
          ruta. El servidor decide tenant (sesión) y pantalla (catálogo
          cerrado); el superadmin en preview se descarta allá. */}
      <PulsoProducto />
      <AvisoLegalPendiente sesion={sesion} />
      {children}
    </>
  );

  return (
    <Chrome
      nombre={sesion.nombre} rol={sesion.rol} cerrarSesion={cerrarSesion} usoIa={usoIa} perfil={perfil}
      {...(v2 && avance ? { insignias: { '/dashboard/puesta-en-marcha': avance } } : {})}
    >
      {v2 && perfil ? (
        <TourProvider
          recorridos={RECORRIDOS_DASHBOARD} ambito={`${tenantDelMenu ?? 'sin'}:${sesion.userId}`}
          soloLectura={sesion.rol === 'superadmin'} rutasPermitidas={rutasDelRecorrido}
        >
          {contenido}
        </TourProvider>
      ) : contenido}
    </Chrome>
  );
}
