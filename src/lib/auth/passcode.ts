// Gate simple del dashboard para el demo: passcode contra variable de entorno,
// SIN Supabase Auth, sin sesión, sin registro. La cookie guarda un token derivado
// (no el passcode crudo). No es autenticación real — es un candado suave para que
// el director pueda ver el panel por su cuenta después de la sala. El flujo real
// de auth (+ AL-5, reads vía RLS) es bloqueante de SEGUNDO CLIENTE, no del demo.

export const ACCESS_COOKIE = 'likida_access';

/** Token derivado del passcode (btoa: funciona en Node y en el runtime edge). */
export function accessToken(passcode: string): string {
  return btoa(`likida:${passcode}`);
}

/** Token esperado según la env, o null si no hay passcode configurado. */
export function expectedAccessToken(): string | null {
  const p = process.env.DASHBOARD_PASSCODE;
  return p ? accessToken(p) : null;
}
