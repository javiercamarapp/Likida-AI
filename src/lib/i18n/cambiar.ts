import type { Idioma } from './idioma';

/**
 * Pide al servidor que cambie el idioma (cookie + preferencia del usuario). Devuelve `true` solo si el servidor confirmó.
 * `peticion` se inyecta para probarla sin red. Nunca lanza: un fallo de red es `false` y la interfaz lo dice.
 */
export async function solicitarCambioIdioma(idioma: Idioma, peticion: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await peticion('/api/preferencias/idioma', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idioma }),
      credentials: 'same-origin',
    });
    return r.ok;
  } catch {
    return false;
  }
}
