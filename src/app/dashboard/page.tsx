import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { sufijoTenant } from './sufijo';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { InicioContenido } from './inicio-contenido';
import { InicioOperacion } from './inicio-operacion';
import { getPerfilCrudo } from '@/lib/likida/repo';
import { onboardingFiscalListo } from '@/lib/likida/perfil/preguntas';

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
  const sufijo = sufijoTenant(sp);

  // El dueño declara el perfil ANTES de ver cifras. Sin el umbral de peaje el
  // motor es fail-closed: el estímulo queda en $0 hasta declarar (FISCAL
  // 19C2, forma.tsx), así que sin este paso el Resumen abriría mostrando un
  // $0 que probablemente no es el número real de la flota.
  // Un bache leyendo el perfil NO atrapa: mejor el panel a medias que la
  // puerta cerrada. El superadmin no se redirige — está viendo, no onboarding.
  //
  // AUDITORÍA 19, FE-19-1 (CRÍTICO): el `redirect()` NO puede vivir dentro
  // del `try`. Next lo implementa LANZANDO un `NEXT_REDIRECT` que el
  // framework atrapa arriba (docs empaquetados, `redirect.md:53`: «redirect
  // throws an error so it should be called **outside** the try block»), y el
  // `catch` desnudo que protege el bache de lectura se lo tragaba igual: la
  // compuerta no disparó nunca y el dueño aterrizaba SIEMPRE en el Resumen.
  // Por eso el `try` ahora envuelve SOLO la lectura, y la decisión sale
  // fuera: el bache sigue sin cerrar la puerta (`faltaOnboarding` se queda
  // en `false`), pero el redirect ya no tiene quién se lo coma.
  let faltaOnboarding = false;
  if (rol === 'flota_admin' && tenantExiste) {
    try {
      const perfil = await getPerfilCrudo(tenantId);
      faltaOnboarding = !onboardingFiscalListo(perfil);
    } catch { /* sigue al resumen */ }
  }
  if (faltaOnboarding) redirect(`/dashboard/onboarding${sufijo}`);

  if (!puedeVerArea(rol, 'dinero')) {
    return <InicioOperacion tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste} sufijo={sufijo} />;
  }

  return <InicioContenido tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste} sufijo={sufijo} />;
}
