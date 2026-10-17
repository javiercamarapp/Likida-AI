import { NextResponse } from 'next/server';
import { revisionDeDesglose } from '@/lib/likida/peajes/revision_cobros';
import { revisionAExcel } from '@/lib/likida/peajes/revision_archivos';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';

export const runtime = 'nodejs';
// Lee el desglose paginado (hasta 60 000 líneas), aplica las reglas y arma el Excel. Literal a propósito: Next lo lee en build.
export const maxDuration = 120;

/**
 * La REVISIÓN DE COBROS de UN desglose de peaje (Agente 2): los CANDIDATOS a validar con el
 * proveedor (clase distinta de 3 y 5, extemporáneos, duplicados exactos, TAG dado de baja,
 * casetas que no deben cruzarse) con «qué pasó / qué significa / qué hacer», el reporte de
 * calidad del archivo y los cruces atípicos.
 *
 *   GET ?desglose=<uuid>      (Excel)
 *
 * Mismas puertas que el reporte de reclamación: la del DATO (área dinero) y la del verbo
 * (`puedeExportar`), rate limit por IP y por flota, y el desglose SIEMPRE acotado al tenant
 * de la sesión (un uuid de otra flota es 404).
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-peajes-revision:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-peajes-revision:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.peajes_revision_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.peajes_revision_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const desgloseId = new URL(req.url).searchParams.get('desglose')?.trim() ?? '';
  if (!desgloseId) return new NextResponse('Falta el desglose (?desglose=…).', { status: 400 });

  try {
    const r = await revisionDeDesglose(t.tenantId, desgloseId);
    if (!r) return new NextResponse('Ese desglose no existe en tu flota.', { status: 404 });
    return new NextResponse(new Blob([revisionAExcel(r) as BlobPart]), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="revision_cobros_peajes_likida.xlsx"',
      },
    });
  } catch (e) {
    if (e instanceof LecturaIncompleta) {
      logger.error('export.peajes_revision_incompleta', { tenant: t.tenantId, leidas: e.leidas, esperadas: e.esperadas });
      return new NextResponse('Ese desglose trae más líneas de las que el export puede traer demostrando que están todas. No se manda un archivo corto: avísanos.', { status: 500 });
    }
    logger.error('export.peajes_revision', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el reporte. Intenta de nuevo en un momento.', { status: 500 });
  }
}
