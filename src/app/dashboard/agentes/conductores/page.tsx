import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getViajes, contarEscalados, getEventosConductores } from '@/lib/likida/analytics';
import { ahoraMs } from '@/lib/saludo';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteConductores, type EsperaAceptar } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';

export const dynamic = 'force-dynamic';

/** Sección secundaria que no se pudo leer → null → su leyenda honesta. */
function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/**
 * Agente de Conductores (F4 del plan) — la ventana del agente que habla con
 * los choferes: avisa el viaje, persigue la aceptación (y escala a las 5 h),
 * sella los hitos "ya llegué / descargando / de regreso" (0090) y recibe al
 * jefe despachando por WhatsApp.
 *
 * Área `operacion` y no `dinero` como sus hermanos: este agente no toca un
 * peso, y su usuario diario ES el jefe de tráfico. CERO pesos en pantalla.
 */
export default async function PaginaAgenteConductores({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/conductores', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/conductores')) redirect('/dashboard');

  const [viajes, escalados, eventos] = await Promise.all([
    getViajes(tenantId),
    contarEscalados(tenantId),
    safe(() => getEventosConductores(tenantId)),
  ]);

  const ahora = ahoraMs();
  const vivos = viajes.filter((v) => v.estatus === 'abierto' || v.estatus === 'en_cuadre');

  // La cola honesta: avisados que no han dicho que sí (y aún no se escalan).
  const esperan: EsperaAceptar[] = vivos
    .filter((v) => v.avisadoEn !== null && v.aceptadoEn === null && v.escaladoEn === null)
    .map((v) => ({
      id: v.id,
      folio: v.folio,
      operadorNombre: v.operadorNombre,
      horasDesdeAviso: Math.floor((ahora - Date.parse(v.avisadoEn as string)) / 3_600_000),
      avisos: v.avisosEnviados,
    }))
    .sort((a, b) => b.horasDesdeAviso - a.horasDesdeAviso);

  const sinAvisar = vivos.filter((v) => v.avisadoEn === null && v.operadorNombre !== null).length;

  return (
    <VistaAgenteConductores
      kpis={{
        vivos: vivos.length,
        aceptados: vivos.filter((v) => v.aceptadoEn !== null).length,
        esperan: esperan.length,
        escalados,
      }}
      esperan={esperan}
      sinAvisar={sinAvisar}
      eventos={eventos}
      sufijo={sufijoTenant(sp)}
      notificaciones={<SeccionNotificaciones tenantId={tenantId} agenteId="conductores" />}
    />
  );
}
