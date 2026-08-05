import { requireSuperadmin } from '@/lib/auth/guard';
import { getResumenNegocio, getConversacionesActivas } from '@/lib/admin/negocio';
import { tenantDemo } from '@/lib/auth/tenant-demo';
import { usd, numero } from '@/lib/utils';
import { saludo, fechaLarga } from '@/lib/saludo';
import Link from 'next/link';
import {
  Truck, DollarSign, Cpu, CheckCircle2, BarChart3, UserPlus2, MessageCircle,
  Sparkles, ChevronDown, ScanText, Calculator, Flag, MessageSquareText, Shuffle, Smartphone, ExternalLink,
} from 'lucide-react';
import { Dona, BarChartSimple } from './charts';
import GraficaCostoConRango from './rango-costo';
import ContadorRetro from './contador-retro';
import { IconoProveedor } from './proveedor-icono';
import { GlobalFilter, resolverRango } from './ui/global-filter';
import { KpiTile } from './ui/kit';
import { SelectorVista } from './selector-vista';

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
      <Icono width={icon} height={icon} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
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
export default async function Admin({
  searchParams,
}: { searchParams: Promise<{ rango?: string }> }) {
  const sp = await searchParams;
  // `GlobalFilter` (§3 del complemento) — 'todo' no cabe en una gráfica de
  // barras por día (sería un muro de barras diminutas), así que ahí se
  // enseña el total histórico real (`facturasTotal`) en vez de fingir una
  // ventana de días que no existe.
  const filtro = resolverRango(sp?.rango, '7');
  const { rango, ventanaDias } = filtro;

  const [{ nombre }, r, conversaciones] = await Promise.all([
    requireSuperadmin(), getResumenNegocio(undefined, ventanaDias), getConversacionesActivas(),
  ]);
  const chipsCosto = r.porDia.slice(-8).map((d) => d.costoUsd);
  const chipsTokens = r.porDia.slice(-8).map((d) => d.tokens);
  // AUDITORÍA 10, ALTO — "Flota (solo el demo)" era texto fijo: con la base
  // en 0 tenants (5-ago-2026) seguía diciendo que había una, y encima
  // "solo el demo" es una afirmación verificable, no una suposición — se
  // comprueba contra el id real en vez de asumir que el único tenant que
  // hay siempre es el demo.
  const esSoloDemo = r.tenants === 1 && r.flotas[0]?.id === tenantDemo();


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
                {saludo()}, {nombre ?? 'Javier'}
              </h1>
              {/* Ya viene capitalizada de `fechaLarga()` — ver auditoría 10,
                  BAJO (dashboard/page.tsx tiene la nota completa). */}
              <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>{fechaLarga()}</p>
            </div>
            {/* MRR real: $0 — Likida no cobra a ningún cliente todavía.
                No es un placeholder, es el número verdadero de hoy. 7
                dígitos = el ancho de "1,000,000", la meta. */}
            <ContadorRetro valor={0} digitos={7} prefijo="$" etiqueta="MRR — meta $1,000,000" tamaño="lg" />
          </div>

          {/* Arriba de todo lo demás a propósito: con la base vacía, entrar a
              los otros paneles a mirar el frontend es lo que se hace en esta
              pantalla, y las gráficas de abajo no tienen nada que enseñar. */}
          <SelectorVista tenants={r.tenants} />

          {/* Facturas = filas de `gasto` (cada una pasó por OCR/CFDI) — el
              mismo dato real que ya se usa en Costo por modelo, agrupado
              por día en vez de por modelo. Ventana de `ventanaDias` (7/30,
              GlobalFilter), con 0 donde no hubo actividad
              (getResumenNegocio ya lo rellena). A lo ancho y con más alto
              que antes — a la mitad del saludo se veía flaca y estirada;
              sola, en su propia fila, aguanta ser más grande. */}
          <div className="px-6 pb-5 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                Facturas procesadas — {rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`}
              </div>
              <GlobalFilter base="/admin" r={filtro} />
            </div>
            {rango === 'todo' ? (
              <div className="flex flex-col items-center justify-center" style={{ height: 160 }}>
                <div className="text-4xl font-semibold tracking-tight tabular">{numero(r.facturasTotal)}</div>
                <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Facturas procesadas — total histórico</div>
              </div>
            ) : r.facturasPorDia.some((d) => d.n > 0) ? (
              <BarChartSimple datos={r.facturasPorDia.map((d) => ({ dia: d.dia, valor: d.n }))} alto={160} />
            ) : (
              <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                Aún sin datos suficientes.
              </div>
            )}
          </div>

          <section id="agentes" className="p-5 border-t scroll-mt-24" style={{ borderColor: 'var(--line)' }}>
            <TituloSeccion>Likida en números</TituloSeccion>
            {/* KpiTile (design system v2, ui/kit.tsx) — reemplaza el
                Insignia+número a mano de las 4 tiles: count-up real,
                mismo sparkline+tendencia de siempre, y el mensaje "sin
                historia" honesto queda resuelto adentro del componente en
                vez de repetirse por tile. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiTile
                icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta={r.tenants === 0 ? 'Flotas (ninguna dada de alta)' : esSoloDemo ? 'Flota (solo el demo)' : 'Flotas'}
                valor={r.tenants} formato="entero"
              />
              <KpiTile
                icono={<DollarSign width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Gastado en IA" valor={r.costoIaUsd} formato="usd"
                tendencia={r.tendenciaCosto} sparkline={chipsCosto}
              />
              <KpiTile
                icono={<Cpu width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Tokens usados" valor={r.tokensIn + r.tokensOut} formato="numero"
                tendencia={r.tendenciaTokens} sparkline={chipsTokens}
              />
              <KpiTile
                icono={<CheckCircle2 width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Viajes procesados" valor={r.viajesProcesados} formato="entero"
              />
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
                      <th className="px-5 py-2.5 font-medium text-right"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.flotas.map((f) => (
                      <tr key={f.id} className="border-t transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-2.5 font-medium">{f.nombre}</td>
                        <td className="px-5 py-2.5" style={{ color: 'var(--muted)' }}>{f.plan}</td>
                        <td className="px-5 py-2.5 text-right tabular">{f.viajes}</td>
                        <td className="px-5 py-2.5 text-right tabular">{usd(f.costoIaUsd)}</td>
                        <td className="px-5 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Link href={`/dashboard?tenant=${f.id}`} target="_blank"
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                              <ExternalLink width={11} height={11} strokeWidth={1.75} /> Panel de dueño
                            </Link>
                            <Link href={`/dashboard/despacho?tenant=${f.id}&rol=encargado`} target="_blank"
                              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full hairline hover:opacity-70 transition-opacity">
                              <ExternalLink width={11} height={11} strokeWidth={1.75} /> Panel de jefe de flota
                            </Link>
                          </div>
                        </td>
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


  return (
    <div>
      {/* Sin header: buscador, Contáctanos, campana y perfil ya no viven
          aquí — campana+perfil están en el sidebar (admin/layout.tsx,
          junto al avatar), y el buscador se quitó del todo. Las gráficas
          centrales y el chat del Asistente arrancan pegados arriba. */}
      {/* El asistente ya no se monta aquí — vive en admin/layout.tsx, para
          estar en todas las páginas. Las recomendaciones, que antes iban
          arriba del chat, se quedan con el contenido de esta página. */}
      {main}
    </div>
  );
}
