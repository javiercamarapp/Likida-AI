import { revalidatePath } from 'next/cache';
import { requireSuperadmin } from '@/lib/auth/guard';
import { decidirCliente } from '@/lib/mcp/oauth';
import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { logger } from '@/lib/logger';
import type { ResultadoAccion } from '../ui/forma';

/**
 * Decide un cliente OAuth del MCP y deja rastro. Vive aparte de la página para
 * poder probarse. A NIVEL DE MÓDULO: un server action serializa lo que captura
 * de su closure y una función no se serializa (server_actions_sin_closures.test.ts).
 *
 * A37-S07-03: aprobar/rechazar un cliente (rechazar revoca credenciales de varias
 * flotas, sin vuelta atrás) NO puede quedar sin rastro con la pantalla diciendo
 * «éxito». La anotación se reintenta una vez; si aun así no se escribe, la
 * decisión ya está aplicada (no se puede deshacer) y la pantalla lo DICE.
 */
export async function decidirYAnotar(
  decision: 'aprobado' | 'rechazado',
  fd: FormData,
): Promise<ResultadoAccion> {
  const s = await requireSuperadmin();
  const clientId = String(fd.get('cliente') ?? '');
  const r = await decidirCliente(clientId, decision, s.userId);
  if (!r.ok) return { error: r.detalle };
  revalidatePath('/admin/mcp-clientes');
  // Bitácora del superadmin: tenant ambiguo por diseño, se firma con el actor.
  const entrada = {
    tenantId: s.tenantId ?? null,
    actor: { id: s.userId },
    accion: decision === 'aprobado' ? 'mcp.cliente_aprobado' : 'mcp.cliente_rechazado',
    entidad: 'mcp_oauth_cliente' as const,
    entidadId: clientId,
    detalle: { tokens_revocados: r.revocados },
  };
  const opciones = { evento: 'mcp.bitacora' };
  const anotada = (await anotarBitacora(entrada, opciones)) || (await anotarBitacora(entrada, opciones));
  const ok = decision === 'aprobado'
    ? 'Cliente aprobado: ya puede pedir consentimiento.'
    : `Cliente rechazado. Tokens vivos revocados: ${r.revocados}.`;
  if (!anotada) {
    logger.error('mcp.cliente_bitacora_perdida', { accion: entrada.accion, clientId });
    return {
      ok: `${ok} ATENCIÓN: la decisión quedó aplicada pero NO se pudo anotar en la bitácora de auditoría; anótala a mano (cliente ${clientId}, ${entrada.accion}).`,
    };
  }
  return { ok };
}
