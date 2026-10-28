import { Check, Link2, Minus, TrendingUp } from 'lucide-react';
import { cx } from '../componentes/clases';

// Modelo epistémico del dato (PLAN §2.4; regla del repo: nunca inventar una cifra).
// Icono + patrón de borde + texto: JAMÁS solo color.
//   observado  = borde sólido (registrado en la fuente)
//   estimado   = borde discontinuo (calculado con un supuesto declarado)
//   inferido   = borde punteado (deducido de otros datos)
//   sin_dato   = punteado vacío (no hay dato; NO es cero)
export type TipoDato = 'observado' | 'estimado' | 'inferido' | 'sin_dato';

export const ROTULO_DATO: Record<TipoDato, { texto: string; ayuda: string }> = {
  observado: { texto: 'Observado', ayuda: 'Registrado en la fuente.' },
  estimado: { texto: 'Estimado', ayuda: 'Calculado con un supuesto que está a la vista.' },
  inferido: { texto: 'Inferido', ayuda: 'Deducido de otros datos; no se midió directo.' },
  sin_dato: { texto: 'Sin dato', ayuda: 'Todavía no hay dato. No es cero.' },
};
const ICONO = { observado: Check, estimado: TrendingUp, inferido: Link2, sin_dato: Minus } as const;

export function KindBadge({ tipo, className }: { tipo: TipoDato; className?: string }) {
  const Icono = ICONO[tipo];
  const r = ROTULO_DATO[tipo];
  return (
    <span className={cx('rv-kind', className)} data-tipo={tipo} title={r.ayuda}>
      <Icono width={12} height={12} strokeWidth={2.2} aria-hidden="true" />
      {r.texto}
    </span>
  );
}
