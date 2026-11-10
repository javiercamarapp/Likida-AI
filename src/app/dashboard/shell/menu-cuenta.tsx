'use client';

import Link from 'next/link';
import { LogOut } from 'lucide-react';
import type { Item } from '../rutas';
import { EnlaceCuenta } from '../enlace-cuenta';
import { TarjetaUsuario } from '../../ui-v2/componentes/pie-sidebar';
import { anclaDe } from './nav-utiles';
import { TRAZO_ICONO } from '../../ui-v2/componentes/icono';

/**
 * La tarjeta de cuenta del pie del dashboard: la MISMA `TarjetaUsuario` que usa /admin (`ui-v2/componentes/pie-sidebar.tsx`), con el
 * menú de filas del cliente: Mi perfil, Mi cuenta, Ayuda (y Plan y Configuración en el menú genérico), el uso de IA de hoy —solo sin
 * perfil— y «Cerrar sesión». El tema ya NO vive aquí: es el conmutador del pie (y un botón de ciclo en el riel). Las filas son
 * enlaces reales (`Link`) con `role="menuitem"`.
 */
export default function MenuCuenta({ nombre, rol, rolEtiqueta, sufijo, filas, usoIaPct, cerrarSesion, alNavegar, iniciales, abiertoInicial = false }: {
  /** Solo para pruebas de render estático (abrir el menú sin interacción). */
  abiertoInicial?: boolean;
  nombre: string | null; rol: string; rolEtiqueta: string; sufijo: string; filas: Item[]; usoIaPct?: number | null;
  cerrarSesion?: () => Promise<void>; alNavegar?: () => void; iniciales: string;
}) {
  const alElegir = () => alNavegar?.();
  const menu = (
    <>
      {usoIaPct !== undefined && (
        <Link role="menuitem" tabIndex={-1} href={`/dashboard/chat${sufijo}`} className="rv-menu__item" onClick={alElegir}>
          <span>Análisis con IA · hoy</span><span className="rv-cuenta-valor">{usoIaPct === null ? '—' : `${usoIaPct} %`}</span>
        </Link>
      )}
      {filas.map((it) => (
        <Link key={it.href} role="menuitem" tabIndex={-1} href={`${it.href}${sufijo}`} className="rv-menu__item" data-tour={`nav-${anclaDe(it.href)}`} onClick={alElegir}>
          <span className="rv-menu__icono" aria-hidden><it.Icono width={16} height={16} strokeWidth={TRAZO_ICONO} /></span>
          <span>{it.nombre === 'Centro de ayuda' ? 'Ayuda' : it.nombre}</span>
        </Link>
      ))}
      <EnlaceCuenta rol={rol} className="rv-menu__item" role="menuitem" tabIndex={-1} onClick={alElegir}>Mi cuenta</EnlaceCuenta>
      {cerrarSesion && (
        <form action={cerrarSesion} className="rv-cuenta-salir-fila" role="none">
          <button type="submit" role="menuitem" tabIndex={-1} className="rv-menu__item">
            <span className="rv-menu__icono" aria-hidden><LogOut width={16} height={16} strokeWidth={TRAZO_ICONO} /></span>
            <span>Cerrar sesión</span>
          </button>
        </form>
      )}
    </>
  );
  return <TarjetaUsuario nombre={nombre} rolEtiqueta={rolEtiqueta} iniciales={iniciales} menu={menu} cerrarSesion={cerrarSesion} alElegir={alElegir} abiertoInicial={abiertoInicial} />;
}
