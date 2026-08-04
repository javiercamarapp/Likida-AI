'use client';

import { useState } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import ChatNegocio from './chat';
import type { ResumenNegocio } from '@/lib/admin/negocio';

import { ANCHO_ASISTENTE, MARCO_ASISTENTE, MARCO_ASISTENTE_EXPANDIDO } from '../marco';

const ANCHO_ASIDE = ANCHO_ASISTENTE;
const DURACION = '480ms cubic-bezier(0.22, 1, 0.36, 1)'; // easeOutQuint — la misma curva "premium" que usan los paneles de macOS/iOS al expandirse

/**
 * Envuelve `main` (las gráficas centrales) y el panel del Asistente —
 * ambos ya renderizados en el servidor, se pasan como children/props, no
 * se reconstruyen aquí. Solo esto necesita ser cliente: el botón de
 * expandir. Al expandir, el centro se encoge a 0 (con fade) y el
 * Asistente crece a todo el ancho, mostrando el chat COMPLETO
 * (`compacto={false}`) en vez de la versión chica pegada abajo.
 */
export default function AsistenteExpandible({
  main, asideTop, resumen,
}: {
  main: React.ReactNode;
  asideTop: React.ReactNode;
  resumen: ResumenNegocio;
}) {
  const [expandido, setExpandido] = useState(false);

  return (
    <div className="flex items-start relative" style={{ gap: expandido ? 0 : 16, transition: `gap ${DURACION}` }}>
      <div
        style={{
          width: expandido ? 0 : `calc(100% - ${ANCHO_ASIDE + 16}px)`,
          minWidth: 0,
          opacity: expandido ? 0 : 1,
          overflow: 'hidden',
          transition: `width ${DURACION}, opacity 250ms ease`,
        }}
      >
        {main}
      </div>

      {/* Mismo marco que dashboard/rail.tsx (marco.ts): expandido SALE del
          flujo —pedir `width: 100%` dentro de un flex que también carga el
          sidebar desbordaba el panel y se llevaba el botón de contraer fuera
          de la pantalla— y arranca DESPUÉS del sidebar, que se queda visible.
          El centro ya se retira solo aquí, con su propio width/opacity. */}
      <aside
        className={`glass-panel shrink-0 hidden xl:flex flex-col ${
          expandido ? MARCO_ASISTENTE_EXPANDIDO : MARCO_ASISTENTE
        }`}
        style={expandido ? undefined : { width: ANCHO_ASIDE, transition: `width ${DURACION}` }}
      >
        <div className="flex items-center gap-2 px-4 pt-4 shrink-0">
          <Sparkles width={15} height={15} strokeWidth={1.75} />
          <span className="font-semibold text-sm">Asistente de negocio</span>
          <button type="button" onClick={() => setExpandido((v) => !v)}
            aria-label={expandido ? 'Contraer chat' : 'Expandir chat a pantalla completa'}
            className="ml-auto w-7 h-7 rounded-lg hairline flex items-center justify-center hover:opacity-70 transition-opacity"
            style={{ background: 'var(--surface)' }}>
            {expandido
              ? <Minimize2 width={13} height={13} strokeWidth={1.75} />
              : <Maximize2 width={13} height={13} strokeWidth={1.75} />}
          </button>
        </div>

        {!expandido && (
          <div className="flex-1 min-w-0 overflow-y-auto px-4 pt-2 space-y-4">
            {asideTop}
          </div>
        )}

        <div className={expandido ? 'flex-1 min-w-0 flex flex-col px-4 pb-4 pt-2 overflow-hidden' : 'shrink-0 px-4 py-3 border-t'}
          style={expandido ? undefined : { borderColor: 'var(--line)' }}>
          {expandido ? (
            <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
              <ChatNegocio resumen={resumen} />
            </div>
          ) : (
            <ChatNegocio resumen={resumen} compacto />
          )}
        </div>
      </aside>
    </div>
  );
}
