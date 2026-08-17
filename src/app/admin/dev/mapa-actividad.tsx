'use client';

import { useState } from 'react';

/**
 * El mapa de puntos INTERACTIVO (orden del 17-ago): clic en un día → fecha y
 * pushes de ESE día, dicho abajo con todas sus letras. Cliente solo por el
 * clic — los datos llegan del servidor ya resueltos.
 */
export function MapaActividad({ semanas, total }: {
  semanas: Array<{ inicio: number; dias: number[] }>;
  total: number;
}) {
  const [dia, setDia] = useState<{ fecha: string; n: number } | null>(null);
  const tope = Math.max(1, ...semanas.flatMap((s) => s.dias));
  const fechaDe = (ms: number) => new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(ms));
  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto pb-1">
        {semanas.map((sem) => (
          <div key={sem.inicio} className="flex flex-col gap-[3px]">
            {sem.dias.map((n, di) => {
              const fecha = fechaDe(sem.inicio + di * 86_400_000);
              const activo = dia?.fecha === fecha;
              return (
                <button key={di} type="button" title={`${n} push${n === 1 ? '' : 'es'} · ${fecha}`}
                  onClick={() => setDia({ fecha, n })}
                  className="w-[11px] h-[11px] rounded-[3px] transition-transform hover:scale-125"
                  style={{
                    background: n === 0
                      ? 'color-mix(in srgb, var(--muted) 14%, transparent)'
                      : `color-mix(in srgb, var(--marca) ${Math.round(25 + (n / tope) * 75)}%, transparent)`,
                    outline: activo ? '1.5px solid var(--marca)' : undefined,
                    outlineOffset: 1,
                  }} />
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
        {dia
          ? <><b className="tabular" style={{ color: 'var(--ink)' }}>{dia.n} push{dia.n === 1 ? '' : 'es'}</b> · {dia.fecha}</>
          : <>{total} commits en 52 semanas (se enseñan 26) · un punto = un día · toca un cuadro para ver su fecha y sus pushes.</>}
      </p>
    </div>
  );
}
