import { logger } from '@/lib/logger';
import type { ResultadoEnvio } from './enviar';

// ═══════════════════════════════════════════════════════════════════════════
// REINTENTO ACOTADO DEL CORREO DE ACCESO.
//
// `enviarCorreo` no reintenta a propósito (un aviso doble enseña a ignorar
// avisos). El correo de acceso es distinto: es la llave de la cuenta y un
// fallo transitorio del proveedor deja a la persona sin entrar. Por eso el
// reintento vive AQUÍ, en quien llama, y solo es seguro porque cada intento
// viaja con la MISMA llave de idempotencia: si el primer POST sí salió y solo
// se perdió la respuesta, Resend devuelve el envío original en vez de mandar
// un segundo correo.
//
// Qué se reintenta: 429, 5xx y fallos de red/timeout. Qué NUNCA: cualquier otro
// 4xx (validación, dominio no verificado, llave inválida) ni «sin configurar».
// ═══════════════════════════════════════════════════════════════════════════

/** Reintentos máximos DESPUÉS del primer intento. */
export const MAX_REINTENTOS_CORREO = 2;
/** Esperas crecientes entre intentos (ms). */
const ESPERAS_MS = [300, 900] as const;

/** ¿El resultado fallido es transitorio (vale la pena volver a intentar)? */
export function esTransitorio(r: ResultadoEnvio): boolean {
  if (r.ok) return false;
  if (r.motivo === 'red') return true;
  if (r.motivo === 'rechazado') {
    const s = r.status;
    return typeof s === 'number' && (s === 429 || s >= 500);
  }
  return false;
}

const dormir = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

export async function conReintentoTransitorio(
  intento: () => Promise<ResultadoEnvio>,
  dormirFn: (ms: number) => Promise<void> = dormir,
): Promise<ResultadoEnvio> {
  let r = await intento();
  for (let n = 0; n < MAX_REINTENTOS_CORREO && esTransitorio(r); n++) {
    logger.warn('correo.reintento', { numero: n + 1, motivo: r.ok ? 'ok' : r.motivo });
    await dormirFn(ESPERAS_MS[n] ?? ESPERAS_MS[ESPERAS_MS.length - 1]);
    r = await intento();
  }
  return r;
}
