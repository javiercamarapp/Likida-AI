// El latido del Cerebro de ventas: el cliente pollea aquí cada 60 s para que
// un prospecto nuevo (del cazador, del enriquecedor, de la prospección)
// aparezca en el mapa SIN recargar — el "se va poniendo solo" de la orden
// del 17-ago. Solo lectura; puerta propia porque /api no pasa por el layout
// de /admin (mismo patrón que qa/puerta.ts).
import { NextResponse } from 'next/server';
import { getDatosMapa } from '@/lib/admin/prospectos-mapa';
import { sesionSuperadmin } from './puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { error } = await sesionSuperadmin();
  if (error) return error;
  const datos = await getDatosMapa();
  return NextResponse.json(datos, { headers: { 'Cache-Control': 'no-store' } });
}
