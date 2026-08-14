import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta, puedeVerArea } from '@/lib/auth/visibilidad';
import {
  getConciliacionConsolidado, getLineasPorConciliar, getDesglosesRecibidos, getAcreditables,
} from '@/lib/likida/analytics';
import { parseCfdiXml, esConsolidado } from '@/lib/likida/intake/cfdi_xml';
import { guardarYConciliarConsolidado } from '@/lib/likida/intake/consolidado';
import { logger } from '@/lib/logger';
import { sufijoTenant } from '../../sufijo';
import { VistaAgentePeajes } from './vista';
import { SeccionNotificaciones } from '../seccion-notificaciones';

export const dynamic = 'force-dynamic';

/** El estado de cuenta más grande que se acepta por pantalla. Un CFDI
 *  consolidado de un mes pesa decenas de KB; 4 MB es ya un archivo
 *  equivocado, no un desglose grande. */
const MAX_XML_BYTES = 4 * 1024 * 1024;

function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  return fn().catch(() => null);
}

/**
 * Agente de Peajes (F5 del plan) — el conciliador del "martirio": el estado
 * de cuenta del TAG/monedero (CFDI consolidado) contra los gastos reales de
 * los viajes. El JOIN automático ya corre cuando el XML llega por WhatsApp
 * de la oficina; esta página agrega la ingesta por pantalla, la ventana del
 * agente y el estado honesto del estímulo de peaje (RMF 9.1.8).
 *
 * La MESA para resolver líneas a mano vive en Combustible y casetas — esta
 * ventana la enseña y enlaza, no la duplica.
 */
export default async function PaginaAgentePeajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/agentes/peajes', sp);
  if (!puedeVerRuta(rol, '/dashboard/agentes/peajes')) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  const [conciliacion, lineas, desgloses, acreditables] = await Promise.all([
    getConciliacionConsolidado(tenantId),
    safe(() => getLineasPorConciliar(tenantId)),
    safe(() => getDesglosesRecibidos(tenantId)),
    safe(() => getAcreditables(tenantId)),
  ]);

  async function subirDesglose(
    _prev: { error?: string; resumen?: { totalLineas: number; conciliadas: number; porConciliar: number } } | null,
    fd: FormData,
  ): Promise<{ error?: string; resumen?: { totalLineas: number; conciliadas: number; porConciliar: number } } | null> {
    'use server';
    // EL CHEQUEO SE REPITE ADENTRO (patrón del repo): POST directo posible.
    const sesion = await requireSessionTenant('/dashboard/agentes/peajes');
    if (!puedeVerArea(sesion.rol, 'dinero')) return { error: 'Tu rol no puede subir estados de cuenta.' };
    if (sesion.rol !== 'superadmin' && sesion.tenantId !== tenantId) return { error: 'Este agente no es de tu flota.' };

    const archivo = fd.get('archivo');
    if (!(archivo instanceof File) || archivo.size === 0) return { error: 'Elige el archivo XML del estado de cuenta.' };
    if (archivo.size > MAX_XML_BYTES) return { error: 'Ese archivo pesa demasiado para ser un CFDI — revisa que sea el XML del estado de cuenta.' };

    const texto = await archivo.text();
    const xml = parseCfdiXml(texto);
    if (!xml?.uuid) return { error: 'No pude leerlo como CFDI (XML). El desglose en Excel/PDF todavía no entra por aquí — solo el XML del consolidado.' };
    if (!esConsolidado(xml)) {
      return { error: 'Ese CFDI trae un solo concepto — los tickets individuales entran por WhatsApp con su foto. Aquí va el CONSOLIDADO del TAG o monedero.' };
    }

    try {
      const r = await guardarYConciliarConsolidado(tenantId, xml, texto);
      logger.info('peajes.desglose_subido', { tenantId, uuid: xml.uuid, lineas: r.totalLineas, conciliadas: r.conciliadas });
      return { resumen: { totalLineas: r.totalLineas, conciliadas: r.conciliadas, porConciliar: r.porConciliar } };
    } catch (e) {
      logger.error('peajes.desglose_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
      return { error: 'No se pudo procesar el estado de cuenta. Inténtalo de nuevo.' };
    }
  }

  return (
    <VistaAgentePeajes
      conciliacion={conciliacion}
      lineas={lineas}
      desgloses={desgloses}
      peajeAcreditable={acreditables?.peaje ?? null}
      sufijo={sufijo}
      subirDesglose={subirDesglose}
      notificaciones={<SeccionNotificaciones tenantId={tenantId} agenteId="peajes" />}
    />
  );
}
