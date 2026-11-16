import { cache } from 'react';
import { IDIOMA_POR_OMISION, idiomaValido, type Idioma } from './idioma';

// ═══════════════════════════════════════════════════════════════════════════
// IDIOMA «DE AMBIENTE» DE LA PETICIÓN (solo para Server Components).
//
// Un Server Component no puede leer el contexto del `IdiomaProvider` (es de cliente) ni volverse async sin romper a sus
// llamadores. `idiomaActual()` (servidor.ts) deja aquí el idioma que resolvió para ESTA petición (`cache()` de React = una
// ranura por petición) y los componentes compartidos de ui-v2 lo leen en síncrono cuando no les llega la prop `idioma`.
// Pieza pura (sin next/headers): se puede importar desde módulos que también viajan al cliente. Nunca lanza; si nadie la fijó
// (página pública, prueba, script) devuelve undefined y quien llama cae a es.
// ═══════════════════════════════════════════════════════════════════════════

const ranura = cache((): { idioma?: Idioma } => ({}));

/** La llama `idiomaActual()` al resolver el idioma de la petición. */
export function fijarIdiomaAmbiente(idioma: Idioma): void {
  try { ranura().idioma = idioma; } catch { /* sin petición: nada que fijar */ }
}

/** El idioma que la petición ya resolvió, o undefined. */
export function idiomaAmbiente(): Idioma | undefined {
  try {
    const v = ranura().idioma;
    return idiomaValido(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export { IDIOMA_POR_OMISION };
