'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, ChevronDown, ChevronsLeft, ArrowLeftRight, UserRound, Workflow, Briefcase, SlidersHorizontal, Activity } from 'lucide-react';
import { type Item, SECCIONES, entradaDeRuta } from './rutas';
import PieSidebar, { TarjetaUsuario, inicialesDe } from '../ui-v2/componentes/pie-sidebar';
import { useRequiereAccion } from './cabecera-admin';
import LogoV2 from '../dashboard/shell/logo-v2';
import { ALTO_LOGO_PX } from '../marco-v2';
import { useRiel } from '../dashboard/shell/colapso';
import { Tooltip } from '../ui-v2/componentes/overlay';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';

// El sidebar de /admin usa las clases del sistema (`.rv-sb`, `.rv-item`, `.rv-grupo` de ui-v2/shell.css), las MISMAS que el del
// dashboard (7-nov-2026, R8): ancho, hover, activo, colapso a riel y animación de entrada vienen de ahí. Lo único distinto es el
// contenido: las secciones salen de `admin/rutas.ts` y aquí no hay sufijo de superadmin.

// Icono de CADA sección: en el riel (72 px) solo se ve una sección abierta a la vez y las demás se reducen a su icono (antes el riel
// pintaba las 43 páginas seguidas, la lista se cortaba a medias y se encimaba con el pie).
const ICONO_SECCION: Record<string, typeof Workflow> = {
  Agentes: Workflow, Negocio: Briefcase, Control: SlidersHorizontal, Sistema: Activity,
};

function idSeccion(titulo: string): string {
  return `nav-seccion-${titulo.toLowerCase().split(' ').join('-')}`;
}

