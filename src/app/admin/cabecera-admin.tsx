'use client';

import { createContext, useContext } from 'react';
import Link from 'next/link';
import { Bell, ChevronsLeft } from 'lucide-react';
import { useRiel } from '../dashboard/shell/colapso';
import FechaHoy from '../dashboard/shell/fecha-hoy';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';
import type { RequiereAccion } from './requiere-accion';

const ContextoRequiereAccion = createContext<RequiereAccion | undefined>(undefined);

/** El layout (servidor) resuelve el dato y lo da por aquí: así `chrome.tsx` no necesita props nuevas. */
export function ProveedorRequiereAccion({ valor, children }: { valor: RequiereAccion; children: React.ReactNode }) {
  return <ContextoRequiereAccion.Provider value={valor}>{children}</ContextoRequiereAccion.Provider>;
}

/** El texto de la campana para lectores de pantalla y el tooltip. `null` = lectura caída: «sin dato», nunca «0». */
export function etiquetaCampana(r: RequiereAccion | undefined): string {
  if (!r) return 'Notificaciones';
  if (r.pendientes === null) return 'Notificaciones: sin dato';
  if (r.pendientes === 0) return 'Notificaciones: nada pendiente';
  const n = `${r.pendientes} ${r.pendientes === 1 ? 'pendiente' : 'pendientes'}`;
  return `Notificaciones: ${n}${r.hayUrgente ? ', hay algo urgente' : ''}`;
}

const TOPE_VISIBLE = 99;

/**
 * La cabecera de /admin: la MISMA barra superior del dashboard (`CabeceraEscritorio`, clases `.rv-cab-esc`): a la izquierda el botón
 * de plegar/expandir el menú y a la derecha la campana y la fecha de hoy. Antes /admin no tenía cabecera: al plegar el sidebar a riel
 * el botón de la marca desaparece y no había NINGÚN control para volver a abrirlo (la preferencia queda en localStorage y se
 * conservaba entre visitas). Aquí el botón vive siempre, igual que en el dashboard. Entre 768 y 1023 px el riel es obligatorio por CSS
 * y el botón se oculta (mismo comportamiento que el dashboard).
 */
export default function CabeceraAdmin({ requiereAccion }: { requiereAccion?: RequiereAccion } = {}) {
  const { riel, alternar } = useRiel();
  const delContexto = useContext(ContextoRequiereAccion);
  const r = requiereAccion ?? delContexto;
  const etiqueta = etiquetaCampana(r);
  return (
    <header className="rv-cab-esc">
      <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={riel ? 'Expandir el menú' : 'Plegar el menú'}
        title={riel ? 'Expandir el menú' : 'Plegar el menú'} aria-expanded={!riel}>
        <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
      </button>
      <div className="rv-cab-esc__der">
        <Link href="/admin/notificaciones" className="rv-icono-boton rv-campana" aria-label={etiqueta} title={etiqueta}>
          <Bell width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
          {r && r.pendientes === null && <span className="rv-campana__sin-dato" data-estado="sin-dato" aria-hidden>?</span>}
          {r && r.pendientes !== null && r.pendientes > 0 && (
            <span className="rv-campana__cuenta" data-urgente={r.hayUrgente ? 'si' : 'no'} aria-hidden>
              {r.pendientes > TOPE_VISIBLE ? `${TOPE_VISIBLE}+` : r.pendientes}
            </span>
          )}
        </Link>
        <FechaHoy className="rv-cab-esc__fecha" />
      </div>
    </header>
  );
}
