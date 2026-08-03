'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { LayoutGrid, ChevronDown } from 'lucide-react';
import { type Item, AGENTES, NEGOCIO, PLATAFORMA, CONTROL, SISTEMA } from './rutas';

const ITEM = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)] transition-colors';
const ICONO = { width: 16, height: 16, strokeWidth: 1.75, color: 'var(--muted)' } as const;

/** Una sección plegable — arranca abierta si la página activa vive adentro
 *  (así no se pierde de dónde viene al cargar) o si `defaultAbierto` lo
 *  fuerza (Agentes: la primera categoría del dashboard, siempre visible de
 *  entrada), colapsada si no. Plegar/desplegar es estado de React, no
 *  `<details>`: con 6 secciones y ~29 links no cabían todas abiertas a la
 *  vez sin scroll — colapsadas se ven las 6 categorías de un vistazo, y
 *  cada una se abre nada más la que se necesita. */
function Seccion({ titulo, items, defaultAbierto = false }: { titulo: string; items: Item[]; defaultAbierto?: boolean }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(() => defaultAbierto || items.some((it) => it.href === pathname));

  return (
    <div>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="w-full flex items-center justify-between gap-2 px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide hover:opacity-70 transition-opacity"
        style={{ color: 'var(--muted)' }}
      >
        {titulo}
        <ChevronDown width={12} height={12} strokeWidth={2} className="transition-transform" style={{ transform: abierto ? 'rotate(180deg)' : 'none' }} />
      </button>
      {abierto && items.map(({ href, nombre, Icono }) => (
        <Link key={href} href={href} className={ITEM}>
          <Icono {...ICONO} /> {nombre}
        </Link>
      ))}
    </div>
  );
}

export default function SidebarNav() {
  return (
    <>
      <div>
        <Link href="/admin" className={`${ITEM} font-medium`}>
          <LayoutGrid {...ICONO} /> Inicio
        </Link>
      </div>
      <Seccion titulo="Agentes" items={AGENTES} defaultAbierto />
      <Seccion titulo="Negocio" items={NEGOCIO} />
      <Seccion titulo="Plataforma" items={PLATAFORMA} />
      <Seccion titulo="Control" items={CONTROL} />
      <Seccion titulo="Sistema" items={SISTEMA} />
    </>
  );
}
