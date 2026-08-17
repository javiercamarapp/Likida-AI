'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, ChevronDown, ChevronRight, ArrowLeftRight } from 'lucide-react';
import { type Item, AGENTES, NEGOCIO, PLATAFORMA, CONTROL, SISTEMA } from './rutas';
import { SelectorTema } from '../selector-tema';
import { WidgetUso } from './ui/kit';
import { usd } from '@/lib/utils';
import { numero } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL MISMO LENGUAJE QUE EL SIDEBAR DE /dashboard, A PROPÓSITO (14-ago-2026,
// pedido explícito: "que el sidebar sea idéntico"). Las clases, el pill
// activo (--g1 + --marca), las secciones plegables con chevron y las clases
// sb-* del colapso vienen de `dashboard/sidebar-nav.tsx` — si aquel cambia
// de dirección visual, éste se cambia igual. Lo ÚNICO distinto es el
// contenido: las secciones salen de `admin/rutas.ts` y aquí no hay sufijo de
// superadmin (las rutas de /admin no cargan ?tenant=).
// ═══════════════════════════════════════════════════════════════════════════

const ITEM = 'flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] transition-colors sb-centrable';

/** Activo = pill SÓLIDA en tinta (16-ago-2026, ref. shadcn-dashboard) —
 *  el MISMO cambio que su gemelo dashboard/sidebar-nav.tsx, a la vez. */
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

function Fila({ item, pathname }: { item: Item; pathname: string }) {
  const activo = pathname === item.href;
  return (
    <Link href={item.href} className={claseItem(activo)} style={estiloItem(activo)} title={item.nombre}>
      <item.Icono {...estiloIcono(activo)} /> <span className="sb-texto truncate">{item.nombre}</span>
    </Link>
  );
}

function Seccion({ titulo, items, pathname }: { titulo: string; items: Item[]; pathname: string }) {
  // Solo AGENTES amanece abierta; el resto pliega (orden de Javier del
  // 17-ago, que SUSTITUYE a la del 14-ago de "todo abierto": con las
  // pantallas de Fase D el sidebar completo ya no cabe sin scroll y los
  // encabezados dejan de ser pelones — cada uno anuncia su sección). La
  // sección de la ruta ACTIVA también abre: llegar por link directo a una
  // pantalla y no verla iluminada en el menú desorienta. Estado de sesión —
  // no persiste a propósito.
  const contieneActiva = items.some((it) => it.href === pathname);
  const [plegada, setPlegada] = useState(titulo !== 'Agentes' && !contieneActiva);
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
      {!plegada && items.map((it) => <Fila key={it.href} item={it} pathname={pathname} />)}
    </div>
  );
}

export default function SidebarNav() {
  const pathname = usePathname();
  const resumenActivo = pathname === '/admin';
  return (
    <>
      <div>
        <Link href="/admin" className={claseItem(resumenActivo)} style={estiloItem(resumenActivo)} title="Resumen">
          <LayoutGrid {...estiloIcono(resumenActivo)} /> <span className="sb-texto truncate">Resumen</span>
        </Link>
      </div>
      <Seccion titulo="Agentes" items={AGENTES} pathname={pathname} />
      <Seccion titulo="Negocio" items={NEGOCIO} pathname={pathname} />
      <Seccion titulo="Plataforma" items={PLATAFORMA} pathname={pathname} />
      <Seccion titulo="Control" items={CONTROL} pathname={pathname} />
      <Seccion titulo="Sistema" items={SISTEMA} pathname={pathname} />
    </>
  );
}

/** El bloque inferior fijo — gemelo de `SidebarAbajo` del dashboard (pill de
 *  ayuda + selector de tema). Aquí la pill es la puerta a los paneles de los
 *  otros roles: la acción que el superadmin hace todo el día.
 *
 *  `usoIa` (16-ago-2026, ref. shadcn-dashboard): el costo de IA del mes,
 *  medido — lo trae layout.tsx. `undefined` = no se pidió (render de
 *  prueba): el widget no se pinta; `null` = se pidió y no se pudo leer: el
 *  widget lo DICE. */
export function SidebarAbajoAdmin({ usoIa }: {
  usoIa?: { mesUsd: number; llamadas: number; etiquetaMes: string } | null;
}) {
  return (
    <>
      {usoIa !== undefined && (
        <WidgetUso
          etiqueta={usoIa ? `Costo de IA · ${usoIa.etiquetaMes}` : 'Costo de IA · este mes'}
          valor={usoIa ? usd(usoIa.mesUsd) : null}
          detalle={usoIa ? `${numero(usoIa.llamadas)} ${usoIa.llamadas === 1 ? 'llamada' : 'llamadas'} al modelo` : undefined}
          href="/admin/costos-facturacion" hrefTexto="Ver costos"
        />
      )}
      <Link href="/admin#vistas" title="Entrar a los paneles de los otros roles"
        className="hairline flex items-center gap-2 px-3 py-1.5 mb-1 rounded-full text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)] sb-centrable"
        style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
        <ArrowLeftRight width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
        <span className="sb-texto truncate">Ver los otros paneles</span>
      </Link>
      {/* El selector se esconde entero al colapsar (sb-texto) — misma razón
          que en el dashboard: a 72px no caben tres botones. */}
      <div className="sb-texto px-2.5 pt-1.5 flex justify-center">
        <SelectorTema />
      </div>
    </>
  );
}
