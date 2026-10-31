'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, ChevronsUpDown, Check } from 'lucide-react';
import type { Item } from '../rutas';
import { EnlaceCuenta } from '../enlace-cuenta';
import { Popover, MenuList } from '../../ui-v2/componentes/overlay';
import { anclaDe, indiceDeMenu } from './nav-utiles';
import { OPCIONES_TEMA, useTema } from '../../selector-tema';

/**
 * La tarjeta de cuenta del pie (alto 44): monograma, nombre, rol y «Salir» (icono en tinta, nunca rojo). Al pulsar la tarjeta se
 * abre el Popover del sistema de overlays (`overlay.tsx`: posición, foco inicial, Esc con retorno del foco, clic fuera) con un
 * `MenuList` (flechas, Inicio, Fin) de filas de 32 px: Mi perfil, Mi cuenta, Ayuda (y Plan y Configuración en el menú genérico), el tema y —solo sin perfil— el uso
 * de IA de hoy. Tab sale del menú y lo cierra. Las filas son enlaces reales (`Link`, navegación suave) con `role="menuitem"`.
 */
export default function MenuCuenta({ nombre, rol, rolEtiqueta, sufijo, filas, usoIaPct, cerrarSesion, alNavegar, iniciales, abiertoInicial = false }: {
  /** Solo para pruebas de render estático (abrir el menú sin interacción). */
  abiertoInicial?: boolean;
  nombre: string | null; rol: string; rolEtiqueta: string; sufijo: string; filas: Item[]; usoIaPct?: number | null;
  cerrarSesion?: () => Promise<void>; alNavegar?: () => void; iniciales: string;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const { tema, elegir } = useTema();

  const cerrar = () => setAbierto(false);
  const alElegir = () => { setAbierto(false); alNavegar?.(); };
  const mostrarNombre = (nombre ?? '').trim() || 'Mi cuenta';
  return (
    <div className="rv-cuenta">
      <button ref={gatillo} type="button" className="rv-cuenta__btn" aria-haspopup="menu" aria-expanded={abierto} aria-controls={abierto ? idMenu : undefined}
        title="Menú de la cuenta" onClick={() => setAbierto((a) => !a)}>
        <span className="rv-avatar" aria-hidden>{iniciales}</span>
        <span className="rv-cuenta__txt">
          <span className="rv-cuenta__nombre">{mostrarNombre}</span>
          <span className="rv-cuenta__rol">{rolEtiqueta}</span>
        </span>
        <ChevronsUpDown className="rv-cuenta__chev" width={14} height={14} strokeWidth={1.75} aria-hidden />
      </button>
      {cerrarSesion && (
        <form action={cerrarSesion} className="rv-cuenta__salir">
          <button type="submit" title="Cerrar sesión" aria-label="Cerrar sesión" className="rv-icono-boton">
            <LogOut width={16} height={16} strokeWidth={1.75} aria-hidden />
          </button>
        </form>
      )}
      <Popover abierto={abierto} onCerrar={cerrar} ancla={gatillo} etiqueta="Cuenta" alineacion="inicio">
        {/* En CAPTURA, antes que el MenuList: Tab sale del menú y lo cierra; Esc no cierra además la hoja «Más» (<dialog> contenedor);
            las flechas recorren TAMBIÉN las filas de tema (menuitemradio), que el MenuList no cuenta. */}
        <div id={idMenu} onKeyDownCapture={(e) => {
          if (e.key === 'Tab') { cerrar(); return; }
          if (e.key === 'Escape') { e.preventDefault(); return; }
          const lista = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((x) => x.getClientRects().length > 0);
          const nuevo = indiceDeMenu(e.key, lista.indexOf(document.activeElement as HTMLElement), lista.length);
          if (nuevo !== null) { e.preventDefault(); e.stopPropagation(); lista[nuevo]?.focus(); }
        }}>
          <MenuList etiqueta="Cuenta">
            {usoIaPct !== undefined && (
              <Link role="menuitem" tabIndex={-1} href={`/dashboard/chat${sufijo}`} className="rv-menu__item" onClick={alElegir}>
                <span>Análisis con IA · hoy</span><span className="rv-cuenta-valor">{usoIaPct === null ? '—' : `${usoIaPct} %`}</span>
              </Link>
            )}
            {filas.map((it) => (
              <Link key={it.href} role="menuitem" tabIndex={-1} href={`${it.href}${sufijo}`} className="rv-menu__item" data-tour={`nav-${anclaDe(it.href)}`} onClick={alElegir}>
                <span className="rv-menu__icono" aria-hidden><it.Icono width={16} height={16} strokeWidth={1.75} /></span>
                <span>{it.nombre === 'Centro de ayuda' ? 'Ayuda' : it.nombre}</span>
              </Link>
            ))}
            <EnlaceCuenta rol={rol} className="rv-menu__item" role="menuitem" tabIndex={-1} onClick={alElegir}>Mi cuenta</EnlaceCuenta>
            {/* El tema vive SOLO aquí (el pie ya no apila un segmentado): claro / sistema / oscuro, también en el riel y en la hoja «Más». */}
            <div className="rv-cuenta-tema" role="presentation">
              {OPCIONES_TEMA.map(({ valor, Icono, rotulo }) => (
                <button key={valor} type="button" role="menuitemradio" aria-checked={tema === valor} tabIndex={-1} data-tema={valor} className="rv-menu__item"
                  aria-label={rotulo} onClick={() => elegir(valor)}>
                  <span className="rv-menu__icono" aria-hidden><Icono width={16} height={16} strokeWidth={1.75} /></span>
                  <span>{rotulo}</span>{tema === valor && <Check className="rv-cuenta-valor" width={14} height={14} strokeWidth={2} aria-hidden />}
                </button>
              ))}
            </div>
            {cerrarSesion && (
              <form action={cerrarSesion} className="rv-cuenta-salir-fila" role="none">
                <button type="submit" role="menuitem" tabIndex={-1} className="rv-menu__item">
                  <span className="rv-menu__icono" aria-hidden><LogOut width={16} height={16} strokeWidth={1.75} /></span>
                  <span>Cerrar sesión</span>
                </button>
              </form>
            )}
          </MenuList>
        </div>
      </Popover>
    </div>
  );
}
