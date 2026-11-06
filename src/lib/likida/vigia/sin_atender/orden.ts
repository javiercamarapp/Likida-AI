// Orden estable de alertas: alta primero; urgencia/palabra clave antes que pregunta; crítico; mayor antigüedad; nombre; id.
import type { AlertaSinAtender } from './tipos';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pesoMotivo = (a: AlertaSinAtender): number => (a.motivos.includes('urgencia') || a.motivos.includes('palabra_clave') ? 0 : 1);

export function ordenarAlertas(alertas: readonly AlertaSinAtender[]): AlertaSinAtender[] {
  return [...alertas].sort((a, b) => {
    if (a.nivel !== b.nivel) return a.nivel === 'alta' ? -1 : 1;
    const pm = pesoMotivo(a) - pesoMotivo(b);
    if (pm !== 0) return pm;
    if (a.critico !== b.critico) return a.critico ? -1 : 1;
    if (a.antiguedadMin !== b.antiguedadMin) return b.antiguedadMin - a.antiguedadMin;
    return cmp(a.chatNombre, b.chatNombre) || cmp(a.chatId, b.chatId) || cmp(a.desde, b.desde) || cmp(a.clave, b.clave);
  });
}
