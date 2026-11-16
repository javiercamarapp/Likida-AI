// Constructores de las entradas en inglés (US): MISMA forma y mismos argumentos que `../constructores.ts`; solo cambian los textos fijos.
// Convención para traducir un archivo `info-textos/<x>.ts`: copiar la entrada, dejar la clave y el orden de argumentos iguales y traducir
// solo las cadenas. `V(titulo, queEs, comoSeCalcula, fuente, queHacer?)` y `T(titulo, queEs)` se importan de ESTE archivo.
import type { InfoTexto } from '../../info-catalogo';

const PENDIENTE_CALCULO = 'To be confirmed: the exact formula will be documented when this indicator’s reader is verified.';
const PENDIENTE_FUENTE = 'To be confirmed: source and cutoff date of this indicator.';
export const PENDIENTE_EN = { PENDIENTE_CALCULO, PENDIENTE_FUENTE } as const;
export const T = (titulo: string, queEs: string): InfoTexto => ({ titulo, estado: 'por_confirmar', queEs, comoSeCalcula: PENDIENTE_CALCULO, fuente: PENDIENTE_FUENTE });

/** Entrada verificada: el texto describe lo que el lector de la página hace de verdad. */
export const V = (titulo: string, queEs: string, comoSeCalcula: string, fuente: string, queHacer?: string): InfoTexto => ({
  titulo, estado: 'verificado', queEs, comoSeCalcula, fuente, ...(queHacer ? { queHacer } : {}),
});
