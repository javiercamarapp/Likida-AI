'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { BellOff, CircleHelp, Compass, LifeBuoy, ListChecks, MapPinned, Play, RotateCcw, Zap } from 'lucide-react';
import type { PerfilTenant } from '@/lib/auth/visibilidad';
import { Popover, MenuList } from '../../ui-v2/componentes/overlay';
import { useTourOpcional, useProgresoTour } from '../../ui-v2/movimiento/tour';
import { hrefsDelMenu } from './menu-por-perfil';
import { useMenuV2 } from './navegacion-v2';
import { indiceDeMenu } from './nav-utiles';

const HREF_AYUDA = '/dashboard/soporte';

/**
 * El botón «Guía» y su menú: Recorrido corto · Recorrido completo (o Retomar) · Saltar a una pantalla · recorridos por agente ·
 * Primeros pasos · Centro de ayuda · No volver a mostrar. Vive en la topbar de escritorio (con texto) y en la cabecera móvil (solo
 * icono, 44 px). Solo ofrece lo que existe y el rol puede abrir; una entrada vacía no se pinta, y sin ninguna fila el botón no existe.
 */
export default function MenuGuia({ rol, perfil, compacto = false }: { rol: string; perfil?: PerfilTenant | null; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const gatillo = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const { sufijo, menu } = useMenuV2(rol, perfil);
  const hrefs = hrefsDelMenu(menu);
  const cerrar = () => setAbierto(false);
  const tour = useTourOpcional();
  const asistente = tour?.asistente && hrefs.includes(tour.asistente.href) ? tour.asistente : null;
  const ayuda = hrefs.includes(HREF_AYUDA);
  const hayRecorrido = Boolean(tour?.principal && tour.existe(`${tour.principal}.completo`));
  // Sin ninguna fila que ofrecer (p. ej. un rol sin recorrido ni asistente ni ayuda) el botón no existe: un menú vacío miente.
  if (!(hayRecorrido || asistente || ayuda)) return null;
  return (
    <div className="rv-guia">
      <button ref={gatillo} type="button" className={compacto ? 'rv-icono-boton' : 'rv-guia__btn'} aria-haspopup="menu" aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined} aria-label={compacto ? 'Guía' : undefined} title="Guía" data-onboarding="recorrido.boton"
        onClick={() => setAbierto((a) => !a)}>
        <CircleHelp width={compacto ? 18 : 16} height={compacto ? 18 : 16} strokeWidth={1.75} aria-hidden />
        {!compacto && <span>Guía</span>}
        {tour?.nuevo ? <span className="rv-guia__punto" aria-hidden /> : null}
      </button>
      <Popover abierto={abierto} onCerrar={cerrar} ancla={gatillo} etiqueta="Guía" alineacion="fin">
        <div id={idMenu} onKeyDownCapture={(e) => {
          if (e.key === 'Tab') { cerrar(); return; }
          const lista = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((x) => x.getClientRects().length > 0);
          const nuevo = indiceDeMenu(e.key, lista.indexOf(document.activeElement as HTMLElement), lista.length);
          if (nuevo !== null) { e.preventDefault(); e.stopPropagation(); lista[nuevo]?.focus(); }
        }}>
          <MenuList etiqueta="Guía">
            {hayRecorrido ? <FilasRecorrido alElegir={cerrar} /> : null}
            {asistente && (
              <Link role="menuitem" tabIndex={-1} href={`${asistente.href}${sufijo}`} className="rv-menu__item" onClick={cerrar}>
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
            {hayRecorrido ? <FilaNoVolver alElegir={cerrar} /> : null}
          </MenuList>
        </div>
      </Popover>
    </div>
  );
}

function Fila({ icono, texto, onClick }: { icono: React.ReactNode; texto: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" tabIndex={-1} className="rv-menu__item" onClick={onClick}>
      <span className="rv-menu__icono" aria-hidden>{icono}</span>
      <span>{texto}</span>
    </button>
  );
}

/** Corto · Completo (o Retomar) · Saltar a una pantalla · un recorrido por agente. Cada grupo desaparece si no tiene filas. */
function FilasRecorrido({ alElegir }: { alElegir: () => void }) {
  const tour = useTourOpcional();
  const p = tour?.principal ?? '';
  const corto = useProgresoTour(`${p}.corto`);
  const completo = useProgresoTour(`${p}.completo`);
  if (!tour || !p) return null;
  const retoma = completo?.estado === 'en_curso' ? { id: `${p}.completo`, prog: completo } : corto?.estado === 'en_curso' ? { id: `${p}.corto`, prog: corto } : null;
  const hayCorto = tour.existe(`${p}.corto`);
  const pantallas = tour.pantallas(`${p}.completo`);
  const ir = (fn: () => void) => () => { alElegir(); fn(); };
  return (
    <>
      {retoma ? (
        <Fila icono={<RotateCcw width={16} height={16} strokeWidth={1.75} />} texto={`Retomar donde lo dejé (paso ${retoma.prog.indice + 1} de ${retoma.prog.total})`} onClick={ir(() => tour.reanudar(retoma.id))} />
      ) : null}
      {hayCorto ? <Fila icono={<Zap width={16} height={16} strokeWidth={1.75} />} texto="Recorrido corto" onClick={ir(() => tour.reiniciar(`${p}.corto`))} /> : null}
      <Fila icono={<Play width={16} height={16} strokeWidth={1.75} />} texto={retoma ? 'Repetir recorrido completo' : 'Recorrido completo'} onClick={ir(() => tour.reiniciar(`${p}.completo`))} />
      {pantallas.length > 0 ? (
        <>
          <p className="rv-guia-sub" id="rv-guia-pantallas">Saltar a una pantalla</p>
          <div className="rv-guia-pantallas" role="group" aria-labelledby="rv-guia-pantallas">
            {pantallas.map((s) => (
              <Fila key={s.href} icono={<MapPinned width={16} height={16} strokeWidth={1.75} />} texto={s.nombre} onClick={ir(() => tour.irAPantalla(`${p}.completo`, s.href))} />
            ))}
          </div>
        </>
      ) : null}
      {tour.agentes.length > 0 ? (
        <>
          <p className="rv-guia-sub">Recorrido por agente</p>
          {tour.agentes.map((a) => (
            <Fila key={a.id} icono={<Compass width={16} height={16} strokeWidth={1.75} />} texto={a.titulo.replace(/^Agente: /, '')} onClick={ir(() => tour.reiniciar(a.id))} />
          ))}
        </>
      ) : null}
    </>
  );
}

function FilaNoVolver({ alElegir }: { alElegir: () => void }) {
  const tour = useTourOpcional();
  if (!tour) return null;
  return <Fila icono={<BellOff width={16} height={16} strokeWidth={1.75} />} texto="No volver a mostrar invitaciones" onClick={() => { alElegir(); tour.noVolver(); }} />;
}
