'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { CircleHelp, LifeBuoy, ListChecks, Play, RotateCcw } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { Popover, MenuList } from '../../ui-v2/componentes/overlay';
import { useTourOpcional, useProgresoTour } from '../../ui-v2/movimiento/tour';
import { hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import { indiceDeMenu } from './nav-utiles';

const HREF_PRIMEROS_PASOS = '/dashboard/puesta-en-marcha';
const HREF_AYUDA = '/dashboard/soporte';

/**
 * El botón «Guía» y su menú (Recorrido · Primeros pasos · Centro de ayuda). Vive en la topbar de escritorio (con texto) y en la
 * cabecera móvil (solo icono, 44 px). Solo ofrece lo que ya existe y el rol puede abrir: el recorrido si hay motor de recorridos,
 * «Primeros pasos» y «Centro de ayuda» si están en su menú. El contenido del recorrido es de otro lote; aquí solo se enlaza.
 */
export default function MenuGuia({ rol, perfil, compacto = false }: { rol: string; perfil?: PerfilTenant | null; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const { sufijo, menu } = useMenuV2(rol, perfil);
  const hrefs = hrefsDelMenu(menu);
  const cerrar = () => setAbierto(false);
  const primeros = hrefs.includes(HREF_PRIMEROS_PASOS);
  const ayuda = hrefs.includes(HREF_AYUDA);
  const tour = useTourOpcional();
  // Sin ninguna fila que ofrecer (p. ej. nómina: solo Liquidación, avisos y su perfil) el botón no existe: un menú vacío miente.
  if (!(tour?.existe('dueno') || primeros || ayuda)) return null;
  return (
    <div className="rv-guia">
      <button ref={gatillo} type="button" className={compacto ? 'rv-icono-boton' : 'rv-guia__btn'} aria-haspopup="menu" aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined} aria-label={compacto ? 'Guía' : undefined} title="Guía"
        onClick={() => setAbierto((a) => !a)}>
        <CircleHelp width={compacto ? 18 : 16} height={compacto ? 18 : 16} strokeWidth={1.75} aria-hidden />
        {!compacto && <span>Guía</span>}
      </button>
      <Popover abierto={abierto} onCerrar={cerrar} ancla={gatillo} etiqueta="Guía" alineacion="fin">
        <div id={idMenu} onKeyDownCapture={(e) => {
          if (e.key === 'Tab') { cerrar(); return; }
          const lista = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((x) => x.getClientRects().length > 0);
          const nuevo = indiceDeMenu(e.key, lista.indexOf(document.activeElement as HTMLElement), lista.length);
          if (nuevo !== null) { e.preventDefault(); e.stopPropagation(); lista[nuevo]?.focus(); }
        }}>
          <MenuList etiqueta="Guía">
            <FilaRecorrido alElegir={cerrar} />
            {primeros && (
              <Link role="menuitem" tabIndex={-1} href={`${HREF_PRIMEROS_PASOS}${sufijo}`} className="rv-menu__item" onClick={cerrar}>
                <span className="rv-menu__icono" aria-hidden><ListChecks width={16} height={16} strokeWidth={1.75} /></span>
                <span>Primeros pasos</span>
              </Link>
            )}
            {ayuda && (
              <Link role="menuitem" tabIndex={-1} href={`${HREF_AYUDA}${sufijo}`} className="rv-menu__item" onClick={cerrar}>
                <span className="rv-menu__icono" aria-hidden><LifeBuoy width={16} height={16} strokeWidth={1.75} /></span>
                <span>Centro de ayuda</span>
              </Link>
            )}
          </MenuList>
        </div>
      </Popover>
    </div>
  );
}

/** «Recorrido» / «Reanudar recorrido»: la forma de abrirlo desde cualquier pantalla; sin motor de recorrido (v2 sin perfil) no existe. */
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
    <button type="button" role="menuitem" tabIndex={-1} className="rv-menu__item" onClick={() => { alElegir(); if (enCurso) tour.reanudar('dueno'); else tour.reiniciar('dueno'); }}>
      <span className="rv-menu__icono" aria-hidden>{enCurso ? <RotateCcw width={16} height={16} strokeWidth={1.75} /> : <Play width={16} height={16} strokeWidth={1.75} />}</span>
      <span>{enCurso ? 'Reanudar recorrido' : 'Recorrido'}</span>
    </button>
  );
}
