import { TEXTO_BANDA, type Origen } from '@/lib/likida/insights/origen_datos';

// T-INS-06 — Banda superior fija cuando lo que se ve no es de la operación real.
// Se dice con PALABRAS (no solo color); con origen real no pinta nada.

export function BandaOrigen({ origen }: { origen: Origen }) {
  if (origen === 'real') return null;
  return (
    <div
      role="status"
      data-banda-origen={origen}
      className="sticky top-0 z-10 px-4 py-2 text-sm font-medium"
      style={{ color: 'var(--ink)', background: 'var(--warnbg)', borderBottom: '1px solid var(--warn)' }}
    >
      {TEXTO_BANDA[origen]}
    </div>
  );
}
