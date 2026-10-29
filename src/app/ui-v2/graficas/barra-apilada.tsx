import type { Matiz } from '../metricas';

export interface Tramo { etiqueta: string; valor: number | null; /** parcial = trama 45° (dato incompleto) */ parcial?: boolean }

/** Barra apilada de UN matiz: pista 8 px o segmentos de 6 px con hueco de 2. Los tramos con valor nulo no se
 *  pintan (no son 0) y salen «—» en la leyenda. El valor impreso acompaña a cada tono (color no es la única señal). */
export function BarraApilada({ tramos, matiz = 8, etiqueta, segmentada = false, formato = (v) => String(v), leyenda = true }: {
  tramos: readonly Tramo[];
  matiz?: Matiz;
  etiqueta: string;
  segmentada?: boolean;
  formato?: (v: number) => string;
  leyenda?: boolean;
}) {
  const total = tramos.reduce((s, t) => s + (t.valor ?? 0), 0);
  return (
    <figure className="rv-gr rv-apilada" data-matiz={matiz} data-segmentada={segmentada || undefined} aria-label={etiqueta}>
      <div className="rv-apilada__pista" role="img" aria-label={etiqueta}>
        {total > 0 ? tramos.map((t, i) => (t.valor && t.valor > 0 ? (
          <span key={t.etiqueta} className={`rv-apilada__tramo rv-tono-${Math.min(i, 4)}`} data-parcial={t.parcial || undefined}
            style={{ flexGrow: t.valor }} title={`${t.etiqueta}: ${formato(t.valor)}`} />
        ) : null)) : <span className="rv-apilada__vacio" />}
      </div>
      {leyenda ? (
        <ul className="rv-apilada__leyenda">
          {tramos.map((t, i) => (
            <li key={t.etiqueta}><i className={`rv-dona__marca rv-tono-${Math.min(i, 4)}`} aria-hidden="true" />{t.etiqueta} <b>{t.valor === null ? '—' : formato(t.valor)}</b></li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
