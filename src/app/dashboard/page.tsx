import Link from 'next/link';
import {
  Fuel, Receipt, Route as RouteIcon, Truck, Wallet, AlertTriangle, Percent,
  ScanText, ReceiptText, TrendingUp, Sparkles,
} from 'lucide-react';
import {
  getKpis, getAcreditables, detectarAnomalias, getLiquidacionesPorDia,
  type DashboardKpis, type Acreditables, type Anomalia,
} from '@/lib/cuadra/analytics';
import { mxn } from '@/lib/utils';
import { saludo, fechaLarga } from '@/lib/saludo';
import { LEYENDA_CORTA } from '@/lib/cuadra/cuadre/leyendas';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { estadoPanel } from './estado';
import { BarChartSimple } from '../admin/charts';
import { GlobalFilter } from '../admin/ui/global-filter';
import { KpiTile } from '../admin/ui/kit';
import ContadorRetro from '../admin/contador-retro';
import AsistenteFlotaExpandible from './asistente-expandible';
import { sufijoTenant } from './sufijo';

export const dynamic = 'force-dynamic';

/** Resiliencia por sección: si una consulta falla, devuelve null y la
 *  tarjeta muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
      {children}
    </h2>
  );
}

/**
 * Inicio / Resumen del panel de la FLOTA — el equivalente de admin/page.tsx
 * para el cliente: mismo encabezado con saludo + contador retro, misma
 * gráfica de barras+línea con filtro 7d/30d/Todo, mismos KpiTile, mismo rail
 * de Asistente. Lo que cambia es de quién son los números: aquí TODO está
 * filtrado al `tenantId` que le pasan.
 *
 * El detalle por liquidación y la lista de anomalías YA NO viven aquí: se
 * fueron a /dashboard/cuadre, su propia página. Inicio es el vistazo, no el
 * expediente.
 *
 * Recibe el tenant YA resuelto en vez de resolverlo adentro (eso lo hace
 * `page.tsx`, abajo) — misma razón que `chrome.tsx`: así este contenido se
 * puede renderizar en una prueba visual sin sesión, y lo que se verifica es
 * la pantalla REAL, no una copia que puede haber divergido.
 */
