import Link from 'next/link';
import { Fuel, Receipt, Route as RouteIcon, Truck, Wallet, AlertTriangle, Percent } from 'lucide-react';
import {
  getKpis, getAcreditables, detectarAnomalias, getLiquidacionesPorDia, getViajes,
  type ViajeRow,
  type DashboardKpis, type Acreditables, type Anomalia,
} from '@/lib/cuadra/analytics';
import { saludo, fechaLarga, ahoraMs } from '@/lib/saludo';
import { LEYENDA_CORTA } from '@/lib/cuadra/cuadre/leyendas';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { estadoPanel } from './estado';
import { BarChartSimple } from '../admin/charts';
import { GlobalFilter } from '../admin/ui/global-filter';
import { KpiTile } from '../admin/ui/kit';
import CifraGrande from './cifra-grande';
import AvanceCierre from './avance-cierre';
import { InicioOperacion } from './inicio-operacion';
import { puedeVerArea } from '@/lib/auth/visibilidad';
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
  // Por defecto 7 DÍAS, igual que /admin — decisión de Javier (3-ago-2026).
  //
  // ESTO REVIERTE UNA DECISIÓN ANTERIOR Y HAY QUE SABER QUÉ SE ACEPTA. El
  // default era 30 porque este filtro no mueve una gráfica de actividad como
  // en /admin: mueve los ACREDITABLES FISCALES. Con ventana de 7 días el
  // panel puede abrir con "IVA acreditable $0.00 · Peaje $0.00" teniendo
  // miles de pesos acumulados un poco más atrás, y un cero de encuadre se lee
  // como un cero de la flota. El mes es además la unidad en la que un
  // contralor piensa su corte.
  //
  // Si en el demo el panel abre en ceros con datos existiendo, es esto: se
  // cambia el default de vuelta a '30' en esta línea.
  const rango = sp?.rango === '30' ? '30' : sp?.rango === 'todo' ? 'todo' : '7';
  const ventanaDias = rango === '30' ? 30 : 7;
  const sufijo = sufijoTenant(sp);

  // El filtro de arriba mueve TODO, no solo la gráfica: con 'todo' se pasa
  // `undefined` (sin corte) y con 7/30 la misma ventana a las tres consultas,
  // para que los rótulos "del periodo" digan la verdad.
  const ventana = rango === 'todo' ? undefined : ventanaDias;
  const [acred, kpis, anomalias, porDia, viajes] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId, ventana)),
    safe<DashboardKpis>(() => getKpis(tenantId, ventana)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    safe<Array<{ dia: string; valor: number }>>(() => getLiquidacionesPorDia(tenantId, ventanaDias)),
    // Para la barra de avance de cierre: se traen los viajes con su fecha y
    // estatus y el filtro por periodo se hace en el cliente, así cambiar de
    // semana a mes no cuesta una consulta por clic.
    safe<ViajeRow[]>(() => getViajes(tenantId)),
  ]);
  const etiquetaVentana = rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`;

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

  return (
    // Mismo criterio que en `inicio-operacion.tsx`: el scroll vive DENTRO del
    // panel. Con la columna scrolleando, el recuadro se corta a media fila de
    // KPIs y su borde redondeado no aparece nunca — se lee como interfaz rota.
    <main className="h-full flex flex-col">
      <div className="glass-panel overflow-hidden flex flex-col min-h-0">
        {/* Encabezado FIJO: el saludo y la cifra grande no se van al hacer
            scroll — son el marco de referencia de todo lo de abajo. */}
        <div className="px-5 pt-3 pb-3 flex items-start justify-between gap-6 shrink-0">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl tracking-tight truncate" style={{ fontFamily: 'var(--font-display), var(--font-sans)', fontWeight: 600 }}>
              {saludo()}, {nombre ?? 'flota'}
            </h1>
            <p className="text-[13px] mt-0.5 capitalize" style={{ color: 'var(--muted)' }}>{fechaLarga()}</p>
            {tenantNombre && (
              <span className="inline-block mt-1 text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
                viendo como superadmin · {tenantNombre}
              </span>
            )}
            {/* La barra vive DENTRO de la columna del saludo, no debajo del
                bloque: así queda al nivel de la cifra grande y se corta antes
                de ella en vez de pasarle por abajo y estirar el encabezado. */}
            <AvanceCierre viajes={viajes ?? []} ahoraMs={ahoraMs()} />
          </div>
          {/* `CifraGrande`, no el `ContadorRetro` de tiles negros: ese reloj
              Solari es el guiño de la consola INTERNA y ahí se queda. Y no
              repite el "Monto comprobado" del grid de abajo —era la misma
              cifra dos veces en pantalla— sino lo que el motor SEÑALÓ, que es
              lo único aquí que solo Likida pone sobre la mesa. */}
          <CifraGrande
            valor={kpis?.diferenciaDetectada ?? 0}
            formato="mxn"
            etiqueta="Señalado por el motor"
            nota={`Sobre política y duplicados · ${etiquetaVentana}`}
          />
        </div>

        {/* TODO LO DEMÁS SCROLLEA AQUÍ ADENTRO. El panel conserva su borde
            redondeado abajo —no se corta a media fila como antes— y el
            contenido que no cabe se recorre sin mover el encabezado. */}
        <div className="flex-1 min-h-0 overflow-y-auto">

        {alertas.length > 0 && (
          <div className="px-5 pb-3.5 space-y-1.5">
            {alertas.map((a) => (
              <Link key={a.href} href={a.href}
                className="card p-3 flex items-center gap-2.5 hover:opacity-85 transition-opacity"
                style={{ borderColor: 'var(--warn)' }}>
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warn)' }} />
                <span className="text-[13px]">{a.texto}</span>
                <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--muted)' }}>Ver →</span>
              </Link>
            ))}
          </div>
        )}

        {estado === 'error' ? (
          <div className="px-5 pb-5 pt-1">
            <div className="card p-10 text-center">
              <p className="text-lg font-semibold tracking-tight">No se pudieron cargar los datos</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                Hubo un problema al leer del sistema. Recarga la página en un momento — esto NO significa
                que no haya liquidaciones, significa que no se pudieron leer.
              </p>
            </div>
          </div>
        ) : estado === 'vacio' ? (
          <div className="px-5 pb-5 pt-1">
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
            <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between gap-4 mb-3">
                <TituloSeccion>
                  Liquidaciones cerradas — {rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`}
                </TituloSeccion>
                <GlobalFilter base="/dashboard" pordefecto="30" activo={rango} extra={sp?.tenant ? { tenant: sp.tenant } : sp?.vista ? { vista: sp.vista } : undefined} />
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
            <section className="p-4 border-t" style={{ borderColor: 'var(--line)' }}>
              <TituloSeccion>Estímulos acreditables</TituloSeccion>
              {acred === null ? (
                <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mt-2.5">
                  <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Diésel elegible para el estímulo" valor={acred.litrosDiesel} formato="litros" destacar
                    nota="LIF 2026, Art. 20-A — su contador aplica la cuota semanal vigente" />
                  <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="IVA acreditable" valor={acred.iva} formato="mxn"
                    nota="LIVA, Art. 5 — CFDI con IVA desglosado" />
                  <KpiTile icono={<RouteIcon width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Peaje (50%)" valor={acred.peaje} formato="mxn"
                    nota="Estímulo de autopistas · LIF 2026, Art. 20-A" />
                </div>
              )}
            </section>

            {/* ── Liquidaciones ── */}
            <section className="p-4 border-t" style={{ borderColor: 'var(--line)' }}>
              <div className="flex items-center justify-between gap-4">
                <TituloSeccion>Liquidaciones</TituloSeccion>
                <Link href={`/dashboard/cuadre${sufijo}`} className="text-xs font-medium px-2.5 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity shrink-0">
                  Ver detalle →
                </Link>
              </div>
              {kpis === null ? (
                <div className="card p-4 mt-3 text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-2.5">
                  <KpiTile icono={<Truck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Viajes liquidados" valor={kpis.viajesLiquidados} formato="entero" />
                  <KpiTile icono={<Wallet width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Monto comprobado" valor={kpis.montoComprobado} formato="mxn" />
                  <KpiTile icono={<AlertTriangle width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Con diferencia" valor={kpis.conDiferencias + kpis.porRevisar} formato="entero" />
                  <KpiTile icono={<Percent width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                    etiqueta="Tasa de cuadre" valor={kpis.tasaCuadre} formato="porcentaje" />
                </div>
              )}
            </section>
          </>
        )}

        <p className="text-xs px-5 pb-5 pt-1" style={{ color: 'var(--muted)' }}>{LEYENDA_CORTA}</p>
        </div>
      </div>
    </main>
  );

}

/** La página real: resuelve quién eres y a qué flota apuntas, y pinta el
 *  contenido de arriba. `esRaiz` hace que un superadmin sin `?tenant=` ni
 *  `?vista=demo` se vaya a SU consola (/admin) en vez de quedarse viendo la
 *  demo por accidente — ver `resolverTenantEfectivo`. */
export default async function DashboardInicio({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rango?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantNombre, nombre, rol } = await resolverTenantEfectivo('/dashboard', sp, { esRaiz: true });

  // DOS CASAS DISTINTAS EN LA MISMA PUERTA.
  //
  // El Resumen de arriba es del DUEÑO: abre con lo que el motor señaló en
  // pesos, los acreditables fiscales y el monto comprobado. El encargado no
  // ve nada de eso (visibilidad.ts), así que aterrizaba en una pantalla
  // hecha para otro rol. No se le esconden secciones al Resumen del dueño —
  // eso deja un queso gruyere—: se le da su propia pantalla, con las mismas
  // piezas y otro contenido.
  //
  // El criterio es "¿ve dinero?" y no "¿es encargado?": un rol nuevo que
  // tampoco vea finanzas cae aquí solo, sin tocar esta línea.
  if (!puedeVerArea(rol, 'dinero')) {
    return <InicioOperacion tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} sp={sp} />;
  }

  return <InicioContenido tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} sp={sp} />;
}
