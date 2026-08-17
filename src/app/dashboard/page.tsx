import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { InicioContenido } from './inicio-contenido';
import { InicioOperacion } from './inicio-operacion';

export const dynamic = 'force-dynamic';

/** La página real: resuelve quién eres y a qué flota apuntas, y pinta el
 *  contenido (`inicio-contenido.tsx` — vive aparte para que el preview
 *  headless pueda montarlo sin sesión y porque Next rechaza exports extra
 *  en una Page). Un superadmin sin `?tenant=`/`?vista=demo` NI flota elegida
 *  en /admin/elegir-flota ya no llega aquí: `requireSessionTenant` lo manda
 *  al selector — el tenant implícito murió el 16-ago-2026 (ver guard.ts). */
export default async function DashboardInicio({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rango?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantNombre, nombre, rol, tenantExiste } = await resolverTenantEfectivo('/dashboard', sp);

  // DOS CASAS DISTINTAS EN LA MISMA PUERTA.
  //
  // El Resumen de arriba es del DUEÑO: abre con lo que el motor señaló en
  // pesos, los acreditables fiscales y el monto comprobado. El encargado no
  // ve nada de eso (visibilidad.ts), así que aterrizaba en una pantalla
  // hecha para otro rol. No se le esconden secciones al Resumen del dueño —
  // eso deja un queso gruyere—: se le da su propia pantalla, con las mismas
  // piezas y otro contenido.
  //
  // El criterio es "¿ve dinero?" y no "¿es encargado?": un rol nuevo que
  // tampoco vea finanzas cae aquí solo, sin tocar esta línea.
  // El MISMO contrato de sufijo que el sidebar (sidebar-nav.tsx): los links
  // que esta página emite (tabla de viajes → detalle de liquidación) cargan
  // el ?tenant=/?vista= del superadmin; para roles reales queda vacío.
  const base = sp.tenant ? `?tenant=${sp.tenant}` : sp.vista ? `?vista=${sp.vista}` : '';
  const sufijo = sp.rol ? `${base}${base ? '&' : '?'}rol=${sp.rol}` : base;

  if (!puedeVerArea(rol, 'dinero')) {
    return <InicioOperacion tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste} sufijo={sufijo} />;
  }

  return <InicioContenido tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste} sufijo={sufijo} />;
}
