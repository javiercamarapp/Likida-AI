import { NextResponse } from 'next/server';
import { toCsv } from '@/lib/likida/export';
import { listarFacturasProveedor, aFilaExportProveedor } from '@/lib/likida/proveedores';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * Export de facturas de proveedor APROBADAS (F6) — el layout importable a
 * SAP B1 / CONTPAQi. Mismo patrón de puertas que /api/export/liquidaciones:
 * la del DATO (área dinero) Y la del verbo (puedeExportar) — la lección
 * documentada del IDOR: se acota el tenant y se olvida el rol.
 */
export async function GET(req: Request) {
  if (!rateLimit(`export-prov:${clientIp(req)}`, 10, 60_000)) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });

  if (!puedeVerArea(t.rol, 'dinero')) {
    logger.warn('export.proveedor_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.proveedor_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  try {
    // El tope de listar (100) es el de la bandeja; para el export se sube —
    // y si algún día una flota lo rebasa, el CSV corto se DICE, no se manda
    // callado (misma doctrina que el export de liquidaciones).
    const todas = await listarFacturasProveedor(t.tenantId, 5000);
    if (todas.length === 5000) {
      logger.error('export.proveedor_tope', { tenant: t.tenantId });
      return new NextResponse('La flota tiene más facturas de las que el export puede traer en una pasada. Avísanos: necesitamos paginar el archivo.', { status: 500 });
    }
    const filas = todas.filter((f) => f.estado === 'aprobada').map(aFilaExportProveedor);
    const csv = toCsv(filas);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="facturas_proveedor_likida.csv"',
      },
    });
  } catch (e) {
    logger.error('export.proveedor', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }
}
