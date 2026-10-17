import type { ResultadoComposicion } from '@/lib/likida/insights/componer';
import { EsqTarjeta } from '../../bloque';
import { TarjetaInsight } from './tarjeta-insight';

// T-INS-03 — Panel de insights con sus cuatro estados: cargando, error, vacío y listo.
// Recibe el resultado ya compuesto por `componer()` (T-INS-02); no decide nada.

export const TEXTO_VACIO =
  'Aún no hay datos para interpretar. Cuando llegue el primer archivo, aquí verás qué pasó y qué hacer.';
export const TEXTO_ERROR =
  'No pudimos preparar la interpretación. Los datos de abajo siguen siendo correctos; vuelve a cargar la página en un momento.';

export type EstadoPanel =
  | { estado: 'cargando' }
  | { estado: 'error'; mensaje?: string }
  | { estado: 'listo'; resultado: ResultadoComposicion };

export function PanelInsights({ titulo = 'Qué pasó y qué hacer', ...props }: EstadoPanel & { titulo?: string }) {
  return (
    <section aria-label={titulo} className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
        {titulo}
      </h2>
      <Cuerpo {...props} />
    </section>
  );
}

function Cuerpo(p: EstadoPanel) {
  if (p.estado === 'cargando') {
    return (
      <div aria-busy="true">
        <EsqTarjeta alto={120} />
      </div>
    );
  }
  if (p.estado === 'error') {
    return (
      <div role="alert" className="card p-4 text-sm" style={{ color: 'var(--ink)', borderColor: 'var(--bad)' }}>
        <strong style={{ color: 'var(--bad)' }}>Algo falló. </strong>
        {p.mensaje ?? TEXTO_ERROR}
      </div>
    );
  }
  const { visibles, verMas, total } = p.resultado;
  if (total === 0) {
    return (
      <p className="card p-4 text-sm" style={{ color: 'var(--muted)' }} data-vacio>
        {TEXTO_VACIO}
      </p>
    );
  }
  return (
    <>
      <ul className="space-y-2 list-none p-0">
        {visibles.map((i) => (
          <li key={i.id}>
            <TarjetaInsight insight={i} />
          </li>
        ))}
      </ul>
      {verMas.length > 0 && (
        <details>
          <summary className="text-xs font-medium cursor-pointer" style={{ color: 'var(--ink)' }}>
            Ver más ({verMas.length})
          </summary>
          <ul className="space-y-2 list-none p-0 mt-2">
            {verMas.map((i) => (
              <li key={i.id}>
                <TarjetaInsight insight={i} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
