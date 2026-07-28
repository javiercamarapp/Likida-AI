// ═══════════════════════════════════════════════════════════════════════════
// SEGUNDA CAPA DE AUTORIZACIÓN — la que no depende de un regex.
//
// Hoy el único candado del panel es el matcher del proxy:
//
//   matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)']
//
// Funciona, y se comprobó que ninguna ruta queda fuera. Pero es UNA capa, y de
// las frágiles: basta añadir una excepción al negative lookahead, mover una
// página a un route group nuevo, o que Next cambie cómo resuelve el matcher, para
// que una página del panel quede servida sin pasar por el gate. El fallo no deja
// rastro — la página simplemente responde 200 a quien no debía.
//
// Esta función es la segunda capa: se llama DENTRO de cada página del panel, así
// que la autorización viaja con la página y no con la configuración de rutas.
// Si el proxy falla, esto sigue de pie; si esto se olvida en una página
// nueva, el proxy sigue de pie. Las dos tienen que fallar a la vez.
// ═══════════════════════════════════════════════════════════════════════════

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, expectedAccessToken, tokenMatches } from './passcode';

/**
 * Corta la página si quien la pide no tiene una cookie válida.
 *
 * Sin passcode configurado (desarrollo) no bloquea: el mismo criterio que el
 * proxy, para que las dos capas no se contradigan.
 *
 * @param destino ruta a la que volver tras autenticarse.
 */
export async function exigirAcceso(destino: string): Promise<void> {
  const esperado = await expectedAccessToken();
  if (!esperado) return;                       // dev sin passcode
  const cookie = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (await tokenMatches(cookie)) return;
  redirect(`/acceso?next=${encodeURIComponent(destino)}`);
}
