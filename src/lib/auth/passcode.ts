// Gate del dashboard para el demo: passcode contra variable de entorno, SIN
// Supabase Auth. La cookie guarda un HMAC-SHA256 del passcode (con un secreto de
// servidor), NO el passcode ni un base64 reversible. No es autenticación real —
// es un candado suave para que el director vea el panel después de la sala. El
// flujo real de auth (+ AL-5, reads vía RLS) es bloqueante de SEGUNDO CLIENTE.
//
// Usa Web Crypto (crypto.subtle), disponible en edge Y node → el middleware
// funciona en cualquier runtime.

export const ACCESS_COOKIE = 'likida_access';

function secret(): string {
  const s = process.env.DASHBOARD_SECRET;
  if (s) return s;

  // EN PRODUCCIÓN NO HAY FALLBACK, Y ES A PROPÓSITO.
  //
  // Antes caía a `likida:${DASHBOARD_PASSCODE}`: la cookie era HMAC(passcode) con
  // una clave DERIVADA del propio passcode. Quien capture UNA cookie puede probar
  // candidatos offline —sin tocar /acceso, sin su rate-limit— hasta dar con el
  // passcode, y entrar por el formulario normal indefinidamente. Un passcode de
  // demo tiene poca entropía: eso son minutos de cómputo.
  //
  // Un candado que parece cerrado y no lo está es peor que uno que avisa que no
  // está puesto.
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DASHBOARD_SECRET es obligatorio en producción: sin él el HMAC de la cookie se deriva del propio passcode, y una cookie capturada permite crackearlo offline.',
    );
  }
  return `likida:${process.env.DASHBOARD_PASSCODE || 'dev'}`;
}

async function hmacHex(msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Token = HMAC-SHA256(passcode) con el secreto de servidor. Irreversible. */
export async function accessToken(passcode: string): Promise<string> {
  return hmacHex(`likida-access:${passcode}`);
}

/** Token esperado según la env, o null si no hay passcode configurado. */
export async function expectedAccessToken(): Promise<string | null> {
  const p = process.env.DASHBOARD_PASSCODE;
  return p ? accessToken(p) : null;
}

/**
 * Comparación en tiempo constante (evita fuga por timing).
 *
 * Se exporta para que `/acceso` la use también: comparaba el passcode con `===`,
 * que sale al primer carácter distinto. El rate-limit hace la explotación
 * difícil, pero teniendo el helper al lado no hay razón para no usarlo.
 */
export function constTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function tokenMatches(cookie: string | undefined | null): Promise<boolean> {
  const expected = await expectedAccessToken();
  if (!expected || !cookie) return false;
  return constTimeEq(cookie, expected);
}
