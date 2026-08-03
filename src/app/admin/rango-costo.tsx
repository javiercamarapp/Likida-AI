'use client';

import { useState } from 'react';
import { AreaChartSimple } from './charts';
import { usd } from '@/lib/utils';

/** Real: recorta el arreglo `porDia` ya traído del servidor, sin refetch —
 *  no hay nada que inventar, solo cuántos días mostrar. */
export default function GraficaCostoConRango({ porDia }: { porDia: Array<{ dia: string; costoUsd: number }> }) {
  const [dias, setDias] = useState<7 | 30 | 0>(0); // 0 = todo

  const datos = (dias === 0 ? porDia : porDia.slice(-dias)).map((d) => ({ dia: d.dia, valor: d.costoUsd }));

  return (
    <div className="glass-panel p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Costo de IA en el tiempo
        </h2>
        <div className="flex items-center gap-1 text-xs rounded-lg hairline p-0.5">
          {([[7, '7d'], [30, '30d'], [0, 'Todo']] as const).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setDias(v)}
              className="px-2.5 py-1 rounded-md transition-colors"
              style={dias === v ? { background: 'var(--ink)', color: 'white' } : { color: 'var(--muted)' }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <AreaChartSimple datos={datos} etiquetaValor={usd} />
    </div>
  );
}
