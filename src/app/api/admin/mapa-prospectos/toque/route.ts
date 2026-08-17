// El registro de TOQUES (0130): cada tap de WhatsApp/correo desde el Cerebro
// deja fila sola — el timeline por prospecto y el filtro "sin contactar en N
// días" viven de esto. Solo escritura mínima; puerta propia (patrón de la
// familia mapa-prospectos).
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { sesionSuperadmin } from '../puerta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CANALES = new Set(['whatsapp', 'correo', 'llamada', 'visita', 'nota']);

export async function POST(req: Request) {
  const { error, sesion } = await sesionSuperadmin();
  if (error) return error;
  const cuerpo = (await req.json().catch(() => null)) as { id?: string; canal?: string; resumen?: string } | null;
  if (!cuerpo?.id || !/^[0-9a-f-]{36}$/.test(cuerpo.id) || !CANALES.has(cuerpo.canal ?? '')) {
    return NextResponse.json({ error: 'Falta prospecto o canal válido.' }, { status: 400 });
  }
  const { error: e } = await supabaseAdmin().from('prospecto_toque').insert({
    prospecto_id: cuerpo.id,
    canal: cuerpo.canal,
    resumen: cuerpo.resumen?.slice(0, 300) ?? null,
    actor: sesion.userId,
  });
  if (e) {
    logger.error('toque.insert', { err: e.message });
    return NextResponse.json({ error: 'No se pudo registrar el toque.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
