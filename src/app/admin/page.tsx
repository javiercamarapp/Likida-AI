import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { supabaseServer } from '@/lib/supabase/server';
import { usd, numero } from '@/lib/utils';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Sparkline, Tendencia, Dona } from './charts';
import BuscadorSecciones from './buscador';
import ChatNegocio from './chat';
import Notificaciones, { type Alerta } from './notificaciones';
import PerfilMenu from './perfil';
import GraficaCostoConRango from './rango-costo';

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

const FASE_ICONO: Record<string, string> = {
  ocr: '📇', cuadre: '🧮', escalacion: '🚩', chat: '💬', router: '🔀', whatsapp: '📱',
};

/**
 * Inicio de /admin — el `requireSuperadmin()` ya lo hizo el layout
 * (admin/layout.tsx), esta página solo trae datos. Todas las cifras,
 * gráficas Y ALERTAS son reales (`getResumenNegocio`/
 * `getConversacionesActivas`): con 1 tenant, los números se ven chicos a
 * propósito, y una alerta que no tiene una condición real detrás no se
 * muestra — nada de "14 items waiting" inventado.
 */
export default async function Admin() {
  const [{ nombre }, r, conversaciones] = await Promise.all([
    requireSuperadmin(), getResumenNegocio(), getConversacionesActivas(),
  ]);
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);
  const chipsTokens = r.porDia.slice(-8).map((d) => d.tokens);
  const topFase = r.porFase[0] ? (FASE_LABEL[r.porFase[0].fase] ?? r.porFase[0].fase) : null;

  async function cerrarSesion() {
    'use server';
    const sb = await supabaseServer();
    await sb.auth.signOut();
    redirect('/login');
  }

  // Condiciones reales, no contadores de adorno. Con 1 tenant y pocos días
  // de historia, la lista casi siempre sale corta — es lo honesto.
  const alertas: Alerta[] = [];
  if (r.tendenciaCosto !== null && r.tendenciaCosto >= 30) {
    alertas.push({ tipo: 'atencion', texto: `El costo de IA subió ${r.tendenciaCosto}% esta semana vs la anterior.` });
  }
  if (conversaciones.length > 0) {
    alertas.push({ tipo: 'ok', texto: `${conversaciones.length} conversación(es) de WhatsApp con actividad reciente.` });
  }
  if (r.tenants <= 1) {
    alertas.push({ tipo: 'atencion', texto: 'Likida sigue con solo el tenant demo — sin clientes reales dados de alta.' });
  }

  const recomendaciones = [
    { href: '#agentes', icono: '📊', titulo: 'Costo por agente', subtitulo: 'Desglose por fase de IA' },
    { href: '#flotas', icono: '🚛', titulo: 'Flotas', subtitulo: `${r.tenants} dada${r.tenants === 1 ? '' : 's'} de alta` },
    { href: '/admin/usuarios/nuevo', icono: '➕', titulo: 'Nuevo usuario', subtitulo: 'Dar de alta una cuenta' },
    { href: '#conversaciones', icono: '💬', titulo: 'Conversaciones', subtitulo: `${conversaciones.length} activas` },
  ];

  return (
    <div className="min-h-screen">
      <header className="border-b h-16 flex items-center gap-3 px-8" style={{ borderColor: 'var(--line)' }}>
        <BuscadorSecciones />
        <a href="mailto:javiercamaraportepetit@gmail.com?subject=Agentes%20a%20la%20medida"
          className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg transition-opacity hover:opacity-85 shrink-0"
          style={{ background: 'var(--ink)', color: 'white' }}>
          + Contáctanos
        </a>
        <Notificaciones alertas={alertas} />
        <PerfilMenu nombre={nombre ?? 'Javier'} cerrarSesion={cerrarSesion} />
      </header>

      <div className="flex">
      <main className="flex-1 min-w-0 px-8 py-8 space-y-8">
        <div>
          <h1 className="text-4xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
            {SALUDO()}, {nombre ?? 'Javier'}
          </h1>
          <p className="text-sm mt-1 capitalize" style={{ color: 'var(--muted)' }}>{FECHA_HOY()}</p>
        </div>

        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
            Likida en números
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="card p-5 transition-shadow hover:shadow-md">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-3" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>🚛</div>
              <div className="text-2xl font-semibold tracking-tight tabular">{r.tenants}</div>
              <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                {r.tenants <= 1 ? 'Flota (solo el demo)' : 'Flotas'}
              </div>
            </div>
            <div className="card p-5 transition-shadow hover:shadow-md">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-3" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>💵</div>
              <div className="text-2xl font-semibold tracking-tight tabular">{usd(r.costoIaUsd)}</div>
              <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Gastado en IA</div>
              {chipsCosto.length > 1 && <div className="mt-2 -mx-1"><Sparkline valores={chipsCosto} /></div>}
              <div className="mt-1.5"><Tendencia valor={r.tendenciaCosto} /></div>
            </div>
            <div className="card p-5 transition-shadow hover:shadow-md">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-3" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>🧮</div>
              <div className="text-2xl font-semibold tracking-tight tabular">{numero(r.tokensIn + r.tokensOut)}</div>
              <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Tokens usados</div>
              {chipsTokens.length > 1 && <div className="mt-2 -mx-1"><Sparkline valores={chipsTokens} /></div>}
              <div className="mt-1.5"><Tendencia valor={r.tendenciaTokens} /></div>
            </div>
            <div className="card p-5 transition-shadow hover:shadow-md">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-3" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>✅</div>
              <div className="text-2xl font-semibold tracking-tight tabular">{r.viajesProcesados}</div>
              <div className="text-sm mt-1" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
            </div>
          </div>
          {r.tenants <= 1 && (
            <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
              Cifras reales, no de ejemplo — Likida todavía no tiene clientes, así que son bajas a propósito.
            </p>
          )}
        </section>

        {r.porDia.length > 1 && <GraficaCostoConRango porDia={r.porDia} />}

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

      {/* Panel derecho — mismo lugar que "AI Agent Assistant" en la
          referencia: saludo, tarjetas de acceso rápido a secciones REALES
          (no "Optimize Workflows" sin nada detrás), insight con datos
          reales, chat compacto hasta abajo. */}
      <aside className="w-[300px] shrink-0 border-l px-5 py-6 space-y-5 hidden xl:block overflow-y-auto" style={{ borderColor: 'var(--line)' }}>
        <div className="flex items-center gap-2">
          <span>✨</span>
          <span className="font-semibold text-sm">Asistente de negocio</span>
        </div>

        <div className="rounded-xl p-3.5 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
          👋 Hola {nombre ?? 'Javier'}, aquí tienes accesos rápidos y lo más importante de hoy.
        </div>

        <div className="space-y-2">
          {recomendaciones.map((rec) => (
            <Link key={rec.titulo} href={rec.href}
              className="flex items-center gap-3 p-3 rounded-xl hairline transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
                {rec.icono}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{rec.titulo}</span>
                <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{rec.subtitulo}</span>
              </span>
            </Link>
          ))}
        </div>

        {(topFase || r.tendenciaCosto !== null) && (
          <div className="rounded-xl p-4" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
            <div className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-ok)' }}>
              ✨ Smart Insight
            </div>
            <p className="text-sm">
              {r.tendenciaCosto !== null
                ? `El gasto de IA ${r.tendenciaCosto >= 0 ? 'subió' : 'bajó'} ${Math.abs(r.tendenciaCosto)}% esta semana vs la anterior.`
                : `"${topFase}" ${FASE_ICONO[r.porFase[0].fase] ?? ''} es tu agente más caro hoy: ${usd(r.porFase[0].costoUsd)}.`}
            </p>
          </div>
        )}

        <div>
          <ChatNegocio resumen={r} compacto />
        </div>
      </aside>
      </div>
    </div>
  );
}
