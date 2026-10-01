import { NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { configEstandar, exportarDocumentos, validarConfigExport, type ExportConfig } from '@/lib/likida/carta_porte_docs/exportacion';
import * as repo from '@/lib/likida/carta_porte_docs/repo';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DOCS = 500;

/**
 * LA EXPORTACIÓN DE LO APROBADO AL FORMATO DESTINO (Agente 3, mig. 0420).
 *
 * Mismo patrón de puertas que las demás rutas de /api/export: rate limit, sesión → flota, el área del DATO
 * (`operacion`, la de la bandeja de documentos) y el verbo (`puedeExportar`). TODA consulta va acotada al tenant
 * de la sesión: un `?ids=` con documentos de otra flota no exporta nada de ella.
 *
 *   ?config=estandar | <uuid de cp_export_config>   (por omisión, el estándar de Likida)
 *   ?formato=csv|json                                 (por omisión, el de la configuración)
 *   ?ids=<uuid>,<uuid>…                               (por omisión, los aprobados que aún no se exportaron)
 *
 * Solo salen documentos APROBADOS; el resto se reporta en el encabezado `X-Omitidos`. No timbra ni emite nada.
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-cp-docs:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-cp-docs:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerRuta(t.rol, '/dashboard/carta-porte/documentos')) {
    logger.warn('export.cp_docs_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve los documentos de Carta Porte de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.cp_docs_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este archivo.', { status: 403 });
  }

  const url = new URL(req.url);
  const configParam = url.searchParams.get('config')?.trim() || 'estandar';
  const formatoParam = url.searchParams.get('formato')?.trim();
  if (formatoParam && formatoParam !== 'csv' && formatoParam !== 'json') return new NextResponse('El formato es csv o json.', { status: 400 });
  const idsParam = url.searchParams.get('ids')?.split(',').map((x) => x.trim()).filter(Boolean) ?? null;
  if (idsParam && (idsParam.length > MAX_DOCS || idsParam.some((x) => !UUID.test(x)))) return new NextResponse(`«ids» son hasta ${MAX_DOCS} uuid separados por coma.`, { status: 400 });

  try {
    let cfg: ExportConfig; let nombre = 'estandar'; let formato: 'csv' | 'json' = formatoParam === 'json' ? 'json' : 'csv';
    if (configParam === 'estandar') {
      cfg = configEstandar();
    } else {
      if (!UUID.test(configParam)) return new NextResponse('«config» es «estandar» o el id de un formato guardado.', { status: 400 });
      const guardada = (await repo.listarExportConfigs(t.tenantId)).find((c) => c.id === configParam);
      if (!guardada) return new NextResponse('Ese formato no existe en tu flota.', { status: 404 });
      const v = validarConfigExport(guardada.config);
      if (!v.ok) return new NextResponse(`El formato guardado ya no es válido: ${v.errores.slice(0, 3).join(' · ')}`, { status: 409 });
      cfg = v.config; nombre = guardada.nombre; formato = formatoParam === 'csv' || formatoParam === 'json' ? formatoParam : guardada.formato;
    }

    const { filas } = await repo.listarDocumentos(t.tenantId, { estados: ['aprobado'], limite: MAX_DOCS });
    const elegidos = idsParam ? filas.filter((d) => idsParam.includes(d.id)) : filas.filter((d) => d.exportadoEn === null);
    if (elegidos.length === 0) return new NextResponse('No hay documentos aprobados para exportar.', { status: 404 });

    const folios = new Map<string, string | null>();
    for (const d of elegidos) {
      if (d.viajeId && !folios.has(d.viajeId)) folios.set(d.viajeId, (await repo.viajePorId(t.tenantId, d.viajeId))?.folio ?? null);
    }
    const r = exportarDocumentos(elegidos.map((doc) => ({ doc, viajeFolio: doc.viajeId ? folios.get(doc.viajeId) ?? null : null })), formato, cfg, nombre);
    if (r.documentos === 0) return new NextResponse('No hay documentos aprobados para exportar.', { status: 404 });

    // El sello DESPUÉS de generar: un sello caído no le niega el archivo a la flota, pero queda en el log.
    const s = await getSessionTenant();
    try {
      const idsListos = elegidos.filter((d) => !r.omitidos.some((o) => o.id === d.id)).map((d) => d.id);
      await repo.marcarExportado(t.tenantId, idsListos);
      for (const id of idsListos) await repo.registrarEvento(t.tenantId, id, 'exportado', s?.userId ?? null, { formato, config: nombre });
    } catch (e) {
      logger.warn('export.cp_docs_sello_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    logger.info('export.cp_docs_generado', { rol: t.rol, documentos: r.documentos, filas: r.filas, formato });
    return new NextResponse(r.contenido, {
      headers: {
        'Content-Type': r.mime,
        'Content-Disposition': `attachment; filename="${r.nombreArchivo}"`,
        'Cache-Control': 'no-store',
        'X-Omitidos': String(r.omitidos.length),
      },
    });
  } catch (e) {
    logger.error('export.cp_docs_fallo', { error: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el archivo. Intenta de nuevo.', { status: 500 });
  }
}
