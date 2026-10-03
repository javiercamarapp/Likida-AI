import { NextResponse } from 'next/server';
import { procesarPush } from '@/lib/likida/gps_push/recibir';

// Puerta pública: NO hay sesión. Su única autenticación es la firma HMAC por
// flota (ver `lib/likida/gps_push/recibir.ts`); el límite de tasa corre antes
// de leer el cuerpo.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ flota: string }> }) {
  const { flota } = await ctx.params;
  const { estado, cuerpo } = await procesarPush(req, flota);
  return NextResponse.json(cuerpo, { status: estado, headers: { 'Cache-Control': 'no-store' } });
}