function Fila({ item, pathname }: { item: Item; pathname: string }) {
  // La entrada está activa en su ruta Y en la de cualquiera de sus pestañas (p. ej. «Agentes» también en /admin/agente-ocr).
  const activo = entradaDeRuta(pathname)?.href === item.href;
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
          {(() => { const Ico = ICONO_SECCION[titulo]; return Ico ? <Ico className="rv-grupo__ico" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden /> : null; })()}
          <span className="rv-grupo__tt">{titulo}</span>
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
  const { t } = useT('shell', shellEs);
  return (
    <div className="rv-sb__marca">
      <Link href="/admin" className="rv-sb__logo" aria-label="Likida, ir al inicio">
        <span className="rv-logo-h"><LogoV2 alto={ALTO_LOGO_PX.sidebar} /></span>
        <span className="rv-logo-s"><LogoV2 alto={ALTO_LOGO_PX.riel} variante="simbolo" /></span>
      </Link>
      <Tooltip texto={t('cab.plegar')}>
        <button type="button" className="rv-icono-boton rv-sb__plegar" onClick={alternar} aria-label={t('cab.plegar')} aria-expanded={!riel}>
          <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}

// Las secciones salen de `rutas.ts` (SECCIONES: Agentes, Negocio, Control, Sistema), la misma fuente del rótulo de área de cada pantalla.
const TITULOS_ADMIN: Array<[string, Item[]]> = SECCIONES.map((s) => [s.titulo, s.items]);

export default function SidebarNav() {
  const pathname = usePathname();
  const resumenActivo = pathname === '/admin';
  // El acordeón: default AGENTES, o la sección de la ruta activa. Toggle
  // sobre la abierta la cierra (null = todas plegadas, también válido).
  const [abierta, setAbierta] = useState<string | null>(() => {
    for (const [titulo, items] of TITULOS_ADMIN) {
      if (items.some((it) => it.href === entradaDeRuta(pathname)?.href)) return titulo;
    }
    return 'Agentes';
  });
  const alternar = (titulo: string) => setAbierta((a) => (a === titulo ? null : titulo));
  const { t } = useT('shell', shellEs);
  // «Página actual»: la pantalla abierta cuando su sección está cerrada (o hay otra abierta) no se vería en el árbol; el bloque la repite
  // arriba y desaparece en cuanto se abre su sección. En el riel no se pinta (CSS): ahí todo está a la vista.
  const activa = entradaDeRuta(pathname);
  const seccionActiva = activa ? TITULOS_ADMIN.find(([, items]) => items.some((it) => it.href === activa.href))?.[0] ?? null : null;
  const itemActual = activa && seccionActiva && abierta !== seccionActiva ? activa : null;
  // El ítem activo se deja a la vista cuando el árbol scrollea; espera a que termine de abrirse la sección (180 ms) para medir.
  useEffect(() => {
    const id = window.setTimeout(() => {
      document.querySelector<HTMLElement>('.rv-sb__nav [aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, 200);
    return () => window.clearTimeout(id);
  }, [pathname, abierta]);
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
      {itemActual && (
        <section aria-labelledby="rv-g-pagina-actual" className="rv-grupo rv-pagina-actual" data-estatico>
          <p id="rv-g-pagina-actual" className="rv-grupo__t">{t('nav.paginaActual')}</p>
          <ul className="rv-lista"><Fila item={itemActual} pathname={pathname} /></ul>
        </section>
      )}
      {TITULOS_ADMIN.map(([titulo, items]) => (
        <Seccion key={titulo} titulo={titulo} items={items} pathname={pathname}
          abierta={abierta} onAbrir={alternar} />
      ))}
    </>
  );
}

/**
 * El pie de /admin: el MISMO `PieSidebar` del dashboard. Organización = selector de flota con «Ver como» (la flota se abre en el
 * dashboard con `?tenant=`, el mecanismo de siempre, sin escribir nada; «Elegir flota» lleva al flujo de `elegir-flota`). «Avisos» lee
 * el conteo real de `requiere-accion.ts` (lectura caída = «sin dato»). Acceso cruzado al panel del cliente. `salir` llega ya armado
 * por el servidor (el `<form>` de cerrar sesión): aquí no viaja ninguna función.
 */
export function PieAdmin({ nombre, avatarUrl, flotas, flotaActual, salir, alNavegar }: {
  nombre: string | null; avatarUrl: string | null;
  /** `null` = la lista de flotas no se pudo leer (se dice «Sin dato»); `undefined` = no se pidió (render de prueba). */
  flotas?: Array<{ id: string; nombre: string }> | null;
  flotaActual?: string | null;
  salir?: React.ReactNode;
  /** La hoja «Más» del móvil la cierra al navegar. */
  alNavegar?: () => void;
}) {
  const r = useRequiereAccion();
  const n = (nombre ?? '').trim();
  return (
    <PieSidebar
      alNavegar={alNavegar}
      organizacion={{
        opciones: flotas === undefined ? [] : flotas === null ? null : flotas.map((f) => ({ valor: f.id, nombre: f.nombre })),
        actual: flotaActual ?? null,
        hrefIr: (id) => `/dashboard?tenant=${encodeURIComponent(id)}`,
        textoIr: 'Ver como',
        hrefSinOpcion: '/admin/elegir-flota',
      }}
      avisos={{ href: '/admin/notificaciones', pendientes: r ? r.pendientes : undefined, urgente: r?.hayUrgente }}
      acceso={{ href: '/dashboard', texto: 'Panel del cliente', Icono: ArrowLeftRight }}
      tarjeta={(
        <TarjetaUsuario nombre={nombre} rolEtiqueta="Superadmin" iniciales={inicialesDe(n || 'J')} avatarUrl={avatarUrl} salir={salir} alElegir={alNavegar}
          menu={(
            <Link role="menuitem" tabIndex={-1} href="/admin/mi-perfil" className="rv-menu__item" onClick={() => alNavegar?.()}>
              <span className="rv-menu__icono" aria-hidden><UserRound width={16} height={16} strokeWidth={TRAZO_ICONO} /></span>
              <span>Mi perfil</span>
            </Link>
          )} />
      )}
    />
  );
}
