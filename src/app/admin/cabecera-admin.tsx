'use client';

import { createContext, useContext, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, CircleHelp, LayoutGrid, LifeBuoy, Users } from 'lucide-react';
import { shell as shellEs } from '@/lib/i18n/es/shell';
import { useT } from '@/lib/i18n/proveedor';
import { Popover, MenuList, Tooltip } from '../ui-v2/componentes/overlay';
import BotonBuscar from '../dashboard/shell/boton-buscar';
import { entradaDeRuta } from './rutas';
import { useRiel } from '../dashboard/shell/colapso';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import type { RequiereAccion } from './requiere-accion';
import { etiquetaNav } from '@/lib/i18n/nav';
import { crearTraductor, type Traductor } from '@/lib/i18n/traducir';
import type { DiccionarioDe } from '@/lib/i18n/catalogo';

/** El traductor en español: lo que dicen `etiquetaCampana` y las etiquetas sin proveedor de idioma (y las pruebas). */
const TRADUCTOR_ES: Traductor<DiccionarioDe<'shell'>> = crearTraductor<DiccionarioDe<'shell'>>('es', shellEs, shellEs);

const ContextoRequiereAccion = createContext<RequiereAccion | undefined>(undefined);

/** El layout (servidor) resuelve el dato y lo da por aquí: así `chrome.tsx` no necesita props nuevas. */
export function ProveedorRequiereAccion({ valor, children }: { valor: RequiereAccion; children: React.ReactNode }) {
  return <ContextoRequiereAccion.Provider value={valor}>{children}</ContextoRequiereAccion.Provider>;
}

/** El texto de la campana para lectores de pantalla y el tooltip. `null` = lectura caída: «sin dato», nunca «0». */
export function etiquetaCampana(r: RequiereAccion | undefined, tr: Traductor<DiccionarioDe<'shell'>> = TRADUCTOR_ES): string {
  if (!r) return tr.t('cab.notificaciones');
  if (r.pendientes === null) return tr.t('cab.notificaciones.sinDato');
  if (r.pendientes === 0) return tr.t('cab.notificaciones.nada');
  return tr.tp(r.hayUrgente ? 'cab.notificaciones.urgente' : 'cab.notificaciones.pendientes', r.pendientes);
}

/** Lo que «Avisos» del pie del sidebar lee del proveedor (el layout lo resuelve en el servidor). */
export function useRequiereAccion(): RequiereAccion | undefined {
  return useContext(ContextoRequiereAccion);
}

/**
 * El botón «Guía» de /admin: la misma píldora que la del dashboard (`.rv-guia__btn`). /admin aún no tiene recorrido guiado propio, así que el
 * menú ofrece solo lo que existe: el Centro de ayuda y la salida a los otros paneles (selector de flota). Sin recorrido que inventar.
 */
function GuiaAdmin() {
  const { t } = useT('shell', shellEs);
  const [abierto, setAbierto] = useState(false);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const cerrar = () => setAbierto(false);
  return (
    <div className="rv-guia">
      <button ref={gatillo} type="button" className="rv-guia__btn" aria-haspopup="menu" aria-expanded={abierto} aria-controls={abierto ? idMenu : undefined}
        onClick={() => setAbierto((a) => !a)}>
        <CircleHelp width={14} height={14} strokeWidth={TRAZO_ICONO} aria-hidden />
        <span>{t('cab.guia')}</span>
      </button>
      <Popover abierto={abierto} onCerrar={cerrar} ancla={gatillo} etiqueta={t('cab.guia')} alineacion="inicio">
        <div id={idMenu} onKeyDownCapture={(e) => { if (e.key === 'Tab') cerrar(); }}>
          <MenuList etiqueta={t('cab.guia')}>
            <Link role="menuitem" tabIndex={-1} href="/dashboard/soporte" className="rv-menu__item" onClick={cerrar}>
              <span className="rv-menu__icono" aria-hidden><LifeBuoy width={16} height={16} strokeWidth={TRAZO_ICONO} /></span>
              <span>{t('cab.guia.ayuda')}</span>
            </Link>
            <Link role="menuitem" tabIndex={-1} href="/admin/elegir-flota" className="rv-menu__item" onClick={cerrar}>
              <span className="rv-menu__icono" aria-hidden><Users width={16} height={16} strokeWidth={TRAZO_ICONO} /></span>
              <span>{t('cab.guia.paneles')}</span>
            </Link>
          </MenuList>
        </div>
      </Popover>
    </div>
  );
}

/**
 * La cabecera de /admin, como la de Rovaq y como la del dashboard (`CabeceraEscritorio`, clases `.rv-cab-esc`): botón de plegar/expandir
 * el menú (sin él, al plegar a riel no habría NINGÚN control para volver a abrirlo), el título de la pantalla (icono y nombre de su
 * entrada del sidebar; el Resumen en `/admin`; nada si la ruta no es de ninguna entrada), la Guía y, a la derecha, el disparador visible
 * del buscador ⌘K. La campana y la fecha se retiraron: la campana vive como «Avisos» en el pie del sidebar (mismo conteo real,
 * `useRequiereAccion`; lectura caída = «sin dato», nunca 0). Entre 768 y 1023 px el riel es obligatorio por CSS y el botón de plegar se oculta.
 */
export default function CabeceraAdmin() {
  const { riel, alternar } = useRiel();
  const tr = useT('shell', shellEs);
  const { t } = tr;
  const pathname = usePathname() ?? '';
  const entrada = pathname === '/admin' ? { nombre: 'Resumen', Icono: LayoutGrid } : entradaDeRuta(pathname);
  const etiqueta = riel ? t('cab.expandir') : t('cab.plegar');
  return (
    <header className="rv-cab-esc">
      <div className="rv-cab-esc__izq">
        <Tooltip texto={etiqueta}>
          <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={etiqueta} aria-expanded={!riel}>
            <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          </button>
        </Tooltip>
        {entrada && (
          <span className="rv-cab-esc__titulo" aria-hidden>
            <entrada.Icono width={15} height={15} strokeWidth={TRAZO_ICONO} aria-hidden />
            <span>{etiquetaNav(tr, entrada.nombre)}</span>
          </span>
        )}
        <GuiaAdmin />
      </div>
      <div className="rv-cab-esc__der">
        <BotonBuscar />
      </div>
    </header>
  );
}
