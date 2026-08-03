import { getConversacionesActivas } from '@/lib/admin/negocio';
import { MessageCircle, MessagesSquare, ChevronDown } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** Insignia local — mismo patrón cuadrado de admin/page.tsx (no se
 *  exporta de ahí), recreado aquí solo para las dos cifras de cabecera. */
function Insignia({ Icono }: { Icono: typeof MessageCircle }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

/**
 * Conversaciones de WhatsApp — versión dedicada y de ancho completo de la
 * sección de Inicio, mismos datos reales de `getConversacionesActivas()`
 * (telefono, tenantNombre, turns, actualizadaEn). Diferencia con Inicio:
 * aquí se enseñan TODOS los turns de cada conversación (Inicio recorta a
 * los últimos 6 por espacio) y hay dos cifras de cabecera — ambas sumas
 * reales sobre esos mismos datos, no una fuente nueva.
 */
export default async function ConversacionesPage() {
  const conversaciones = await getConversacionesActivas();
  const totalMensajes = conversaciones.reduce((s, c) => s + c.turns.length, 0);

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <MessageCircle width={16} height={16} strokeWidth={1.75} />
        <span className="text-sm font-medium">Conversaciones de WhatsApp</span>
      </header>

      <div className="glass-panel p-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="card p-3.5">
            <div className="flex items-center gap-3">
              <Insignia Icono={MessageCircle} />
              <div className="min-w-0">
                <div className="text-xl font-semibold tracking-tight tabular leading-tight">{conversaciones.length}</div>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Conversaciones activas</div>
              </div>
            </div>
          </div>
          <div className="card p-3.5">
            <div className="flex items-center gap-3">
              <Insignia Icono={MessagesSquare} />
              <div className="min-w-0">
                <div className="text-xl font-semibold tracking-tight tabular leading-tight">{totalMensajes}</div>
                <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Mensajes totales en estas conversaciones</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="glass-panel p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
          Todas las conversaciones
        </h2>
        {conversaciones.length === 0 ? (
          <div className="text-sm text-center py-8" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</div>
        ) : (
          <div className="space-y-2.5">
            {conversaciones.map((c) => (
              <details key={c.telefono} className="card overflow-hidden group">
                <summary className="px-4 py-3 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)] transition-colors">
                  <div>
                    <div className="text-sm font-medium">{c.telefono}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{c.tenantNombre}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                    {c.turns.length > 0 ? `${c.turns.length} mensajes` : 'sin mensajes'}
                    <ChevronDown width={14} height={14} className="transition-transform group-open:rotate-180" />
                  </div>
                </summary>
                {c.turns.length > 0 && (
                  <div className="px-4 pb-4 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--line)' }}>
                    {c.turns.map((t, i) => (
                      <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                        <div className="max-w-[80%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap"
                          style={t.role === 'user'
                            ? { background: 'var(--bg)', border: '1px solid var(--line)' }
                            : { background: 'var(--ink)', color: 'var(--bg)' }}>
                          {t.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </details>
            ))}
          </div>
        )}
        <div className="pt-4 mt-4 border-t space-y-2" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Colas (activas/necesitan humano/escaladas/resueltas), búsqueda full-text, handoff a un humano — el bot de Likida es una máquina de estados determinística (foto→OCR→confirmar→liquidar), no un agente conversacional abierto que se pueda &quot;atorar&quot; y necesite ese patrón. Antes de construirlo hay que decidir si de verdad aplica.
          </p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Volumen por canal, heatmap hora×día, histograma de mensajes por conversación — con 1 tenant y pocos días de historia no dicen nada real todavía.
          </p>
        </div>
      </div>
    </div>
  );
}
