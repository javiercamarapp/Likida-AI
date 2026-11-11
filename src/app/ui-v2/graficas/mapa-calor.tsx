'use client';

import type { Matiz } from '../metricas';
import { TablaGrafica } from './partes';
import { resolverFormato, type FormatoGrafica } from './formatos';
import { useT } from '@/lib/i18n/proveedor';
import { graficas as graficasEs } from '@/lib/i18n/es/graficas';

export interface FilaMapaCalor {
  etiqueta: string;
  /** Una celda por columna; null ⇒ sin dato (s/d con trama), nunca un cero ni el nivel más bajo. */
  valores: ReadonlyArray<number | null>;
}

/** Niveles de intensidad: 0 = el valor es cero, 1..4 = cuartiles del máximo. El color solo ayuda; la cifra va en el `title` de cada celda,
 *  impresa si `mostrarValores` y SIEMPRE en «Ver como tabla». */
export function nivelCalor(valor: number | null, max: number): 0 | 1 | 2 | 3 | 4 | null {
  if (valor === null || !Number.isFinite(valor)) return null;
  if (valor <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((valor / max) * 4))) as 1 | 2 | 3 | 4;
}

/** Mapa de calor (Rovaq) de UN matiz: filas × columnas, 5 pasos de intensidad. Las celdas sin dato llevan trama y «s/d» en el título. */
export function MapaCalor({ columnas, filas, matiz = 8, etiqueta, formato: formatoProp, mostrarValores = false }: {
  columnas: readonly string[];
  filas: readonly FilaMapaCalor[];
  matiz?: Matiz;
  etiqueta: string;
  /** Un id serializable (`'numero'`, `'usd'`…) desde un componente de servidor; una función solo desde otro componente de cliente. */
  formato?: FormatoGrafica;
  mostrarValores?: boolean;
}) {
  const { t } = useT('graficas', graficasEs);
  const formato = resolverFormato(formatoProp);
  const max = Math.max(0, ...filas.flatMap((f) => f.valores.map((v) => v ?? 0)));
  const hayDato = filas.some((f) => f.valores.some((v) => v !== null));
  if (!hayDato || filas.length === 0) {
    return <figure className="rv-gr rv-calor" data-matiz={matiz} data-vacio aria-label={etiqueta}><p className="rv-calor__vacio">{t('vacio')}</p></figure>;
  }
  return (
    <figure className="rv-gr rv-calor" data-matiz={matiz} aria-label={etiqueta}>
      <div className="rv-calor__rejilla" role="img" aria-label={etiqueta} style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${columnas.length}, minmax(0, 1fr))` }}>
        <span className="rv-calor__esquina" aria-hidden="true" />
        {columnas.map((c) => <span key={c} className="rv-calor__col" aria-hidden="true">{c}</span>)}
        {filas.map((f) => (
          <div key={f.etiqueta} className="rv-calor__fila" aria-hidden="true">
            <span className="rv-calor__fila-etq">{f.etiqueta}</span>
            {columnas.map((c, j) => {
              const v = f.valores[j] ?? null;
              const n = nivelCalor(v, max);
              return (
                <span key={c} className="rv-calor__celda" data-nivel={n ?? undefined} data-sd={n === null || undefined}
                  title={`${f.etiqueta} · ${c}: ${v === null ? 's/d' : formato(v)}`}>
                  {mostrarValores ? (v === null ? 's/d' : formato(v)) : null}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <ul className="rv-calor__escala" aria-hidden="true">
        <li>{t('calor.menos')}</li>{[0, 1, 2, 3, 4].map((n) => <li key={n}><i className="rv-calor__celda" data-nivel={n} /></li>)}<li>{t('calor.mas')}</li>
      </ul>
      <TablaGrafica titulo={etiqueta} primera={t('calor.fila')} encabezados={columnas}
        filas={filas.map((f) => ({ rotulo: f.etiqueta, celdas: columnas.map((_, j) => (f.valores[j] ?? null) === null ? '—' : formato(f.valores[j] as number)) }))} />
    </figure>
  );
}
