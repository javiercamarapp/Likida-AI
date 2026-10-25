// Quién mandó un correo entrante, contra la lista de remitentes que declaró la flota.
// Pura (sin I/O): la comparten los buzones de carta porte y de peajes.

const DIRECCION = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/**
 * La dirección REAL del From (A37-A3-16, A37-S31-09): la que va entre `< >` o, sin ellos, el valor completo si es una
 * sola dirección. El nombre visible ("alguien@listado.com" <otro@x.com>) NUNCA cuenta: es texto libre del remitente.
 * `null` = no hay una dirección inequívoca (no se adivina). La autenticación SPF/DKIM del proveedor no llega a este
 * punto: lo que se reconoce aquí es solo el From declarado.
 */
export function direccionDeRemitente(remitente: string | null | undefined): string | null {
  const t = (remitente ?? '').trim();
  const ang = /<([^<>]*)>\s*$/.exec(t);
  const candidato = (ang ? ang[1] : t).trim();
  return DIRECCION.test(candidato) ? candidato.toLowerCase() : null;
}

const RE_DIRECCION = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Versión TOLERANTE para enrutar respuestas de campaña (From/To); para AUTORIZAR un remitente se usa `direccionDeRemitente`, que no adivina.
 * La dirección real de un encabezado From/To (A37-S25-04): la del <ángulo>, o la única sin
 * nombre. El nombre visible ("compras@cliente.com" <x@evil.com>) y los comentarios (…) se
 * ignoran: es texto libre que cualquiera puede falsear. Minúsculas; null si no hay dirección.
 */
export function direccionDeEncabezado(encabezado: string | null | undefined): string | null {
  const limpio = (encabezado ?? '').replace(/"(?:[^"\\]|\\.)*"/g, ' ').replace(/\((?:[^()\\]|\\.)*\)/g, ' ');
  const angulo = /<([^<>]*)>/.exec(limpio);
  if (angulo) { const m = RE_DIRECCION.exec(angulo[1]); return m ? m[0].toLowerCase() : null; }
  const m = RE_DIRECCION.exec(limpio);
  return m ? m[0].toLowerCase() : null;
}

/** `null` = la flota no declaró lista (no hay con qué comparar); `true/false` = coincide o no (por correo o por dominio). */
export function remitenteReconocido(remitente: string | null | undefined, permitidos: readonly string[]): boolean | null {
  if (permitidos.length === 0) return null;
  const correo = direccionDeRemitente(remitente);
  if (!correo) return false;
  const dominio = correo.slice(correo.lastIndexOf('@') + 1);
  return permitidos.some((p) => { const x = p.trim().toLowerCase(); return x === correo || x === dominio || x === `@${dominio}`; });
}
