import { TiraCifras, type PropsCifra, type SegmentoKpi } from './cifra';

export type { SegmentoKpi };
/** @deprecated nombre anterior de `PropsCifra`. */
export type ItemKpi = PropsCifra;

/** @deprecated nombre anterior de `TiraCifras` (la implementación es UNA sola: `cifra.tsx`). */
export function TiraKpi({ items, etiqueta }: { items: ItemKpi[]; etiqueta?: string }) {
  return <TiraCifras items={items} etiqueta={etiqueta} />;
}
