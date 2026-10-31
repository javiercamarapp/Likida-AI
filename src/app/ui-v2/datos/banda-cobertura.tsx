import { AlertTriangle } from 'lucide-react';
import { cx } from '../componentes/clases';

export interface FuenteCobertura {
  nombre: string;
  /** ok = se leyó; fallo = no se pudo leer (se muestra, nunca se esconde); sin_datos = se leyó y no trajo nada. */
  estado: 'ok' | 'fallo' | 'sin_datos';
  /** Por qué falló, en una frase (opcional). */
  motivo?: string;
}

/** «Fuentes 5 de 7»: cuántas se leyeron de las que hay, con los FALLOS a la vista (nombre y motivo). Una fuente caída jamás se
 *  cuenta como cero: el total que dependa de ella se lee con este «n de N» al lado. Sin fuentes, no pinta nada. */
export function BandaCobertura({ fuentes, etiqueta = 'Fuentes', className }: { fuentes: readonly FuenteCobertura[]; etiqueta?: string; className?: string }) {
  if (fuentes.length === 0) return null;
  const leidas = fuentes.filter((f) => f.estado !== 'fallo').length;
  const fallos = fuentes.filter((f) => f.estado === 'fallo');
  const completa = fallos.length === 0;
  return (
    <div className={cx('rv-cobertura', className)} data-completa={completa || undefined} role="status">
      <p className="rv-cobertura__cuenta">
        {!completa ? <AlertTriangle width={14} height={14} strokeWidth={2} aria-hidden="true" /> : null}
        <span>{etiqueta} <strong>{leidas} de {fuentes.length}</strong>{completa ? ' leídas' : ' leídas; faltan datos'}</span>
      </p>
      <ul className="rv-cobertura__lista" aria-label={`Estado de ${etiqueta.toLowerCase()}`}>
        {fuentes.map((f) => (
          <li key={f.nombre} className="rv-cobertura__fuente" data-estado={f.estado}>
            <i className="rv-cobertura__punto" aria-hidden="true" />
            <span>{f.nombre}</span>
            <span className="rv-cobertura__estado">
              {f.estado === 'ok' ? 'leída' : f.estado === 'sin_datos' ? 'sin datos' : `no se pudo leer${f.motivo ? `: ${f.motivo}` : ''}`}
            </span>
          </li>
        ))}
      </ul>
      {!completa ? <p className="rv-cobertura__nota">Lo que dependa de {fallos.length === 1 ? 'esa fuente' : 'esas fuentes'} no está en las cifras. No es cero.</p> : null}
    </div>
  );
}
