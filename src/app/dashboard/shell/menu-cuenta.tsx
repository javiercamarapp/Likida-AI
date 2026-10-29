'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { LogOut, ChevronsUpDown, Play, RotateCcw, Check } from 'lucide-react';
import type { Item } from '../rutas';
import { EnlaceCuenta } from '../enlace-cuenta';
import { useTourOpcional, useProgresoTour } from '../../ui-v2/movimiento/tour/proveedor';
import { anclaDe, indiceDeMenu } from './nav-utiles';
import { OPCIONES_TEMA, useTema } from '../../selector-tema';

/**
 * La tarjeta de cuenta del pie (alto 44): monograma, nombre, rol y «Salir» (icono en tinta, nunca rojo). Al pulsar la tarjeta se
 * abre un menú (popover de filas de 32 px) con Mi perfil, Cuenta, Ayuda y Ver recorrido, y —solo sin perfil— el uso de IA de hoy.
 * Se cierra con Esc, con un clic fuera y al navegar; el foco vuelve a la tarjeta. Es `role="menu"`, no un diálogo.
 * (Cuando B entregue `Popover`/`MenuList` en `overlay.tsx`, esta pieza migra a ellos sin cambiar de aspecto.)
 */
export default function MenuCuenta({ nombre, rol, rolEtiqueta, sufijo, filas, usoIaPct, cerrarSesion, alNavegar, iniciales, abiertoInicial = false }: {
  /** Solo para pruebas de render estático (abrir el menú sin interacción). */
  abiertoInicial?: boolean;
  nombre: string | null; rol: string; rolEtiqueta: string; sufijo: string; filas: Item[]; usoIaPct?: number | null;
  cerrarSesion?: () => Promise<void>; alNavegar?: () => void; iniciales: string;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const { tema, elegir } = useTema();
  const raiz = useRef<HTMLDivElement>(null);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();

  // Solo los ítems visibles: el tema del menú existe en el DOM pero se oculta donde el segmentado del pie sí cabe.
  const items = () => [...(raiz.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])].filter((e) => e.getClientRects().length > 0);
  useEffect(() => {
    if (!abierto) return;
    // Foco inicial: el primer ítem del menú (patrón APG de menú).
    items()[0]?.focus();
    const fuera = (e: PointerEvent) => { if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false); };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setAbierto(false); gatillo.current?.focus(); return; }
      if (e.key === 'Tab') { setAbierto(false); return; } // Tab sale del menú y lo cierra (el foco sigue su curso)
      const lista = items();
      const nuevo = indiceDeMenu(e.key, lista.indexOf(document.activeElement as HTMLElement), lista.length);
      if (nuevo !== null) { e.preventDefault(); lista[nuevo]?.focus(); }
    };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('pointerdown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);

  const cerrar = () => { setAbierto(false); alNavegar?.(); };
  const mostrarNombre = (nombre ?? '').trim() || 'Mi cuenta';
  return (
    <div className="rv-cuenta" ref={raiz}>
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
      {abierto && (
        <div id={idMenu} role="menu" aria-label="Cuenta" className="rv-menu">
          {usoIaPct !== undefined && (
            <Link role="menuitem" tabIndex={-1} href={`/dashboard/chat${sufijo}`} className="rv-menu__fila" onClick={cerrar}>
              <span>Análisis con IA · hoy</span><span className="rv-menu__valor">{usoIaPct === null ? '—' : `${usoIaPct} %`}</span>
            </Link>
          )}
          {filas.map((it) => (
            <Link key={it.href} role="menuitem" tabIndex={-1} href={`${it.href}${sufijo}`} className="rv-menu__fila" data-tour={`nav-${anclaDe(it.href)}`} onClick={cerrar}>
              <it.Icono width={16} height={16} strokeWidth={1.75} aria-hidden /><span>{it.nombre === 'Centro de ayuda' ? 'Ayuda' : it.nombre}</span>
            </Link>
          ))}
          <EnlaceCuenta rol={rol} className="rv-menu__fila" role="menuitem" tabIndex={-1} onClick={cerrar}>Mi cuenta</EnlaceCuenta>
          <FilaRecorrido alElegir={cerrar} />
          {/* El tema, también aquí: en el riel (768–1023 y plegado) el segmentado del pie no cabe y esta es la única vía. */}
          <div role="group" aria-label="Tema de la interfaz" className="rv-menu__tema">
            {OPCIONES_TEMA.map(({ valor, Icono, rotulo }) => (
              <button key={valor} type="button" role="menuitemradio" aria-checked={tema === valor} tabIndex={-1} className="rv-menu__fila" onClick={() => elegir(valor)}>
                <Icono width={16} height={16} strokeWidth={1.75} aria-hidden /><span>{rotulo}</span>{tema === valor && <Check className="rv-menu__valor" width={14} height={14} strokeWidth={2} aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** «Ver recorrido» / «Reanudar recorrido»: la única forma de abrirlo; sin motor de recorrido (v2 sin perfil) no existe. */
function FilaRecorrido({ alElegir }: { alElegir: () => void }) {
  if (!useTourOpcional()) return null;
  return <FilaRecorridoConMotor alElegir={alElegir} />;
}
function FilaRecorridoConMotor({ alElegir }: { alElegir: () => void }) {
  const tour = useTourOpcional();
  const prog = useProgresoTour('dueno');
  if (!tour || !tour.existe('dueno')) return null;
  const enCurso = prog?.estado === 'en_curso';
  return (
    <button type="button" role="menuitem" tabIndex={-1} className="rv-menu__fila" onClick={() => { alElegir(); if (enCurso) tour.reanudar('dueno'); else tour.reiniciar('dueno'); }}>
      {enCurso ? <RotateCcw width={16} height={16} strokeWidth={1.75} aria-hidden /> : <Play width={16} height={16} strokeWidth={1.75} aria-hidden />}
      <span>{enCurso ? 'Reanudar recorrido' : 'Ver recorrido'}</span>
    </button>
  );
}
