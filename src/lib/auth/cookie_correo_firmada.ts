import { createHmac, timingSafeEqual } from 'node:crypto';

// ═══════════════════════════════════════════════════════════════════════════
// COOKIE `likida_correo_enlace` FIRMADA (CT-SEG-14).
//
// Antes la cookie era el correo en claro: cualquiera la fijaba a mano
// (`likida_correo_enlace=victima@x.com`), abría `/auth/callback?error_code=
// otp_expired` y veía si Likida "reenviaba" o no => oráculo de existencia de
// cuenta. Ahora el valor es `v1.<correo b64url>.<expira>.<firma HMAC-SHA256>`:
// solo vale una cookie que EL SERVIDOR emitió en /login, con vencimiento
// firmado. Un valor inventado, alterado o vencido se trata como "sin cookie".
//
// El secreto sale de, en este orden: CORREO_ENLACE_SECRET, SUPABASE_AUTH_HOOK_SECRET,
// CRON_SECRET (todos ya existen en producción; CORREO_ENLACE_SECRET es opcional
// y permite rotar solo esta firma). Sin ninguno NO se emite ni se acepta cookie:
// falla cerrado a "no se reenvía", que es el comportamiento seguro y el consejo
// de siempre en pantalla.
// ═══════════════════════════════════════════════════════════════════════════

const ETIQUETA = 'likida/correo-enlace/v1';

function secreto(): string | null {
  const s = process.env.CORREO_ENLACE_SECRET || process.env.SUPABASE_AUTH_HOOK_SECRET || process.env.CRON_SECRET;
  return s && s.length >= 8 ? s : null;
}

function firmar(clave: string, correoB64: string, expira: number): string {
  return createHmac('sha256', clave).update(`${ETIQUETA}|${correoB64}|${expira}`).digest('base64url');
}

/** Valor firmado para guardar en la cookie, o null si no hay secreto configurado. */
export function firmarCorreoCookie(email: string, vidaSegundos: number, ahoraMs = Date.now()): string | null {
  const clave = secreto();
  if (!clave) return null;
  const correoB64 = Buffer.from(email, 'utf8').toString('base64url');
  const expira = Math.floor(ahoraMs / 1000) + vidaSegundos;
  return `v1.${correoB64}.${expira}.${firmar(clave, correoB64, expira)}`;
}

/** El correo si la cookie es auténtica y vigente; '' en cualquier otro caso. */
export function leerCorreoCookie(valor: string | undefined, ahoraMs = Date.now()): string {
  const clave = secreto();
  if (!valor || !clave) return '';
  const partes = valor.split('.');
  if (partes.length !== 4 || partes[0] !== 'v1') return '';
  const [, correoB64, expiraTxt, firma] = partes;
  const expira = Number(expiraTxt);
  if (!Number.isInteger(expira) || expira * 1000 < ahoraMs) return '';
  const esperada = Buffer.from(firmar(clave, correoB64, expira));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return '';
  try {
    return Buffer.from(correoB64, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}
