import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';
import { rateLimit, clientIp } from '@/lib/ratelimit';
import { ACCESS_COOKIE, tokenMatches } from '@/lib/auth/passcode';

export const runtime = 'nodejs';

const TENANT = () => process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';

// Export de liquidaciones a CSV (ERP/Excel). Gate por el MISMO passcode del
// dashboard (la app no tiene Supabase Auth). Como no hay sesión, RLS no puede
// scopear solo → se filtra EXPLÍCITO por tenant_id con service-role.
export async function GET(req: Request) {
  if (!rateLimit(`export:${clientIp(req)}`, 10, 60_000)) return new NextResponse('Demasiadas peticiones', { status: 429 });

  const cookie = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!(await tokenMatches(cookie))) return new NextResponse('No autorizado', { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
    .eq('tenant_id', TENANT())
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return new NextResponse(error.message, { status: 500 });

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
