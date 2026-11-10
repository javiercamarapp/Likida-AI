'use client';

import Link from 'next/link';
import { Bell, ChevronsLeft } from 'lucide-react';
import { useRiel } from '../dashboard/shell/colapso';
import FechaHoy from '../dashboard/shell/fecha-hoy';
import { TRAZO_ICONO } from '../ui-v2/componentes/icono';

/**
 * La cabecera de /admin: la MISMA barra superior del dashboard (`CabeceraEscritorio`, clases `.rv-cab-esc`): a la izquierda el botón
 * de plegar/expandir el menú y a la derecha la campana y la fecha de hoy. Antes /admin no tenía cabecera: al plegar el sidebar a riel
 * el botón de la marca desaparece y no había NINGÚN control para volver a abrirlo (la preferencia queda en localStorage y se
 * conservaba entre visitas). Aquí el botón vive siempre, igual que en el dashboard. Entre 768 y 1023 px el riel es obligatorio por CSS
 * y el botón se oculta (mismo comportamiento que el dashboard).
 */
export default function CabeceraAdmin() {
  const { riel, alternar } = useRiel();
  return (
    <header className="rv-cab-esc">
      <button type="button" className="rv-icono-boton rv-cab-esc__plegar" onClick={alternar} aria-label={riel ? 'Expandir el menú' : 'Plegar el menú'}
        title={riel ? 'Expandir el menú' : 'Plegar el menú'} aria-expanded={!riel}>
        <ChevronsLeft className="rv-chev-plegar" width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
      </button>
      <div className="rv-cab-esc__der">
        <Link href="/admin/notificaciones" className="rv-icono-boton rv-campana" aria-label="Notificaciones" title="Notificaciones">
          <Bell width={16} height={16} strokeWidth={TRAZO_ICONO} aria-hidden />
        </Link>
        <FechaHoy className="rv-cab-esc__fecha" />
      </div>
    </header>
  );
}
