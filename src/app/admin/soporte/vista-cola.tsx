'use client';

import Link from 'next/link';
import { ConteoPestana } from '../../ui-v2/componentes/tabs';

/** La vista de la cola (Abiertos / Esperando / Cerrados) como pestañas subrayadas con contador (Rovaq «Soporte»: 32 px, activa 13/600 con borde
 *  inferior negro de 2 px y `pc-count`). Cada opción es un enlace: el estado vive en la dirección, se comparte y sobrevive al refresh. Un contador
 *  `undefined` no se pinta: si la lista está recortada, un número de la lista mentiría sobre la cola. No es una barra de pestañas del grupo
 *  (la automática de `pestanas-admin.tsx`): es la barra de ESTADOS de esta cola, así que no lleva `role="tablist"` ni cuenta en la guarda. */
export function VistaCola({ etiqueta, valor, opciones }: {
  etiqueta: string;
  valor: string;
  opciones: ReadonlyArray<{ valor: string; etiqueta: string; conteo?: number; href: string }>;
}) {
  return (
    <nav aria-label={etiqueta} className="adm-cola-estados">
      <ul className="rv-tabs rv-tabs--enlaces" role="list">
        {opciones.map((o) => (
          <li key={o.valor}>
            <Link href={o.href} scroll={false} prefetch={false} className="rv-tabs__tab" aria-current={o.valor === valor ? 'page' : undefined}>
              {o.etiqueta}{o.conteo != null ? <ConteoPestana n={o.conteo} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
