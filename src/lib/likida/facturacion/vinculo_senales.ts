import { logger } from '@/lib/logger';
import type { InventarioPagina } from './adaptadores/playwright_base';

// ════════════════════════════════════════════════════════════════════════════
// LAS SEÑALES DEL VÍNCULO — puro, sin base de datos y sin navegador.
//
// Vive aparte de `vinculo_portal.ts` a propósito, y no por estética: el piloto
// de visión importa esto y el piloto tiene que poder probarse sin Chromium Y
// sin Supabase. Si estas funciones vivieran junto al repositorio de
// `portal_estado`, cada prueba del piloto arrastraría el cliente de la base
// para preguntarle a un inventario si trae un campo de contraseña.
//
// Aquí no se decide NADA que tenga efecto: se lee lo que la página enseña y se
// dice qué significa. Quien actúa es `vinculo_portal.ts`.
// ════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// LA DETECCIÓN — con lo que la página de verdad enseña, no con adivinanzas.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rutas de login vistas en los portales de este catálogo. La primera sale del
 * pre-vuelo de Megasur del 20-ago-2026 (`/Account/Login`, anotado en
 * `comercios.ts`); las demás son las variantes que usan los portales
 * mexicanos de facturación. Es una lista de EVIDENCIA, no un catálogo
 * cerrado: si un portal usa otra ruta, la señal fuerte —el campo de
 * contraseña— lo caza igual.
 */
