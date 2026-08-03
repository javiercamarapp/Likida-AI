import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { usd } from '@/lib/formato';
import { Smartphone, MessageCircle, ChevronDown } from 'lucide-react';

export const dynamic = 'force-dynamic';

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

/**
 * Agente de WhatsApp — la capa de conversación que lleva al operador de
 * principio a fin. Real: `llm_costo` filtrado por `fase === 'whatsapp'`
 * (`getResumenNegocio`) y `wa_conversacion.estado` para las conversaciones
 * activas (mismo render que Inicio, con más espacio para leerlas).
 */
export default async function AgenteWhatsappPage() {
  const [r, conversaciones] = await Promise.all([getResumenNegocio(), getConversacionesActivas()]);
  const whatsapp = r.porFase.find((f) => f.fase === 'whatsapp');

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Smartphone width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Agente de WhatsApp</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>La conversación completa con el operador</span>
        </div>
      </header>

      <div className="glass-panel overflow-hidden">
        <section className="p-5">
          <TituloSeccion>Costo real</TituloSeccion>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={Smartphone} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{whatsapp ? usd(whatsapp.costoUsd) : usd(0)}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Gastado en WhatsApp</div>
                </div>
              </div>
            </div>
            <div className="card p-3.5">
              <div className="flex items-center gap-3">
                <Insignia Icono={MessageCircle} />
                <div className="min-w-0">
                  <div className="text-xl font-semibold tracking-tight tabular leading-tight">{whatsapp ? whatsapp.n : 0}</div>
                  <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Llamadas de WhatsApp</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Conversaciones activas</TituloSeccion>
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
          <TituloSeccion>Lo que falta</TituloSeccion>
          <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
            Entrega (enviados/entregados/leídos), ventana de 24h, opt-ins — requiere integrar la Meta WhatsApp
            Business API más a fondo de lo que Likida usa hoy.
          </p>
        </section>
      </div>
    </div>
  );
}
