'use client';

import { Info } from 'lucide-react';
import { useId, useRef, useSyncExternalStore } from 'react';
import { INFO, infoDe, type InfoClave } from '../info-catalogo';
import { useMovil } from './movil';
import { Drawer, Popover } from './overlay';

// ═══════════════════════════════════════════════════════════════════════════
// InfoTip (ⓘ): botón de 24 px (toque 44) en la esquina del encabezado de cada recuadro. Abre una explicación
// UNIFICADA (Qué es · Cómo se calcula · Fuente y corte · Qué hacer): popover anclado de ≤280 px en escritorio,
// hoja inferior en móvil. UN SOLO ⓘ abierto a la vez en toda la página (almacén de módulo). Foco, Esc y
// aria-describedby: el botón apunta al panel mientras está abierto.
// ═══════════════════════════════════════════════════════════════════════════

let abiertoId: string | null = null;
const oyentes = new Set<() => void>();
const poner = (id: string | null) => { abiertoId = id; oyentes.forEach((f) => f()); };
const suscribir = (f: () => void) => { oyentes.add(f); return () => { oyentes.delete(f); }; };
const useAbierto = (id: string) => useSyncExternalStore(suscribir, () => abiertoId === id, () => false);

function Contenido({ clave }: { clave: InfoClave }) {
  const t = infoDe(clave);
  return (
    <dl className="rv-infotexto">
      <div><dt>Qué es</dt><dd>{t.queEs}</dd></div>
      <div><dt>Cómo se calcula</dt><dd>{t.comoSeCalcula}</dd></div>
      <div><dt>Fuente y corte</dt><dd>{t.fuente}</dd></div>
      {t.queHacer ? <div><dt>Qué hacer con esto</dt><dd>{t.queHacer}</dd></div> : null}
    </dl>
  );
}

export function InfoTip({ clave }: { clave: InfoClave }) {
  const id = useId();
  const idPanel = `${id}-info`;
  const ancla = useRef<HTMLButtonElement>(null);
  const abierto = useAbierto(id);
  const movil = useMovil();
  const t = INFO[clave];
  const cerrar = () => { if (abiertoId === id) poner(null); };
  return (
    <>
      <button
        ref={ancla} type="button" className="rv-info" aria-label={`Información: ${t.titulo}`}
        aria-haspopup="true" aria-expanded={abierto} aria-describedby={abierto && !movil ? idPanel : undefined}
        onClick={() => poner(abierto ? null : id)}
      >
        <Info aria-hidden="true" strokeWidth={1.75} />
      </button>
      {movil ? (
        <Drawer abierto={abierto} onCerrar={cerrar} titulo={t.titulo}><Contenido clave={clave} /></Drawer>
      ) : (
        <Popover abierto={abierto} onCerrar={cerrar} ancla={ancla} etiqueta={`Información: ${t.titulo}`} alineacion="inicio" className="rv-pop--info" id={idPanel}>
          <p className="rv-infotexto__titulo">{t.titulo}</p>
          <Contenido clave={clave} />
        </Popover>
      )}
    </>
  );
}
