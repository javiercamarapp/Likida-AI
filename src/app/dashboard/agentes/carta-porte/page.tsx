import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { getEstadoCartaPorte, type EstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { ultimasCorridas } from '@/lib/likida/agentes/corridas';
import { dominioBuzon } from '@/lib/correo/buzon';
import { direccionCp } from '@/lib/likida/carta_porte_docs/correo_entrante';
import * as repoDocs from '@/lib/likida/carta_porte_docs/repo';
import { calcularInsights, type InsightsAgente } from '@/lib/likida/carta_porte_docs/metricas';
import { listarViajesSinCcp, type ListadoSinCcp } from '@/lib/likida/carta_porte_docs/viajes_sin_ccp';
import { sufijoTenant } from '../../sufijo';
import { VistaAgenteCartaPorte, type BuzonCartaPorteVista } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';
import { FichaCorridas } from '../ficha-corridas';
import { Bloque, EsqTabla } from '../../bloque';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/carta-porte';
const DIAS_INSIGHTS = 30;

/** Insights del agente (T-A3-37). `'no_leido'` = la lectura falló: la vista lo dice, no pinta ceros. */
async function leerInsights(tenantId: string): Promise<{ insights: InsightsAgente | 'no_leido'; nombres: Record<string, string> }> {
  try {
    const desde = new Date(Date.now() - DIAS_INSIGHTS * 86_400_000);
    const [lista, clientes, envios, causas] = await Promise.all([
      repoDocs.listarDocumentos(tenantId, { desde: desde.toISOString(), limite: 500 }),
      repoDocs.listarClientes(tenantId),
      repoDocs.enviosParaInsights(tenantId, desde),
      repoDocs.contarCausasDeRechazo(tenantId, desde),
    ]);
    const aprobados = lista.filas.filter((d) => d.estado === 'aprobado').map((d) => d.id);
    const [correcciones, campos] = await Promise.all([
      repoDocs.contarCorreccionesPorDocumento(tenantId, aprobados),
      repoDocs.contarCorreccionesPorCampo(tenantId, aprobados),
    ]);
    const nombresCliente = new Map(clientes.map((c) => [c.id, c.nombre]));
    return {
      insights: calcularInsights({ docs: lista.filas, correcciones, camposCorregidos: campos, causasRechazo: causas, envios, nombresCliente, ahora: new Date() }),
      nombres: Object.fromEntries(nombresCliente),
    };
  } catch {
    return { insights: 'no_leido', nombres: {} };
  }
}

/** Viajes salidos sin Carta Porte (T-A3-66). `'no_leido'` = la lectura falló: la vista lo dice, no pinta «sin pendientes». */
async function leerSinCcp(tenantId: string): Promise<ListadoSinCcp | 'no_leido'> {
  try {
    const ahora = new Date();
    const { viajes, conCcp, truncado } = await repoDocs.leerSalidasParaSinCcp(tenantId, ahora);
    return { ...listarViajesSinCcp(viajes, conCcp, ahora), ...(truncado ? { truncado: true } : {}) };
  } catch {
    return 'no_leido';
  }
}

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

  // El buzón de correo de la flota: 'no_leido' si la lectura falla (jamás «sin buzón» inventado).
  let buzon: BuzonCartaPorteVista | null | 'no_leido';
  try {
    const fila = await repoDocs.buzonDeFlota(tenantId);
    const dominio = dominioBuzon();
    buzon = fila ? { direccion: direccionCp(fila.token, dominio), activo: fila.activo, remitentes: fila.remitentesPermitidos, dominioConfigurado: dominio !== null } : null;
  } catch {
    buzon = 'no_leido';
  }

  // La ficha de corridas (B3): null = no se pudo leer, y la ficha lo dice.
  const { insights, nombres } = await leerInsights(tenantId);

  const sinCcp = await leerSinCcp(tenantId);

  const pCorridas = ultimasCorridas(tenantId, 'carta_porte').catch(() => null);

  return (
    <VistaAgenteCartaPorte
      datos={datos}
      sufijo={sufijoTenant(sp)}
      buzon={buzon}
      insights={insights}
      sinCcp={sinCcp}
      nombresCliente={nombres}
      diasVentana={DIAS_INSIGHTS}
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