export async function InicioContenido({
  tenantId, tenantNombre, nombre, sp,
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  sp: { vista?: string; tenant?: string; rango?: string } | undefined;
}) {
  const rango = sp?.rango === '30' ? '30' : sp?.rango === 'todo' ? 'todo' : '7';
  const ventanaDias = rango === '30' ? 30 : 7;
  const sufijo = sufijoTenant(sp);

  const [acred, kpis, anomalias, porDia] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId)),
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    safe<Array<{ dia: string; valor: number }>>(() => getLiquidacionesPorDia(tenantId, ventanaDias)),
  ]);

  // `liquidaciones` ya no se carga en esta página (se fue a /dashboard/cuadre),
  // así que el estado se decide con lo que SÍ vive aquí. `estadoPanel` sigue
  // siendo la misma función probada: se le pasa `porDia` en el lugar de la
  // lista, que es la sección equivalente de esta pantalla.
  const estado = estadoPanel({ acreditables: acred, kpis, liquidaciones: porDia, anomalias });

  const alertas: Array<{ texto: string; href: string }> = [];
  if (kpis && kpis.porRevisar > 0) {
    // "liquidación" + "es" da "liquidaciónes": en español el acento SE PIERDE
    // al pluralizar (liquidación → liquidaciones), así que el sufijo pegado
    // no sirve para esta palabra — va la palabra completa.
    alertas.push({
      texto: `${kpis.porRevisar} ${kpis.porRevisar === 1 ? 'liquidación' : 'liquidaciones'} por revisar`,
      href: `/dashboard/cuadre${sufijo}`,
    });
  }
  if (anomalias && anomalias.length > 0) {
    alertas.push({
      texto: `${anomalias.length} comprobante${anomalias.length === 1 ? '' : 's'} aparece${anomalias.length === 1 ? '' : 'n'} en más de un viaje`,
      href: `/dashboard/cuadre${sufijo}#anomalias`,
    });
  }

  const main = (
    <main>
      <div className="glass-panel overflow-hidden">
        <div className="px-6 pt-4 pb-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl tracking-tight" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              {saludo()}, {nombre ?? 'flota'}
            </h1>
            <p className="text-sm mt-0.5 capitalize" style={{ color: 'var(--muted)' }}>{fechaLarga()}</p>
            {tenantNombre && (
              <span className="inline-block mt-2 text-xs px-2.5 py-1 rounded-full font-medium" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
                viendo como superadmin · {tenantNombre}
              </span>
            )}
          </div>
          {/* Contador retro (§2 del documento: FlipCounter) — el número real
              de cabecera de una FLOTA es lo comprobado del periodo, no un MRR
              (la flota no le cobra a nadie desde aquí). Se redondea a pesos
              enteros a propósito: el componente pinta un tile por carácter y
              un punto decimal quedaría como un dígito más. La cifra exacta con
              centavos vive en el KpiTile de abajo. */}
          <ContadorRetro valor={Math.round(kpis?.montoComprobado ?? 0)} digitos={7} prefijo="$"
            etiqueta="Comprobado — histórico" tamaño="lg" />
        </div>

        {alertas.length > 0 && (
          <div className="px-6 pb-4 space-y-2">
            {alertas.map((a) => (
              <Link key={a.href} href={a.href}
                className="card p-3.5 flex items-center gap-3 hover:opacity-85 transition-opacity"
                style={{ borderColor: 'var(--warn)' }}>
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
                <span className="text-sm">{a.texto}</span>
                <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--muted)' }}>Ver →</span>
              </Link>
            ))}
          </div>
        )}

        {estado === 'error' ? (
          <div className="px-6 pb-6 pt-2">
            <div className="card p-10 text-center">
              <p className="text-lg font-semibold tracking-tight">No se pudieron cargar los datos</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                Hubo un problema al leer del sistema. Recarga la página en un momento — esto NO significa
                que no haya liquidaciones, significa que no se pudieron leer.
              </p>
            </div>
          </div>
        ) : estado === 'vacio' ? (
          <div className="px-6 pb-6 pt-2">
            <div className="card p-10 text-center">
              <p className="text-lg font-semibold tracking-tight">Aún no hay liquidaciones</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                En cuanto un operador cierre su primer viaje por WhatsApp, aquí aparecen los acreditables y el detalle.
              </p>
              <Link href="/demo" className="inline-block mt-5 px-5 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>Ver el demo</Link>
            </div>
          </div>
        ) : (
          <>
            {estado === 'parcial' && (
              <div className="px-6 pb-4">
                <div className="card p-4 flex items-start gap-3" style={{ borderColor: 'var(--warn)' }}>
                  <span className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--warn)' }} />
                  <div>
                    <p className="text-sm font-semibold m-0">Faltan datos por cargar — esta pantalla está incompleta</p>
                    <p className="text-xs mt-1 m-0" style={{ color: 'var(--muted)' }}>
                      Una o más secciones no respondieron. No tomes estas cifras como el corte del periodo.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── ComboChart (§2 del documento: barras + línea, toggle 7d/30d/Todo) ── */}
            <div className="px-6 pb-5 border-t pt-5" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between gap-4 mb-3">
                <TituloSeccion>
                  Liquidaciones cerradas — {rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`}
                </TituloSeccion>
                <GlobalFilter base="/dashboard" activo={rango} extra={sp?.tenant ? { tenant: sp.tenant } : sp?.vista ? { vista: sp.vista } : undefined} />
              </div>
              {rango === 'todo' ? (
                <div className="flex flex-col items-center justify-center" style={{ height: 160 }}>
                  <div className="text-4xl font-semibold tracking-tight tabular">{kpis?.viajesLiquidados ?? 0}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>Liquidaciones cerradas — total histórico</div>
                </div>
              ) : porDia === null ? (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                  No se pudo cargar esta gráfica.
                </div>
              ) : porDia.some((d) => d.valor > 0) ? (
                <BarChartSimple datos={porDia} alto={160} />
              ) : (
                <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 160 }}>
                  Sin cierres en esta ventana — prueba con 30d o el histórico.
                </div>
              )}
            </div>

            {/* ── Estímulos acreditables ── */}
            <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <TituloSeccion>Estímulos acreditables del periodo</TituloSeccion>
              {acred === null ? (
                <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                  <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Diésel elegible para el estímulo" valor={acred.litrosDiesel} formato="litros" destacar
                    nota="LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente" />
                  <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="IVA acreditable" valor={acred.iva} formato="mxn"
                    nota="LIVA, Art. 5 — CFDI con IVA desglosado" />
                  <KpiTile icono={<RouteIcon width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Peaje (50%)" valor={acred.peaje} formato="mxn"
                    nota="Estímulo de autopistas · LIF 2026, Art. 20-A" />
                </div>
              )}
            </section>

            {/* ── Liquidaciones del periodo ── */}
            <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between gap-4">
                <TituloSeccion>Liquidaciones del periodo</TituloSeccion>
                <Link href={`/dashboard/cuadre${sufijo}`} className="text-xs font-medium px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity shrink-0">
                  Ver detalle →
                </Link>
              </div>
              {kpis === null ? (
                <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <KpiTile icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Viajes liquidados" valor={kpis.viajesLiquidados} formato="entero" />
                  <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Monto comprobado" valor={kpis.montoComprobado} formato="mxn" />
                  <KpiTile icono={<AlertTriangle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Con diferencia" valor={kpis.conDiferencias + kpis.porRevisar} formato="entero" />
                  <KpiTile icono={<Percent width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />}
                    etiqueta="Tasa de cuadre" valor={kpis.tasaCuadre} formato="porcentaje" />
                </div>
              )}
            </section>
          </>
        )}

        <p className="text-xs px-5 pb-5 pt-1" style={{ color: 'var(--muted)' }}>{LEYENDA_CORTA}</p>
      </div>
    </main>
  );

  const accesos = [
    { href: `/dashboard/cuadre${sufijo}`, Icono: ReceiptText, titulo: 'Cuadre / Liquidación', subtitulo: kpis ? `${kpis.viajesLiquidados} cerradas` : 'Detalle por viaje' },
    { href: `/dashboard/documentos${sufijo}`, Icono: ScanText, titulo: 'Documentos (OCR)', subtitulo: 'Comprobantes procesados' },
    { href: `/dashboard/valor-ahorro${sufijo}`, Icono: TrendingUp, titulo: 'Valor & Ahorro', subtitulo: 'Lo que Likida te ahorra' },
    { href: `/dashboard/viajes${sufijo}`, Icono: Truck, titulo: 'Viajes', subtitulo: 'Estado de la operación' },
  ];

  const asideTop = (
    <>
      <div className="rounded-xl p-3 text-sm" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
        Hola {nombre ?? 'de nuevo'}, aquí tienes accesos rápidos y lo más importante de hoy.
      </div>

      <div className="space-y-1.5">
        {accesos.map((a) => (
          <Link key={a.titulo} href={a.href}
            className="flex items-center gap-2.5 p-2.5 rounded-xl hairline transition-colors hover:bg-[color-mix(in_srgb,var(--muted)_6%,transparent)]">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <a.Icono width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ink)' }} />
            </div>
            <span className="min-w-0">
              <span className="block text-sm font-medium truncate">{a.titulo}</span>
              <span className="block text-xs truncate" style={{ color: 'var(--muted)' }}>{a.subtitulo}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* Smart Insight — SOLO cuando hay un hallazgo real que reportar. Sin
          anomalías ni liquidaciones no se pinta nada: una tarjeta verde que
          dice "todo bien" cuando en realidad no se revisó nada entrena a
          ignorarla. */}
      {(anomalias && anomalias.length > 0) ? (
        <div className="rounded-xl p-3.5" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-ok)' }}>
            <Sparkles width={12} height={12} strokeWidth={2} /> Smart Insight
          </div>
          <p className="text-sm">
            Encontré {anomalias.length} comprobante{anomalias.length === 1 ? '' : 's'} cargado{anomalias.length === 1 ? '' : 's'} en
            más de un viaje, por {mxn(anomalias.reduce((s, a) => s + a.monto, 0))} en total. Es una coincidencia detectada, no un veredicto.
          </p>
        </div>
      ) : kpis && kpis.viajesLiquidados > 0 ? (
        <div className="rounded-xl p-3.5" style={{ background: 'color-mix(in srgb, var(--color-ok) 10%, transparent)' }}>
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-ok)' }}>
            <Sparkles width={12} height={12} strokeWidth={2} /> Smart Insight
          </div>
          <p className="text-sm">
            Tu tasa de cuadre es {kpis.tasaCuadre}% — {kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar} de {kpis.viajesLiquidados} liquidaciones
            cerraron sin diferencias.
          </p>
        </div>
      ) : null}
    </>
  );

  return <AsistenteFlotaExpandible main={main} asideTop={asideTop} kpis={kpis} acred={acred} />;
}

/** La página real: resuelve quién eres y a qué flota apuntas, y pinta el
 *  contenido de arriba. `esRaiz` hace que un superadmin sin `?tenant=` ni
 *  `?vista=demo` se vaya a SU consola (/admin) en vez de quedarse viendo la
 *  demo por accidente — ver `resolverTenantEfectivo`. */
export default async function DashboardInicio({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rango?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantNombre, nombre } = await resolverTenantEfectivo('/dashboard', sp, { esRaiz: true });
  return <InicioContenido tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} sp={sp} />;
}
