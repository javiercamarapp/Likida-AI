/**
 * A37-S07-06 — el bucket `avatares` es PÚBLICO y la ruta lleva la extensión
 * (`<userId>/avatar.<ext>`): subir PNG y luego JPG dejaba el PNG público sin
 * referencia ni borrado. Tras guardar el avatar nuevo, se retiran las demás
 * extensiones del MISMO usuario. Best-effort: nunca lanza (la foto nueva ya
 * quedó guardada) y solo toca rutas bajo el userId de la sesión.
 */
export const EXTENSIONES_AVATAR = ['jpg', 'png', 'webp'] as const;

export function rutasAvatarObsoletas(userId: string, extNueva: string): string[] {
  return EXTENSIONES_AVATAR.filter((e) => e !== extNueva).map((e) => `${userId}/avatar.${e}`);
}

interface ClienteConStorage {
  storage: { from(bucket: string): { remove(rutas: string[]): PromiseLike<unknown> } };
}

export async function descartarAvataresViejos(admin: ClienteConStorage, userId: string, extNueva: string): Promise<void> {
  try {
    await admin.storage.from('avatares').remove(rutasAvatarObsoletas(userId, extNueva));
  } catch {
    // El huérfano queda hasta la próxima subida; no se tumba el guardado.
  }
}
