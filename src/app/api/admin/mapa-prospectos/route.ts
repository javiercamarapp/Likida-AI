// El latido del Cerebro de ventas: el cliente pollea aquí cada 5 min para que
// un prospecto nuevo (del cazador, del enriquecedor, de la prospección)
// aparezca en el mapa SIN recargar — el "se va poniendo solo" de la orden
// del 17-ago. Solo lectura; puerta propia porque /api no pasa por el layout
// de /admin (mismo patrón que qa/puerta.ts).
//
// FE-16 — `?desde=` ES EL ARREGLO. Hasta hoy cada latido devolvía la cartera
// ENTERA (33 mil prospectos, ~33 MB de JSON) por pestaña abierta y cada cinco
// minutos, para que casi siempre nada hubiera cambiado. Con `desde` la
// respuesta trae solo `updated_at > desde`: en reposo, cero filas y unos
// cientos de bytes. Sin `desde` sigue siendo la carga completa — que es lo que
// pide la primera pintada y lo que el cliente vuelve a pedir cuando detecta
// una baja.
import { NextResponse } from 'next/server';
import { getDatosMapa } from '@/lib/admin/prospectos-mapa';
import { sesionSuperadmin } from './puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { error } = await sesionSuperadmin();
  if (error) return error;
  const crudo = new URL(req.url).searchParams.get('desde');
  // Una marca que no es una fecha se IGNORA (carga completa) en vez de
  // viajar a Postgres: `updated_at > 'perro'` es un 400 del otro lado, y el
  // cliente lo vería como "la red falló" y se quedaría con el mapa viejo.
  const desde = crudo && !Number.isNaN(Date.parse(crudo)) ? crudo : null;
  const datos = await getDatosMapa({ desde });
  return NextResponse.json(datos, { headers: { 'Cache-Control': 'no-store' } });
}
