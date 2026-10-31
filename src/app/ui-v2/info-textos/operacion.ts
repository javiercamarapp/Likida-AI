import type { InfoTexto } from '../info-catalogo';
import { V } from './constructores';

// Textos de ⓘ: operación diaria. Claves `<pagina>.<recuadro>`; tono de guía (ANEXO C), solo lo que el lector hace de verdad.
export const INFO_OPERACION = {
} as const satisfies Record<string, InfoTexto>;
void V;
