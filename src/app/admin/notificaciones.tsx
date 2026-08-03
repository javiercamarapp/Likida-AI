'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell } from 'lucide-react';

export interface Alerta { tipo: 'ok' | 'atencion'; texto: string }

/**
 * Nada de contadores inventados ("14 items waiting"): las alertas las
 * calcula el servidor (page.tsx) a partir de datos reales — tendencia de
 * costo, conversaciones activas. Si no hay nada real que avisar, la
 * campana no trae número.
 */
export default function Notificaciones({ alertas }: { alertas: Alerta[] }) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fuera(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const hayAtencion = alertas.some((a) => a.tipo === 'atencion');

  return (
    <div className="relative shrink-0" ref={ref}>
      <button type="button" onClick={() => setAbierto((v) => !v)}
        className="relative w-9 h-9 rounded-lg hairline flex items-center justify-center hover:opacity-70 transition-opacity"
        style={{ background: 'var(--surface)' }}>
        <Bell width={16} height={16} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
        {hayAtencion && (
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-bad)' }} />
        )}
      </button>
      {abierto && (
        <div className="absolute right-0 mt-2 w-72 rounded-xl overflow-hidden z-20 glass-panel">
          <div className="px-4 py-3 text-sm font-medium border-b" style={{ borderColor: 'var(--line)' }}>Notificaciones</div>
          {alertas.length === 0 ? (
            <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--muted)' }}>Sin novedades.</div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
              {alertas.map((a, i) => (
                <div key={i} className="px-4 py-3 text-sm flex items-start gap-2.5">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: a.tipo === 'atencion' ? 'var(--color-bad)' : 'var(--color-ok)' }} />
                  {a.texto}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
