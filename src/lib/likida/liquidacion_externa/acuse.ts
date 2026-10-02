// ═══════════════════════════════════════════════════════════════════════════
// LIQUIDACIÓN EXTERNA — el acuse del chofer (los dos botones del mensaje).
//
// El botón llega al webhook como TEXTO con el id del botón por cuerpo (ver
// `webhook/whatsapp/route.ts`), y el processor lo atiende ANTES del agente: es
// la respuesta a una pregunta nuestra, no algo que un modelo deba interpretar.
//
// El id es `liqext_ok:<uuid>` / `liqext_no:<uuid>`. El uuid dice QUÉ
// liquidación; QUIÉN aprieta lo dice el teléfono del remitente (ya resuelto a
// un operador por el processor). Un id ajeno —reenviado o fabricado— no acusa
// la liquidación de otro chofer: `registrarAcuse` compara contra el dueño.
//
// Honestidad de lo que se le contesta al chofer: la respuesta solo afirma lo que
// de verdad pasó. «No coincide» queda marcado en el panel y AVISA a la oficina
// por WhatsApp (el selector central); a la persona solo se le dice «le avisé a tu
// oficina» cuando Meta aceptó ese aviso. Si no salió, se dice que quedó marcado
// en el panel y se le sugiere avisar directo.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';
import { PREFIJO_BOTON_RECIBIDA, PREFIJO_BOTON_NO_COINCIDE } from './presentacion';
import type { TipoAcuse } from './repo';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RE_BOTON = new RegExp(`^(${PREFIJO_BOTON_RECIBIDA}|${PREFIJO_BOTON_NO_COINCIDE})(${UUID})$`, 'i');

export function leerBotonLiquidacionExterna(texto: string): { tipo: TipoAcuse; liquidacionId: string } | null {
  const m = RE_BOTON.exec((texto ?? '').trim());
  if (!m) return null;
  return {
    tipo: m[1].toLowerCase() === PREFIJO_BOTON_RECIBIDA ? 'recibida' : 'no_coincide',
    liquidacionId: m[2].toLowerCase(),
  };
}

/**
 * `null` = el texto no es un botón de este circuito y sigue su camino.
 * Cualquier otra cosa es la respuesta que hay que mandarle al chofer.
 */
export async function atenderAcuseLiquidacionExterna(
  op: { tenantId: string; operadorId: string }, texto: string,
): Promise<string | null> {
  const boton = leerBotonLiquidacionExterna(texto);
  if (!boton) return null;
  try {
    // Import perezoso: el processor importa este archivo en cada turno de
    // WhatsApp, y el servicio arrastra el generador de PDF y el cliente de
    // Storage — que solo se necesitan cuando de verdad llega un botón nuestro.
    const { registrarAcuseConAviso } = await import('./servicio');
    const { resultado: r, avisoOficina } = await registrarAcuseConAviso(op.tenantId, op.operadorId, boton.liquidacionId, boton.tipo);
    logger.info('liqext.acuse', { liquidacion: boton.liquidacionId, tipo: boton.tipo, resultado: r, avisoOficina });
    if (r === 'no_encontrada') {
      return 'No encontré esa liquidación en tu cuenta. Si el botón es de un mensaje viejo, pídele a tu oficina que te la reenvíe. 🙏';
    }
    if (r === 'ya_registrado') return 'Ya tenía registrada esa respuesta. ✅';
    if (boton.tipo === 'recibida') return 'Listo, quedó registrado que recibiste tu liquidación ✅.';
    return avisoOficina === 'enviado'
      ? 'Anotado: tu liquidación NO coincide. Ya le avisé a tu oficina para que la revisen. 🙏'
      : 'Anotado: tu liquidación NO coincide. Quedó marcada en el panel de tu oficina para que la revisen, pero no pude avisarles por WhatsApp: si es urgente, avísales directo. 🙏';
  } catch (e) {
    // Fallar CERRADO y decirlo: «registrado» sin que la base lo haya guardado
    // sería una constancia falsa.
    logger.error('liqext.acuse_error', { liquidacion: boton.liquidacionId, err: e instanceof Error ? e.message : String(e) });
    return 'No pude registrar tu respuesta ahorita 😕. Vuelve a apretar el botón en un momento.';
  }
}
