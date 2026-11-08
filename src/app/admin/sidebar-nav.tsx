'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, ChevronDown, ChevronsLeft, ArrowLeftRight, Gauge } from 'lucide-react';
import { type Item, AGENTES, NEGOCIO, PLATAFORMA, CONTROL, SISTEMA } from './rutas';
import { SelectorTema } from '../selector-tema';
import LogoV2 from '../dashboard/shell/logo-v2';
import { ALTO_LOGO_PX } from '../marco-v2';
import { useRiel } from '../dashboard/shell/colapso';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import { WidgetUso } from './ui/kit';
import { usd } from '@/lib/utils';
import { numero } from '@/lib/formato';

// El sidebar de /admin usa las clases del sistema (`.rv-sb`, `.rv-item`, `.rv-grupo` de ui-v2/shell.css), las MISMAS que el del
// dashboard (7-nov-2026, R8): ancho, hover, activo, colapso a riel y animación de entrada vienen de ahí. Lo único distinto es el
// contenido: las secciones salen de `admin/rutas.ts` y aquí no hay sufijo de superadmin.

function idSeccion(titulo: string): string {
  return `nav-seccion-${titulo.toLowerCase().split(' ').join('-')}`;
}

function Fila({ item, pathname }: { item: Item; pathname: string }) {
  const activo = pathname === item.href;
  return (
    <li>
      <Link href={item.href} className="rv-item" aria-current={activo ? 'page' : undefined} title={item.nombre} aria-label={item.nombre}>
        <item.Icono className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        <span className="rv-item__txt">{item.nombre}</span>
      </Link>
    </li>
  );
}

function Seccion({ titulo, items, pathname, abierta, onAbrir }: {
  titulo: string; items: Item[]; pathname: string; abierta: string | null;
  onAbrir: (titulo: string) => void;
}) {
  // ACORDEÓN (orden de Javier, 17-ago): UNA sola sección abierta a la vez; el estado vive en el padre.
  const esta = abierta === titulo;
  if (items.length === 0) return null;
  const id = idSeccion(titulo);
  return (
    <section className="rv-grupo" data-abierto={esta ? '' : undefined} aria-labelledby={id}>
      <h2 className="rv-grupo__h">
        <button type="button" id={id} className="rv-grupo__t rv-grupo__tog" onClick={() => onAbrir(titulo)}
          aria-expanded={esta} aria-controls={`${id}-items`}>
          {titulo}
          <ChevronDown className="rv-grupo__chev" width={14} height={14} strokeWidth={TRAZO_ICONO} aria-hidden />
        </button>
      </h2>
      <div id={`${id}-items`} className="rv-grupo__cuerpo" role="region" aria-labelledby={id}>
        <div className="rv-grupo__int">
          <ul className="rv-lista">{items.map((it) => <Fila key={it.href} item={it} pathname={pathname} />)}</ul>
        </div>
      </div>
    </section>
  );
}

/** El `<aside>` `.rv-sb`: lleva `data-riel` cuando el usuario plegó el menú (misma preferencia que el dashboard). */
export function AsideAdmin({ children }: { children: React.ReactNode }) {
  const { riel } = useRiel();
  return <aside className="rv-sb" data-riel={riel ? '' : undefined}>{children}</aside>;
}

/** La marca del sidebar: logo (horizontal / símbolo en el riel) y el botón de plegar — las mismas piezas que `SidebarV2`. */
export function MarcaAdmin() {
  const { riel, alternar } = useRiel();
  return (
    <div className="rv-sb__marca">
      <Link href="/admin" className="rv-sb__logo" aria-label="Likida, ir al inicio">
        <span className="rv-logo-h"><LogoV2 alto={ALTO_LOGO_PX.sidebar} /></span>
        <span className="rv-logo-s"><LogoV2 alto={ALTO_LOGO_PX.riel} variante="simbolo" /></span>
      </Link>
      <button type="button" className="rv-icono-boton rv-sb__plegar" onClick={alternar} aria-label="Plegar el menú" title="Plegar el menú" aria-expanded={!riel}>
        <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
      </button>
    </div>
  );
}

const TITULOS_ADMIN: Array<[string, Item[]]> = [
  ['Agentes', AGENTES], ['Negocio', NEGOCIO], ['Plataforma', PLATAFORMA],
  ['Control', CONTROL], ['Sistema', SISTEMA],
];

export default function SidebarNav() {
  const pathname = usePathname();
  const resumenActivo = pathname === '/admin';
  // El acordeón: default AGENTES, o la sección de la ruta activa. Toggle
  // sobre la abierta la cierra (null = todas plegadas, también válido).
  const [abierta, setAbierta] = useState<string | null>(() => {
    for (const [titulo, items] of TITULOS_ADMIN) {
      if (items.some((it) => it.href === pathname)) return titulo;
    }
    return 'Agentes';
  });
  const alternar = (titulo: string) => setAbierta((a) => (a === titulo ? null : titulo));
  return (
    <>
      <ul className="rv-lista">
        <li>
          <Link href="/admin" className="rv-item" aria-current={resumenActivo ? 'page' : undefined} title="Resumen" aria-label="Resumen">
            <LayoutGrid className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
            <span className="rv-item__txt">Resumen</span>
          </Link>
        </li>
      </ul>
      {TITULOS_ADMIN.map(([titulo, items]) => (
        <Seccion key={titulo} titulo={titulo} items={items} pathname={pathname}
          abierta={abierta} onAbrir={alternar} />
      ))}
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
        <div className="adm-solo-ancho">
          <WidgetUso
            etiqueta={usoIa ? `Costo de IA · ${usoIa.etiquetaMes}` : 'Costo de IA · este mes'}
            valor={usoIa ? usd(usoIa.mesUsd) : null}
            detalle={usoIa ? `${numero(usoIa.llamadas)} ${usoIa.llamadas === 1 ? 'llamada' : 'llamadas'} al modelo` : undefined}
            href="/admin/costos-facturacion" hrefTexto="Ver costos"
          />
        </div>
      )}
      {usoIa === undefined && (
        <Link href="/admin/costos-facturacion" aria-label="Costos de IA" title="Costos de IA" className="rv-item">
          <Gauge className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          <span className="rv-item__txt">Costos de IA</span>
        </Link>
      )}
      <Link href="/admin/dev" title="Entrar a los paneles de los otros roles (vive en Dev desde el 17-ago)" aria-label="Ver los otros paneles" className="rv-item">
        <ArrowLeftRight className="rv-item__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        <span className="rv-item__txt">Ver los otros paneles</span>
      </Link>
      {/* El selector se esconde entero en el riel (adm-solo-ancho): a 72 px no caben tres botones. */}
      <div className="adm-solo-ancho flex justify-center py-1">
        <SelectorTema />
      </div>
    </>
  );
}
