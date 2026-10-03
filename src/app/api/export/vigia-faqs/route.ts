import { NextResponse } from 'next/server';
import { analizarHistorial } from '@/lib/likida/vigia/historial/analisis';
import { faqsAExcel, faqsAPdf } from '@/lib/likida/vigia/historial/reporte_archivos';
import { grupoDeFlota, leerMensajesHistorial } from '@/lib/likida/vigia/historial/repo';
import { crearRepoVigia } from '@/lib/likida/vigia/repo';
import { leerRazonSocial } from '@/lib/likida/liquidacion_externa/repo';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
// Lee hasta 50,000 mensajes del histórico (páginas de 1,000), los analiza sin modelo y arma el archivo. Literal a propósito: Next lo lee en build.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El REPORTE DE PREGUNTAS FRECUENTES Y TENDENCIAS del Vigía (Agente 4), en Excel o PDF: lo mismo que enseña
 * `/dashboard/agentes/vigia/historial` (FAQs con lo que contesta el equipo, temas por semana, tiempos de respuesta).
 *
 *   GET ?[grupo=<uuid>][&formato=xlsx|pdf]   (xlsx por omisión; sin `grupo`, todos los grupos de la flota)
 *
 * Puertas: la del DATO (área `operacion`, la de la pantalla del Vigía) y la del verbo (`puedeExportar`), rate limit por IP y por
 * flota, y el histórico SIEMPRE acotado al tenant de la sesión (el grupo de otra flota es 404). Sin las tablas de la 0484 es 409:
 * no se manda un archivo vacío que parezca «no hay preguntas».
 */
export async function GET(req: Request) {
  if (!(await rateLimit(`export-vigia-faqs:${clientIp(req)}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  if (!(await rateLimit(`export-vigia-faqs:tenant:${t.tenantId}`, 10, 60_000))) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }
  if (!puedeVerArea(t.rol, 'operacion')) {
    logger.warn('export.vigia_faqs_area_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no ve la operación de la flota.', { status: 403 });
  }
  if (!puedeExportar(t.rol)) {
    logger.warn('export.vigia_faqs_rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const params = new URL(req.url).searchParams;
  const grupoParam = params.get('grupo')?.trim() ?? '';
  if (grupoParam && !UUID.test(grupoParam)) return new NextResponse('`grupo` no es un identificador válido.', { status: 400 });
  const formato = params.get('formato') ?? 'xlsx';
  if (formato !== 'xlsx' && formato !== 'pdf') return new NextResponse('`formato` tiene que ser `xlsx` o `pdf`.', { status: 400 });

  try {
    let alcance = 'Todos los grupos';
    if (grupoParam) {
      const g = await grupoDeFlota(t.tenantId, grupoParam);
      if (!g) return new NextResponse('Ese grupo no existe en tu flota.', { status: 404 });
      alcance = g.nombre;
    }
    const datos = await leerMensajesHistorial(t.tenantId, grupoParam || null);
    if (datos === null) return new NextResponse('Falta aplicar la migración 0484 (grupos e histórico) en la base de datos.', { status: 409 });
    if (datos.mensajes.length === 0) return new NextResponse('Todavía no hay histórico subido: sube el chat de un grupo y vuelve a descargar.', { status: 404 });

    const config = await crearRepoVigia().config(t.tenantId).catch(() => null);
    const umbralMin = config?.slaCriticoMin ?? 10;
    const reporte = analizarHistorial(datos.mensajes, { umbralMin });
    const meta = { alcance, truncado: datos.truncado, umbralMin };
    const cabeceras = { 'Cache-Control': 'no-store' } as const;
    if (formato === 'pdf') {
      const razon = await leerRazonSocial(t.tenantId).catch(() => null);
      const bytes = await faqsAPdf(reporte, meta, razon);
      return new NextResponse(new Blob([bytes as BlobPart]), {
        headers: { ...cabeceras, 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="preguntas_frecuentes_vigia_likida.pdf"' },
      });
    }
    return new NextResponse(new Blob([faqsAExcel(reporte, meta) as BlobPart]), {
      headers: {
        ...cabeceras,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="preguntas_frecuentes_vigia_likida.xlsx"',
      },
    });
  } catch (e) {
    logger.error('export.vigia_faqs', { tenant: t.tenantId, err: e instanceof Error ? e.message : String(e) });
    return new NextResponse('No se pudo generar el reporte. Intenta de nuevo en un momento.', { status: 500 });
  }
}
