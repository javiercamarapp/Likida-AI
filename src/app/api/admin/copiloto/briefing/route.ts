// El briefing «Decide hoy» del Copiloto (F5): GET, solo lectura. Las rutas /api no pasan por el layout de /admin, así que esta
// es su propia puerta (misma que el chat): sin sesión 401, otro rol 403. Cada fuente cae por separado y se declara en
// `fuentesCiegas`; nunca se reporta «sin pendientes» sobre una lectura que falló.
import { NextResponse } from 'next/server';
import { sesionSuperadmin } from '../puerta';
import { armarBriefing } from '@/lib/admin/copiloto-briefing';
import { rateLimit } from '@/lib/ratelimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET() {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;
  if (!(await rateLimit(`copiloto:briefing:${sesion.userId}`, 30, 60_000))) {
    return NextResponse.json({ error: 'demasiadas lecturas del briefing — espera un momento' }, { status: 429 });
  }
  const b = await armarBriefing(Date.now());
  return NextResponse.json(b, { headers: { 'Cache-Control': 'no-store' } });
}
