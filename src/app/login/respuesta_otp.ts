// ═══════════════════════════════════════════════════════════════════════════
// QUÉ VE QUIEN PIDE UN MAGIC LINK, decidido para que /login no sea un oráculo.
//
// AUDITORÍA 18, MEDIO (M24). El anti-oráculo anterior enumeraba el caso "el
// correo no existe" (`otp_disabled`) y lo disfrazaba de "enviado"; todo lo
// demás salía como error. Pero GoTrue solo intenta MANDAR el correo cuando la
// cuenta existe, así que el segundo intento en 60 s de un correo real volvía
// con `over_email_send_rate_limit` → "Algo falló", y el de un correo
// inexistente volvía con `otp_disabled` → "Te mandamos un enlace". Dos
// peticiones distinguían las dos poblaciones.
//
// La regla se invierte: SOLO un conjunto cerrado de fallos que no dependen de
// si la cuenta existe (el correo está malformado — GoTrue lo rechaza antes de
// buscarlo) se enseña como error. Cualquier otra cosa —cuota de envío, SMTP
// caído, cuenta inexistente, código que no conocemos— se ve como "enviado" y se
// deja en el log. El costo es que un fallo real de infraestructura también se
// ve como "enviado"; por eso la pantalla de "enviado" conserva el formulario
// (B8) y el reenvío existe (`reenvio_enlace.ts`).
//
// Y el TIEMPO: mandar un correo tarda más que rechazar un `otp_disabled`.
// `conPisoDeTiempo` hace que ambas ramas duren al menos `PISO_RESPUESTA_MS`
// — un piso, no una igualación perfecta, pero por encima del envío típico por
// SMTP de Supabase (≈ 200-800 ms medidos).
// ═══════════════════════════════════════════════════════════════════════════

export interface ErrorOtp { code?: string; message?: string; status?: number }

/** Fallos que GoTrue decide ANTES de mirar si el correo tiene cuenta: la
 *  dirección no es una dirección. Son los únicos que se pueden enseñar como
 *  error sin revelar nada. */
const CODIGOS_PROPIOS = new Set(['validation_failed', 'email_address_invalid']);

export type RespuestaOtp = 'enviado' | 'error';

export function respuestaOtp(error: ErrorOtp | null | undefined): RespuestaOtp {
  if (!error) return 'enviado';
  if (error.code && CODIGOS_PROPIOS.has(error.code)) return 'error';
  return 'enviado';
}

export const PISO_RESPUESTA_MS = 1500;

/** Resuelve con el resultado de `fn`, pero nunca antes de `ms` milisegundos
 *  desde que se llamó — aunque `fn` rechace (la espera se respeta igual). */
export async function conPisoDeTiempo<T>(fn: () => Promise<T>, ms: number = PISO_RESPUESTA_MS): Promise<T> {
  const piso = new Promise<void>((r) => setTimeout(r, ms));
  const [resultado] = await Promise.allSettled([fn(), piso]);
  if (resultado.status === 'rejected') throw resultado.reason;
  return resultado.value;
}
