// ═══════════════════════════════════════════════════════════════════════════
// ENTRADA POR LÍNEA PROPIA DE UN TENANT (paquete W).
//
// Un mensaje que llega por el `phone_number_id` de la línea de UN tenant solo
// puede pertenecer a ESE tenant. Aquí vive la comprobación de pertenencia del
// remitente y la respuesta «no estás registrado» POR ESA MISMA LÍNEA.
//
// AISLAMIENTO (sagrado): las consultas filtran por `tenant_id`. Si el remitente
// no existe en ese tenant NO se busca en ningún otro: se le dice que no está
// registrado y se corta. Un fallo de lectura LANZA (nunca se lee como «no existe»).
//
// El token de la línea NO viaja en `InboundMessage` (esa fila se persiste en la
// bandeja durable): se resuelve aquí, en el momento de responder, con
// `resolverCanal(tenantId)`, y nunca se registra en logs.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
import { variantesTelefono } from './telefono_variantes';
import { crearRepoVigia } from './vigia/repo';
import { resolverCanal } from '@/lib/meta/canal';
import { destinatarioWhatsApp, destinatarioEnmascarado } from '@/lib/meta/client';
import { logger } from '@/lib/logger';

const GRAPH = 'https://graph.facebook.com/v21.0';

export const TEXTO_NO_REGISTRADO_EN_LINEA =
  'Hola, no te tengo registrado en esta línea. Pídele a tu flota que te dé de alta en Likida. 🚛';

/** ¿El número es operador activo, cuenta de oficina activa o contacto del Vigía DE ESTE TENANT? Lanza si la base no contesta. */
export async function remitenteEnTenant(tenantId: string, telefono: string): Promise<boolean> {
  const variantes = variantesTelefono(telefono);
  const op = await acotada(supabaseAdmin().from('operador').select('id')
    .eq('tenant_id', tenantId).in('telefono', variantes).eq('activo', true)
    .order('id', { ascending: true }).limit(1), 'linea.operador');
  if (op.error) throw new Error(`línea: operador por teléfono: ${op.error.message}`);
  if ((op.data ?? []).length > 0) return true;

  const of = await acotada(supabaseAdmin().from('app_user').select('id, activo')
    .eq('tenant_id', tenantId).in('telefono', variantes)
    .or('activo.is.null,activo.eq.true')
    .order('id', { ascending: true }).limit(5), 'linea.oficina');
  if (of.error) throw new Error(`línea: cuenta por teléfono: ${of.error.message}`);
  if ((of.data ?? []).some((f) => (f as { activo?: boolean }).activo !== false)) return true;

  const vigia = await crearRepoVigia().contactoPorTelefono(telefono);
  return vigia?.tenantId === tenantId;
}

/** Responde texto por la línea del tenant (nunca por la de plataforma). Best-effort: no lanza. */
export async function responderPorLinea(tenantId: string, telefono: string, texto: string): Promise<boolean> {
  try {
    const canal = await resolverCanal(tenantId);
    const res = await fetch(`${GRAPH}/${encodeURIComponent(canal.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${canal.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: destinatarioWhatsApp(telefono), type: 'text', text: { body: texto } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn('wa.linea.respuesta_rechazada', { tenantId, status: res.status, para: destinatarioEnmascarado(telefono) });
      return false;
    }
    return true;
  } catch (e) {
    logger.warn('wa.linea.respuesta_fallo', { tenantId, err: e instanceof Error ? e.message : String(e) });
    return false;
  }
}
