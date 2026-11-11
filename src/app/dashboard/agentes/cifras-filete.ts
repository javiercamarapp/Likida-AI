import type { PropsCifra } from '@/app/ui-v2/graficas';
import { matizDeEtiqueta } from '@/app/ui-v2/graficas/matiz-etiqueta';

/** Rovaq pone filete a TODAS las celdas de una tira. El sistema solo lo da a las etiquetas que caen en una familia (un color sin significado es
 *  decoración), así que en la tira de un agente las celdas sin familia y sin tono de atención llevan el matiz de VOLUMEN (8: tinta), el neutro
 *  de la paleta monocroma. No cambia ningún dato ni ningún tono: solo evita la tira a medias, con filete en tres celdas de cuatro. */
export function conFilete<T extends PropsCifra>(cifras: readonly T[]): T[] {
  return cifras.map((c) => (c.matiz !== undefined || c.metrica !== undefined || c.tono !== undefined || matizDeEtiqueta(c.etiqueta) !== undefined ? c : { ...c, matiz: 8 as const }));
}
