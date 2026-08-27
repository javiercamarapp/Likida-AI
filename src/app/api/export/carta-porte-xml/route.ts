import { NextResponse } from 'next/server';
import { getBorradorViaje } from '@/lib/likida/carta_porte_datos';
import { generarXmlCcp } from '@/lib/likida/carta_porte_xml';
import { generarIdCcp } from '@/lib/likida/carta_porte';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { getSessionTenant } from '@/lib/auth/session';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * FASE D DE CARTA PORTE — la descarga del XML listo para timbrar.
 *
 * Mismo patrón de puertas que las demás rutas de /api/export (auditoría 18,
 * A21): la del DATO (la ruta de Carta Porte es del área `operacion` — el
 * mismo gate que la página del borrador) Y la del verbo (`puedeExportar`).
 * El `?viaje=` se consulta SIEMPRE acotado al tenant de la sesión: un uuid
 * de otra flota devuelve 404, no el complemento ajeno.
 *
 * El XML solo sale del borrador VALIDADO (fail-closed en generarXmlCcp) y no
 * está timbrado — Likida no timbra (0049); la leyenda va dentro del archivo.
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-ccp-xml:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });

  if (!(await rateLimit(`export-ccp-xml:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  if (!puedeVerRuta(t.rol, '/dashboard/carta-porte')) {
    logger.warn('export.ccp_xml_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve la Carta Porte de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.ccp_xml_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const viajeId = new URL(req.url).searchParams.get('viaje')?.trim() ?? '';
  if (!viajeId) return new NextResponse('Falta el viaje (?viaje=…).', { status: 400 });

  try {
    const v = await getBorradorViaje(t.tenantId, viajeId);
    if (!v) return new NextResponse('Ese viaje no existe en tu flota.', { status: 404 });

    const r = generarXmlCcp(v, generarIdCcp());
    if (!r.ok) {
      // 409 y no 500: el estado del borrador es el conflicto, no un error del
      // sistema — y los motivos son los mismos que la página ya enseña.
      return new NextResponse(`El XML no se puede generar todavía:\n· ${r.motivos.join('\n· ')}`, { status: 409 });
    }

    // La bitácora: cuándo y quién generó por última vez (la última gana — el
    // XML se puede regenerar tras corregir datos, y lo citable es la más
    // reciente). Mejor esfuerzo DESPUÉS de generar: un sello caído no le
    // niega el archivo a la flota, pero queda en el log con su porqué.
    const s = await getSessionTenant();
    const sello = await acotada(
      supabaseAdmin().from('viaje')
        .update({ ccp_xml_generado_en: new Date().toISOString(), ccp_xml_generado_por: s?.userId ?? null })
        .eq('tenant_id', t.tenantId)
        .eq('id', viajeId),
      'export.ccp_xml.sello',
    );
    if (sello.error) {
      logger.warn('export.ccp_xml_sello_fallo', { viajeId, error: sello.error.message });
    }
    logger.info('export.ccp_xml_generado', { viajeId, idCcp: r.idCcp, rol: t.rol, omitidos: r.omitidos.length });

    return new NextResponse(r.xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${r.nombreArchivo}"`,
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('export.ccp_xml_fallo', { viajeId, error });
    return new NextResponse('No se pudo generar el XML. Intenta de nuevo.', { status: 500 });
  }
}
