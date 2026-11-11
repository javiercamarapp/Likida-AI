import type { Metadata } from 'next';
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
import '../ui-v2/pie-sidebar.css';
import '../ui-v2/carga.css';
// Piezas del carril B (botones, chips, drawers, KPI, gráficas, recorrido) y páginas del carril C. Nadie las importaba todavía.
import '../ui-v2/componentes.css';
import '../ui-v2/overlay.css';
import '../ui-v2/piezas.css';
import '../ui-v2/barra-periodo.css';
import '../ui-v2/graficas.css';
import '../ui-v2/datos.css';
import '../ui-v2/movimiento.css';
import '../ui-v2/onboarding.css';
import '../ui-v2/chat.css';
import '../ui-v2/paginas.css';
import '../ui-v2/paginas-dominio.css';
import { PulsoProducto } from './pulso-producto';
import { AvisoLegalPendiente } from './aviso-legal';
import { AvisoPlanEnPausa } from './aviso-plan-en-pausa';
import { TourProvider } from '../ui-v2/movimiento/tour';
import { onboardingDeLaSesion } from './recorridos';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { guardarEstadoGuia, leerSenalesDeLaGuia, registrarEventosGuia } from '@/lib/likida/guia/acciones';
import { invitacionEncendida, leerEstado } from '@/lib/likida/guia/repo';
import type { EstadoGuia } from '@/lib/likida/guia/tipos';
import { insigniaDeCookie, nombreCookieAvance } from './puesta-en-marcha/progreso';
import { IdiomaProvider } from '@/lib/i18n/proveedor';
import { datosParaProveedor } from '@/lib/i18n/servidor';
import { resolverBandeja } from '@/lib/avisos/bandeja';
import { leerAvisosFlota } from '@/lib/avisos/fuente-flota';

// Título de la pestaña: cada pantalla exporta su nombre (el del menú) y la plantilla le pone «· Likida».
export const metadata: Metadata = { title: { default: 'Likida — Liquidación de viajes', template: '%s · Likida' } };

export const dynamic = 'force-dynamic';

