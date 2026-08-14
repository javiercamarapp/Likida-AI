import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getKpis, detectarAnomalias, contarEscalados } from '@/lib/likida/analytics';
import { contarHuerfanosPendientes } from '@/lib/likida/repo';
import { getConexiones } from '@/lib/likida/conexiones';
import { calcularAlertasFlota } from '../calcular-alertas-flota';
import { sufijoTenant } from '../sufijo';
import { ListaAlertas } from './lista';

export const dynamic = 'force-dynamic';

/**
 * NOTIFICACIONES DE LA FLOTA — el patrón que Handle abre en su Inicio
 * ("alertas que necesitan tu atención" ANTES del panorama), aquí con página
 * propia como ya la tiene /admin.
 *
 * Antes de esto el panel del cliente tenía una campana que solo abría un
 * dropdown con dos textos sin liga, y solo existía en el Inicio: para
 * enterarte de que un viaje se escaló tenías que ir a buscarlo.
 *
 * CADA señal se lee por separado y CADA una puede fallar por su cuenta. Se
 * lee con `catch → null`, no con `catch → 0`: `calcularAlertasFlota` sabe
 * distinguirlos y confiesa lo que no pudo revisar. Un `Promise.all` que se
 * cae entero por una consulta rota dejaría la pantalla en blanco cuando
 * justamente hay algo que avisar.
 */
export default async function PaginaNotificaciones({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/notificaciones', sp);
  if (!puedeVerRuta(rol, '/dashboard/notificaciones')) redirect('/dashboard');

  const sufijo = sufijoTenant(sp);

  const [kpis, anomalias, escalados, huerfanos, conectores] = await Promise.all([
    getKpis(tenantId).catch(() => null),
    detectarAnomalias(tenantId).catch(() => null),
    contarEscalados(tenantId).catch(() => null),
    contarHuerfanosPendientes(tenantId).catch(() => null),
    getConexiones(tenantId).catch(() => null),
  ]);

  const alertas = calcularAlertasFlota(
    {
      porRevisar: kpis ? kpis.porRevisar : null,
      duplicados: anomalias ? anomalias.length : null,
      escalados,
      huerfanos,
      conectores,
    },
    sufijo,
    (href) => puedeVerRuta(rol, href),
  );

  return <ListaAlertas alertas={alertas} />;
}
