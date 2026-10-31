// Constructores de entradas del catálogo (compartidos por info-catalogo.ts y los archivos de info-textos/).
import type { InfoTexto } from '../info-catalogo';

const PENDIENTE_CALCULO = 'Por confirmar: la fórmula exacta se documenta al verificar el lector de este indicador.';
const PENDIENTE_FUENTE = 'Por confirmar: fuente y fecha de corte de este indicador.';
export const PENDIENTE = { PENDIENTE_CALCULO, PENDIENTE_FUENTE } as const;
export const T = (titulo: string, queEs: string): InfoTexto => ({ titulo, estado: 'por_confirmar', queEs, comoSeCalcula: PENDIENTE_CALCULO, fuente: PENDIENTE_FUENTE });

/** Entrada verificada: el texto describe lo que el lector de la página hace de verdad. */
export const V = (titulo: string, queEs: string, comoSeCalcula: string, fuente: string, queHacer?: string): InfoTexto => ({
  titulo, estado: 'verificado', queEs, comoSeCalcula, fuente, ...(queHacer ? { queHacer } : {}),
});
