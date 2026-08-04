import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { Smartphone, MessageCircle, ChevronDown } from 'lucide-react';
import { KpiTile, EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

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
            <KpiTile
              icono={<Smartphone width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Gastado en WhatsApp" valor={whatsapp ? whatsapp.costoUsd : 0} formato="usd"
            />
            <KpiTile
              icono={<MessageCircle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
              etiqueta="Llamadas de WhatsApp" valor={whatsapp ? whatsapp.n : 0} formato="entero"
            />
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

        <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
          <TituloSeccion>Lo que falta</TituloSeccion>
          <div className="mt-2">
            <EstadoVacio>
              Entrega (enviados/entregados/leídos), ventana de 24h, opt-ins — requiere integrar la Meta WhatsApp
              Business API más a fondo de lo que Likida usa hoy.
            </EstadoVacio>
          </div>
        </section>
      </div>
    </div>
  );
}
