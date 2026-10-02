import { redirect } from 'next/navigation';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { sufijoTenant } from '../../../sufijo';
import { logger } from '@/lib/logger';
import { reporteReclamacion } from '@/lib/likida/peajes/bitacora_conciliada';
import type { ReporteReclamacion } from '@/lib/likida/peajes/reclamacion';
import { VistaReclamacionPeajes } from './vista';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/agentes/peajes/reclamacion';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El reporte de reclamación de un desglose de peaje: los cruces que el GPS no
 * respalda, con el porqué y la evidencia, para pedirle al proveedor la revisión.
 * Se lee COMPLETO (primaria, sin `safe` mudo): si no se pudo leer, la pantalla lo
 * dice; jamás «no hay nada que reclamar» estando ciega.
 */
export default async function PaginaReclamacionPeajes({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string; desglose?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');
  const sufijo = sufijoTenant(sp);

  const desglose = (sp.desglose ?? '').trim();
  let reporte: ReporteReclamacion | null = null;
  let estado: 'sin_desglose' | 'no_existe' | 'error' | 'ok' = 'sin_desglose';
  if (desglose) {
    if (!UUID.test(desglose)) estado = 'no_existe';
    else {
      try {
        reporte = await reporteReclamacion(tenantId, desglose.toLowerCase());
        estado = reporte ? 'ok' : 'no_existe';
      } catch (e) {
        logger.error('peajes.reclamacion_pagina', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
        estado = 'error';
      }
    }
  }
  return <VistaReclamacionPeajes sufijo={sufijo} desglose={UUID.test(desglose) ? desglose.toLowerCase() : null} estado={estado} reporte={reporte} />;
}
