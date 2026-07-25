// Hash de contenido de una imagen (SHA-256) para deduplicar fotos. La
// idempotencia por waMessageId cubre los REINTENTOS de Meta, pero NO cuando el
// operador reenvía manualmente la MISMA foto (otro waMessageId) → sin esto, se
// duplicaría el gasto (error de dinero). Web Crypto = edge/node compatible.

/** SHA-256 (hex) de los bytes de un data URL "data:...;base64,XXXX". */
export async function hashImagen(dataUrl: string): Promise<string> {
  const coma = dataUrl.indexOf(',');
  const b64 = coma >= 0 ? dataUrl.slice(coma + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
