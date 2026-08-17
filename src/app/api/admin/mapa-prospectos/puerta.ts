// La puerta de /api/admin/mapa-prospectos — mismo patrón que qa/puerta.ts:
// las rutas /api no pasan por el layout de /admin, así que esta familia
// re-chequea sesión aquí. Detrás hay la cartera comercial completa (829
// prospectos con teléfonos y decisores) — sin sesión: 401; otro rol: 403.
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
