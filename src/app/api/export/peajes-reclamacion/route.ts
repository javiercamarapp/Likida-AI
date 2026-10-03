import { NextResponse } from 'next/server';
import { reporteReclamacion } from '@/lib/likida/peajes/bitacora_conciliada';
import { reclamacionAExcel, reclamacionAPdf } from '@/lib/likida/peajes/reclamacion_archivos';
import { leerRazonSocial } from '@/lib/likida/liquidacion_externa/repo';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';

export const runtime = 'nodejs';
// Lee el desglose paginado, pide las posiciones GPS de las candidatas por tandas y arma el archivo. Literal a propósito: Next lo lee en build.
export const maxDuration = 120;

/**
 * El REPORTE DE RECLAMACIÓN de UN desglose de peaje (Agente 2), para pedirle al
 * proveedor la revisión de los cobros que el GPS no respalda: por cruce, fecha,
 * caseta, TAG, unidad, monto, por qué y la evidencia de GPS.
 *
 *   GET ?desglose=<uuid>[&formato=xlsx|pdf]   (xlsx por omisión)
 *
 * Mismas puertas que la bitácora conciliada: la del DATO (área dinero) y la del
 * verbo (`puedeExportar`), rate limit por IP y por flota, y el desglose SIEMPRE
 * acotado al tenant de la sesión (un uuid de otra flota es 404).
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-peajes-reclamacion:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-peajes-reclamacion:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.peajes_reclamacion_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.peajes_reclamacion_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const desgloseId = params.get('desglose')?.trim() ?? '';
  if (!desgloseId) return new NextResponse('Falta el desglose (?desglose=…).', { status: 400 });
  const formato = params.get('formato') ?? 'xlsx';
  if (formato !== 'xlsx' && formato !== 'pdf') return new NextResponse('`formato` tiene que ser `xlsx` o `pdf`.', { status: 400 });

  try {
    const r = await reporteReclamacion(t.tenantId, desgloseId);
    if (!r) return new NextResponse('Ese desglose no existe en tu flota.', { status: 404 });
    const cabeceras = { 'Cache-Control': 'no-store' } as const;
    if (formato === 'pdf') {
      const razon = await leerRazonSocial(t.tenantId);
      const bytes = await reclamacionAPdf(r, razon);
      return new NextResponse(new Blob([bytes as BlobPart]), {
        headers: { ...cabeceras, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="reclamacion_peajes_likida.pdf"' },
      });
    }
    return new NextResponse(new Blob([reclamacionAExcel(r) as BlobPart]), {
      headers: {
        ...cabeceras,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="reclamacion_peajes_likida.xlsx"',
      },
    });
  } catch (e) {
    if (e instanceof LecturaIncompleta) {
      logger.error('export.peajes_reclamacion_incompleta', { tenant: t.tenantId, leidas: e.leidas, esperadas: e.esperadas });
      return new NextResponse('Ese desglose trae más líneas de las que el export puede traer demostrando que están todas. No se manda un archivo corto: avísanos.', { status: 500 });
    }
    logger.error('export.peajes_reclamacion', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el reporte. Intenta de nuevo en un momento.', { status: 500 });
  }
}
