import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { toCsv, toLiquidacionRows } from '@/lib/cuadra/export';

export const runtime = 'nodejs';

// Export de liquidaciones a CSV (ERP/Excel). RLS aplica el scoping por tenant
// automáticamente vía la sesión del usuario — no se filtra a mano.
export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse('No autorizado', { status: 401 });

  const { data, error } = await sb
    .from('liquidacion')
    .select('created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, viaje:viaje_id(folio, operador:operador_id(nombre))')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return new NextResponse(error.message, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = toLiquidacionRows((data ?? []) as any);
  const csv = toCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="liquidaciones_cuadra.csv"`,
    },
  });
}
