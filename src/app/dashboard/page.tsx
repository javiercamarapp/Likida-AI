import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { sufijoTenant } from './sufijo';
import { puedeVerArea, puedeVerRuta } from '@/lib/auth/visibilidad';
import { InicioCincoAgentes, leerInsightsResumen } from './inicio-cinco-agentes';
import { ResumenV2 } from './resumen-v2';
import { leerRango } from './resumen-datos';
import { perfilDeTenant } from '@/lib/auth/perfil_tenant';
import { getPerfilCrudo } from '@/lib/likida/repo';
import { onboardingFiscalListo, onboardingPospuesto } from '@/lib/likida/perfil/preguntas';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Resumen' };

export const dynamic = 'force-dynamic';

/** La página real: resuelve quién eres y a qué flota apuntas, y pinta el
 *  Resumen (`resumen-v2.tsx`, o `inicio-cinco-v2.tsx` bajo el perfil de cinco
 *  agentes). El respaldo v1 (`InicioContenido`/`InicioOperacion`) se retiró el
 *  11-nov-2026: ninguna flota lo usaba en producción. Un superadmin sin `?tenant=`/`?vista=demo` NI flota elegida
 *  en /admin/elegir-flota ya no llega aquí: `requireSessionTenant` lo manda
 *  al selector — el tenant implícito murió el 16-ago-2026 (ver guard.ts). */
export default async function DashboardInicio({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rango?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantNombre, nombre, rol, tenantExiste, userId } = await resolverTenantEfectivo('/dashboard', sp);

  // EL PERFIL DE LA FLOTA (0770): una flota con perfil `cinco_agentes` tiene su
  // propio Resumen reducido a los cinco agentes y NO pasa por el onboarding
  // fiscal (su pantalla está en stand-by: redirigir allá sería un bucle contra
  // el propio perfil). Sin perfil, todo sigue como antes.
  const perfilFlota = await perfilDeTenant(tenantId);
  if (perfilFlota) {
    return (
      <InicioCincoAgentes
        tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste} sufijo={sufijoTenant(sp)}
        userId={userId} soloLectura={Boolean(sp.tenant || sp.vista || sp.rol || tenantNombre)}
        veAsistente={puedeVerRuta(rol, '/dashboard/puesta-en-marcha', perfilFlota)}
        // DECISIÓN (31-oct-2026): el perfil `cinco_agentes` SÍ ve pesos en el Inicio, pero solo dueño y finanzas, y solo por el lector
        // propio `leerCifrasPesosCincoAgentes` (importe IAVE y extemporáneos). El encargado nunca.
        rango={leerRango(sp.rango)} rol={rol}
      />
    );
  }

  // El criterio de las dos casas es «¿ve dinero?» y no «¿es encargado?»: el Resumen v2 recibe `veDinero` y pinta los mismos
  // recuadros con conteos (sin ningún peso) para un rol sin dinero; un rol nuevo que tampoco vea finanzas cae ahí solo.
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
  // W2: quien eligió «lo confirmo con mi contador» NO queda sin Resumen (el candado
  // dejaba inalcanzable el Resumen a un director que no conoce sus ingresos anuales
  // de memoria). El Resumen se abre con un aviso permanente de que el estímulo de
  // peaje sigue en $0 hasta declarar — ver `avisoFiscalPospuesto` abajo.
  let avisoFiscalPospuesto = false;
  if (rol === 'flota_admin' && tenantExiste) {
    try {
      const perfil = await getPerfilCrudo(tenantId);
      const listo = onboardingFiscalListo(perfil);
      const pospuesto = onboardingPospuesto(perfil);
      faltaOnboarding = !listo && !pospuesto;
      avisoFiscalPospuesto = !listo && pospuesto;
    } catch { /* sigue al resumen */ }
  }
  if (faltaOnboarding) redirect(`/dashboard/onboarding${sufijo}`);

  // Los enlaces y los insights del Resumen se limitan a lo que ESE rol abre.
  const { principales, fallidos } = await leerInsightsResumen(tenantId, rol, null);
  return (
    <ResumenV2
      tenantId={tenantId} userId={userId ?? 'sin-usuario'} tenantNombre={tenantNombre} nombre={nombre} tenantExiste={tenantExiste}
      sufijo={sufijo} soloLectura={Boolean(sp.tenant || sp.vista || sp.rol || tenantNombre)}
      veAsistente={false} veDinero={puedeVerArea(rol, 'dinero')} rango={leerRango(sp.rango)}
      principales={principales} fallidos={fallidos} rol={rol} perfil={null} avisoFiscalPospuesto={avisoFiscalPospuesto}
    />
  );
}
