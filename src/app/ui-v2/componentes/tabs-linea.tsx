import Link from 'next/link';
import { ConteoPestana } from './tabs';

export interface PestanaLinea { clave: string; etiqueta: string; href: string; conteo?: number | null }

/** Pestañas que son enlaces a rutas hermanas. `actual` es la clave de la pestaña de la página que se está viendo. */
export function TabsLinea({ etiqueta, pestanas, actual, className }: { etiqueta: string; pestanas: readonly PestanaLinea[]; actual: string; className?: string }) {
  return (
    <nav aria-label={etiqueta} className={className}>
      <ul className="rv-tabs rv-tabs--enlaces" role="list">
        {pestanas.map((p) => (
          <li key={p.clave}>
            <Link href={p.href} className="rv-tabs__tab" aria-current={p.clave === actual ? 'page' : undefined}>
              {p.etiqueta}{p.conteo != null ? <ConteoPestana n={p.conteo} /> : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
