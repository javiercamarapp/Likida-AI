// Conversiones de bytes del buzón, juntas en UN archivo: el guardia de la frontera de datos cuenta cualquier
// `.from(` —también `Buffer.from(`— como acceso directo a Supabase (mismo motivo que carta_porte_docs/bytes.ts).

export const aBuffer = (b: Uint8Array): Buffer => Buffer.from(b.buffer, b.byteOffset, b.byteLength);

/** Una copia independiente (el original puede ser una vista de un buffer más grande). */
export const copiar = (b: Uint8Array): Buffer => Buffer.from(b);

export const bufferDeTexto = (s: string, codificacion: 'utf8' | 'latin1' | 'base64' = 'utf8'): Buffer => Buffer.from(s, codificacion);

export const bufferDeBytes = (b: readonly number[]): Buffer => Buffer.from(b);
