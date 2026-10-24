import { NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { aXlsxPlantillaTms, configEstandar, exportarDocumentos, MIME_XLSX, validarConfigExport, type ExportConfig, type FormatoExport } from '@/lib/likida/carta_porte_docs/exportacion';
import { construirPlantilla, faltantesBloqueantes } from '@/lib/likida/carta_porte_docs/plantilla_tms';
import { leerConfigSalida } from '@/lib/likida/carta_porte_docs/salida_config';
import * as repo from '@/lib/likida/carta_porte_docs/repo';
import type { DocumentoFila } from '@/lib/likida/carta_porte_docs/repo';

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
 *   ?formato=csv|json|xlsx                            (por omisión, el de la configuración)
 *   ?ids=<uuid>,<uuid>…                               (por omisión, los aprobados que aún no se exportaron)
 *   ?formato=plantilla_tms&documento=<uuid>           (la plantilla multi-hoja del TMS de UN documento aprobado: 404 si no es de tu flota, 409 si no está aprobado)
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
  if (formatoParam === 'plantilla_tms') return plantillaTms(t.tenantId, t.rol, url.searchParams.get('documento')?.trim() ?? '');
  if (formatoParam && formatoParam !== 'csv' && formatoParam !== 'json' && formatoParam !== 'xlsx') return new NextResponse('El formato es csv, json o xlsx.', { status: 400 });
  const idsParam = url.searchParams.get('ids')?.split(',').map((x) => x.trim()).filter(Boolean) ?? null;
  if (idsParam && (idsParam.length > MAX_DOCS || idsParam.some((x) => !UUID.test(x)))) return new NextResponse(`«ids» son hasta ${MAX_DOCS} uuid separados por coma.`, { status: 400 });

  try {
    let cfg: ExportConfig; let nombre = 'estandar'; let formato: FormatoExport = formatoParam === 'json' || formatoParam === 'xlsx' ? formatoParam : 'csv';
    if (configParam === 'estandar') {
      cfg = configEstandar();
    } else {
      if (!UUID.test(configParam)) return new NextResponse('«config» es «estandar» o el id de un formato guardado.', { status: 400 });
      const guardada = (await repo.listarExportConfigs(t.tenantId)).find((c) => c.id === configParam);
      if (!guardada) return new NextResponse('Ese formato no existe en tu flota.', { status: 404 });
      const v = validarConfigExport(guardada.config);
      if (!v.ok) return new NextResponse(`El formato guardado ya no es válido: ${v.errores.slice(0, 3).join(' · ')}`, { status: 409 });
      cfg = v.config; nombre = guardada.nombre; formato = formatoParam === 'csv' || formatoParam === 'json' || formatoParam === 'xlsx' ? formatoParam : guardada.formato;
    }

    // A37-S10-01: el filtro (ids o «sin exportar») va EN LA CONSULTA, no en memoria sobre las 500 más recientes: un
    // aprobado antiguo y aún sin exportar ya no queda fuera de la ventana. Por omisión sale el lote más ANTIGUO de
    // hasta MAX_DOCS (así la cola se drena en orden) y `X-Restantes` dice cuántos quedan para la siguiente descarga.
    let elegidos: DocumentoFila[] = [];
    let restantes = 0;
    if (idsParam) {
      for (let i = 0; i < idsParam.length; i += 100) {
        const { filas } = await repo.listarDocumentos(t.tenantId, { estados: ['aprobado'], ids: idsParam.slice(i, i + 100), limite: 100, completo: true });
        elegidos.push(...filas);
      }
    } else {
      const { filas, total } = await repo.listarDocumentos(t.tenantId, { estados: ['aprobado'], sinExportar: true, ascendente: true, limite: MAX_DOCS, completo: true });
      elegidos = filas;
      restantes = Math.max(0, total - filas.length);
    }
    if (elegidos.length === 0) return new NextResponse('No hay documentos aprobados para exportar.', { status: 404 });

    const folios = new Map<string, string | null>();
    for (const d of elegidos) {
      if (d.viajeId && !folios.has(d.viajeId)) folios.set(d.viajeId, (await repo.viajePorId(t.tenantId, d.viajeId))?.folio ?? null);
    }
    const generar = (docs: DocumentoFila[]) => exportarDocumentos(docs.map((doc) => ({ doc, viajeFolio: doc.viajeId ? folios.get(doc.viajeId) ?? null : null })), formato, cfg, nombre);
    let r = generar(elegidos);
    if (r.documentos === 0) return new NextResponse('No hay documentos aprobados para exportar.', { status: 404 });

    // A37-S10-02 — EL SELLO ES UN RECLAMO ATÓMICO (`UPDATE … WHERE exportado_en IS NULL RETURNING`), no un aviso
    // posterior. Sin ids (la descarga «lo nuevo») dos clics o dos usuarios en paralelo leían el mismo conjunto y el TMS
    // recibía la carga duplicada: ahora cada descarga se queda SOLO con los que ganó, y si otra se llevó todo, 409.
    // Con ?ids= el usuario pide a propósito volver a bajar lo ya exportado: se re-sella («la última gana»).
    const s = await getSessionTenant();
    let idsSellados: string[] = [];
    let avisoSello: string | null = null;
    const idsListos = elegidos.filter((d) => !r.omitidos.some((o) => o.id === d.id)).map((d) => d.id);
    try {
      if (idsParam) {
        await repo.marcarExportado(t.tenantId, idsListos);
        idsSellados = idsListos;
      } else {
        const ganados = new Set(await repo.reclamarExportacion(t.tenantId, idsListos));
        if (ganados.size === 0) {
          return new NextResponse('Otra descarga acaba de exportar estos documentos. Actualiza la pantalla.', { status: 409 });
        }
        if (ganados.size < idsListos.length) r = generar(elegidos.filter((d) => ganados.has(d.id)));
        idsSellados = [...ganados];
      }
    } catch (e) {
      logger.warn('export.cp_docs_sello_fallo', { error: e instanceof Error ? e.message : String(e) });
      // El archivo ya existe y no se le niega a la flota, pero NO se calla (A37-S10-02, como export/facturas-proveedor):
      // sin el sello, estos mismos documentos reaparecerán como «sin exportar» y podrían subirse dos veces al TMS.
      avisoSello = 'El archivo está completo, pero NO se pudo marcar como exportado. Estos documentos van a reaparecer como «sin exportar»: no los subas de nuevo al TMS sin revisar cuáles ya entraron.';
    }
    try {
      for (const id of idsSellados) await repo.registrarEvento(t.tenantId, id, 'exportado', s?.userId ?? null, { formato, config: nombre });
    } catch (e) {
      logger.warn('export.cp_docs_evento_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    logger.info('export.cp_docs_generado', { rol: t.rol, documentos: r.documentos, filas: r.filas, formato });
    // En CSV el aviso va DENTRO del archivo (primera línea, con `#`, tras el BOM); en json/xlsx no cabe sin romper el
    // formato y va en las cabeceras.
    let cuerpo: string | Blob;
    if (typeof r.contenido === 'string') {
      const bom = r.contenido.startsWith('\uFEFF') ? '\uFEFF' : '';
      cuerpo = avisoSello && formato === 'csv' ? `${bom}# AVISO: ${avisoSello}\r\n${r.contenido.slice(bom.length)}` : r.contenido;
    } else {
      cuerpo = new Blob([r.contenido as BlobPart]);
    }
    return new NextResponse(cuerpo, {
      headers: {
        'Content-Type': r.mime,
        'Content-Disposition': `attachment; filename="${r.nombreArchivo}"`,
        'Cache-Control': 'no-store',
        'X-Omitidos': String(r.omitidos.length),
        'X-Restantes': String(restantes),
        ...(avisoSello ? { 'X-Sello-Fallo': '1', 'X-Aviso': encodeURIComponent(avisoSello) } : {}),
      },
    });
  } catch (e) {
    logger.error('export.cp_docs_fallo', { error: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el archivo. Intenta de nuevo.', { status: 500 });
  }
}

/** Un documento APROBADO -> la plantilla multi-hoja del TMS (.xlsx). Solo de la flota de la sesión. */
async function plantillaTms(tenantId: string, rol: string, documentoId: string): Promise<NextResponse> {
  if (!UUID.test(documentoId)) return new NextResponse('«documento» es el id de un documento.', { status: 400 });
  try {
    const doc = await repo.leerDocumento(tenantId, documentoId);
    if (!doc) return new NextResponse('Ese documento no existe en tu flota.', { status: 404 });
    if (doc.estado !== 'aprobado' || !doc.extraccion) {
      return new NextResponse('Solo se descarga la plantilla de un documento aprobado. Revísalo y apruébalo primero.', { status: 409 });
    }
    const config = await leerConfigSalida(tenantId);
    const plantilla = construirPlantilla(doc.extraccion, { clienteInterno: null, plantilla: config.plantillaPorDefecto });
    // Un faltante BLOQUEANTE (orígenes 2..N o destinos > 4 que la plantilla no lleva) significa que el libro saldría incompleto: no se
    // entrega ni se sella «exportado», para que nadie suba un CCP recortado creyéndolo válido (A35-A3-04).
    const bloqueantes = faltantesBloqueantes(plantilla);
    if (bloqueantes.length > 0) {
      logger.warn('export.cp_docs_bloqueado', { rol, documentoId: doc.id, bloqueantes: bloqueantes.length });
      return new NextResponse(`La plantilla no se puede descargar: ${[...new Set(bloqueantes.map((f) => f.mensaje ?? `falta ${f.campo}`))].join(' ')}`, { status: 409 });
    }
    const bytes = aXlsxPlantillaTms(plantilla);
    const s = await getSessionTenant();
    try {
      await repo.marcarExportado(tenantId, [doc.id]);
      await repo.registrarEvento(tenantId, doc.id, 'exportado', s?.userId ?? null, { formato: 'plantilla_tms', plantilla: config.plantillaPorDefecto });
    } catch (e) {
      logger.warn('export.cp_docs_sello_fallo', { error: e instanceof Error ? e.message : String(e) });
    }
    logger.info('export.cp_docs_generado', { rol, documentos: 1, faltantes: plantilla.faltantes.length, formato: 'plantilla_tms' });
    return new NextResponse(new Blob([bytes as BlobPart]), {
      headers: {
        'Content-Type': MIME_XLSX,
        'Content-Disposition': `attachment; filename="plantilla-tms-${doc.id.slice(0, 8)}.xlsx"`,
        'Cache-Control': 'no-store',
        'X-Faltantes': String(plantilla.faltantes.length),
        // Cuántos avisos trae (celdas recortadas, layout provisional…): el visor los muestra junto al botón.
        'X-Avisos': String(plantilla.avisos.length),
      },
    });
  } catch (e) {
    logger.error('export.cp_docs_fallo', { error: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el archivo. Intenta de nuevo.', { status: 500 });
  }
}
