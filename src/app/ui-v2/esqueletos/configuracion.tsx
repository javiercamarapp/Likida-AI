import type { ReactNode } from 'react';
import { Chip, MarcoPagina, type TonoChip } from '../componentes';
import { BloqueAvisos, type PropsMarcoEsqueleto } from './comunes';

/** Una fila «rótulo + ayuda | control» de una sección (Rovaq `/settings/team`, `/setup`): rótulo 14/600, ayuda 12 apagada a la izquierda y el
 *  control (campo de 32, interruptor, botón) a la derecha, con divisor de 1 px entre filas. En móvil el control baja bajo el rótulo. */
export function FilaConfig({ rotulo, ayuda, idRotulo, children }: { rotulo: string; ayuda?: string; idRotulo?: string; children?: ReactNode }) {
  return (
    <div className="rv-esq__fila" role="group" aria-labelledby={idRotulo}>
      <div>
        <p className="rv-esq__fila-rotulo" id={idRotulo}>{rotulo}</p>
        {ayuda ? <p className="rv-esq__fila-ayuda">{ayuda}</p> : null}
      </div>
      <div className="rv-esq__fila-control">{children}</div>
    </div>
  );
}

export interface SeccionConfig {
  id: string;
  titulo: string;
  descripcion?: string;
  /** Chip de estado de la sección o del paso («Para revisar», «Hecho»). */
  estado?: { texto: string; tono?: TonoChip };
  /** Las filas (`FilaConfig`) o cualquier contenido de la sección. */
  contenido: ReactNode;
  /** Pie con la acción de ESTA sección (una primaria suave, o un secundario). */
  pie?: ReactNode;
  /** Solo en `variante="pasos"`: el paso que toca hacer ahora (borde en tinta). */
  actual?: boolean;
  /** Solo en `variante="pasos"`: «Quién puede hacerlo» y «qué se pide». */
  quien?: string;
}

/** CONFIGURACIÓN POR SECCIONES (Rovaq `/setup`, Equipo, Retención, Entrega de avisos). Orden:
 *   cabecera SIN eyebrow → aviso gris de contexto (`contexto`) → progreso («3 de 6 que puedes hacer ahora») → SECCIONES en una columna de
 *   ≤780 px, cada una una tarjeta con su título 14/600, chip de estado, filas rótulo-control y UNA acción en su pie.
 *  `variante="secciones"` (por omisión) son tarjetas de formulario; `variante="pasos"` son tarjetas de paso (el actual con borde en tinta,
 *  «Quién puede hacerlo») para onboarding, importaciones y flujos guiados. */
export function EsqueletoConfiguracion({ contexto, avisos, progreso, secciones, variante = 'secciones', ...marco }: PropsMarcoEsqueleto & {
  /** Aviso gris «Estás viendo la configuración como: …». */
  contexto?: ReactNode;
  avisos?: ReactNode;
  progreso?: { hechos: number; total: number; etiqueta: string };
  secciones: readonly SeccionConfig[];
  variante?: 'secciones' | 'pasos';
}) {
  return (
    <MarcoPagina className="rv-esq rv-esq--config" ancho="lectura" {...marco}>
      {contexto}
      <BloqueAvisos>{avisos}</BloqueAvisos>
      {progreso ? (
        <div className="rv-esq__progreso">
          <progress max={progreso.total} value={progreso.hechos} aria-label={progreso.etiqueta} />
          <span>{progreso.etiqueta}</span>
        </div>
      ) : null}
      <div className="rv-esq__cfg">
        {secciones.map((s) => {
          const idT = `esq-cfg-${s.id}`;
          if (variante === 'pasos') {
            return (
              <section key={s.id} className="rv-esq__paso" data-actual={s.actual || undefined} aria-labelledby={idT} aria-current={s.actual ? 'step' : undefined}>
                <div className="rv-esq__paso-cab">
                  <h2 id={idT}>{s.titulo}</h2>
                  {s.estado ? <Chip tono={s.estado.tono ?? 'neutral'} tamano="estado">{s.estado.texto}</Chip> : null}
                </div>
                {s.quien ? <p className="rv-esq__paso-quien">{s.quien}</p> : null}
                {s.descripcion ? <p className="rv-esq__fila-ayuda">{s.descripcion}</p> : null}
                {s.contenido}
                {s.pie ? <div className="rv-esq__paso-acciones">{s.pie}</div> : null}
              </section>
            );
          }
          return (
            <section key={s.id} className="rv-tarjeta" aria-labelledby={idT}>
              <header className="rv-tarjeta__cab">
                <h2 id={idT} className="rv-tarjeta__titulo">{s.titulo}</h2>
                {s.estado ? <div className="rv-tarjeta__acciones"><Chip tono={s.estado.tono ?? 'neutral'} tamano="estado">{s.estado.texto}</Chip></div> : null}
              </header>
              <div className="rv-tarjeta__cuerpo">
                {s.descripcion ? <p className="rv-esq__fila-ayuda">{s.descripcion}</p> : null}
                {s.contenido}
                {s.pie ? <div className="rv-esq__seccion-pie">{s.pie}</div> : null}
              </div>
            </section>
          );
        })}
      </div>
    </MarcoPagina>
  );
}
