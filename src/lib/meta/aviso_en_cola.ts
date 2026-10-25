/**
 * A37-S56-02 — ¿el aviso que «falló» en realidad YA QUEDÓ en `wa_outbox`?
 *
 * El cliente de Meta, ante un rechazo transitorio (timeout, 429, 5xx) o un token vencido (190/401), deja el
 * mensaje en `wa_outbox`, que lo entrega solo. Quien llama a `avisarOficina`/`enviarConFallback` recibe
 * `ok:false` con `encolado` o `reintentable`. Soltar el reclamo o no sellar y volver a mandar en la corrida
 * siguiente duplica un aviso a una persona (plazo legal, regla, vencimiento) una vez por hora mientras dure la
 * caída. Quien tenga un «una sola vez» debe tratar este caso como ENVIADO / en vuelo.
 *
 * Archivo aparte y puro a propósito: lo importan tres barridos cuyos tests ya doblan `enviar_con_fallback`.
 */
export function avisoQuedoEnCola(r: { ok: boolean; encolado?: boolean; reintentable?: boolean } | null | undefined): boolean {
  return !!r && r.ok === false && (r.encolado === true || r.reintentable === true);
}
