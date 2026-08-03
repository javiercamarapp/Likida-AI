'use client';

import { useState } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import ChatFlota from './chat';
import type { DashboardKpis, Acreditables } from '@/lib/cuadra/analytics';

const ANCHO_ASIDE = 276;
const DURACION = '480ms cubic-bezier(0.22, 1, 0.36, 1)';

/**
 * Mismo componente que admin/asistente-expandible.tsx (envuelve `main` +
 * el rail, ambos ya renderizados en el servidor) — con `kpis`/`acred` de
 * ESTA flota en vez de `resumen: ResumenNegocio` cross-tenant. Ver la nota
 * de dashboard/layout.tsx: no se comparte con admin porque los dos chats
 * cargan datos de mundos distintos.
 */
export default function AsistenteFlotaExpandible({
  main, asideTop, kpis, acred,
}: {
  main: React.ReactNode;
  asideTop: React.ReactNode;
  kpis: DashboardKpis | null;
  acred: Acreditables | null;
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

      <aside
        className="glass-panel shrink-0 hidden xl:flex flex-col sticky top-0 self-start h-[calc(100dvh-2rem)]"
        style={{ width: expandido ? '100%' : ANCHO_ASIDE, transition: `width ${DURACION}` }}
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
              <ChatFlota kpis={kpis} acred={acred} />
            </div>
          ) : (
            <ChatFlota kpis={kpis} acred={acred} compacto />
          )}
        </div>
      </aside>
    </div>
  );
}
