// La lista del panel Historial del copiloto (0121). Misma puerta que el
// endpoint del chat (las rutas /api no pasan por el layout de /admin) y el
// mismo contrato que /api/dashboard/conversaciones: fallar DICIENDO — una
// lista vacía por error afirmaría "no has chateado".
import { NextResponse } from 'next/server';
import { listarConversacionesCopiloto } from '@/lib/agents/copiloto-historial';
import { logger } from '@/lib/logger';
import { sesionSuperadmin } from '../puerta';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { error: puerta, sesion } = await sesionSuperadmin();
  if (!sesion) return puerta;

  try {
    const conversaciones = await listarConversacionesCopiloto(sesion.userId);
    return NextResponse.json({ conversaciones });
  } catch (err) {
    logger.error('copiloto.conversaciones.listar_fallo', { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'no se pudo leer el historial' }, { status: 502 });
  }
}
