import type { Matiz } from '../metricas';

/** Bullet: pista de 8 px, relleno hasta `valor`, marca de 2 px en `meta`. valor null ⇒ pista discontinua y «—»
 *  (no 0). Cifra impresa siempre. */
export function Bullet({ valor, meta, maximo, matiz = 8, etiqueta, formato = (v) => String(v), compacto = false }: {
  valor: number | null;
  meta?: number;
  maximo?: number;
  matiz?: Matiz;
  etiqueta: string;
  formato?: (v: number) => string;
  /** En celda de tabla: pista y valor en una fila; la etiqueta queda solo para lectores de pantalla. */
  compacto?: boolean;
}) {
  const tope = maximo ?? Math.max(valor ?? 0, meta ?? 0, 1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / tope) * 100))}%`;
  return (
    <div className="rv-gr rv-bullet" data-matiz={matiz} data-compacto={compacto || undefined} role="meter" aria-label={etiqueta}
      aria-valuemin={0} aria-valuemax={tope} aria-valuenow={valor ?? undefined}
      aria-valuetext={valor === null ? 'Sin dato' : `${formato(valor)}${meta !== undefined ? ` de meta ${formato(meta)}` : ''}`}>
      <span className={compacto ? 'rv-sr' : 'rv-bullet__etq'}>{etiqueta}</span>
      <span className="rv-bullet__pista" data-vacio={valor === null || undefined}>
        {valor !== null ? <span className="rv-bullet__relleno" style={{ width: pct(valor) }} /> : null}
        {meta !== undefined ? <span className="rv-bullet__meta" style={{ left: pct(meta) }} /> : null}
      </span>
      <span className="rv-bullet__val">{valor === null ? '—' : formato(valor)}</span>
    </div>
  );
}
