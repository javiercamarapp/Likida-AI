import { getConversacionesActivas } from '@/lib/admin/negocio';
import { Server, Smartphone, MessageCircle, ChevronDown, Info } from 'lucide-react';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatCard, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

const ICONO_KPI = { width: 15, height: 15, strokeWidth: 1.75 } as const;

/** Lo que de verdad falta para tratar esto como infraestructura de la Meta
 *  WhatsApp Business API a escala — ninguno de estos existe hoy, y no se
 *  simula: Likida usa UN número para el flujo del bot, sin pool, sin
 *  plantillas administradas, sin métricas de entrega. */
const FUERA_DE_ALCANCE = [
  'Quality rating por número',
  'Pool de números con rotación/balanceo',
  'Plantillas — estado de aprobación, categoría, deliverability',
  'Entrega enviados → entregados → leídos',
  'Ventana de 24h',
  'Opt-ins / opt-outs',
];

/**
 * WhatsApp Infra — el número real que opera el bot de producción es UNO
 * solo, no un pool. No hay el dígito real disponible en este código (vive
 * en la config de Meta, no en una tabla), así que esta página lo describe
 * en vez de inventarlo. Lo único con datos reales aquí son las
 * conversaciones (`wa_conversacion`, vía `getConversacionesActivas`) — no
 * existe todavía una página dedicada de Conversaciones bajo /admin, así
 * que en vez de enlazar a algo que no existe, se enseña la lista completa
 * aquí mismo (mismo patrón que la sección "Conversaciones de WhatsApp" de
 * Inicio).
 *
 * Re-envuelta en la anatomía FlowAI (14-ago): lienzo `--g1` + `BarraPagina`
 * con el ícono de `rutas.ts` (Server). Las mitades vacías siguen vacías y
 * lo dicen — solo cambió la envoltura.
 */
export default async function WhatsappInfraPage() {
  const conversaciones = await getConversacionesActivas();

  return (
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Server width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="WhatsApp Infra"
        />
        <div className="px-5 py-5 flex-1 space-y-2.5">
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            El número real que opera el bot, y lo que falta para tratarlo como infraestructura a escala
          </p>

          <div className="card p-3">
            <TituloSeccion>Número operativo</TituloSeccion>
            <div className="hairline rounded-lg px-3 py-2.5 mt-2 flex items-center gap-2.5" style={{ background: 'var(--surface)' }}>
              <Smartphone width={15} height={15} strokeWidth={1.75} className="shrink-0" style={{ color: 'var(--muted)' }} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">1 número operativo</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  El que usa el bot de producción — vía Meta WhatsApp Business API. Sin pool de números, sin rotación.
                </div>
              </div>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              El dígito real no vive en este código (es configuración de Meta, no una fila en la base de datos) —
              por eso no se muestra un número aquí, para no inventar uno de ejemplo que se lea como real.
            </p>
          </div>

          {/* Mismo conteo real de siempre (`getConversacionesActivas`); la
              nota de la fuente (`wa_conversacion`, tope de 20 filas) va en el
              pie de la StatCard, no como caption suelto. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <StatCard icono={<MessageCircle {...ICONO_KPI} />}
              etiqueta="Conversaciones activas" valor={conversaciones.length} formato="entero"
              nota="Las más recientes (wa_conversacion, tope de 20 filas)"
            />
          </div>

          <section id="conversaciones" className="card p-3 scroll-mt-24">
            <TituloSeccion>Conversaciones</TituloSeccion>
            {conversaciones.length === 0 ? (
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</p>
            ) : (
              <div className="space-y-1.5 mt-2">
                {conversaciones.map((c) => (
                  <details key={c.telefono} className="hairline rounded-lg overflow-hidden group" style={{ background: 'var(--surface)' }}>
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
                        {c.turns.slice(-6).map((t, i) => (
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
          </section>

          <div className="card p-3">
            <TituloSeccion>Fuera de alcance hoy</TituloSeccion>
            {/* EstadoVacio (kit compartido) — mismo mensaje + icono (Info,
                igual que antes) de la intro; la lista de items fuera de
                alcance baja como bloque aparte. */}
            <div className="mt-2">
              <EstadoVacio icono={<Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                Ninguno de estos existe todavía en este panel — requieren integrar más a fondo la Meta WhatsApp
                Business API de lo que Likida usa hoy (Fase 5 del roadmap, a escala):
              </EstadoVacio>
            </div>
            <ul className="text-sm mt-3 space-y-2" style={{ color: 'var(--muted)' }}>
              {FUERA_DE_ALCANCE.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
