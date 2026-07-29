import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { ACCESS_COOKIE, tokenMatches } from '@/lib/auth/passcode';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

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
// URL de vida corta, detrás del MISMO passcode que el resto del panel.
//
// El ejemplar que se entrega es el del CONTRALOR (`{viajeId}.pdf`), no el del
// operador: es el que lleva los veredictos y el que se archiva. Esa separación
// es deliberada en `tools.ts` y aquí se respeta.
// ═══════════════════════════════════════════════════════════════════════════
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!rateLimit(`export-pdf:${clientIp(req)}`, 30, 60_000)) {
    return new NextResponse('Demasiadas peticiones', { status: 429 });
  }

  const cookie = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!(await tokenMatches(cookie))) return new NextResponse('No autorizado', { status: 401 });

  const { id } = await params;
  const admin = supabaseAdmin();
  // El filtro por tenant es EXPLÍCITO: sin sesión de Supabase no hay RLS que
  // scopee, así que un id de otra flota no puede resolver aquí.
  const { data, error } = await admin
    .from('liquidacion')
    .select('pdf_url')
    .eq('id', id)
    .eq('tenant_id', TENANT())
    .maybeSingle();

  if (error) {
    logger.error('export.pdf.lectura', { tenant: TENANT(), liquidacion: id, err: error.message });
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
      tenant: TENANT(), liquidacion: id, path: data.pdf_url,
      err: firmada.error?.message ?? 'storage no devolvió URL firmada',
    });
    return new NextResponse('No se pudo preparar la descarga. Intenta de nuevo en un momento.', { status: 502 });
  }

  return NextResponse.redirect(firmada.data.signedUrl, 302);
}