const RUTAS_DE_LOGIN = /\/(account\/login|login|signin|sign-in|iniciar-?sesion|inicio-?sesion|acceso|autenticar)(\/|\?|#|$)/i;

/**
 * ¿Esta pantalla es la de entrar, o seguimos dentro? Devuelve la EVIDENCIA en
 * palabras (para el reporte y para la pantalla) o `null` si estamos adentro.
 *
 * Tres señales, en orden de qué tan poco se pueden confundir:
 *
 *   1. UN CAMPO DE CONTRASEÑA VISIBLE. Es la más fuerte y la más barata: un
 *      portal de facturación no pide contraseña en ninguna pantalla que no
 *      sea la de entrar. Se exige `visible` a propósito — Megasur trae un
 *      password OCULTO en su formulario (pre-vuelo del 20-ago-2026) y contarlo
 *      diría "login" en pantallas donde no lo hay.
 *   2. LA DIRECCIÓN. Un portal que nos redirigió a `/Account/Login` ya lo dijo
 *      todo, aunque el campo tarde en renderizar.
 *   3. LA SEÑA DE ESTAR DENTRO, AUSENTE. Es la que pide el encargo ("selector
 *      de usuario ausente"): el adaptador declara qué existe SOLO estando
 *      adentro —el nombre de la cuenta, el botón de salir— y si eso no
 *      aparece por ningún lado del inventario, no estamos dentro. Va al final
 *      porque es la más fácil de equivocar: un portal que renombre su botón
 *      la dispara sin que la sesión haya caducado. Por eso es OPCIONAL: sin
 *      seña declarada, esta señal no existe y no se inventa.
 */
export function pantallaDeLogin(inv: InventarioPagina, senaDeAdentro?: string): string | null {
  const pass = inv.campos.find((c) => c.type === 'password' && c.visible);
  if (pass) {
    const seña = pass.id || pass.name || pass.etiqueta || 'sin id';
    return `el portal enseña un campo de contraseña (${seña}), o sea la pantalla de entrar`;
  }

  if (RUTAS_DE_LOGIN.test(inv.url)) {
    return `el portal redirigió a su pantalla de entrar (${inv.url})`;
  }

  const seña = senaDeAdentro?.trim();
  if (seña) {
    const enAlgunLado =
      inv.texto.includes(seña) ||
      inv.botones.some((b) => b.id === seña || b.name === seña || b.texto.includes(seña)) ||
      inv.campos.some((c) => c.id === seña || c.name === seña);
    if (!enAlgunLado) {
      return `no aparece por ningún lado la seña de estar dentro («${seña}»)`;
    }
  }

  return null;
}

/** Las tres clases de fallo, cada una con un dueño distinto. */
export type ClaseDeFallo = 'sesion_caducada' | 'requiere_vinculacion' | 'portal_cambio';

export interface FalloDeVinculo {
  clase: ClaseDeFallo;
  /** Qué se vio. Va al log y al reporte tal cual. */
  evidencia: string;
  /** Qué hay que hacer, escrito para la persona que lo va a hacer. */
  queHacer: string;
}

/**
 * Traduce lo que se vio a QUIÉN tiene que actuar.
 *
 * `arrancoConSesion` es lo que separa las dos primeras clases, y por eso entra
 * como dato y no se adivina: caer en el login SIN sesión guardada es el estado
 * normal de un portal que nadie ha vinculado todavía; caer en el login CON una
 * sesión guardada es que esa sesión murió. La pantalla dice cosas distintas y
 * el aviso también.
 */
export function clasificarFallo(args: {
  /** Lo que devolvió `pantallaDeLogin`, o `null` si seguimos dentro. */
  loginVisto: string | null;
  arrancoConSesion: boolean;
  /** Selectores del mapeo que la página ya no tiene. Solo importan si NO es login. */
  selectoresFaltantes?: readonly string[];
}): FalloDeVinculo | null {
  if (args.loginVisto) {
    return args.arrancoConSesion
      ? {
          clase: 'sesion_caducada',
          evidencia: args.loginVisto,
          queHacer:
            'La sesión guardada de este portal ya no sirve: hay que volver a entrar UNA vez desde el panel («Vincular ahora») y a partir de ahí las corridas siguen solas.',
        }
      : {
          clase: 'requiere_vinculacion',
          evidencia: args.loginVisto,
          queHacer:
            'Este portal pide iniciar sesión y Likida no teclea contraseñas: el login lo hace una persona UNA vez desde el panel («Vincular ahora»), y la sesión queda guardada cifrada para las corridas siguientes.',
        };
  }

  const faltan = args.selectoresFaltantes ?? [];
  if (faltan.length > 0) {
    return {
      clase: 'portal_cambio',
      evidencia: `seguimos dentro del portal pero el formulario ya no trae ${faltan.join(', ')}`,
      queHacer:
        'ESTO NO SE ARREGLA VOLVIENDO A ENTRAR: la sesión está viva y lo que cambió es el portal. Lo tiene que corregir Likida (rehacer el mapeo del adaptador).',
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UN CONTEXTO, VARIOS PORTALES — cómo se reparten las cookies.
//
// `SesionNavegador` abre UN BrowserContext por FLOTA (decisión de costo, ver
// `pagina_playwright.ts`), y un contexto tiene UNA bolsa de cookies. Pero las
// sesiones se guardan POR PORTAL, porque caducan y se re-vinculan por
// separado. Las dos cosas se concilian aquí y en ningún otro sitio:
//
//   · AL ENTRAR se UNEN las sesiones de todos los portales de la flota en un
//     solo `storageState`. Las cookies llevan su dominio, así que cada portal
//     solo ve las suyas: unirlas no las mezcla, las pone en la misma bolsa.
//   · AL SALIR se RECORTA por dominio antes de guardar. Sin esto, la fila de
//     G500 acabaría guardando también las cookies de La Gas —y una
//     invalidación de G500 se llevaría por delante la sesión buena de la otra,
//     que es exactamente el bug que `sesion_portal.ts` evitó separando la
//     sesión de la credencial.
// ═══════════════════════════════════════════════════════════════════════════

interface CookieDeEstado { name?: unknown; domain?: unknown; path?: unknown }
interface OrigenDeEstado { origin?: unknown }

/** El `hostname` de una URL, o `null` si no es una URL. No lanza. */
function anfitrion(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * ¿Esta cookie es de ESTE portal? El dominio de una cookie puede venir con
 * punto por delante (`.megasur.com.mx` = «y sus subdominios») o sin él; las dos
 * formas cubren al host, y ninguna de las dos cubre a un host distinto.
 */
function cookieDelAnfitrion(dominio: string, host: string): boolean {
  const d = dominio.replace(/^\./, '').toLowerCase();
  if (!d) return false;
  return host === d || host.endsWith(`.${d}`);
}

/**
 * El `storageState` recortado a lo que pertenece al portal de esa URL, como
 * JSON en string. `null` si no queda nada que guardar —y eso NO es un error:
 * un portal del que no quedó ninguna cookie simplemente no tiene sesión que
 * conservar, y guardar una bolsa vacía haría que la pantalla dijera
 * «vinculado» sobre un vínculo que no existe.
 */
export function recortarEstadoAlPortal(storageState: string, urlPortal: string): string | null {
  const host = anfitrion(urlPortal);
  if (!host) return null;

  let v: { cookies?: unknown; origins?: unknown };
  try {
    v = JSON.parse(storageState) as { cookies?: unknown; origins?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(v.cookies) || !Array.isArray(v.origins)) return null;

  const cookies = (v.cookies as CookieDeEstado[]).filter(
    (c) => typeof c?.domain === 'string' && cookieDelAnfitrion(c.domain, host),
  );
  const origins = (v.origins as OrigenDeEstado[]).filter((o) => {
    const h = typeof o?.origin === 'string' ? anfitrion(o.origin) : null;
    return h !== null && (h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`));
  });

  if (cookies.length === 0 && origins.length === 0) return null;
  return JSON.stringify({ cookies, origins });
}

/**
 * Une varios `storageState` en uno. Los ilegibles se saltan con grito: una
 * sesión corrupta no puede dejar sin las suyas a los demás portales del lote.
 *
 * Las cookies se deduplican por `(name, domain, path)` —la llave con la que un
 * navegador las identifica— y gana la ÚLTIMA: si dos filas traen la misma
 * cookie, la del portal que se re-vinculó después es la que sirve.
 */
export function unirEstados(estados: readonly string[]): string | null {
  const cookies = new Map<string, CookieDeEstado>();
  const origins = new Map<string, OrigenDeEstado>();

  for (const crudo of estados) {
    let v: { cookies?: unknown; origins?: unknown };
    try {
      v = JSON.parse(crudo) as { cookies?: unknown; origins?: unknown };
    } catch {
      logger.warn('vinculo_portal.estado_ilegible', { detalle: 'un storageState guardado no parsea; se salta' });
      continue;
    }
    if (Array.isArray(v.cookies)) {
      for (const c of v.cookies as CookieDeEstado[]) {
        cookies.set(`${String(c?.name)} ${String(c?.domain)} ${String(c?.path)}`, c);
      }
    }
    if (Array.isArray(v.origins)) {
      for (const o of v.origins as OrigenDeEstado[]) origins.set(String(o?.origin), o);
    }
  }

  if (cookies.size === 0 && origins.size === 0) return null;
  return JSON.stringify({ cookies: [...cookies.values()], origins: [...origins.values()] });
}

