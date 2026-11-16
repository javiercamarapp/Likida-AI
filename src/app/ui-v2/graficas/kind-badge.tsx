import { Calculator, Check, Link2, Minus, TrendingUp } from 'lucide-react';
import { cx } from '../componentes/clases';

// Modelo epistémico del dato (PLAN §2.4; regla del repo: nunca inventar una cifra).
// Icono + patrón de borde + texto: JAMÁS solo color.
//   observado  = SILENCIOSO: punto de 6 px + texto muted, sin borde (registrado en la fuente)
//   estimado   = borde discontinuo (calculado con un supuesto declarado)
//   inferido   = borde punteado (deducido de otros datos)
//   calculado  = borde sólido con icono (resultado de una fórmula sobre datos registrados; sello «Clase de dato» del ⓘ)
//   sin_dato   = punteado vacío (no hay dato; NO es cero)
export type TipoDato = 'observado' | 'calculado' | 'estimado' | 'inferido' | 'sin_dato';

export const ROTULO_DATO: Record<TipoDato, { texto: string; ayuda: string }> = {
  observado: { texto: 'Observado', ayuda: 'Registrado en la fuente.' },
  calculado: { texto: 'Calculado', ayuda: 'Resultado de una fórmula sobre datos registrados en la fuente.' },
  estimado: { texto: 'Estimado', ayuda: 'Calculado con un supuesto que está a la vista.' },
  inferido: { texto: 'Inferido', ayuda: 'Deducido de otros datos; no se midió directo.' },
  sin_dato: { texto: 'Sin dato', ayuda: 'Todavía no hay dato. No es cero.' },
};
/** Rótulos en inglés (US) del sello; el español es el de `ROTULO_DATO`. */
export const ROTULO_DATO_EN: Record<TipoDato, { texto: string; ayuda: string }> = {
  observado: { texto: 'Observed', ayuda: 'Recorded at the source.' },
  calculado: { texto: 'Calculated', ayuda: 'Result of a formula over data recorded at the source.' },
  estimado: { texto: 'Estimated', ayuda: 'Calculated with an assumption that is shown openly.' },
  inferido: { texto: 'Inferred', ayuda: 'Deduced from other data; not measured directly.' },
  sin_dato: { texto: 'No data', ayuda: 'There is no data yet. It is not zero.' },
};
const ICONO = { observado: Check, calculado: Calculator, estimado: TrendingUp, inferido: Link2, sin_dato: Minus } as const;

export function KindBadge({ tipo, className, idioma }: { tipo: TipoDato; className?: string; idioma?: 'es' | 'en' }) {
  const Icono = ICONO[tipo];
  const r = (idioma === 'en' ? ROTULO_DATO_EN : ROTULO_DATO)[tipo];
  return (
    <span className={cx('rv-kind', className)} data-tipo={tipo} title={r.ayuda}>
      {tipo === 'observado' ? <i className="rv-kind__punto" aria-hidden="true" /> : <Icono width={12} height={12} strokeWidth={2.2} aria-hidden="true" />}
      {r.texto}
    </span>
  );
}
