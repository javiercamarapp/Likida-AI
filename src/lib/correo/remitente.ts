// Quién mandó un correo entrante, contra la lista de remitentes que declaró la flota.
// Pura (sin I/O): la comparten los buzones de carta porte y de peajes.

/** `null` = la flota no declaró lista (no hay con qué comparar); `true/false` = coincide o no (por correo o por dominio). */
export function remitenteReconocido(remitente: string | null | undefined, permitidos: readonly string[]): boolean | null {
  if (permitidos.length === 0) return null;
  const m = /([a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,}))/i.exec(remitente ?? '');
  if (!m) return false;
  const correo = m[1].toLowerCase(); const dominio = m[2].toLowerCase();
  return permitidos.some((p) => { const x = p.trim().toLowerCase(); return x === correo || x === dominio || x === `@${dominio}`; });
}
