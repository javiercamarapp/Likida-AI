import { getConversacionesActivas } from '@/lib/admin/negocio';
import { MessageCircle, MessagesSquare, ChevronDown } from 'lucide-react';
import { HBars } from '../ui/graficas';
import { ChartCard, EstadoVacio, KpiTile } from '../ui/kit';

export const dynamic = 'force-dynamic';

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
          <KpiTile
            icono={<MessageCircle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
            etiqueta="Conversaciones activas" valor={conversaciones.length} formato="entero"
          />
          <KpiTile
            icono={<MessagesSquare width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
            etiqueta="Mensajes totales en estas conversaciones" valor={totalMensajes} formato="entero"
          />
        </div>

        {/* Mensajes por conversación (c.turns.length) es un conteo real que
            ya se calcula para el resumen de arriba, así que un ranking con
            HBars entre conversaciones es genuino — no una serie inventada.
            Solo con 2+ conversaciones: con 1 sola, un "ranking" de una barra
            no compara nada. */}
        {conversaciones.length > 1 && (
          <div className="mt-4">
            <ChartCard titulo="Mensajes por conversación" tamano="S">
              <HBars datos={conversaciones.map((c) => ({ etiqueta: c.telefono, valor: c.turns.length }))} formato="entero" />
            </ChartCard>
          </div>
        )}
      </div>

      <div className="glass-panel p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
          Todas las conversaciones
        </h2>
        {conversaciones.length === 0 ? (
          <EstadoVacio icono={<MessageCircle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
            Sin conversaciones activas.
          </EstadoVacio>
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
                            : { background: 'var(--marca)', color: 'var(--marca-fg)' }}>
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
        <div className="pt-4 mt-4 border-t" style={{ borderColor: 'var(--line)' }}>
          <EstadoVacio>
            Colas (activas/necesitan humano/escaladas/resueltas), búsqueda full-text, handoff a un humano — el bot de Likida es una máquina de estados determinística (foto→OCR→confirmar→liquidar), no un agente conversacional abierto que se pueda &quot;atorar&quot; y necesite ese patrón. Antes de construirlo hay que decidir si de verdad aplica.
            <br /><br />
            Volumen por canal, heatmap hora×día, histograma de mensajes por conversación — con 1 tenant y pocos días de historia no dicen nada real todavía.
          </EstadoVacio>
        </div>
      </div>
    </div>
  );
}
