import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';
import { armarPasos, resumenMarcha } from '@/lib/likida/puesta_en_marcha';
import { leerSenalesMarcha } from '@/lib/likida/puesta_en_marcha_lectura';
import { sufijoTenant } from '../sufijo';
import { AUTOMATIZACIONES } from '../rutas';
import { VistaPuestaEnMarcha } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/arranque';

/**
 * LA PUESTA EN MARCHA (W2 «producto»): el checklist guiado con estado real. Área
 * `operacion` (cero pesos): el dueño ve y hace todo; el jefe de tráfico ve el
 * avance y hace los pasos de operación (los de configuración le dicen «lo hace
 * quien administra»). Las señales se leen por separado: una caída no la tumba.
 */
export default async function PaginaPuestaEnMarcha({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  const senales = await leerSenalesMarcha(tenantId);
  const pasos = armarPasos(senales, sufijo);

  const hrefAutomatizacion: Record<string, string | null> = {};
  for (const a of AUTOMATIZACIONES) hrefAutomatizacion[a.href] = puedeVerRuta(rol, a.href) ? `${a.href}${sufijo}` : null;

  return (
    <VistaPuestaEnMarcha
      pasos={pasos} resumen={resumenMarcha(pasos)}
      puedeAdministrar={puedeAdministrar(rol)} hrefAutomatizacion={hrefAutomatizacion}
    />
  );
}
