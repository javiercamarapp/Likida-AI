import { createHmac, timingSafeEqual } from 'node:crypto';
import { appUrl } from '@/lib/env';

// ═══════════════════════════════════════════════════════════════════════════
// LA LIGA DE BAJA — el enlace real de un solo clic que la campaña fría exige
// (LFPDPPP art. 16 fr. II + las guías de Gmail/Yahoo para remitente masivo,
// 2024-26: sin `List-Unsubscribe` de un clic, el correo puntúa como spam).
//
// Hasta este módulo, la ÚNICA baja funcional era responder con la palabra
// BAJA (`respuesta_campana.ts`) — cumple LFPDPPP, pero no es lo que un
// destinatario espera ver ni lo que los filtros de un remitente masivo piden.
// Este módulo agrega la LIGA sin quitar esa vía: las dos conviven.
//
// EL TOKEN ES UN HMAC DEL CORREO, no un ID guardado por envío — mismo criterio
// que `firma_entrante.ts` (HMAC + comparación en tiempo constante) y que
// `cron.ts` (SEG-5: no cortar en el primer byte distinto). Firmar el correo en
// vez de guardar una fila:
//   · no necesita una tabla ni una migración por enlace;
//   · el enlace sigue vivo para siempre (la baja no debe caducar);
//   · es el MISMO enlace cada vez que ese correo recibe una campaña, así que
//     un cliente de correo que lo prefetchea dos veces no cambia nada.
//
// SIN SECRETO CONFIGURADO, NO HAY LIGA — y eso es DELIBERADO: `enviarPieza-
// PorCorreo` (cola.ts) rechaza mandar una campaña sin una liga de baja
// funcional. El cumplimiento no es opcional, y una variable de entorno
// olvidada no puede convertirse en "correo sin baja" silencioso.
// ═══════════════════════════════════════════════════════════════════════════

/** ¿Hay secreto configurado? Lo usa la puerta de salida para decidir, antes
 *  de intentar nada, si una campaña puede siquiera llevar su liga obligatoria. */
export function bajaSecretoConfigurado(): boolean {
  return Boolean(process.env.LIKIDA_BAJA_SECRET?.trim());
}

function llave(): Buffer | null {
  const s = process.env.LIKIDA_BAJA_SECRET?.trim();
  return s ? Buffer.from(s, 'utf8') : null;
}

function normalizar(correo: string): string {
  return correo.trim().toLowerCase();
}

/** Firma un correo. `null` si no hay secreto — nunca un token que parezca
 *  válido y no lo sea. */
export function firmarBaja(correo: string): string | null {
  const k = llave();
  if (!k) return null;
  return createHmac('sha256', k).update(normalizar(correo), 'utf8').digest('base64url');
}

/** Verifica en tiempo constante. `false` ante cualquier duda: sin secreto,
 *  correo vacío, token de otro largo o de otro correo. */
export function verificarBaja(correo: string, token: string): boolean {
  const esperado = firmarBaja(correo);
  if (!esperado || !token) return false;
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** La URL pública, lista para ir en el correo y en `List-Unsubscribe`.
 *  `null` si no hay secreto — el llamador decide qué hacer con eso (cola.ts:
 *  no manda la campaña). */
export function urlBaja(correo: string): string | null {
  const token = firmarBaja(correo);
  if (!token) return null;
  const c = normalizar(correo);
  return `${appUrl()}/api/correo/baja?e=${encodeURIComponent(c)}&t=${encodeURIComponent(token)}`;
}
