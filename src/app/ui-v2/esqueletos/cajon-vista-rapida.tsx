'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Drawer } from '../componentes';
import '../esqueletos/esqueletos.css';

export interface CifraVistaRapida { etiqueta: string; valor: string }

/** CAJÓN DE VISTA RÁPIDA (Rovaq 06c): un solo cajón por pantalla, con el contenido de la fila elegida. La fila es un ENLACE (`?ver=<id>`),
 *  así que el servidor arma el contenido de esa fila y la URL manda: se puede compartir, funciona con «atrás» y el cajón nace abierto.
 *  Estructura: título + subtítulo («Grupo 1 de 12») → cuadrícula 2×2 de cifras → aviso → contenido → pie con la acción primaria
 *  («Abrir …»). Ancho 420 (`tamano="m"`; Rovaq usa 480, Likida unifica en 420/640, R8). Foco, Esc, fondo, hoja inferior en móvil y logo:
 *  los da `Drawer`. Al cerrar navega a `hrefCerrar` (la misma pantalla sin `ver`), sin recargar el scroll. */
export function CajonVistaRapida({ titulo, subtitulo, cifras, aviso, pie, hrefCerrar, children }: {
  titulo: string;
  subtitulo?: string;
  /** Exactamente cuatro (2×2). Sin dato: `valor="—"`, nunca 0. */
  cifras: readonly [CifraVistaRapida, CifraVistaRapida, CifraVistaRapida, CifraVistaRapida];
  /** Un `<Aviso>` informativo (p. ej. «La evidencia se verifica al abrir»). */
  aviso?: ReactNode;
  /** La acción primaria («Abrir problema»), a la derecha. */
  pie?: ReactNode;
  /** La URL de esta pantalla SIN el parámetro `ver`. */
  hrefCerrar: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  return (
    <Drawer abierto onCerrar={() => router.replace(hrefCerrar, { scroll: false })} titulo={titulo} descripcion={subtitulo} tamano="m" pie={pie ? <div className="rv-esq__vr-pie">{pie}</div> : undefined}>
      <div className="rv-esq__vr-cuerpo">
        <dl className="rv-esq__vr">
          {cifras.map((c) => (
            <div key={c.etiqueta}>
              <dt>{c.etiqueta}</dt>
              <dd>{c.valor}</dd>
            </div>
          ))}
        </dl>
        {aviso}
        {children}
      </div>
    </Drawer>
  );
}
