import { NextResponse } from 'next/server';
import { bitacoraConciliada, bitacoraConciliadaACsv } from '@/lib/likida/peajes/bitacora_conciliada';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';

export const runtime = 'nodejs';
// Un desglose de hasta 5,000 líneas se lee paginado y se resuelve contra viajes,
// unidades y casetas: segundos. Literal a propósito: Next lo lee en build.
export const maxDuration = 120;

/**
 * La bitácora CONCILIADA de UN desglose de peaje (Agente 2): TODAS las líneas,
 * cada una cuadra / sin respaldo / por verificar con su motivo, en CSV con la
 * leyenda pegada al archivo (qué significa cada estado y qué NO afirma).
 *
 * Mismo patrón de puertas que /api/export/bitacora-peaje: la del DATO (área
 * dinero) Y la del verbo (puedeExportar), rate limit por IP y por flota, y el
 * `?desglose=` SIEMPRE acotado al tenant de la sesión — un uuid de otra flota
 * devuelve 404, no datos ajenos.
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-bitacora-conciliada:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-bitacora-conciliada:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.bitacora_conciliada_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.bitacora_conciliada_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const desgloseId = new URL(req.url).searchParams.get('desglose')?.trim() ?? '';
  if (!desgloseId) return new NextResponse('Falta el desglose (?desglose=…).', { status: 400 });

  try {
    const b = await bitacoraConciliada(t.tenantId, desgloseId);
    if (!b) return new NextResponse('Ese desglose no existe en tu flota.', { status: 404 });
    return new NextResponse(`﻿${bitacoraConciliadaACsv(b)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bitacora_conciliada_peajes_likida.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    if (e instanceof LecturaIncompleta) {
      logger.error('export.bitacora_conciliada_incompleta', { tenant: t.tenantId, leidas: e.leidas, esperadas: e.esperadas });
      return new NextResponse('Ese desglose trae más líneas de las que el export puede traer demostrando que están todas. No se manda un archivo corto: avísanos.', { status: 500 });
    }
    logger.error('export.bitacora_conciliada', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar la bitácora. Intenta de nuevo en un momento.', { status: 500 });
  }
}
