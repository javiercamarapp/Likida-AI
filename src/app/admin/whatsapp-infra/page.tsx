import { getConversacionesActivas } from '@/lib/admin/negocio';
import { Smartphone, MessageCircle, ChevronDown, Info } from 'lucide-react';

export const dynamic = 'force-dynamic';

/** Insignia monocromo — mismo patrón que admin/page.tsx, recreado local
 *  porque `page.tsx` no lo exporta (es una función chica, no vale la pena
 *  compartirla entre rutas). */
function Insignia({ Icono }: { Icono: typeof Smartphone }) {
  return (
    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

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
 */
export default async function WhatsappInfraPage() {
  const conversaciones = await getConversacionesActivas();

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Smartphone width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">WhatsApp Infra</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>El número real que opera el bot, y lo que falta para tratarlo como infraestructura a escala</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Número operativo</TituloSeccion>
          <div className="card p-4 mt-3">
            <div className="flex items-center gap-3">
              <Insignia Icono={Smartphone} />
              <div className="min-w-0">
                <div className="text-sm font-semibold">1 número operativo</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  El que usa el bot de producción — vía Meta WhatsApp Business API. Sin pool de números, sin rotación.
                </div>
              </div>
            </div>
          </div>
          <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
            El dígito real no vive en este código (es configuración de Meta, no una fila en la base de datos) —
            por eso no se muestra un número aquí, para no inventar uno de ejemplo que se lea como real.
          </p>
        </section>

        <section id="conversaciones" className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Conversaciones</TituloSeccion>
          <div className="card p-4 mt-3">
            <div className="flex items-center gap-3">
              <Insignia Icono={MessageCircle} />
              <div className="min-w-0">
                <div className="text-xl font-semibold tracking-tight tabular leading-tight">{conversaciones.length}</div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  Conversaciones activas más recientes (`wa_conversacion`, tope de 20 filas)
                </div>
              </div>
            </div>
          </div>

          {conversaciones.length === 0 ? (
            <div className="mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</div>
          ) : (
            <div className="space-y-2.5 mt-3">
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
                      {c.turns.slice(-6).map((t, i) => (
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
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Fuera de alcance hoy</TituloSeccion>
          <div className="card p-4 mt-3">
            <div className="flex items-start gap-3">
              <Insignia Icono={Info} />
              <div className="min-w-0">
                <p className="text-sm">
                  Ninguno de estos existe todavía en este panel — requieren integrar más a fondo la Meta WhatsApp
                  Business API de lo que Likida usa hoy (Fase 5 del roadmap, a escala):
                </p>
                <ul className="text-sm mt-2 space-y-1" style={{ color: 'var(--muted)' }}>
                  {FUERA_DE_ALCANCE.map((item) => (
                    <li key={item}>· {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
