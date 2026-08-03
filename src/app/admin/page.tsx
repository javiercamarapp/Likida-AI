import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/utils';
import { Sparkline, Tendencia, AreaChartSimple, Dona } from './charts';

const SALUDO = () => {
  const h = new Date().getUTCHours() - 6; // hora de México, aproximada — un saludo no necesita el minuto exacto
  const hora = ((h % 24) + 24) % 24;
  if (hora < 12) return 'Buenos días';
  if (hora < 19) return 'Buenas tardes';
  return 'Buenas noches';
};

const FECHA_HOY = () => new Date().toLocaleDateString('es-MX', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Mexico_City',
});

export const dynamic = 'force-dynamic';

const FASE_LABEL: Record<string, string> = {
  ocr: 'Agente OCR', cuadre: 'Agente de Cuadre', escalacion: 'Agente de Escalación',
  chat: 'Agente de Chat', router: 'Agente Router', whatsapp: 'Agente de WhatsApp',
};

/**
 * Inicio de /admin — el `requireSuperadmin()` ya lo hizo el layout
 * (admin/layout.tsx), esta página solo trae datos. Todas las cifras y
 * gráficas son reales (`getResumenNegocio`/`getConversacionesActivas`), no
 * de relleno: con 1 tenant, los números se ven chicos a propósito, y la
 * tendencia se calla (`null`) en vez de inventar un % sin 7 días previos
 * que comparar.
 */
export default async function Admin() {
  const [{ nombre }, r, conversaciones] = await Promise.all([
    requireSuperadmin(), getResumenNegocio(), getConversacionesActivas(),
  ]);
  const serieCosto = r.porDia.map((d) => ({ dia: d.dia, valor: d.costoUsd }));
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);
  const chipsTokens = r.porDia.slice(-8).map((d) => d.tokens);

  return (
    <div className="min-h-screen">
      <header className="border-b h-16 flex items-center px-8" style={{ borderColor: 'var(--line)' }}>
        <span className="text-base font-medium">Inicio</span>
      </header>

      <main className="px-8 py-10 space-y-10 max-w-5xl">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">{SALUDO()}, {nombre ?? 'Javier'}</h1>
          <p className="text-sm mt-1.5 capitalize" style={{ color: 'var(--muted)' }}>{FECHA_HOY()}</p>
        </div>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Likida en números
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div className="card p-6 transition-shadow hover:shadow-md">
              <div className="text-3xl font-semibold tracking-tight tabular">{r.tenants}</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
                {r.tenants <= 1 ? 'Flota (todavía solo el demo)' : 'Flotas'}
              </div>
            </div>
            <div className="card p-6 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-3xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
                  <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Gastado en IA</div>
                </div>
                {chipsCosto.length > 1 && <Sparkline valores={chipsCosto} />}
              </div>
              <div className="mt-2"><Tendencia valor={r.tendenciaCosto} /></div>
            </div>
            <div className="card p-6 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-3xl font-semibold tracking-tight tabular">{numero(r.tokensIn + r.tokensOut)}</div>
                  <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Tokens usados</div>
                </div>
                {chipsTokens.length > 1 && <Sparkline valores={chipsTokens} />}
              </div>
              <div className="mt-2"><Tendencia valor={r.tendenciaTokens} /></div>
            </div>
            <div className="card p-6 transition-shadow hover:shadow-md">
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

        {serieCosto.length > 1 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
              Costo de IA en el tiempo
            </h2>
            <div className="card p-6">
              <AreaChartSimple datos={serieCosto} etiquetaValor={usd} />
            </div>
          </section>
        )}

        <div id="agentes" className="grid grid-cols-1 md:grid-cols-2 gap-8 scroll-mt-24">
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
              Agentes — costo por fase
            </h2>
            {r.porFase.length === 0 ? (
              <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
            ) : (
              <div className="card p-6">
                <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
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
              <div className="card divide-y" style={{ borderColor: 'var(--line)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

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
                    <tr key={f.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
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
            Conversaciones de WhatsApp
          </h2>
          {conversaciones.length === 0 ? (
            <div className="card p-8 text-base" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</div>
          ) : (
            <div className="space-y-4">
              {conversaciones.map((c) => (
                <details key={c.telefono} className="card overflow-hidden group">
                  <summary className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)] transition-colors">
                    <div>
                      <div className="text-sm font-medium">{c.telefono}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{c.tenantNombre}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--muted)' }}>
                      {c.turns.length > 0 ? `${c.turns.length} mensajes` : 'sin mensajes'}
                      <span className="transition-transform group-open:rotate-180">⌄</span>
                    </div>
                  </summary>
                  {c.turns.length > 0 && (
                    <div className="px-5 pb-5 pt-1 space-y-2 border-t" style={{ borderColor: 'var(--line)' }}>
                      {c.turns.slice(-6).map((t, i) => (
                        <div key={i} className={`flex ${t.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                          <div className="max-w-[80%] px-3.5 py-2 rounded-xl text-sm whitespace-pre-wrap"
                            style={t.role === 'user'
                              ? { background: 'var(--surface)', border: '1px solid var(--line)' }
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

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
            Salud del sistema
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="card p-6 hover:shadow-md transition-shadow">
              <div className="text-base font-medium">Errores — Sentry</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Ya conectado. Se enlaza en vez de reconstruirse.</div>
            </a>
            <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="card p-6 hover:shadow-md transition-shadow">
              <div className="text-base font-medium">Uptime y deploys — Vercel</div>
              <div className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
