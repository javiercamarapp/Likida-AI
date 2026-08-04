'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { LayoutGrid, ChevronDown } from 'lucide-react';
import { type Item, INICIO, NEGOCIO, OPERACION, DOCUMENTOS_DINERO, GESTION } from './rutas';
import { puedeVerRuta } from '@/lib/auth/visibilidad';

const ITEM = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)] transition-colors';
const ICONO = { width: 16, height: 16, strokeWidth: 1.75, color: 'var(--muted)' } as const;

/** Mismo patrón que admin/sidebar-nav.tsx: una sección plegable, abierta
 *  de entrada si la página activa vive adentro. */
function Seccion({ titulo, items, defaultAbierto = false, sufijo }: { titulo: string; items: Item[]; defaultAbierto?: boolean; sufijo: string }) {
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(() => defaultAbierto || items.some((it) => it.href === pathname));

  // Una sección que quedó sin un solo item para este rol no se pinta: un
  // encabezado "Documentos & Dinero" con nada debajo le anuncia al encargado
  // justo lo que no puede ver.
  if (items.length === 0) return null;

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
        <Link key={href} href={`${href}${sufijo}`} className={ITEM}>
          <Icono {...ICONO} /> {nombre}
        </Link>
      ))}
    </div>
  );
}

/**
 * Sidebar de /dashboard — mismo patrón visual que admin/sidebar-nav.tsx,
 * navegación propia (rutas.ts).
 *
 * `sufijo`: cuando un superadmin llega viendo una flota real (`?tenant=`) o
 * la demo (`?vista=demo`), CADA link del sidebar tiene que cargar ese mismo
 * parámetro — si no, "Viajes" te bota de vuelta al tenant demo aunque
 * estuvieras viendo Transportes Innovativos. Un flota_admin/operador/contador
 * real nunca trae ninguno de los dos params (entra por /login sin
 * query string), así que para ellos `sufijo` siempre es vacío y esto no
 * hace nada distinto de un link normal.
 */
export default function SidebarNav({ rol }: { rol: string }) {
  const sp = useSearchParams();
  const tenant = sp.get('tenant');
  const vista = sp.get('vista');
  // EL SUPERADMIN QUE LLEGA A UNA SUBPÁGINA SIN PARÁMETRO SE EXPULSABA SOLO.
  //
  // `/dashboard` a secas rebota a /admin cuando el rol es superadmin y no
  // trae `?tenant=` ni `?vista=demo` (tenant-efectivo.ts, `esRaiz`): es su
  // consola, no la de un cliente. Pero las SUBpáginas no rebotan — caen al
  // tenant demo sin más. Así que entrar directo a /dashboard/despacho (link
  // pegado, bookmark) dejaba el sufijo vacío, y el link de "Resumen"
  // apuntaba a /dashboard pelón: el propio sidebar te sacaba del panel que
  // estabas viendo. Para superadmin sin parámetro se asume `?vista=demo`,
  // que es el tenant al que las subpáginas ya lo mandaron.
  //
  // Para los otros cuatro roles esto no cambia nada: nunca traen ninguno de
  // los dos params y su sufijo sigue siendo vacío.
  const sufijo = tenant
    ? `?tenant=${tenant}`
    : vista ? `?vista=${vista}`
    : rol === 'superadmin' ? '?vista=demo' : '';

  // Se filtra con la MISMA función que gatea la página (`visibilidad.ts`).
  // Dos listas separadas —una para pintar y otra para autorizar— se
  // desincronizan, y el modo de falla es el peor: el link existe, el clic
  // rebota, y el usuario cree que la app está rota.
  const visibles = (items: Item[]) => items.filter((it) => puedeVerRuta(rol, it.href));

  return (
    <>
      {puedeVerRuta(rol, '/dashboard') && (
        <div>
          <Link href={`/dashboard${sufijo}`} className={`${ITEM} font-medium`}>
            <LayoutGrid {...ICONO} /> Resumen
          </Link>
        </div>
      )}
      <Seccion titulo="Inicio" items={visibles(INICIO)} defaultAbierto sufijo={sufijo} />
      <Seccion titulo="Negocio" items={visibles(NEGOCIO)} sufijo={sufijo} />
      <Seccion titulo="Operación" items={visibles(OPERACION)} sufijo={sufijo} />
      <Seccion titulo="Documentos & Dinero" items={visibles(DOCUMENTOS_DINERO)} sufijo={sufijo} />
      <Seccion titulo="Gestión" items={visibles(GESTION)} sufijo={sufijo} />
    </>
  );
}
