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
  // En producción debe ponerse DASHBOARD_SECRET; si falta, cae al passcode.
  return process.env.DASHBOARD_SECRET || `likida:${process.env.DASHBOARD_PASSCODE || 'dev'}`;
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

/** Comparación en tiempo constante (evita fuga por timing). */
function constTimeEq(a: string, b: string): boolean {
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
