import { NextResponse } from 'next/server';
import { sesionSuperadmin } from '@/lib/auth/api-superadmin';
import { getBandejaEscalaciones } from '@/lib/admin/escalaciones';
import { casoDeEscalacion, claveDeEscalacion } from '@/lib/admin/casos-regresion';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// «Convertir en caso de examen» (F14-B): descarga un JSON REDACTADO de un renglón de Escalaciones. No guarda nada en la base y
// no toca el repositorio: el dueño lo guarda en el corpus fuera de git. Puerta propia (las rutas /api no pasan por el layout).
export async function GET(req: Request) {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;
  const url = new URL(req.url);
  const fuente = url.searchParams.get('fuente') ?? '';
  const clave = url.searchParams.get('clave') ?? '';
  if (!/^[a-z_]{3,30}$/.test(fuente) || !/^[0-9a-f]{16}$/.test(clave)) return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  try {
    const ahora = Date.now();
    const bandeja = await getBandejaEscalaciones(ahora);
    const item = bandeja.cola.find((i) => i.fuente === fuente && claveDeEscalacion(i) === clave);
    if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const caso = casoDeEscalacion(item, { ahoraMs: ahora });
    return new NextResponse(JSON.stringify(caso, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${caso.id}.json"`, 'cache-control': 'no-store' },
    });
  } catch (e) {
    logger.error('admin.caso_examen_fallo', { err: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ error: 'caso_not_generated' }, { status: 422 });
  }
}
