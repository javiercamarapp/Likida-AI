import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { resolverTenantApi } from '@/lib/auth/tenant-api';
import { puedeExportar } from '@/lib/auth/permisos';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ═══════════════════════════════════════════════════════════════════════════
// EL PDF QUE YA EXISTÍA Y NO TENÍA PUERTA.
//
// `guardar_liquidacion_tx` recibe `p_pdf_url` y la columna `pdf_url` existe
// desde la 0001, pero `getLiquidacionDetalle` ni la seleccionaba y ninguna
// página la renderizaba: en el demo, "¿me da el PDF?" se contestaba tecleando
// una URL a mano (auditoría 5, frontend, MEDIO 5).
//
// Lo guardado NO es una URL pública: es la ruta dentro del bucket privado
// `liquidaciones` (`{tenantId}/{viajeId}.pdf`, ver tools.ts). Servirla tal cual
// no funcionaría, y hacer público el bucket dejaría las liquidaciones de todas
// las flotas al alcance de quien adivine dos UUIDs. Por eso aquí se firma una
// URL de vida corta, detrás de la sesión real del contralor.
//
// El ejemplar que se entrega es el del CONTRALOR (`{viajeId}.pdf`), no el del
// operador: es el que lleva los veredictos y el que se archiva. Esa separación
// es deliberada en `tools.ts` y aquí se respeta.
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`export-pdf:${clientIp(req)}`, 30, 60_000)) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  // `getSessionTenant()` a secas le devolvía 401 al SUPERADMIN: su
  // `app_user.tenant_id` es `null` por diseño (0001), y el fallback a la flota
  // demo vivía solo en `guard.ts`, que una API no puede usar porque redirige.
  // En pantalla eso era apretar "Descargar PDF" y abrir una pestaña en blanco
  // que dice "No autorizado" — el minuto 4 del guion del demo.
  const t = await resolverTenantApi(req.url);
  if (!t.ok) return new NextResponse(t.motivo, { status: t.status });
  const tenantId = t.tenantId;

  // ── QUIÉN PUEDE DESCARGAR, NO SOLO DE QUÉ FLOTA ──────────────────────────
  //
  // Faltaba esto y era un IDOR: la ruta autorizaba por SESIÓN y por TENANT, y
  // ahí se detenía. Cualquier usuario de la flota —incluido un OPERADOR, que
  // solo debe ver lo suyo— bajaba el PDF de la liquidación de cualquier
  // compañero con nada más que el id en la URL.
  //
  // `puedeExportar` ya excluía a `operador`; la ruta nunca se lo preguntó. Es
  // el patrón que este repo tiene documentado como el fallo más común del
  // código escrito por agentes: se acota el tenant y se olvida el rol.
  if (!puedeExportar(t.rol)) {
    logger.warn('export.rol_sin_permiso', { rol: t.rol });
    return new NextResponse('Tu rol no puede descargar este documento.', { status: 403 });
  }

  const { id } = await params;
  const admin = supabaseAdmin();
  // El filtro por tenant es EXPLÍCITO: el service-role salta RLS, así que un
  // id de otra flota no puede resolver aquí — tenantId sale de la sesión, no
  // de un env var.
  const { data, error } = await admin
    .from('liquidacion')
    .select('pdf_url')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    logger.error('export.pdf.lectura', { tenant: tenantId, liquidacion: id, err: error.message });
    return new NextResponse('No se pudo leer la liquidación. Intenta de nuevo en un momento.', { status: 500 });
  }
  // Sin fila y con fila sin PDF son 404 los dos: quien pregunta no debe poder
  // distinguir "no existe" de "existe y aún no tiene papel".
  if (!data?.pdf_url) return new NextResponse('No hay PDF para esta liquidación', { status: 404 });

  const firmada = await admin.storage
    .from('liquidaciones')
    .createSignedUrl(data.pdf_url as string, 60, { download: `liquidacion_${id.slice(0, 8)}.pdf` });

  if (firmada.error || !firmada.data?.signedUrl) {
    logger.error('export.pdf.firma', {
      tenant: tenantId, liquidacion: id, path: data.pdf_url,
      err: firmada.error?.message ?? 'storage no devolvió URL firmada',
    });
    return new NextResponse('No se pudo preparar la descarga. Intenta de nuevo en un momento.', { status: 502 });
  }

  return NextResponse.redirect(firmada.data.signedUrl, 302);
}
