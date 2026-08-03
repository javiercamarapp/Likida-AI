import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/**
 * Inicio de /admin — el `requireSuperadmin()` ya lo hizo el layout
 * (admin/layout.tsx), esta página solo trae datos. Todas las cifras son
 * reales (`getResumenNegocio`/`getConversacionesActivas`), no de relleno:
 * con 1 tenant, los números se ven chicos a propósito.
 */
export default async function Admin() {
  const [r, conversaciones] = await Promise.all([getResumenNegocio(), getConversacionesActivas()]);

  return (
    <div className="min-h-screen">
      <header className="border-b h-16 flex items-center px-8" style={{ borderColor: 'var(--line)' }}>
        <span className="text-base font-medium">Inicio</span>
      </header>

      <main className="px-8 py-10 space-y-10 max-w-5xl">
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Likida en números
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{r.tenants}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
                {r.tenants <= 1 ? 'Flota (todavía solo el demo)' : 'Flotas'}
              </div>
            </div>
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Gastado en IA (total)</div>
            </div>
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{numero(r.tokensIn + r.tokensOut)}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Tokens usados</div>
            </div>
            <div className="card p-6">
              <div className="text-3xl font-semibold tracking-tight tabular">{r.viajesProcesados}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
            </div>
          </div>
          {r.tenants <= 1 && (
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Cifras reales, no de ejemplo — Likida todavía no tiene clientes, así que son bajas a propósito.
            </p>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Agentes — costo por fase
          </h2>
          {r.porFase.length === 0 ? (
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {r.porFase.map((f) => (
                <div key={f.fase} id={f.fase} className="card p-6 scroll-mt-24">
                  <div className="text-base font-medium">{FASE_LABEL[f.fase] ?? f.fase}</div>
                  <div className="text-2xl font-semibold tracking-tight tabular mt-2">{usd(f.costoUsd)}</div>
                  <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>{f.n} llamadas</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Costo por modelo
          </h2>
          {r.porModelo.length === 0 ? (
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-6 py-3 font-medium">Modelo</th>
                    <th className="px-6 py-3 font-medium text-right">Llamadas</th>
                    <th className="px-6 py-3 font-medium text-right">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.porModelo.map((m) => (
                    <tr key={m.modelo} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-6 py-3 font-mono text-xs">{m.modelo}</td>
                      <td className="px-6 py-3 text-right tabular">{m.n}</td>
                      <td className="px-6 py-3 text-right tabular font-medium">{usd(m.costoUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {r.porDia.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
              Costo por día
            </h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-6 py-3 font-medium">Día</th>
                    <th className="px-6 py-3 font-medium text-right">Tokens</th>
                    <th className="px-6 py-3 font-medium text-right">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {r.porDia.map((d) => (
                    <tr key={d.dia} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-6 py-3">{d.dia}</td>
                      <td className="px-6 py-3 text-right tabular">{numero(d.tokens)}</td>
                      <td className="px-6 py-3 text-right tabular font-medium">{usd(d.costoUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section id="flotas" className="scroll-mt-24">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Flotas
          </h2>
          {r.flotas.length === 0 ? (
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>Sin flotas dadas de alta todavía.</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--muted)' }} className="text-left">
                    <th className="px-6 py-3 font-medium">Flota</th>
                    <th className="px-6 py-3 font-medium">Plan</th>
                    <th className="px-6 py-3 font-medium text-right">Viajes</th>
                    <th className="px-6 py-3 font-medium text-right">Costo de IA</th>
                  </tr>
                </thead>
                <tbody>
                  {r.flotas.map((f) => (
                    <tr key={f.id} className="border-t" style={{ borderColor: 'var(--line)' }}>
                      <td className="px-6 py-3 font-medium">{f.nombre}</td>
                      <td className="px-6 py-3" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                      <td className="px-6 py-3 text-right tabular">{f.viajes}</td>
                      <td className="px-6 py-3 text-right tabular">{usd(f.costoIaUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
            Plan, uso vs. límite y estado de cuenta (activa/en riesgo/morosa) son Fase 1 del roadmap — hoy solo se enseña lo que ya existe.
          </p>
        </section>

        <section id="conversaciones" className="scroll-mt-24">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Conversaciones de WhatsApp — estado en curso
          </h2>
          <p className="text-xs mb-3" style={{ color: 'var(--muted)' }}>
            Es la máquina de estados del bot (qué espera de cada teléfono ahora), no un historial de mensajes — Likida no guarda el texto de la conversación.
          </p>
          {conversaciones.length === 0 ? (
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</div>
          ) : (
            <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
              {conversaciones.map((c) => (
                <div key={c.telefono} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{c.telefono}</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{c.tenantNombre}</div>
                  </div>
                  <code className="text-xs px-2.5 py-1 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                    {JSON.stringify(c.estado)}
                  </code>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Salud del sistema
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="card p-6 hover:opacity-80">
              <div className="text-base font-medium">Errores — Sentry</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Ya conectado. Se enlaza en vez de reconstruirse.</div>
            </a>
            <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="card p-6 hover:opacity-80">
              <div className="text-base font-medium">Uptime y deploys — Vercel</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