const HREF_AVISOS = '/dashboard/notificaciones';

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
  // La versión de interfaz (`tenant_ui`; sin fila = v2, por omisión) se lee en el MISMO Promise.all que el perfil. `versionUi` nunca lanza:
  // un bache de lectura sin valor previo cae en v2; solo una fila `v1` explícita deja el panel anterior.
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

  // Nombre de la flota para el selector «Organización» del pie (solo v2). `null` = no se pudo leer: el pie dice «Sin dato».
  let organizacion: { id: string; nombre: string } | null | undefined;
  if (ui === 'v2' && tenantDelMenu) {
    try {
      const { data, error } = await supabaseAdmin().from('tenant').select('nombre').eq('id', tenantDelMenu).maybeSingle();
      organizacion = !error && data?.nombre ? { id: tenantDelMenu, nombre: String(data.nombre) } : null;
    } catch { organizacion = null; }
  }

  // Solo el SUPERADMIN (v2): la lista de flotas para el pie. El layout no ve `?tenant=`; el pie (cliente) elige el nombre con esta lista y la URL.
  // Lectura acotada, con orden y desempate; caída = `null` y el pie dice «Sin dato» (nunca el nombre de otra flota). Quien es de flota no la recibe.
  let flotas: Array<{ id: string; nombre: string }> | null | undefined;
  if (ui === 'v2' && sesion.rol === 'superadmin') {
    try {
      const { data, error } = await supabaseAdmin().from('tenant').select('id, nombre').order('nombre').order('id').limit(1000);
      flotas = !error && data ? data.map((t) => ({ id: String(t.id), nombre: String(t.nombre ?? t.id) })) : null;
    } catch { flotas = null; }
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
  const onb = v2 ? onboardingDeLaSesion(sesion.rol, perfil) : null;
  const rutasDelRecorrido = (onb?.rutas ?? []).filter((r) => puedeVerRuta(sesion.rol, r, perfil));
  // Estado de la guía por persona y flota (0983) e interruptor de la invitación por flota: una lectura por carga del panel. Si la tabla
  // no existe todavía o la base falla, la guía sigue con su respaldo local y la invitación sigue el interruptor global. «Ver como» no lee ni escribe.
  let estadoGuia: { estado: EstadoGuia; version: number } | null = null;
  let invitacionDeLaFlota = false;
  if (onb?.principal && tenantDelMenu && sesion.rol !== 'superadmin') {
    try {
      const db = supabaseAdmin();
      const [leido, encendida] = await Promise.all([leerEstado(db, sesion.userId, tenantDelMenu), invitacionEncendida(db, tenantDelMenu)]);
      if (leido.ok) estadoGuia = { estado: leido.estado, version: leido.version };
      invitacionDeLaFlota = encendida;
    } catch { /* respaldo local */ }
  }
  // El número de «Avisos» del pie: los no leídos de ESTA persona, de la MISMA bandeja que pinta /dashboard/notificaciones. Solo para roles
  // reales de una flota: un superadmin «viendo como» puede estar mirando otra flota que la del layout (que no ve `?tenant=`), y un número
  // de otra flota bajo este encabezado mentiría; ahí el pie no lleva cifra. Lectura caída = sin cifra, nunca 0.
  let avisosPendientes: string | undefined;
  if (v2 && sesion.rol !== 'superadmin' && sesion.tenantId && puedeVerRuta(sesion.rol, HREF_AVISOS, perfil)) {
    try {
      const b = await resolverBandeja(await supabaseServer(), { tipo: 'flota', tenantId: sesion.tenantId }, sesion.userId, await leerAvisosFlota(sesion.tenantId, sesion.rol));
      if (b.noLeidos !== null) avisosPendientes = String(b.noLeidos);
    } catch { /* sin cifra */ }
  }
  const insignias: Record<string, string> = {
    ...(avance ? { '/dashboard/puesta-en-marcha': avance } : {}),
    ...(avisosPendientes !== undefined ? { [HREF_AVISOS]: avisosPendientes } : {}),
  };
  const contenido = (
    <>
      {/* El pulso de producto (0251): un POST de fuego-y-olvido por cambio de
          ruta. El servidor decide tenant (sesión) y pantalla (catálogo
          cerrado); el superadmin en preview se descarta allá. */}
      <PulsoProducto />
      {children}
      {/* Después de la pantalla, no antes: el aviso no bloquea y no debe quedar por encima del título de cada página. */}
      <AvisoLegalPendiente sesion={sesion} />
      <AvisoPlanEnPausa tenantId={tenantDelMenu} />
    </>
  );

  const marco = (
    <Chrome
      nombre={sesion.nombre} rol={sesion.rol} cerrarSesion={cerrarSesion} usoIa={usoIa} perfil={perfil}
      {...(v2 && Object.keys(insignias).length > 0 ? { insignias } : {})}
      {...(v2 && organizacion !== undefined ? { organizacion } : {})}
      {...(v2 && flotas !== undefined ? { flotas } : {})}
    >
      {contenido}
    </Chrome>
  );

  // El motor del recorrido envuelve TODO el chrome (no solo la página): el menú Guía vive en la barra superior y necesita su contexto.
  // Idioma de la interfaz (i18n P0): cookie > preferencia del usuario > es. El layout RAÍZ no lo lee (públicas estáticas).
  const idiomaDatos = await datosParaProveedor(['shell', 'operacion', 'avisos', 'resto']);
  const arbol = onb && onb.principal ? (
    <TourProvider
      recorridos={onb.recorridos} ambito={`${tenantDelMenu ?? 'sin'}:${sesion.userId}`}
      soloLectura={sesion.rol === 'superadmin'} rutasPermitidas={rutasDelRecorrido}
      principal={onb.principal} asistente={onb.asistente} pistas={onb.pistas} invitacion={(process.env.ONBOARDING_INVITACION === '1' || invitacionDeLaFlota) && jarra.get('likida_onb_visto')?.value !== '1'}
      estadoServidor={estadoGuia} guardarRemoto={guardarEstadoGuia} leerSenales={leerSenalesDeLaGuia} registrarEventos={registrarEventosGuia}
    >
      {marco}
    </TourProvider>
  ) : marco;
  return <IdiomaProvider idioma={idiomaDatos.idioma} diccionarios={idiomaDatos.diccionarios}>{arbol}</IdiomaProvider>;
}
