import { NextResponse } from 'next/server';
import { armarVinculos, vinculosAExcel } from '@/lib/likida/peajes/vinculos_archivos';
import { leerVinculosParaArchivo } from '@/lib/likida/peajes/vinculos_reporte';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';

export const runtime = 'nodejs';
// Lee líneas, vínculos y folios paginados. Literal a propósito: Next lo lee en build.
export const maxDuration = 120;

/**
 * «CASETAS LIGADAS A VIAJE» de UN desglose de peaje (Agente 2): hojas Ligadas, Sin viaje (las
 * excepciones) y Ambiguas.
 *
 *   GET ?desglose=<uuid>
 *
 * Mismas puertas que `peajes-reclamacion`: la del DATO (área dinero) y la del verbo (`puedeExportar`),
 * rate limit por IP y por flota, y el desglose SIEMPRE acotado al tenant de la sesión (un uuid de otra
 * flota es 404). Sin vínculos calculados (interruptor de la flota apagado o desglose sin conciliar)
 * es 409: un archivo vacío haría creer que no hay casetas sin viaje.
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-peajes-vinculos:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-peajes-vinculos:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.peajes_vinculos_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.peajes_vinculos_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const desgloseId = new URL(req.url).searchParams.get('desglose')?.trim() ?? '';
  if (!desgloseId) return new NextResponse('Falta el desglose (?desglose=…).', { status: 400 });

  try {
    const d = await leerVinculosParaArchivo(t.tenantId, desgloseId);
    if (!d) return new NextResponse('Ese desglose no existe en tu flota.', { status: 404 });
    if (d.vinculos.length === 0) {
      return new NextResponse('Este desglose aún no tiene vínculos con viajes calculados: activa el vínculo cruce-viaje de la flota y vuelve a conciliar.', { status: 409 });
    }
    const bytes = vinculosAExcel(armarVinculos(d.lineas, d.vinculos, d.folios, d.costos));
    return new NextResponse(new Blob([bytes as BlobPart]), {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="peajes_vinculos_likida.xlsx"',
      },
    });
  } catch (e) {
    if (e instanceof LecturaIncompleta) {
      logger.error('export.peajes_vinculos_incompleta', { tenant: t.tenantId, leidas: e.leidas, esperadas: e.esperadas });
      return new NextResponse('Ese desglose trae más líneas de las que el export puede traer demostrando que están todas. No se manda un archivo corto: avísanos.', { status: 500 });
    }
    logger.error('export.peajes_vinculos', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el archivo. Intenta de nuevo en un momento.', { status: 500 });
  }
}
