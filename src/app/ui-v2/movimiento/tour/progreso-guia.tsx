// Anillo de avance de la Guía: «n de N» pasos MEDIDOS (los confirmados por la persona no cuentan; SPEC 2.6). Con rol de barra de
// progreso y nombre accesible; el número va en texto, el anillo es refuerzo visual. El trazo usa atributos SVG (no estilos en línea).
export function ProgresoGuia({ hechos, total, etiqueta = 'Avance de la guía', tamano = 36 }: { hechos: number; total: number; etiqueta?: string; tamano?: number }) {
  const t = Math.max(0, Math.floor(total));
  const h = Math.min(Math.max(0, Math.floor(hechos)), t);
  const pct = t === 0 ? 0 : Math.round((h / t) * 100);
  return (
    <span className="rv-onb-anillo" role="progressbar" aria-valuemin={0} aria-valuemax={t} aria-valuenow={h} aria-valuetext={`${h} de ${t}`} aria-label={etiqueta} data-completo={t > 0 && h === t ? '' : undefined}>
      <svg width={tamano} height={tamano} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
        <circle className="rv-onb-anillo__pista" cx="18" cy="18" r="15.9155" pathLength={100} />
        <circle className="rv-onb-anillo__valor" cx="18" cy="18" r="15.9155" pathLength={100} strokeDasharray={`${pct} ${100 - pct}`} transform="rotate(-90 18 18)" />
      </svg>
      <span className="rv-onb-anillo__n">{h}<span aria-hidden="true">/</span><span className="rv-sr">{' de '}</span>{t}</span>
    </span>
  );
}
