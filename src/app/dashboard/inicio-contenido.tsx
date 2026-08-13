import Link from 'next/link';
import { Wallet, Calculator, Fuel, PiggyBank, LayoutGrid, CalendarDays, Plus } from 'lucide-react';
import {
  getKpis, getAcreditables, detectarAnomalias, getViajes, getViajesPorMes,
  getGastoPorSemanaSeries, getLiquidadoPorSemanaSeries, getTopRutasPorGastoSeries,
  getSeriesKpiCards, getLiquidaciones,
  type ViajeRow, type LiqRow,
  type DashboardKpis, type Acreditables, type Anomalia,
  type GastoSemanalSeries, type LiquidadoSemanalSeries, type TopRutasSeries, type SeriesKpiCards,
} from '@/lib/likida/analytics';
import { getConfig, type LikidaConfig } from '@/lib/likida/config';
import {
  resolverPeriodo, getGastosFiscales, getGastosFiscalesSeries, resumirPerdidas, opcionesDe,
  type GastoFiscal, type ResumenPerdidas, type GastosFiscalesSeries,
} from '@/lib/likida/fiscal';
import { saludo, ahoraMs } from '@/lib/saludo';
import { fechaMx, TZ_MX } from '@/lib/formato';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { estadoPanel, liquidacionesDeViajes } from './estado';
import {
  BarraPagina, ChipFecha, HeroSaludo, MotorFiscal, TituloSeccion,
  TablaViajes, type FilaViaje,
} from './resumen-visual';
import { StatCard } from '../admin/ui/kit';
import { BarraAcciones, type ItemBusqueda } from './barra-acciones';
import { KpiPeriodo } from './kpi-periodo';
import { MotorFiscalPeriodo } from './motor-fiscal-periodo';
import { PanelPeriodo } from './panel-periodo';
import { AvisoSinFlota } from './sin-flota';

/** Resiliencia por sección: si una consulta falla, devuelve null y la
 *  tarjeta muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * Inicio / Resumen del panel de la FLOTA — todo filtrado al `tenantId` que
 * le pasan. Anatomía de la referencia FlowAI (12-ago-2026): barra de
 * página, saludo con chip de fecha, KPIs con caja interna, la tabla de
 * viajes recientes como protagonista y los bloques de periodo como
 * tarjetas blancas sobre el lienzo tenue.
 *
 * VIVE EN SU PROPIO ARCHIVO, EXPORTADO, y no dentro de `page.tsx`, por dos
 * razones que ya cobraron una vez cada una:
 *  1. Next valida los exports de una Page: `export` de esto dentro de
 *     `page.tsx` rompía `npm run build` ("InicioContenido is not a valid
 *     Page export field", 12-ago-2026).
 *  2. Sin export no se puede montar en un preview headless sin sesión — y
 *     "verificar mirando" es regla del repo. Recibe el tenant YA resuelto
 *     por eso mismo: lo que se verifica es la pantalla real, no una copia.
 */
