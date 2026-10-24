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

/** `null` = la flota no declaró lista (no hay con qué comparar); `true/false` = coincide o no (por correo o por dominio). */
export function remitenteReconocido(remitente: string | null | undefined, permitidos: readonly string[]): boolean | null {
  if (permitidos.length === 0) return null;
  const correo = direccionDeRemitente(remitente);
  if (!correo) return false;
  const dominio = correo.slice(correo.lastIndexOf('@') + 1);
  return permitidos.some((p) => { const x = p.trim().toLowerCase(); return x === correo || x === dominio || x === `@${dominio}`; });
}
