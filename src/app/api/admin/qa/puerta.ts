// La puerta de las rutas /api/admin/qa/* — mismo patrón que
// api/admin/copiloto/puerta.ts: las rutas /api NO pasan por el layout de
// /admin (su requireSuperadmin() no las cubre), así que cada familia de rutas
// re-chequea aquí. Detrás hay lecturas y ESCRITURAS con service_role más
// gasto real de modelo por corrida — sin sesión: 401; otro rol: 403; ninguna
// respuesta dice qué hay detrás.
import { NextResponse } from 'next/server';
import { getSessionTenant, type SessionTenant } from '@/lib/auth/session';

export async function sesionSuperadmin(): Promise<
  { error: NextResponse; sesion: null } | { error: null; sesion: SessionTenant }
> {
  const s = await getSessionTenant();
  if (!s) return { error: new NextResponse(null, { status: 401 }), sesion: null };
  if (s.rol !== 'superadmin') return { error: new NextResponse(null, { status: 403 }), sesion: null };
  return { error: null, sesion: s };
}
