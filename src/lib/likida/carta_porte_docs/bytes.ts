// Conversiones de bytes del módulo, juntas en UN archivo. No es estética: el guardia de la frontera de datos
// cuenta cualquier `.from(` —también `Buffer.from(`— como acceso directo a Supabase, y repartir veinte
// conversiones inofensivas por el módulo inflaría ese techo con falsos positivos.

export const aBuffer = (b: Uint8Array): Buffer => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

export function textoDeBytes(b: Uint8Array, codificacion: 'utf8' | 'latin1' = 'utf8', hasta?: number): string {
  return aBuffer(hasta === undefined ? b : b.subarray(0, hasta)).toString(codificacion);
}

export function bytesDeBase64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64'));
}

export function textoDeBase64(s: string): string {
  return Buffer.from(s, 'base64').toString('utf8');
}

/** Un texto latin1 (quoted-printable ya decodificado a bytes) leído como UTF-8. */
export function utf8DeLatin1(s: string): string {
  return Buffer.from(s, 'latin1').toString('utf8');
}

export function bytesDeTexto(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