export async function InicioContenido({
  tenantId, tenantNombre, nombre, tenantExiste = true, sufijo = '',
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `sin-flota.tsx`. Default `true` para no cambiar el render de
   *  ningún cliente real, cuyo tenant existe por llave foránea. */
  tenantExiste?: boolean;
  /** Query string que los links internos deben cargar (`?tenant=`/`?vista=`
   *  del superadmin) — mismo contrato que el sidebar; vacío para roles
   *  reales. Lo arma `page.tsx`, que es quien tiene los searchParams. */
  sufijo?: string;
}) {
  // AUDITORÍA DE DISEÑO, 8-AGO-2026 — sin filtro operativo global 7d/30d:
  //   - `getKpis` sin ventana: "por revisar" y "comprobantes duplicados"
  //     nunca esconden un pendiente real solo por ser viejo.
  //   - `getAcreditables` usa el MISMO periodo que el resto de "Tu motor
  //     fiscal" (el ejercicio fiscal en curso) — dos cifras en la misma
  //     tarjeta con dos "cuándo" distintos se leen como error de captura.
  const hoy = new Date(ahoraMs()).toISOString().slice(0, 10);
  const periodoFiscal = resolverPeriodo(undefined, hoy);
  const diasEjercicio = periodoFiscal.desde
    ? Math.floor((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${periodoFiscal.desde}T00:00:00Z`)) / 86_400_000) + 1
    : undefined;

  const [
    acred, kpis, anomalias, viajes,
    gastoSemanalSeries, liquidadoSemanalSeries, seriesKpis,
    cfgFiscal, gastosFiscales, gastosFiscalesSeries, viajesPorMes, topRutasSeries,
    liquidaciones,
  ] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId, diasEjercicio)),
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    // `estadoPanel`, `PanelPeriodo` (Actividad) y la tabla de viajes
    // recientes reusan este MISMO arreglo.
    safe<ViajeRow[]>(() => getViajes(tenantId)),
    // Semanal/mensual/histórico — mismo selector único que las tarjetas de
    // KPI y el resto de `PanelPeriodo` (dirección del 8-ago-2026).
    safe<GastoSemanalSeries>(() => getGastoPorSemanaSeries(tenantId, hoy)),
    safe<LiquidadoSemanalSeries>(() => getLiquidadoPorSemanaSeries(tenantId, hoy)),
    // Cada tarjeta de KPI cicla su PROPIA granularidad con ‹ ›
    // (dirección del 8-ago-2026). `PanelPeriodo` también lo reusa para la
    // dona "Viajes" (liquidados/pendientes DEL periodo).
    safe<SeriesKpiCards>(() => getSeriesKpiCards(tenantId, hoy)),
    safe<LikidaConfig>(() => getConfig(tenantId)),
    safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodoFiscal)),
    // "En riesgo/perdido" y "Recuperable pidiendo factura" ciclan
    // semanal/mensual/histórico (`MotorFiscalPeriodo`) — serie aparte de
    // `gastosFiscales` (que sigue fija al ejercicio, para el top-causas).
    safe<GastosFiscalesSeries>(() => getGastosFiscalesSeries(tenantId, hoy)),
    // `Actividad` pestaña Histórico — agregado real por mes, SIN el tope de
    // 100 filas de `viajes` (ver nota en `getViajesPorMes`).
    safe<Array<{ dia: string; valor: number }>>(() => getViajesPorMes(tenantId)),
    safe<TopRutasSeries>(() => getTopRutasPorGastoSeries(tenantId, 5, hoy)),
    // Para el "Ver" de la tabla: `/dashboard/[id]` abre por id de
    // LIQUIDACIÓN, no de viaje — se cruza por folio.
    safe<LiqRow[]>(() => getLiquidaciones(tenantId)),
  ]);
  const resumenPerdidas: ResumenPerdidas | null = cfgFiscal && gastosFiscales
    ? resumirPerdidas(gastosFiscales, opcionesDe(cfgFiscal))
    : null;
  // Las 3 vistas de "En riesgo/Recuperable" (`MotorFiscalPeriodo`, cliente) —
  // `resumirPerdidas` es pura: se calcula UNA vez por modo aquí en el
  // servidor y se manda ya resuelta (`fiscal.ts` importa `supabaseAdmin` a
  // nivel de módulo; un Client Component no puede importarlo sin arrastrar
  // el service-role al bundle del navegador).
  const resumenPerdidasSeries: Record<'semanal' | 'mensual' | 'historico', ResumenPerdidas> | null =
    cfgFiscal && gastosFiscalesSeries
      ? {
        semanal: resumirPerdidas(gastosFiscalesSeries.semanal, opcionesDe(cfgFiscal)),
        mensual: resumirPerdidas(gastosFiscalesSeries.mensual, opcionesDe(cfgFiscal)),
        historico: resumirPerdidas(gastosFiscalesSeries.historico, opcionesDe(cfgFiscal)),
      }
      : null;

  // AUDITORÍA 10, ALTO: el estado se decide con VIAJES reales filtrados a
  // `liquidado` (un arreglo que sí puede quedar vacío), no con `porDia`
  // (siempre traía 7/30 elementos y la rama 'vacio' era inalcanzable).
  const estado = estadoPanel({ acreditables: acred, kpis, liquidaciones: liquidacionesDeViajes(viajes), anomalias });

  // `/dashboard/cuadre` se borró el 10-ago-2026 (rediseño desde cero) — las
  // alertas vivían para mandar ahí con "Ver →". `kpis.porRevisar`/`anomalias`
  // se SIGUEN calculando bien; una tarjeta que promete "Ver →" hacia un 404
  // es peor que no mostrarla. Vuelven a poblarse cuando Cuadre exista.
  const alertas: Array<{ texto: string; href: string }> = [];

  // Las 6 filas de la tabla (la referencia enseña ~6). El link "Ver" solo
  // cuando la liquidación existe Y se pudo cruzar — un folio sin cruce se
  // queda sin link, nunca con un link a un 404.
  const liqPorFolio = new Map((liquidaciones ?? []).map((l) => [l.folio, l.id]));
  const filasViajes: FilaViaje[] = (viajes ?? []).slice(0, 6).map((v) => ({
    id: v.id, folio: v.folio, origen: v.origen, destino: v.destino,
    estatus: v.estatus, anticipo: v.anticipo, operadorNombre: v.operadorNombre,
    fechaInicio: v.fechaInicio,
    liqId: v.estatus === 'liquidado' ? liqPorFolio.get(v.folio) ?? null : null,
  }));

  const ICONO_BARRA = { width: 15, height: 15, strokeWidth: 1.75, style: { color: 'var(--muted)' } } as const;

  // La búsqueda de la barra cubre los 100 viajes cargados, no solo las 6
  // filas visibles — encontrar un folio y saber su estado también es una
  // respuesta, aunque todavía no tenga liquidación a la cual navegar.
  const itemsBusqueda: ItemBusqueda[] = (viajes ?? []).map((v) => {
    const liqId = v.estatus === 'liquidado' ? liqPorFolio.get(v.folio) ?? null : null;
    const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? 'sin ruta capturada';
    return {
      etiqueta: v.folio,
      detalle: `${ruta}${v.operadorNombre ? ` · ${v.operadorNombre}` : ''}`,
      href: liqId ? `/dashboard/${liqId}${sufijo}` : null,
    };
  });

  // La campana enseña PENDIENTES reales — los mismos que perdieron su
  // tarjeta cuando Cuadre se borró el 10-ago. Aquí son texto: el link
  // regresa cuando esa página exista.
  const pendientes: string[] = [];
  if (kpis && kpis.porRevisar > 0) {
    pendientes.push(`${kpis.porRevisar} liquidación${kpis.porRevisar === 1 ? '' : 'es'} por revisar`);
  }
  if (anomalias && anomalias.length > 0) {
    pendientes.push(`${anomalias.length} comprobante${anomalias.length === 1 ? '' : 's'} repetido${anomalias.length === 1 ? '' : 's'} entre viajes distintos`);
  }

  return (
    // El scroll vive DENTRO del panel (patrón FASE 1.5). El lienzo del
    // contenido es TENUE (`--g1`) y las piezas son tarjetas blancas encima —
    // la anatomía de la referencia; la barra y el saludo van sobre blanco.
    <main className="h-full">
      <div className="rounded-2xl overflow-hidden min-h-full flex flex-col hairline" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<LayoutGrid {...ICONO_BARRA} />}
          titulo="Resumen"
          derecha={
            <div className="flex items-center gap-2 min-w-0">
              {tenantNombre && (
                <span className="hidden lg:inline-block text-[11px] px-2 py-0.5 rounded-full font-medium shrink-0" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
                  viendo como superadmin · {tenantNombre}
                </span>
              )}
              <BarraAcciones items={itemsBusqueda} pendientes={pendientes} hrefAsistente={`/dashboard/chat${sufijo}`} />
            </div>
          }
        />
        {/* La bienvenida vive DIRECTO sobre el lienzo tenue — corrección de
            Javier sobre la referencia: lo que lleva recuadro blanco es la
            BARRA de arriba, no el saludo. */}
        <HeroSaludo
            saludo={saludo()} nombre={nombre ?? 'flota'}
            tagline="Todo listo para que sigas moviendo tu flota"
            derecha={
              <div className="flex items-center gap-2.5 shrink-0 pt-1">
                {/* El DÍA DE MÉXICO, no el UTC: a las 6pm de CDMX el chip
                    decía mañana (capturado el 12-ago). */}
                <ChipFecha icono={<CalendarDays {...ICONO_BARRA} />}>{fechaMx(new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(new Date(ahoraMs())))}</ChipFecha>
                {/* El CTA negro de la referencia. DESHABILITADO con razón a
                    la vista: crear viaje vive en Despacho, la primera página
                    que se va a reconstruir — un botón que truena en silencio
                    es peor que uno que dice por qué no. Al existir esa
                    página, esto se vuelve un Link. */}
                <button type="button" disabled
                  title="Se habilita con la página de Despacho (la primera por reconstruir)"
                  className="h-8 px-3 rounded-lg text-[13px] font-medium inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
                  <Plus width={15} height={15} strokeWidth={2} /> Nuevo viaje
                </button>
              </div>
            }
        />

        <div className="px-5 pb-5 flex-1">
          {/* ANTES QUE NINGUNA CIFRA. Lo de abajo son ceros de una flota que
              no existe, y esa frase tiene que llegar antes que los ceros. */}
          {!tenantExiste && (
            <div className="mt-3"><AvisoSinFlota tenantId={tenantId} /></div>
          )}

          {alertas.length > 0 && (
            <div className="mt-3 space-y-1.5">
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
            <div className="card p-10 text-center mt-3">
              <p className="text-lg font-semibold tracking-tight">No se pudieron cargar los datos</p>
              <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
                Hubo un problema al leer del sistema. Recarga la página en un momento — esto NO significa
                que no haya liquidaciones, significa que no se pudieron leer.
              </p>
            </div>
          ) : (
            <>
              {/* `vacio` y `datos` son el MISMO layout — `estadoPanel` ya
                  garantiza que todo cargó bien en ambos casos: "vacío" son
                  las mismas piezas con sus propios ceros honestos. */}
              {estado === 'parcial' && (
                <div className="card p-4 flex items-start gap-3 mt-3" style={{ borderColor: 'var(--warn)' }}>
                  <span className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: 'var(--warn)' }} />
                  <div>
                    <p className="text-sm font-semibold m-0">Faltan datos por cargar — esta pantalla está incompleta</p>
                    <p className="text-xs mt-1 m-0" style={{ color: 'var(--muted)' }}>
                      Una o más secciones no respondieron. No tomes estas cifras como el corte del periodo.
                    </p>
                  </div>
                </div>
              )}

              {/* ── KPIs (caja interna + delta como texto, referencia) ──
                  "Total viajes" y "Liquidado" no van aquí: ya se ven como
                  GRÁFICA más abajo. "Ahorro generado" se queda (pedido
                  explícito): mismo número que "Recuperable pidiendo
                  factura", pero fijo al ejercicio fiscal completo. La
                  dirección buena/mala no es igual para las tres: gastar
                  más no es bueno aunque el número suba. */}
              {kpis && (
                <div className="mt-2">
                  {seriesKpis ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <KpiPeriodo icono={<Wallet width={15} height={15} strokeWidth={1.75} />}
                        nombre="Gasto total" campo="gastoTotal" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                      <KpiPeriodo icono={<Calculator width={15} height={15} strokeWidth={1.75} />}
                        nombre="Costo por viaje" campo="costoPorViaje" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                      <StatCard icono={<PiggyBank width={15} height={15} strokeWidth={1.75} />}
                        etiqueta={`Ahorro generado — ${periodoFiscal.etiqueta}`}
                        valor={resumenPerdidas?.montoRecuperable ?? 0} formato="mxn" delta={null} />
                    </div>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el comparativo de KPIs.</p>
                  )}
                </div>
              )}

              {/* ── Motor fiscal — el diferenciador real, no un TMS
                  genérico. Todo lo fiscal vive junto, en UNA tarjeta. */}
              <div className="card p-3 mt-2">
                <TituloSeccion>Tu motor fiscal — {periodoFiscal.etiqueta}</TituloSeccion>
                {/* Las 3 tarjetas en la MISMA línea, todo el ancho (pedido
                    explícito, 8-ago-2026), misma altura (`h-full`). El
                    diésel elegible va en LITROS, no en pesos — el estímulo
                    es cuota DOF (semanal) × litros, y esa cuota no vive
                    aquí. `docs/conocimiento/guion-demo.md` +
                    `guion_demo.test.ts` atan el guion de venta a esto. */}
                <div className="mt-2 flex flex-wrap gap-2 items-stretch">
                  <MotorFiscalPeriodo series={resumenPerdidasSeries} />
                  {acred && (
                    <div className="flex-1 min-w-[200px]">
                      <StatCard icono={<Fuel width={15} height={15} strokeWidth={1.75} />}
                        etiqueta="Diésel elegible para el estímulo" valor={acred.litrosDiesel} formato="litros" delta={null} />
                    </div>
                  )}
                </div>
                <div className="mt-2">
                  <MotorFiscal resumen={resumenPerdidas} />
                </div>
              </div>

              {/* ── La tabla protagonista de la referencia, con los viajes
                  REALES. Sin "Ver todo": la página de Viajes se rehará a su
                  tiempo, y un link muerto anuncia una página que no existe. */}
              <div className="card p-3 mt-2">
                <div className="mb-2"><TituloSeccion>Viajes recientes</TituloSeccion></div>
                <TablaViajes viajes={filasViajes} sufijo={sufijo} />
              </div>

              {/* ── Viajes / Actividad / Gasto por categoría / Liquidado /
                  Top rutas — UN SOLO selector Semanal/Mensual/Histórico que
                  mueve las 5 juntas (pedido explícito, 8-ago-2026). */}
              <div className="mt-2.5">
                <PanelPeriodo
                  viajes={viajes ?? []}
                  porMes={viajesPorMes ?? []}
                  seriesKpis={seriesKpis}
                  gastoSemanalSeries={gastoSemanalSeries}
                  liquidadoSemanalSeries={liquidadoSemanalSeries}
                  topRutasSeries={topRutasSeries}
                />
              </div>
            </>
          )}

          <p className="text-[11px] pt-3" style={{ color: 'var(--faint)' }}>{LEYENDA_CORTA}</p>
        </div>
      </div>
    </main>
  );
}
