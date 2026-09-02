/**
 * Leer el cuerpo de un webhook SIN pasarse del tope, aunque el emisor mienta.
 *
 * Vivía como función privada de `correo/entrante/route.ts`. Sube aquí por la
 * AUDITORÍA 24 (BE-21): `correo/eventos` hacía `await req.text()` y MEDÍA
 * DESPUÉS, así que un POST `chunked` sin `content-length` —y sin ninguna
 * cabecera svix, o sea sin haber demostrado nada— materializaba en memoria lo
 * que quisiera antes de que el 413 llegara. El tope tiene que aplicarse
 * mientras se lee, no cuando ya está adentro.
 *
 * Devuelve `null` cuando el cuerpo se pasa: quien llama contesta 413. Las dos
 * rutas necesitan el cuerpo CRUDO (un `JSON.parse` + `stringify` reordena
 * llaves y la firma dejaría de cuadrar), por eso devuelve texto y no un objeto.
 */
export async function cuerpoAcotado(req: Request, maxBytes: number): Promise<string | null> {
  const declarado = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declarado) && declarado > maxBytes) return null;
  if (!req.body) return '';
  const lector = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await lector.cancel();
        return null;
      }
      partes.push(value);
    }
  } finally {
    lector.releaseLock();
  }
  const combinado = new Uint8Array(total);
  let offset = 0;
  for (const parte of partes) { combinado.set(parte, offset); offset += parte.byteLength; }
  return new TextDecoder().decode(combinado);
}
