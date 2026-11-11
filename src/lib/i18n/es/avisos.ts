// Namespace «avisos»: franjas informativas del panel que no son de un módulo concreto. Fuente de verdad en español;
// `en/avisos.ts` lo espeja y el compilador exige las mismas claves.
export const avisos = {
  'planPausa.ilegible': 'Los datos y los comprobantes siguen entrando; las salidas se reanudan al confirmar el plan.',
  'planPausa.frena': 'Los datos y los comprobantes siguen entrando; no sale ningún mensaje ni correo automático hasta reactivar el plan.',
} as const;
