// La puerta compartida de las rutas del copiloto — vive FUERA de route.ts
// porque Next valida los exports de una ruta (misma razón que
// api/dashboard/chat/validacion.ts) y porque ahora son TRES rutas con la
// misma puerta: el chat/acciones, la lista del historial y una conversación.
// Las rutas /api no pasan por el layout de /admin: cada una re-chequea aquí.
import { NextResponse } from 'next/server';
import { getSessionTenant, type SessionTenant } from '@/lib/auth/session';

/** Sin sesión: 401. Otro rol: 403. Ninguna dice qué hay detrás. */
export async function sesionSuperadmin(): Promise<
  { error: NextResponse; sesion: null } | { error: null; sesion: SessionTenant }
> {
  const s = await getSessionTenant();
  if (!s) return { error: new NextResponse(null, { status: 401 }), sesion: null };
  if (s.rol !== 'superadmin') return { error: new NextResponse(null, { status: 403 }), sesion: null };
  return { error: null, sesion: s };
}
