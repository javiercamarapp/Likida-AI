import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { getSessionTenant } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). Gate por la sesión real del
// contralor (Supabase Auth) — ya no por el passcode compartido. El
// service-role salta RLS, así que se sigue filtrando EXPLÍCITO por
// tenant_id, ahora tomado de la sesión en vez de un env var.
export async function GET(req: Request) {
  if (!rateLimit(`export:${clientIp(req)}`, 10, 60_000)) return new NextResponse('Demasiadas peticiones', { status: 429 });

  const s = await getSessionTenant();
  if (!s || !s.tenantId) return new NextResponse('No autorizado', { status: 401 });
  const tenantId = s.tenantId;

  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(5000);
  // El texto crudo de PostgREST iba en el cuerpo del 500 y del lado del
  // servidor NO quedaba ninguna línea: el único testigo del fallo era el
  // navegador del contralor, que no lo guarda. Si cerraba la pestaña, el evento
  // no existió. Y de paso el mensaje sacaba nombres de columna y detalle del
  // esquema hacia afuera (auditoría 5, operabilidad, ALTO).
  //
  // Se invierte: el detalle se queda dentro y el usuario recibe algo que puede
  // repetir por teléfono. `tenant` va en el log —el redactor lo huella, no lo
  // borra— para saber de qué flota era el fallo.
  if (error) {
    logger.error('export.liquidaciones', { tenant: tenantId, err: error.message });
    return new NextResponse('No se pudo generar el export. Intenta de nuevo en un momento.', { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = toLiquidacionRows((data ?? []) as any);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_likida.csv"`,
    },
  });
}
