import { cookies } from 'next/headers';
import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO DE UNA ACCIÓN, SIN TEXTO LIBRE EN LA URL (A37-S13-08, A37-S14-07).
//
// Antes cada acción volvía a su pantalla con `?aviso=<texto>` / `?error=<texto>` y la pantalla lo pintaba tal cual en una tarjeta
// de «mensaje del sistema». Un enlace armado por un tercero («Tu sesión venció, llama al…») se veía, para el dueño autenticado,
// igual que un mensaje real. Aquí el mensaje viaja en una cookie de vida corta que SOLO el servidor escribe (httpOnly), acotada
// a la ruta de la pantalla: lo que llega por la URL ya no se pinta.
//
// Se lee en el render (no se puede borrar ahí): la vida corta la limpia sola, y un refresco inmediato lo vuelve a mostrar.
// ═══════════════════════════════════════════════════════════════════════════

const VIDA_S = 30;
const MAX = 700;

export interface Flash { aviso?: string; error?: string; detalle?: string }

const nombreDe = (ruta: string): string => `lkf_${ruta.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}`.slice(0, 80);
const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v.slice(0, MAX) : undefined);

/** Deja el mensaje para la siguiente carga de `ruta`. Nunca lanza: un aviso perdido no debe tumbar la acción que ya se hizo. */
export async function dejarFlash(ruta: string, f: Flash): Promise<void> {
  try {
    const jar = await cookies();
    const carga: Record<string, string> = { r: ruta };
    for (const k of ['aviso', 'error', 'detalle'] as const) { const t = texto(f[k]); if (t) carga[k] = t; }
    jar.set(nombreDe(ruta), encodeURIComponent(JSON.stringify(carga)), {
      httpOnly: true, sameSite: 'lax', path: ruta, maxAge: VIDA_S, secure: process.env.NODE_ENV === 'production',
    });
  } catch (e) {
    logger.warn('flash.no_se_pudo_dejar', { ruta, err: e instanceof Error ? e.message : String(e) });
  }
}

/** El mensaje que dejó la última acción de esta ruta, o `{}`. Una cookie ilegible o de otra ruta se ignora. */
export async function leerFlash(ruta: string): Promise<Flash> {
  try {
    const crudo = (await cookies()).get(nombreDe(ruta))?.value;
    if (!crudo) return {};
    const o = JSON.parse(decodeURIComponent(crudo)) as Record<string, unknown>;
    if (o === null || typeof o !== 'object' || o.r !== ruta) return {};
    const out: Flash = {};
    for (const k of ['aviso', 'error', 'detalle'] as const) { const t = texto(o[k]); if (t) out[k] = t; }
    return out;
  } catch {
    return {};
  }
}
