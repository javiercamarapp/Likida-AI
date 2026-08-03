import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { supabaseServer } from '@/lib/supabase/server';
import { usd, numero } from '@/lib/utils';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Truck, DollarSign, Cpu, CheckCircle2, BarChart3, UserPlus2, MessageCircle,
  Sparkles, ChevronDown, ScanText, Calculator, Flag, MessageSquareText, Shuffle, Smartphone,
} from 'lucide-react';
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

const FASE_ICONO: Record<string, typeof ScanText> = {
  ocr: ScanText, cuadre: Calculator, escalacion: Flag, chat: MessageSquareText, router: Shuffle, whatsapp: Smartphone,
};

/** Insignia monocromo — badge cuadrado con un ícono lucide adentro, sustituye
 *  todos los emoji que había antes (🚛💵🧮✅ etc.): mismas tonalidades de
 *  marca (blanco/negro/gris), nunca color. */
function Insignia({ Icono, tamaño = 'md' }: { Icono: typeof Truck; tamaño?: 'sm' | 'md' }) {
  const box = tamaño === 'sm' ? 'w-8 h-8' : 'w-9 h-9';
  const icon = tamaño === 'sm' ? 15 : 17;
  return (
    <div className={`${box} rounded-lg flex items-center justify-center shrink-0`} style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
      <Icono width={icon} height={icon} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
    </div>
  );
}

/**
 * Inicio de /admin — el `requireSuperadmin()` ya lo hizo el layout
 * (admin/layout.tsx), esta página solo trae datos. Todas las cifras,
 * gráficas Y ALERTAS son reales (`getResumenNegocio`/
 * `getConversacionesActivas`): con 1 tenant, los números se ven chicos a
 * propósito, y una alerta que no tiene una condición real detrás no se
 * muestra — nada de "14 items waiting" inventado.
 *
 * Cada sección es su propio `.glass-panel` flotando sobre el fondo oscuro
 * difuminado del layout — no hay panel contenedor blanco de fondo: el
 * espacio ENTRE tarjetas deja ver el fondo a propósito, para que se lean
 * sobrepuestas y no pegadas.
 */
