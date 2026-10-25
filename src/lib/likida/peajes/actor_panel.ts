// A37-A2-20: quién hizo una decisión o una anulación desde el panel. Antes se guardaba solo el rol (`panel:contador`):
// dos usuarios con el mismo rol eran indistinguibles al auditar. Ahora lleva también el id del usuario.
// Cabe en los 80 caracteres de `peaje_candidato_accion.actor` (0815): rol ≤ 30 + id de 36.
export function actorDePanel(sesion: { rol: string; userId?: string | null }): string {
  const rol = sesion.rol.trim().slice(0, 30) || 'sin_rol';
  const id = typeof sesion.userId === 'string' ? sesion.userId.trim() : '';
  return id ? `panel:${rol}:${id.slice(0, 40)}` : `panel:${rol}`;
}
