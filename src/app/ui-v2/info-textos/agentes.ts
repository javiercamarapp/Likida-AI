import type { InfoTexto } from '../info-catalogo';
import { V } from './constructores';

// Textos de ⓘ: agentes de vigía, carta porte, conductores y peajes. Claves `<pagina>.<recuadro>`; tono de guía (ANEXO C), solo lo que el lector hace de verdad.
export const INFO_AGENTES = {
} as const satisfies Record<string, InfoTexto>;
void V;
