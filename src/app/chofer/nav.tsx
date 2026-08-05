'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Truck, CircleDollarSign, Receipt, Route } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LA NAVEGACIÓN DEL CHOFER VA ABAJO, Y NO ES UNA MODA.
//
// El panel de la oficina tiene sidebar y rail porque se usa sentado, con
// ratón. Este se usa de pie, con una mano, mientras la otra sostiene el
// teléfono: lo que queda al alcance del pulgar es el tercio inferior. Un menú
// arriba obliga a recolocar el aparato para cambiar de pestaña, que es
// justamente lo que hace que alguien deje de usar una herramienta.
//
// CUATRO PESTAÑAS, NI UNA MÁS. Con cinco, cada blanco baja de los 44 px que un
// dedo acierta sin mirar. Si algún día hace falta una quinta, sale una de
// estas — no se encogen las cuatro.
//
// La pestaña activa se marca con COLOR Y TEXTO EN NEGRITA, nunca con color
// solo: bajo el sol, en una pantalla con el brillo al mínimo, el matiz es lo
// primero que se pierde.
// ═══════════════════════════════════════════════════════════════════════════

const PESTANAS = [
  { href: '/chofer', etiqueta: 'Hoy', Icono: Truck },
  { href: '/chofer/liquidacion', etiqueta: 'Mi saldo', Icono: CircleDollarSign },
  { href: '/chofer/comprobantes', etiqueta: 'Tickets', Icono: Receipt },
  { href: '/chofer/viajes', etiqueta: 'Viajes', Icono: Route },
] as const;

export default function NavInferior({ ruta: rutaFija }: { ruta?: string } = {}) {
  // `rutaFija` solo la pasa el preview temporal, que vive en otra URL y sin
  // ella pintaría las cuatro pestañas apagadas — justo el estado que hay que
  // mirar es el de la activa. En producción llega `undefined`.
  const rutaReal = usePathname();
  const ruta = rutaFija ?? rutaReal;

  return (
    <nav
      aria-label="Secciones"
      className="fixed bottom-0 left-0 right-0 z-20 border-t"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--line)',
        // El iPhone con gesto de inicio se come la última franja: sin esto, la
        // barra de "Viajes" queda debajo de la rayita del sistema.
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className="flex">
        {PESTANAS.map(({ href, etiqueta, Icono }) => {
          // `/chofer` es prefijo de todas: la raíz se compara exacta o se
          // quedaría siempre activa.
          const activa = href === '/chofer' ? ruta === '/chofer' : ruta.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={activa ? 'page' : undefined}
                className="flex flex-col items-center justify-center gap-1 py-2.5"
                style={{ minHeight: 56, color: activa ? 'var(--marca)' : 'var(--muted)' }}
              >
                <Icono width={22} height={22} strokeWidth={activa ? 2.25 : 1.75} />
                <span className={`text-xs ${activa ? 'font-semibold' : 'font-medium'}`}>{etiqueta}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
