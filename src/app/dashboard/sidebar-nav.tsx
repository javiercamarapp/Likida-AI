'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LayoutGrid, ChevronDown, ChevronRight } from 'lucide-react';
import { type Item, AGENTES, OPERACION, DINERO_FISCAL, SISTEMA, ABAJO } from './rutas';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { SelectorTema } from '../selector-tema';
import { WidgetUso } from '../admin/ui/kit';

const ITEM = 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors sb-centrable';

/** Item activo = pill SÓLIDA en tinta (`--marca` de fondo, texto e ícono
 *  `--marca-fg`) — dirección 16-ago-2026 (ref. shadcn-dashboard, pedido de
 *  Javier); reemplaza a la pill suave `--g1` de la v3. `hover` solo aplica
 *  al item INACTIVO. El gemelo de /admin cambia IGUAL — es la misma pieza. */
function claseItem(activo: boolean): string {
  return activo
    ? `${ITEM} font-medium`
    : `${ITEM} hover:bg-[color-mix(in_srgb,var(--muted)_10%,transparent)]`;
}
function estiloItem(activo: boolean) {
  return activo ? { background: 'var(--marca)', color: 'var(--marca-fg)' } : undefined;
}
function estiloIcono(activo: boolean) {
  return { width: 16, height: 16, strokeWidth: 1.75, color: activo ? 'var(--marca-fg)' : 'var(--muted)' } as const;
}

function Fila({ item, sufijo, pathname }: { item: Item; sufijo: string; pathname: string }) {
  const activo = pathname === item.href;
  return (
    <Link href={`${item.href}${sufijo}`} className={claseItem(activo)} style={estiloItem(activo)} title={item.nombre}>
      <item.Icono {...estiloIcono(activo)} /> <span className="sb-texto truncate">{item.nombre}</span>
    </Link>
  );
}

function Seccion({ titulo, items, sufijo, pathname }: { titulo: string; items: Item[]; sufijo: string; pathname: string }) {
  // PLEGABLE (13-ago-2026), y desde el 17-ago solo AGENTES amanece abierta
  // (orden de Javier, misma regla que el sidebar de /admin): los encabezados
  // anuncian su sección y el menú cabe sin scroll. La sección de la ruta
  // activa también abre — llegar por link directo y no ver la pantalla
  // iluminada en el menú desorienta. Estado de sesión, no persiste.
  const contieneActiva = items.some((it) => pathname === it.href || pathname.startsWith(it.href + '/'));
  const [plegada, setPlegada] = useState(titulo !== 'Agentes' && !contieneActiva);
  // Una sección sin items para este rol no se pinta: un encabezado con nada
  // debajo le anuncia al usuario justo lo que no puede ver.
  if (items.length === 0) return null;
  return (
    <div>
      <button type="button" onClick={() => setPlegada((v) => !v)}
        className="w-full flex items-center justify-between px-2.5 mb-1.5 text-[11px] font-semibold uppercase tracking-wide sb-texto transition-opacity hover:opacity-70"
        style={{ color: 'var(--muted)' }}>
        {titulo}
        {plegada
          ? <ChevronRight width={13} height={13} strokeWidth={2} />
          : <ChevronDown width={13} height={13} strokeWidth={2} />}
      </button>
      {!plegada && items.map((it) => <Fila key={it.href} item={it} sufijo={sufijo} pathname={pathname} />)}
    </div>
  );
}

/** El MISMO contrato de sufijo en cada link: `?tenant=`/`?vista=`/`?rol=`
 *  del superadmin viajan siempre — perder uno te saca del panel que ves.
 *  (Para superadmin sin parámetro se asume `?vista=demo`: las subpáginas ya
 *  lo mandaron ahí, y un link sin sufijo lo expulsaba del panel.) */
function useSufijoYRol(rol: string): { sufijo: string; rolMenu: string } {
  const sp = useSearchParams();
  const tenant = sp.get('tenant');
  const vista = sp.get('vista');
  const base = tenant
    ? `?tenant=${tenant}`
    : vista ? `?vista=${vista}`
    : rol === 'superadmin' ? '?vista=demo' : '';
  const rolVista = sp.get('rol');
  const sufijo = rolVista ? `${base}${base ? '&' : '?'}rol=${rolVista}` : base;
  // El rol con el que se FILTRA el menú es el previsualizado (solo si el
  // real es superadmin) — misma regla que `rolEfectivo` del servidor,
  // duplicada aquí a propósito: este componente es cliente.
  const rolMenu = rol === 'superadmin' && rolVista ? rolVista : rol;
  return { sufijo, rolMenu };
}

