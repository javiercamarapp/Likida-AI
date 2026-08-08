'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';
import { type Item, SIDEBAR_PRINCIPAL, FISCAL } from './rutas';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { DEGRADADO_MARCA } from './resumen-visual';

const ITEM = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors';

/** Mismo degradado que los KPI de Resumen (`DEGRADADO_MARCA`, una sola
 *  fuente) — el mockup usa ese mismo tono para el item activo del sidebar,
 *  no el naranja plano. `hover` solo aplica al item INACTIVO: el activo no
 *  necesita indicar que es clickeable, ya dice dónde estás. */
function claseItem(activo: boolean): string {
  return activo
    ? `${ITEM} font-medium`
    : `${ITEM} hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]`;
}
function estiloItem(activo: boolean) {
  return activo ? { background: DEGRADADO_MARCA, color: 'var(--marca-fg)' } : undefined;
}
function estiloIcono(activo: boolean) {
  return { width: 16, height: 16, strokeWidth: 1.75, color: activo ? 'var(--marca-fg)' : 'var(--muted)' } as const;
}

/** Mismo patrón que admin/sidebar-nav.tsx, sin el plegado: la dirección
 *  visual del 7-ago quiere el sidebar siempre abierto, como una sola lista —
 *  el título de sección se queda como separador de lectura, no como botón. */
function Seccion({ titulo, items, sufijo, pathname }: { titulo: string; items: Item[]; sufijo: string; pathname: string }) {
  // Una sección que quedó sin un solo item para este rol no se pinta: un
  // encabezado "Documentos & Dinero" con nada debajo le anuncia al encargado
  // justo lo que no puede ver.
  if (items.length === 0) return null;

  return (
    <div>
      <div className="px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {titulo}
      </div>
      {items.map(({ href, nombre, Icono }) => {
        const activo = pathname === href;
        return (
          <Link key={href} href={`${href}${sufijo}`} className={claseItem(activo)} style={estiloItem(activo)}>
            <Icono {...estiloIcono(activo)} /> {nombre}
          </Link>
        );
      })}
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
 * estuvieras viendo una flota ejemplo. Un flota_admin/operador/contador
 * real nunca trae ninguno de los dos params (entra por /login sin
 * query string), así que para ellos `sufijo` siempre es vacío y esto no
 * hace nada distinto de un link normal.
 */
export default function SidebarNav({ rol }: { rol: string }) {
  const pathname = usePathname();
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
  const base = tenant
    ? `?tenant=${tenant}`
    : vista ? `?vista=${vista}`
    : rol === 'superadmin' ? '?vista=demo' : '';

  // "Ver como" (`?rol=`) tiene que viajar en CADA link igual que `?tenant=`:
  // si un solo link lo pierde, el siguiente clic te devuelve a tu propia
  // vista de superadmin y la comparación se rompe sin avisar.
  const rolVista = sp.get('rol');
  const sufijo = rolVista ? `${base}${base ? '&' : '?'}rol=${rolVista}` : base;

  // El rol con el que se FILTRA el menú es el previsualizado, no el real —
  // pero solo si el real es superadmin, misma regla que `rolEfectivo` aplica
  // del lado del servidor. Duplicarla aquí es a propósito: este componente es
  // cliente y no puede llamar a la del servidor, y las dos son la misma línea.
  const rolMenu = rol === 'superadmin' && rolVista ? rolVista : rol;

  // Se filtra con la MISMA función que gatea la página (`visibilidad.ts`).
  // Dos listas separadas —una para pintar y otra para autorizar— se
  // desincronizan, y el modo de falla es el peor: el link existe, el clic
  // rebota, y el usuario cree que la app está rota.
  const visibles = (items: Item[]) => items.filter((it) => puedeVerRuta(rolMenu, it.href));

  const resumenActivo = pathname === '/dashboard';

  return (
    <>
      {puedeVerRuta(rolMenu, '/dashboard') && (
        <div>
          <Link href={`/dashboard${sufijo}`} className={claseItem(resumenActivo)} style={estiloItem(resumenActivo)}>
            <LayoutGrid {...estiloIcono(resumenActivo)} /> Resumen
          </Link>
        </div>
      )}
      {/* Plano, sin encabezado — dirección visual del 7-ago-2026, los 9 que
          importan todos los días. */}
      {visibles(SIDEBAR_PRINCIPAL).map(({ href, nombre, Icono }) => {
        const activo = pathname === href;
        return (
          <Link key={href} href={`${href}${sufijo}`} className={claseItem(activo)} style={estiloItem(activo)}>
            <Icono {...estiloIcono(activo)} /> {nombre}
          </Link>
        );
      })}
      {/* El panel del contador SÍ necesita su sección propia: es su única
          casa, y no aparece en SIDEBAR_PRINCIPAL (esa lista es la del
          dueño). Para un rol sin área `dinero` esto sale vacío y no se
          pinta (ver `Seccion`). */}
      <Seccion titulo="Fiscal" items={visibles(FISCAL)} sufijo={sufijo} pathname={pathname} />
    </>
  );
}
