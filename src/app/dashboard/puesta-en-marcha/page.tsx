import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { leerSenalesAsistente } from '@/lib/likida/asistente/senales';
import { sufijoTenant } from '../sufijo';
import type { IdPaso } from '@/lib/likida/asistente/pasos_cinco_agentes';
import { VistaPuestaEnMarcha } from './vista';

const PASOS: readonly IdPaso[] = ['equipo', 'tms', 'correo', 'catalogos', 'carta_porte', 'simulacro', 'whatsapp', 'peajes', 'vigia_conductor', 'legal'];

export const dynamic = 'force-dynamic';

/** La puerta de la ruta: esta cadena se clasifica en `AREA_POR_RUTA` y `RUTAS_PERFIL_CINCO_AGENTES` (visibilidad.ts). */
const RUTA = '/dashboard/puesta-en-marcha';

/**
 * Puesta en marcha — el asistente de conexiones del dueño (PLAN-MAESTRO §2.5).
 *
 * Ruta NUEVA y delgada: no reutiliza `/dashboard/arranque`, cuyas lecturas tocan recursos que el perfil niega. Las señales
 * salen de lectores que ya existen (`lib/likida/asistente/senales.ts`, sin consultas propias) y cada una cae a «no se pudo
 * comprobar» por separado. La pantalla (cliente) suma lo que la persona declara en su navegador.
 */
export default async function PaginaPuestaEnMarcha({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; paso?: string }>;
}) {
  const sp = await searchParams;
  const s = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(s.rol, RUTA)) redirect('/dashboard');

  const senales = await leerSenalesAsistente(s.tenantId);
  // Viendo como otra persona (superadmin con ?tenant/?vista/?rol): se mira, pero no se escribe progreso.
  const soloLectura = Boolean(sp.tenant || sp.vista || sp.rol || s.tenantNombre);

  return (
    <main className="h-full">
      <VistaPuestaEnMarcha
        senales={senales}
        ambito={`${s.tenantId}:${s.userId}`}
        tenantId={s.tenantId}
        sufijo={sufijoTenant(sp)}
        soloLectura={soloLectura}
        pasoInicial={PASOS.find((x) => x === sp.paso)}
      />
    </main>
  );
}