/**
 * Navegación principal — estructura
 * (13-ago-2026): Resumen + categorías AGENTES / OPERACIÓN / DINERO Y
 * FISCAL / SISTEMA. Se filtra con la MISMA función que gatea la página
 * (`visibilidad.ts`): dos listas separadas se desincronizan y el modo de
 * falla es el peor — el link existe, el clic rebota.
 */
export default function SidebarNav({ rol }: { rol: string }) {
  const pathname = usePathname();
  const { sufijo, rolMenu } = useSufijoYRol(rol);
  const visibles = (items: Item[]) => items.filter((it) => puedeVerRuta(rolMenu, it.href));
  // El Resumen de CADA QUIEN, un solo link. `/dashboard` es de `operacion`,
  // así que el contador no lo ve — su casa es `/dashboard/contador` (dinero,
  // reconstruida el 14-ago-2026) y sin esta rama se quedaba sin link de
  // Resumen, con su panel alcanzable solo tecleando la URL. El orden importa:
  // el dueño y el superadmin ven las dos rutas, y su Resumen sigue siendo
  // `/dashboard` — nunca se pintan los dos links.
  const hrefResumen = puedeVerRuta(rolMenu, '/dashboard')
    ? '/dashboard'
    : puedeVerRuta(rolMenu, '/dashboard/contador') ? '/dashboard/contador' : null;
  const resumenActivo = pathname === hrefResumen;

  return (
    <>
      {hrefResumen && (
        <div>
          <Link href={`${hrefResumen}${sufijo}`} className={claseItem(resumenActivo)} style={estiloItem(resumenActivo)} title="Resumen">
            <LayoutGrid {...estiloIcono(resumenActivo)} /> <span className="sb-texto truncate">Resumen</span>
          </Link>
        </div>
      )}
      <Seccion titulo="Agentes" items={visibles(AGENTES)} sufijo={sufijo} pathname={pathname} />
      <Seccion titulo="Operación" items={visibles(OPERACION)} sufijo={sufijo} pathname={pathname} />
      <Seccion titulo="Dinero y fiscal" items={visibles(DINERO_FISCAL)} sufijo={sufijo} pathname={pathname} />
      <Seccion titulo="Sistema" items={visibles(SISTEMA)} sufijo={sufijo} pathname={pathname} />
    </>
  );
}

/** El bloque INFERIOR fijo (Soporte / Configuración),
 *  montado por chrome.tsx en su zona con fondo propio — separado del nav
 *  principal para poder anclarlo abajo. El 13-ago llegaron dos piezas más:
 *  "Centro de ayuda" como botón pill y el
 *  selector de tema claro / sistema / oscuro. */
export function SidebarAbajo({ rol, usoIa }: {
  rol: string;
  /** El % usado del presupuesto diario de análisis con IA (16-ago-2026, ref.
   *  shadcn-dashboard "plan usage") — % real gastado/tope, sin dólares: el
   *  costo interno va en USD y esa unidad no es del cliente. `undefined` no
   *  se pinta; `null` = no se pudo leer, y se dice. */
  usoIa?: { pct: number } | null;
}) {
  const pathname = usePathname();
  const { sufijo, rolMenu } = useSufijoYRol(rol);
  const items = ABAJO.filter((it) => puedeVerRuta(rolMenu, it.href));
  if (items.length === 0) return null;
  const ayuda = items.find((it) => it.href === '/dashboard/soporte');
  const filas = items.filter((it) => it.href !== '/dashboard/soporte');
  return (
    <>
      {usoIa !== undefined && (
        <WidgetUso
          etiqueta="Análisis con IA · hoy"
          valor={usoIa ? `${usoIa.pct}%` : null}
          detalle={usoIa ? 'del análisis incluido hoy — se renueva a medianoche' : undefined}
          tope={usoIa ? { usado: usoIa.pct, limite: 100 } : null}
          href={`/dashboard/chat${sufijo}`} hrefTexto="Preguntar a tus datos"
        />
      )}
      {ayuda && (
        <Link href={`${ayuda.href}${sufijo}`} title={ayuda.nombre}
          className="hairline flex items-center gap-2 px-3 py-1.5 mb-1 rounded-full text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)] sb-centrable"
          style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
          <ayuda.Icono width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          <span className="sb-texto truncate">{ayuda.nombre}</span>
        </Link>
      )}
      {filas.map((it) => <Fila key={it.href} item={it} sufijo={sufijo} pathname={pathname} />)}
      {/* El selector se esconde entero al colapsar (sb-texto): a 72px no
          caben tres botones, y el tema no es algo que se cambie a diario. */}
      <div className="sb-texto px-2.5 pt-1.5 flex justify-center">
        <SelectorTema />
      </div>
    </>
  );
}
