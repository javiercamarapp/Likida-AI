import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getEstadoCartaPorte, type EstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { ultimasCorridas } from '@/lib/likida/agentes/corridas';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteCartaPorte } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';
import { Bloque, EsqTabla } from '../../bloque';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/carta-porte';

/**
 * Agente de Carta Porte (Fases B-C del blueprint 20-Agente-Carta-Porte) — la
 * ventana del agente que corre el árbol legal al despachar y le pregunta al
 * jefe por WhatsApp lo que falta declarar. Área `operacion`: cero pesos, y el
 * usuario diario es el jefe de tráfico (misma razón que su pantalla hermana
 * /dashboard/carta-porte, donde vive la captura).
 */
export default async function PaginaAgenteCartaPorte({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // null = no se pudo leer, y la vista lo dice — jamás un semáforo vacío que
  // se lea como "todo en regla".
  let datos: EstadoCartaPorte | null;
  try {
    datos = await getEstadoCartaPorte(tenantId);
  } catch {
    datos = null;
  }

  // La ficha de corridas (B3): null = no se pudo leer, y la ficha lo dice.
  const pCorridas = ultimasCorridas(tenantId, 'carta_porte').catch(() => null);

  return (
    <VistaAgenteCartaPorte
      datos={datos}
      sufijo={sufijoTenant(sp)}
      notificaciones={
        <>
          <Bloque mensaje="No se pudo leer la bitácora de corridas." esqueleto={<EsqTabla filas={3} />}>
            <BloqueCorridas pCorridas={pCorridas} />
          </Bloque>
          <Bloque mensaje="No se pudo leer la configuración de avisos." esqueleto={<EsqTabla filas={4} />}>
            <SeccionNotificaciones tenantId={tenantId} agenteId="carta_porte" />
          </Bloque>
        </>
      }
    />
  );
}

async function BloqueCorridas({ pCorridas }: {
  pCorridas: Promise<Awaited<ReturnType<typeof ultimasCorridas>> | null>;
}) {
  return <FichaCorridas corridas={await pCorridas} />;
}
