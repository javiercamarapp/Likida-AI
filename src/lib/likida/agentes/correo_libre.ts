/**
 * A39-S28-03: dominios de correo GRATUITO o de ISP abierto. Que el correo
 * principal sea `x@gmail.com` NO vuelve «de la empresa» a cualquier otro
 * `@gmail.com` que imprima el sitio (la agencia web, un tercero): esos dominios
 * son de millones de personas. Para ellos la compuerta pide la dirección EXACTA
 * del principal, nunca el dominio.
 */
export const DOMINIOS_DE_CORREO_LIBRE: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com',
  'hotmail.com', 'hotmail.es', 'hotmail.com.mx', 'outlook.com', 'outlook.es', 'outlook.com.mx',
  'live.com', 'live.com.mx', 'msn.com',
  'yahoo.com', 'yahoo.com.mx', 'yahoo.es', 'ymail.com', 'rocketmail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com',
  'zoho.com', 'yandex.com', 'tutanota.com', 'prodigy.net.mx',
]);

/** ¿El correo es de un dominio gratuito / ISP abierto? */
export function esDominioDeCorreoLibre(correo: string): boolean {
  const host = correo.includes('@') ? correo.split('@')[1] : '';
  return DOMINIOS_DE_CORREO_LIBRE.has(host.trim().toLowerCase());
}
