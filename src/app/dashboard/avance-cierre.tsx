'use client';

import { useMemo, useState } from 'react';
import type { ViajeRow } from '@/lib/cuadra/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AVANCE DE CIERRE — cuánto de lo que se abrió ya cerró, por periodo.
//
// Por qué ESTA métrica y no una de dinero: esta barra vive en /dashboard, que
// el ENCARGADO también ve (visibilidad.ts). Una barra de pesos ahí sería una
// fuga por la puerta de atrás — el jefe de tráfico no ve finanzas. Ésta es
// puramente operativa: viajes liquidados contra viajes iniciados en el
// periodo, que además es la pregunta que el operador se hace en la mañana
// ("¿voy al corriente o se me está acumulando?").
//
// Se calcula en el cliente sobre los viajes que la página ya trajo, no con
// una consulta por pestaña: cambiar de semana a mes es instantáneo y no
// cuesta un viaje al servidor por clic.
// ═══════════════════════════════════════════════════════════════════════════

type Periodo = 'semana' | 'mes' | 'todo';

const PERIODOS: Array<{ id: Periodo; label: string; dias: number | null }> = [
  { id: 'semana', label: 'Semana', dias: 7 },
  { id: 'mes', label: 'Mes', dias: 30 },
  { id: 'todo', label: 'Todo', dias: null },
];

/**
 * `ahoraMs` lo manda el SERVIDOR (`ahoraMs()` de lib/saludo). Leer el reloj
 * aquí sería impuro —el componente puede re-renderizar y clasificar distinto—
 * y además el reloj del navegador no coincide con el del servidor, así que el
 * HTML servido y el primer render del cliente podrían meter un viaje en
 * periodos distintos y React reportaría desajuste de hidratación.
 */
export default function AvanceCierre({ viajes, ahoraMs }: { viajes: ViajeRow[]; ahoraMs: number }) {
  const [periodo, setPeriodo] = useState<Periodo>('mes');

  const datos = useMemo(() => {
    const cfg = PERIODOS.find((p) => p.id === periodo)!;
    const corte = cfg.dias === null ? null : ahoraMs - cfg.dias * 86_400_000;

    // Un viaje SIN fecha de inicio no se puede ubicar en un periodo. No se
    // cuenta ni como dentro ni como fuera: se reporta aparte, porque meterlo
    // en el total movería el porcentaje sin que nadie sepa por qué.
    let dentro = 0, cerrados = 0, sinFecha = 0;
    for (const v of viajes) {
      if (!v.fechaInicio) { sinFecha += 1; continue; }
      const t = Date.parse(v.fechaInicio);
      if (Number.isNaN(t)) { sinFecha += 1; continue; }
      if (corte !== null && t < corte) continue;
      dentro += 1;
      if (v.estatus === 'liquidado') cerrados += 1;
    }
    return { dentro, cerrados, sinFecha, pct: dentro === 0 ? null : Math.round((cerrados / dentro) * 100) };
  }, [viajes, periodo, ahoraMs]);

  return (
    <div className="mt-2.5 max-w-md">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Avance de cierre
          </span>
          {/* Sin viajes en el periodo NO se pinta 0%: un 0% se lee como "no
              has cerrado nada", que es una acusación. Se dice que no hubo. */}
          {datos.pct !== null && (
            <span className="text-sm font-semibold tabular">{datos.pct}%</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {PERIODOS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriodo(p.id)}
              aria-pressed={periodo === p.id}
              className="text-[11px] font-medium px-2 py-1 rounded-full transition-colors"
              style={periodo === p.id
                ? { background: 'var(--marca)', color: 'var(--marca-fg)' }
                : { color: 'var(--muted)', border: '1px solid var(--line)' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
        <div
          className="h-full rounded-full motion-reduce:transition-none"
          style={{
            width: `${datos.pct ?? 0}%`,
            background: 'var(--marca)',
            transition: 'width 620ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>

      <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
        {datos.dentro === 0
          ? 'No hay viajes iniciados en este periodo.'
          : `${datos.cerrados} de ${datos.dentro} viaje${datos.dentro === 1 ? '' : 's'} iniciado${datos.dentro === 1 ? '' : 's'} ya está${datos.cerrados === 1 ? '' : 'n'} liquidado${datos.cerrados === 1 ? '' : 's'}.`}
        {datos.sinFecha > 0 && ` ${datos.sinFecha} sin fecha de inicio, fuera del cálculo.`}
      </p>
    </div>
  );
}
