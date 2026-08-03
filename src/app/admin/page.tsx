import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/utils';
import Link from 'next/link';
import {
  Truck, DollarSign, Cpu, CheckCircle2, BarChart3, UserPlus2, MessageCircle,
  Sparkles, ChevronDown, ScanText, Calculator, Flag, MessageSquareText, Shuffle, Smartphone,
} from 'lucide-react';
import { Sparkline, Tendencia, Dona, BarChartSimple } from './charts';
import GraficaCostoConRango from './rango-costo';
import AsistenteExpandible from './asistente-expandible';
import ContadorRetro from './contador-retro';
import { IconoProveedor } from './proveedor-icono';

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

/** Título de sección — SIEMPRE vive DENTRO de un `.glass-panel` (nunca
 *  suelto sobre el fondo oscuro): así el gris de `--muted` se lee bien
 *  porque está sobre la superficie blanca del panel, no sobre la imagen
 *  negra difuminada de fondo. Un texto gris flotando directo sobre esa
 *  imagen no pasa contraste. */
function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
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

  const recomendaciones = [
    { href: '#agentes', Icono: BarChart3, titulo: 'Costo por agente', subtitulo: 'Desglose por fase de IA' },
    { href: '#flotas', Icono: Truck, titulo: 'Flotas', subtitulo: `${r.tenants} dada${r.tenants === 1 ? '' : 's'} de alta` },
    { href: '/admin/usuarios/nuevo', Icono: UserPlus2, titulo: 'Nuevo usuario', subtitulo: 'Dar de alta una cuenta' },
    { href: '#conversaciones', Icono: MessageCircle, titulo: 'Conversaciones', subtitulo: `${conversaciones.length} activas` },
  ];

  // `main` y `asideTop` se pasan como children al cliente
  // (asistente-expandible.tsx) — se renderizan aquí en el servidor, el
  // componente cliente solo los muestra/oculta y anima el ancho. Ningún
  // ícono/función cruza la frontera server→client, solo el JSX ya resuelto.
  const main = (
    <main>
          {/* Un solo panel glass grande, EXTENDIDO para toda la columna
              central — antes cada sección flotaba por separado con huecos
              entre sí; ahora es una sola superficie continua, dividida por
              hairlines internas (`border-t`), y los recuadros de datos
              (`.card` opacos) son los que se sobreponen encima de ESA
              superficie, no la superficie misma la que se corta en pedazos. */}
          <div className="glass-panel overflow-hidden">
          <div className="px-6 pt-4 pb-4 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
                {SALUDO()}, {nombre ?? 'Javier'}
              </h1>
              <p className="text-sm mt-0.5 capitalize" style={{ color: 'var(--muted)' }}>{FECHA_HOY()}</p>
            </div>
            {/* MRR real: $0 — Likida no cobra a ningún cliente todavía.
                No es un placeholder, es el número verdadero de hoy. 7
                dígitos = el ancho de "1,000,000", la meta. */}
            <ContadorRetro valor={0} digitos={7} prefijo="$" etiqueta="MRR — meta $1,000,000" tamaño="lg" />
          </div>

          {/* Facturas = filas de `gasto` (cada una pasó por OCR/CFDI) — el
              mismo dato real que ya se usa en Costo por modelo, agrupado
              por día en vez de por modelo. Últimos 7 días siempre, con 0
              donde no hubo actividad (getResumenNegocio ya lo rellena).
              A lo ancho y con más alto que antes — a la mitad del saludo
              se veía flaca y estirada; sola, en su propia fila, aguanta
              ser más grande. */}
          <div className="px-6 pb-5 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
            <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Facturas procesadas — últimos 7 días
            </div>
            {r.facturasPorDia.some((d) => d.n > 0) ? (
              <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={160} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Aún sin datos suficientes.
              </div>
            )}
          </div>

          <section id="agentes" className="p-5 border-t scroll-mt-24" style={{ borderColor: 'var(--line)' }}>
            <TituloSeccion>Likida en números</TituloSeccion>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <div className="card p-3.5">
                <div className="flex items-center gap-3">
                  <Insignia Icono={Truck} tamaño="sm" />
                  <div className="min-w-0">
                    <div className="text-xl font-semibold tracking-tight tabular leading-tight">{r.tenants}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
                      {r.tenants <= 1 ? 'Flota (solo el demo)' : 'Flotas'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="card p-3.5">
                <div className="flex items-center gap-3">
                  <Insignia Icono={DollarSign} tamaño="sm" />
                  <div className="min-w-0">
                    <div className="text-xl font-semibold tracking-tight tabular leading-tight">{usd(r.costoIaUsd)}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Gastado en IA</div>
                  </div>
                </div>
                {chipsCosto.length > 1 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0"><Sparkline valores={chipsCosto} alto={20} /></div>
                    <Tendencia valor={r.tendenciaCosto} />
                  </div>
                )}
              </div>
              <div className="card p-3.5">
                <div className="flex items-center gap-3">
                  <Insignia Icono={Cpu} tamaño="sm" />
                  <div className="min-w-0">
                    <div className="text-xl font-semibold tracking-tight tabular leading-tight">{numero(r.tokensIn + r.tokensOut)}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Tokens usados</div>
                  </div>
                </div>
                {chipsTokens.length > 1 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0"><Sparkline valores={chipsTokens} alto={20} /></div>
                    <Tendencia valor={r.tendenciaTokens} />
                  </div>
                )}
              </div>
              <div className="card p-3.5">
                <div className="flex items-center gap-3">
                  <Insignia Icono={CheckCircle2} tamaño="sm" />
                  <div className="min-w-0">
                    <div className="text-xl font-semibold tracking-tight tabular leading-tight">{r.viajesProcesados}</div>
                    <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>Viajes procesados</div>
                  </div>
                </div>
              </div>
            </div>
            {r.tenants <= 1 && (
              <p className="text-xs mt-3" style={{ color: 'var(--muted)' }}>
                Cifras reales, no de ejemplo — Likida todavía no tiene clientes, así que son bajas a propósito.
              </p>
            )}

            {(r.porDia.length > 1 || r.porFase.length > 0) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
                {r.porDia.length > 1 ? (
                  <GraficaCostoConRango porDia={r.porDia} anidado />
                ) : (
                  <div className="card p-4 flex items-center text-sm" style={{ color: 'var(--muted)' }}>Sin historial suficiente todavía.</div>
                )}
                {r.porFase.length > 0 ? (
                  <div className="card p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
                      Agentes — costo por fase
                    </h3>
                    <Dona segmentos={r.porFase.map((f) => ({ etiqueta: FASE_LABEL[f.fase] ?? f.fase, valor: f.costoUsd }))} />
                  </div>
                ) : (
                  <div className="card p-4 flex items-center text-sm" style={{ color: 'var(--muted)' }}>Todavía no hay actividad de IA registrada.</div>
                )}
              </div>
            )}
          </section>

          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <TituloSeccion>Costo por modelo</TituloSeccion>
            {r.porModelo.length === 0 ? (
              <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>Sin llamadas registradas todavía.</div>
            ) : (
              <div className="card divide-y mt-3" style={{ borderColor: 'var(--line)' }}>
                {r.porModelo.map((m) => (
                  <div key={m.modelo} className="px-5 py-3 flex items-center gap-3">
                    <IconoProveedor modelo={m.modelo} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-mono truncate">{m.modelo}</div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{m.n} llamadas</div>
                    </div>
                    <div className="text-sm font-semibold tabular shrink-0">{usd(m.costoUsd)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section id="flotas" className="border-t scroll-mt-24" style={{ borderColor: 'var(--line)' }}>
            <div className="px-5 pt-4 pb-1"><TituloSeccion>Flotas</TituloSeccion></div>
            {r.flotas.length === 0 ? (
              <div className="px-5 py-4 text-sm" style={{ color: 'var(--muted)' }}>Sin flotas dadas de alta todavía.</div>
            ) : (
              <div className="overflow-x-auto mt-2">
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
            <p className="text-xs px-5 pt-2 pb-4" style={{ color: 'var(--muted)' }}>
              Plan, uso vs. límite y estado de cuenta (activa/en riesgo/morosa) son Fase 1 del roadmap — hoy solo se enseña lo que ya existe.
            </p>
          </section>

          <section id="conversaciones" className="p-5 border-t scroll-mt-24" style={{ borderColor: 'var(--line)' }}>
            <TituloSeccion>Conversaciones de WhatsApp</TituloSeccion>
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
            <TituloSeccion>Salud del sistema</TituloSeccion>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
              <a href="https://sentry.io" target="_blank" rel="noopener noreferrer" className="card p-4 hover:shadow-md transition-shadow">
                <div className="text-sm font-medium">Errores — Sentry</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Ya conectado. Se enlaza en vez de reconstruirse.</div>
              </a>
              <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="card p-4 hover:shadow-md transition-shadow">
                <div className="text-sm font-medium">Uptime y deploys — Vercel</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Vercel ya lo mide. Se enlaza en vez de reconstruirse.</div>
              </a>
            </div>
          </section>
          </div>
    </main>
  );

  const asideTop = (
    <>
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
    </>
  );

  return (
    <div>
      {/* Sin header: buscador, Contáctanos, campana y perfil ya no viven
          aquí — campana+perfil están en el sidebar (admin/layout.tsx,
          junto al avatar), y el buscador se quitó del todo. Las gráficas
          centrales y el chat del Asistente arrancan pegados arriba. */}
      <AsistenteExpandible main={main} asideTop={asideTop} resumen={r} />
    </div>
  );
}
