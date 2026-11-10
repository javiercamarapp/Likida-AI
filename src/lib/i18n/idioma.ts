// ═══════════════════════════════════════════════════════════════════════════
// IDIOMAS DE LA INTERFAZ — pieza PURA (sin Next, sin React, sin Supabase): la importan el servidor, el cliente, la ruta de
// preferencia y las pruebas por igual.
//
// REGLA DE ORO (PLAN-I18N §4): el idioma por omisión es es-MX y NO se autodetecta por navegador (flotas mexicanas). Todo lo que
// no tenga proveedor, cookie ni preferencia se queda en español, así que las pruebas que afirman texto en español no cambian.
// ═══════════════════════════════════════════════════════════════════════════

export const IDIOMAS = ['es', 'en'] as const;
export type Idioma = (typeof IDIOMAS)[number];

export const IDIOMA_POR_OMISION: Idioma = 'es';

/** La cookie del idioma elegido (1 año). La escribe `POST /api/preferencias/idioma`; httpOnly: el cliente no la lee. */
export const COOKIE_IDIOMA = 'likida_lang';
export const VIGENCIA_COOKIE_IDIOMA_S = 60 * 60 * 24 * 365;

/** Clave de `user_metadata` de Supabase Auth donde se guarda la preferencia por usuario (sin migración). */
export const CLAVE_PREFERENCIA = 'idioma';

/**
 * Configuración regional de Intl por idioma. DEBE coincidir con `LOCALE_FORMATO` de `formato.ts` (que no importa nada); una
 * prueba lo fija. Solo cambia la ortografía de fechas y símbolos: la moneda sigue siendo MXN y la zona America/Mexico_City.
 */
export const LOCALE_INTL: Record<Idioma, string> = { es: 'es-MX', en: 'en-US' };

/** El atributo `lang` de `<html>` para cada idioma. */
export const LANG_HTML: Record<Idioma, string> = { es: 'es', en: 'en' };

export function idiomaValido(valor: unknown): valor is Idioma {
  return typeof valor === 'string' && (IDIOMAS as readonly string[]).includes(valor);
}

/**
 * Quién manda: cookie válida > preferencia guardada del usuario (`user_metadata.idioma`, que se VALIDA al leerla: es texto
 * que el usuario puede escribir) > es. Un valor inválido en cualquiera de las dos se ignora, nunca se propaga.
 */
export function resolverIdioma(fuentes: { cookie?: unknown; preferencia?: unknown } = {}): Idioma {
  if (idiomaValido(fuentes.cookie)) return fuentes.cookie;
  if (idiomaValido(fuentes.preferencia)) return fuentes.preferencia;
  return IDIOMA_POR_OMISION;
}
