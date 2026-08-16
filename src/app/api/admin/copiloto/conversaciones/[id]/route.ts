// Una conversación completa del historial del copiloto (0121). El anclaje
// por usuario vive en traerConversacionCopiloto: un id ajeno devuelve 404,
// no la conversación de otro.
import { NextResponse, type NextRequest } from 'next/server';
import { traerConversacionCopiloto } from '@/lib/agents/copiloto-historial';
import { validarConversacionId } from '@/app/api/dashboard/chat/validacion';
import { logger } from '@/lib/logger';
import { sesionSuperadmin } from '../../puerta';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;

  const id = validarConversacionId((await params).id);
  if (!id) return NextResponse.json({ error: 'id inválido' }, { status: 400 });

  try {
    const conversacion = await traerConversacionCopiloto(sesion.userId, id);
    if (!conversacion) return NextResponse.json({ error: 'no existe' }, { status: 404 });
    return NextResponse.json(conversacion);
  } catch (err) {
    logger.error('copiloto.conversaciones.traer_fallo', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'no se pudo leer la conversación' }, { status: 502 });
  }
}
