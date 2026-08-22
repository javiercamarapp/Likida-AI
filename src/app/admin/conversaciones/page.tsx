import { getConversacionesActivas, contarConversacionesActivas, TOPE_CONVERSACIONES } from '@/lib/admin/negocio';
import { MessageCircle, MessagesSquare, ChevronDown } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
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
 *
 * Anatomía de página (14-ago): BarraPagina + tarjetas sobre el lienzo tenue
 * (--g1); cada conversación es una lámina --surface con hairline dentro de
 * la tarjeta, el mismo material que usa la sección gemela de consola.tsx.
 */
export default async function ConversacionesPage() {
  // FE-9: `getConversacionesActivas` devuelve 20 — un TOPE. El KPI de arriba
  // lo pintaba como "Conversaciones activas: 20" y con 4,000 vivas seguía
  // diciendo 20. El total sale de un `count exact` aparte; `null` = no se
  // pudo contar, y entonces no se afirma ninguna cifra.
  const [conversaciones, total] = await Promise.all([
    getConversacionesActivas(), contarConversacionesActivas(),
  ]);
  const totalMensajes = conversaciones.reduce((s, c) => s + c.turns.length, 0);
  const recortado = total !== null && total > conversaciones.length;

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<MessageCircle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conversaciones de WhatsApp"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <KpiTile
              icono={<MessageCircle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Conversaciones activas" valor={total} formato="entero"
              vacio={total === null ? 'No se pudo contar — esto no significa que no haya ninguna.' : undefined}
            />
            <KpiTile
              icono={<MessagesSquare width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta={`Mensajes en las ${conversaciones.length} que se listan`} valor={totalMensajes} formato="entero"
            />
          </div>

          {/* Mensajes por conversación (c.turns.length) es un conteo real que
              ya se calcula para el resumen de arriba, así que un ranking con
              HBars entre conversaciones es genuino — no una serie inventada.
              Solo con 2+ conversaciones: con 1 sola, un "ranking" de una barra
              no compara nada. */}
          {conversaciones.length > 1 && (
            <ChartCard titulo="Mensajes por conversación" tamano="S">
              <HBars datos={conversaciones.map((c) => ({ etiqueta: c.telefono, valor: c.turns.length }))} formato="entero" />
            </ChartCard>
          )}

          <div className="card p-3">
            <TituloSeccion>
              {recortado ? `Las ${TOPE_CONVERSACIONES} más recientes de ${total}` : 'Todas las conversaciones'}
            </TituloSeccion>
            {conversaciones.length === 0 ? (
              <div className="mt-2">
                <EstadoVacio icono={<MessageCircle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Sin conversaciones activas.
                </EstadoVacio>
              </div>
            ) : (
              <div className="space-y-1.5 mt-2">
                {conversaciones.map((c) => (
                  <details key={`${c.tenantId ?? "sin-flota"}-${c.telefono}`} className="hairline rounded-lg overflow-hidden group" style={{ background: 'var(--surface)' }}>
                    <summary className="px-3 py-2.5 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[var(--canvas)] transition-colors">
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
                      <div className="px-3 pb-3 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--line2)' }}>
                        {c.turns.map((t, i) => (
                          <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                            <div className="max-w-[80%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap"
                              style={t.role === 'user'
                                ? { background: 'var(--canvas)', border: '1px solid var(--line2)' }
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
          </div>

          <EstadoVacio>
            Colas (activas/necesitan humano/escaladas/resueltas), búsqueda full-text, handoff a un humano — el bot de Likida es una máquina de estados determinística (foto→OCR→confirmar→liquidar), no un agente conversacional abierto que se pueda &quot;atorar&quot; y necesite ese patrón. Antes de construirlo hay que decidir si de verdad aplica.
            <br /><br />
            Volumen por canal, heatmap hora×día, histograma de mensajes por conversación — con 1 tenant y pocos días de historia no dicen nada real todavía.
          </EstadoVacio>
        </div>
      </div>
    </main>
  );
}
