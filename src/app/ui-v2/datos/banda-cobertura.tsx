import { AlertTriangle } from 'lucide-react';
import { cx } from '../componentes/clases';
import { textoUi } from '../componentes/texto-ui';
import type { Idioma } from '@/lib/i18n/idioma';

export interface FuenteCobertura {
  nombre: string;
  /** ok = se leyó; fallo = no se pudo leer (se muestra, nunca se esconde); sin_datos = se leyó y no trajo nada. */
  estado: 'ok' | 'fallo' | 'sin_datos';
  /** Por qué falló, en una frase (opcional). */
  motivo?: string;
}

/** «Fuentes 5 de 7»: cuántas se leyeron de las que hay, con los FALLOS a la vista (nombre y motivo). Una fuente caída jamás se
 *  cuenta como cero: el total que dependa de ella se lee con este «n de N» al lado. Sin fuentes, no pinta nada. */
export function BandaCobertura({ fuentes, etiqueta: etiquetaProp, className, idioma }: { fuentes: readonly FuenteCobertura[]; etiqueta?: string; className?: string; idioma?: Idioma }) {
  if (fuentes.length === 0) return null;
  const t = textoUi(idioma);
  const etiqueta = etiquetaProp ?? t('banda.etiqueta');
  const leidas = fuentes.filter((f) => f.estado !== 'fallo').length;
  const fallos = fuentes.filter((f) => f.estado === 'fallo');
  const completa = fallos.length === 0;
  return (
    <div className={cx('rv-cobertura', className)} data-completa={completa || undefined} role="status">
      <p className="rv-cobertura__cuenta">
        {!completa ? <AlertTriangle width={14} height={14} strokeWidth={2} aria-hidden="true" /> : null}
        <span>{etiqueta} <strong>{t('banda.n_de', { leidas, total: fuentes.length })}</strong>{' '}{t(completa ? 'banda.leidas' : 'banda.leidas_faltan')}</span>
      </p>
      <ul className="rv-cobertura__lista" aria-label={t('banda.estado_de', { etiqueta: etiqueta.toLowerCase() })}>
        {fuentes.map((f) => (
          <li key={f.nombre} className="rv-cobertura__fuente" data-estado={f.estado}>
            <i className="rv-cobertura__punto" aria-hidden="true" />
            <span>{f.nombre}</span>
            <span className="rv-cobertura__estado">
              {f.estado === 'ok' ? t('banda.leida') : f.estado === 'sin_datos' ? t('banda.sin_datos') : f.motivo ? t('banda.fallo_motivo', { motivo: f.motivo }) : t('banda.fallo')}
            </span>
          </li>
        ))}
      </ul>
      {!completa ? <p className="rv-cobertura__nota">{t(fallos.length === 1 ? 'banda.nota_una' : 'banda.nota_varias')}</p> : null}
    </div>
  );
}
