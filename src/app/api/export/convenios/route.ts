import { NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';
import { LecturaIncompleta } from '@/lib/likida/pg';
import { csvConvenios, plantillaCsvConvenios, textoParaSistemaDeLaFlota } from '@/lib/likida/convenios/importador';
import { ConveniosNoDisponibles, listarConvenios } from '@/lib/likida/convenios/repo';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Los convenios de la flota para llevárselos: `?tipo=`
 *   · `instrucciones` (default) — el CSV de la «calle de instrucciones» SIN dinero: la flota lo carga o lo copia a SU
 *     sistema. Mismo formato que el importador (se vuelve a subir tal cual).
 *   · `texto`        — un bloque de texto por convenio, listo para pegar en el campo de instrucciones de su sistema.
 *   · `completo`     — el CSV con tarifa y requisitos de cobro (DINERO: solo quien ve el área de dinero).
 *   · `plantilla`    — el archivo vacío con su fila de ejemplo.
 *
 * Mismo patrón de puertas que el resto de /api/export: sesión y flota por `resolverTenantApi`, la del VERBO
 * (`puedeExportar`) y, para el dinero, la del DATO (área `dinero`); rate limit por IP y por flota. La flota sale de la
 * SESIÓN: no hay `?tenant=` que valga para nadie más que el superadmin que `resolverTenantApi` ya valida.
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-convenios:${clientIp(req)}`, 20, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-convenios:tenant:${t.tenantId}`, 20, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'operacion')) return new NextResponse('Tu rol no ve los convenios.', { status: 403 });
  if (!puedeExportar(t.rol)) {
    logger.warn('export.convenios_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const tipo = new URL(req.url).searchParams.get('tipo')?.trim() || 'instrucciones';
  if (!['instrucciones', 'texto', 'completo', 'plantilla'].includes(tipo)) return new NextResponse('Tipo de descarga desconocido.', { status: 400 });
  const conFinanzas = puedeVerArea(t.rol, 'dinero');
  if (tipo === 'completo' && !conFinanzas) {
    logger.warn('export.convenios_dinero_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve las cifras de dinero de la flota.', { status: 403 });
  }

  const archivo = (cuerpo: string, nombre: string, tipoMime: string) => new NextResponse(cuerpo, {
    headers: { 'Content-Type': `${tipoMime}; charset=utf-8`, 'Content-Disposition': `attachment; filename="${nombre}"`, 'Cache-Control': 'no-store' },
  });

  if (tipo === 'plantilla') return archivo(plantillaCsvConvenios({ conFinanzas }), 'plantilla_convenios_likida.csv', 'text/csv');

  try {
    // El dinero se lee SOLO para el tipo `completo`: los otros no lo tocan, ni siquiera lo traen de la base.
    const convenios = await listarConvenios(t.tenantId, { conFinanzas: tipo === 'completo' });
    const activos = convenios.filter((c) => c.activo);
    if (tipo === 'texto') return archivo(activos.map(textoParaSistemaDeLaFlota).join('\n\n') + '\n', 'instrucciones_convenios_likida.txt', 'text/plain');
    return archivo(csvConvenios(activos, { conFinanzas: tipo === 'completo' }), tipo === 'completo' ? 'convenios_completos_likida.csv' : 'instrucciones_convenios_likida.csv', 'text/csv');
  } catch (e) {
    if (e instanceof ConveniosNoDisponibles) return new NextResponse('Los convenios todavía no están disponibles en tu cuenta: falta aplicar la actualización de la base.', { status: 503 });
    if (e instanceof LecturaIncompleta) {
      logger.error('export.convenios_incompleto', { tenant: t.tenantId, leidas: e.leidas, esperadas: e.esperadas });
      return new NextResponse('Hay más convenios de los que el export puede traer demostrando que están todos. No se manda un archivo corto: avísanos.', { status: 500 });
    }
    logger.error('export.convenios', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el archivo. Intenta de nuevo en un momento.', { status: 500 });
  }
}