export default async function Admin() {
  const [{ nombre }, r, conversaciones] = await Promise.all([
    requireSuperadmin(), getResumenNegocio(), getConversacionesActivas(),
  ]);
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);
  const chipsTokens = r.porDia.slice(-8).map((d) => d.tokens);
  const topFase = r.porFase[0] ? (FASE_LABEL[r.porFase[0].fase] ?? r.porFase[0].fase) : null;
  const TopFaseIcono = r.porFase[0] ? (FASE_ICONO[r.porFase[0].fase] ?? Sparkles) : Sparkles;

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
    { href: '#agentes', Icono: BarChart3, titulo: 'Costo por agente', subtitulo: 'Desglose por fase de IA' },
    { href: '#flotas', Icono: Truck, titulo: 'Flotas', subtitulo: `${r.tenants} dada${r.tenants === 1 ? '' : 's'} de alta` },
    { href: '/admin/usuarios/nuevo', Icono: UserPlus2, titulo: 'Nuevo usuario', subtitulo: 'Dar de alta una cuenta' },
    { href: '#conversaciones', Icono: MessageCircle, titulo: 'Conversaciones', subtitulo: `${conversaciones.length} activas` },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel sticky top-4 z-20 h-14 flex items-center gap-3 px-5">
        <BuscadorSecciones />
        <div className="flex items-center gap-2.5 ml-auto">
          <a href="mailto:javiercamaraportepetit@gmail.com?subject=Agentes%20a%20la%20medida"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg transition-opacity hover:opacity-85 shrink-0"
            style={{ background: 'var(--ink)', color: 'white' }}>
            Contáctanos
          </a>
          <Notificaciones alertas={alertas} />
          <PerfilMenu nombre={nombre ?? 'Javier'} cerrarSesion={cerrarSesion} />
        </div>
      </header>

      <div className="flex gap-4 items-start">
        <main className="flex-1 min-w-0 space-y-5">
          <div className="glass-panel px-6 py-5">
            <h1 className="text-2xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              {SALUDO()}, {nombre ?? 'Javier'}
            </h1>
            <p className="text-sm mt-0.5 capitalize" style={{ color: 'var(--muted)' }}>{FECHA_HOY()}</p>
          </div>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1" style={{ color: 'var(--muted)' }}>
              Likida en números
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="glass-panel p-4">
                <Insignia Icono={Truck} tamaño="sm" />
                <div className="text-2xl font-semibold tracking-tight tabular mt-2.5">{r.tenants}</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
                  {r.tenants <= 1 ? 'Flota (solo el demo)' : 'Flotas'}
                </div>
              </div>
              <div className="glass-panel p-4">
                <Insignia Icono={DollarSign} tamaño="sm" />
                <div className="text-2xl font-semibold tracking-tight tabular mt-2.5">{usd(r.costoIaUsd)}</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Gastado en IA</div>
                {chipsCosto.length > 1 && <div className="mt-2 -mx-1"><Sparkline valores={chipsCosto} alto={32} /></div>}
                <div className="mt-1"><Tendencia valor={r.tendenciaCosto} /></div>
              </div>
              <div className="glass-panel p-4">
                <Insignia Icono={Cpu} tamaño="sm" />
                <div className="text-2xl font-semibold tracking-tight tabular mt-2.5">{numero(r.tokensIn + r.tokensOut)}</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Tokens usados</div>
                {chipsTokens.length > 1 && <div className="mt-2 -mx-1"><Sparkline valores={chipsTokens} alto={32} /></div>}
                <div className="mt-1"><Tendencia valor={r.tendenciaTokens} /></div>
              </div>
              <div className="glass-panel p-4">
                <Insignia Icono={CheckCircle2} tamaño="sm" />
                <div className="text-2xl font-semibold tracking-tight tabular mt-2.5">{r.viajesProcesados}</div>
                <div className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
              </div>
            </div>
            {r.tenants <= 1 && (
              <p className="text-xs mt-2.5 px-1" style={{ color: 'var(--muted)' }}>
                Cifras reales, no de ejemplo — Likida todavía no tiene clientes, así que son bajas a propósito.
              </p>
            )}
          </section>

          {r.porDia.length > 1 && <GraficaCostoConRango porDia={r.porDia} />}

          <div id="agentes" className="grid grid-cols-1 md:grid-cols-2 gap-4 scroll-mt-24">
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1" style={{ color: 'var(--muted)' }}>
                Agentes — costo por fase
              </h2>
              {r.porFase.length === 0 ? (
                <div className="glass-panel p-6 text-sm" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
              ) : (
                <div className="glass-panel p-5">
                  <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
                </div>
              )}
            </section>

            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1" style={{ color: 'var(--muted)' }}>
                Costo por modelo
              </h2>
              {r.porModelo.length === 0 ? (
                <div className="glass-panel p-6 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
              ) : (
                <div className="glass-panel divide-y" style={{ borderColor: 'var(--line)' }}>
                  {r.porModelo.map((m) => (
                    <div key={m.modelo} className="px-5 py-3 flex items-center justify-between gap-3">
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
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1" style={{ color: 'var(--muted)' }}>
              Flotas
            </h2>
            {r.flotas.length === 0 ? (
              <div className="glass-panel p-6 text-sm" style={{ color: 'var(--muted)' }}>Sin flotas dadas de alta todavía.</div>
            ) : (
              <div className="glass-panel overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium">Flota</th>
                      <th className="px-5 py-2.5 font-medium">Plan</th>
                      <th className="px-5 py-2.5 font-medium text-right">Viajes</th>
                      <th className="px-5 py-2.5 font-medium text-right">Costo de IA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.flotas.map((f) => (
                      <tr key={f.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-2.5 font-medium">{f.nombre}</td>
                        <td className="px-5 py-2.5" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                        <td className="px-5 py-2.5 text-right tabular">{f.viajes}</td>
                        <td className="px-5 py-2.5 text-right tabular">{usd(f.costoIaUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs mt-2 px-1" style={{ color: 'var(--muted)' }}>
              Plan, uso vs. límite y estado de cuenta (activa/en riesgo/morosa) son Fase 1 del roadmap — hoy solo se enseña lo que ya existe.
            </p>
          </section>

          <section id="conversaciones" className="scroll-mt-24">
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1" style={{ color: 'var(--muted)' }}>
              Conversaciones de WhatsApp
            </h2>
            {conversaciones.length === 0 ? (
              <div className="glass-panel p-6 text-sm" style={{ color: 'var(--muted)' }}>Sin conversaciones activas.</div>
            ) : (
              <div className="space-y-3">
                {conversaciones.map((c) => (
                  <details key={c.telefono} className="glass-panel overflow-hidden group">
                    <summary className="px-5 py-3.5 flex items-center justify-between gap-4 cursor-pointer list-none hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)] transition-colors">
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
            <h2 className="text-xs font-semibold uppercase tracking-wide mb-2.5 px-1" style={{ color: 'var(--muted)' }}>
              Salud del sistema
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="glass-panel p-5 hover:shadow-md transition-shadow">
                <div className="text-sm font-medium">Errores — Sentry</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Ya conectado. Se enlaza en vez de reconstruirse.</div>
              </a>
              <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="glass-panel p-5 hover:shadow-md transition-shadow">
                <div className="text-sm font-medium">Uptime y deploys — Vercel</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
              </a>
            </div>
          </section>
        </main>

        {/* Panel derecho — accesos rápidos a secciones REALES (no "Optimize
            Workflows" sin nada detrás), insight con datos reales, chat
            compacto hasta abajo. Flota aparte del main, pegado arriba. */}
        <aside className="glass-panel w-[276px] shrink-0 px-4 py-4 space-y-4 hidden xl:block sticky top-[4.5rem] max-h-[calc(100vh-6.5rem)] overflow-y-auto">
          <div className="flex items-center gap-2">
            <Sparkles width={15} height={15} strokeWidth={1.75} />
            <span className="font-semibold text-sm">Asistente de negocio</span>
          </div>

          <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
            Hola {nombre ?? 'Javier'}, aquí tienes accesos rápidos y lo más importante de hoy.
          </div>

          <div className="space-y-1.5">
            {recomendaciones.map((rec) => (
              <Link key={rec.titulo} href={rec.href}
                className="flex items-center gap-2.5 p-2.5 rounded-xl hairline transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]">
                <Insignia Icono={rec.Icono} tamaño="sm" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{rec.titulo}</span>
                  <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{rec.subtitulo}</span>
                </span>
              </Link>
            ))}
          </div>

          {(topFase || r.tendenciaCosto !== null) && (
            <div className="rounded-xl p-3.5" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-ok)' }}>
                <Sparkles width={12} height={12} strokeWidth={2} /> Smart Insight
              </div>
              <p className="text-sm">
                {r.tendenciaCosto !== null
                  ? `El gasto de IA ${r.tendenciaCosto >= 0 ? 'subió' : 'bajó'} ${Math.abs(r.tendenciaCosto)}% esta semana vs la anterior.`
                  : (
                    <span className="inline-flex items-center gap-1.5">
                      <TopFaseIcono width={13} height={13} strokeWidth={1.75} /> &quot;{topFase}&quot; es tu agente más caro hoy: {usd(r.porFase[0].costoUsd)}.
                    </span>
                  )}
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
