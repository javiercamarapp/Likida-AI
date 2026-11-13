import type { PropsCifra } from '@/app/ui-v2/graficas';

/** Una tira de cifras lleva el filete superior en TODAS sus celdas o en ninguna (Rovaq: `.ui-kpi` / `.hoy-kpi` con filete, `.pc-kpis` sin él;
 *  nunca mezclado). `Cifra` infiere el matiz de la etiqueta y las celdas sin familia se quedan sin filete, así que aquí se fija el mismo matiz
 *  (8, la tinta del volumen) en las celdas que no declaran uno. Las celdas con `tono` de atención conservan el suyo. */
export function uniformes(cifras: readonly PropsCifra[], matiz: NonNullable<PropsCifra['matiz']> = 8): PropsCifra[] {
  return cifras.map((c) => (c.matiz || c.metrica ? c : { ...c, matiz }));
}
