// A37-S51-04: ¿el envío al WhatsApp de la oficina quedó EN COLA aunque no salió «ok»?
//
// `avisarOficina` devuelve `ok:false` con `reintentable` (timeout, 429, 5xx) o `encolado` (también el token vencido 190/401,
// que no es reintentable pero igual se encola): en ambos casos el cliente de Meta YA dejó el mensaje en `wa_outbox` y saldrá
// solo. Tratarlo como fallo libera la reserva y el siguiente barrido manda OTRO: cuando el outbox entrega, la persona recibe
// copias duplicadas. Quien reserva «una sola vez» debe contarlo como enviado.

export const quedoEnCola = (r: { ok: boolean; reintentable?: boolean; encolado?: boolean }): boolean =>
  !r.ok && (r.reintentable === true || r.encolado === true);
