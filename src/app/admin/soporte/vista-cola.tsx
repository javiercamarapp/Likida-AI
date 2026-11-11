'use client';

import { useRouter } from 'next/navigation';
import { SegmentedControl } from '../../ui-v2/componentes/segmented';

/** La vista de la cola (Abiertos / Esperando / Cerrados) como segmentado con contador (Rovaq «Soporte»: pestañas con `pc-count`). Cada opción
 *  es una URL: elegir una navega (el estado vive en la dirección, se comparte y sobrevive al refresh). Un contador `undefined` no se pinta: si la
 *  lista está recortada, un número de la lista mentiría sobre la cola. */
export function VistaCola({ etiqueta, valor, opciones }: {
  etiqueta: string;
  valor: string;
  opciones: ReadonlyArray<{ valor: string; etiqueta: string; conteo?: number; href: string }>;
}) {
  const router = useRouter();
  return (
    <SegmentedControl
      etiqueta={etiqueta} tamano="sm" valor={valor}
      opciones={opciones.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, conteo: o.conteo }))}
      onChange={(v) => { const o = opciones.find((x) => x.valor === v); if (o) router.push(o.href, { scroll: false }); }}
    />
  );
}
