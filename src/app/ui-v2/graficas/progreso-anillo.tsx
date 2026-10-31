import type { ReactNode } from 'react';

/** Anillo de progreso. `valor` 0..100 o null (sin dato: pista rayada y «—»; NO
 *  se pinta como 0 %). pathLength=100 para que el arco sea en porcentaje exacto.
 *  El número va impreso al centro y en aria-valuenow: nunca solo el trazo. */
export function ProgresoAnillo({ valor, tamano = 72, grosor = 6, etiqueta, children }: {
  valor: number | null;
  tamano?: number;
  grosor?: number;
  /** Nombre accesible, p. ej. «Avance de la puesta en marcha». */
  etiqueta: string;
  /** Contenido al centro; por defecto el porcentaje. */
  children?: ReactNode;
}) {
  const sinDato = valor === null || !Number.isFinite(valor);
  const v = sinDato ? 0 : Math.min(100, Math.max(0, Math.round(valor)));
  const r = (tamano - grosor) / 2;
  const c = tamano / 2;
  return (
    <div className="rv-anillo" style={{ width: tamano, height: tamano }}
      role="progressbar" aria-label={etiqueta} aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={sinDato ? undefined : v} aria-valuetext={sinDato ? 'Sin dato' : `${v} %`}>
      <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} aria-hidden="true">
        <circle className={sinDato ? 'rv-anillo__pista rv-anillo__pista--vacia' : 'rv-anillo__pista'} cx={c} cy={c} r={r} fill="none" strokeWidth={grosor} />
        {!sinDato && v > 0 ? (
          <circle className="rv-anillo__arco" cx={c} cy={c} r={r} fill="none" strokeWidth={grosor} strokeLinecap="round"
            pathLength={100} strokeDasharray={`${v} 100`} transform={`rotate(-90 ${c} ${c})`} />
        ) : null}
      </svg>
      <span className="rv-anillo__centro">{children ?? (sinDato ? '—' : `${v}%`)}</span>
    </div>
  );
}
