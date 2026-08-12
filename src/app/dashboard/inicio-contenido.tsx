import Link from 'next/link';
import { Wallet, Calculator, Fuel, PiggyBank } from 'lucide-react';
import {
  getKpis, getAcreditables, detectarAnomalias, getViajes, getViajesPorMes,
  getGastoPorSemanaSeries, getLiquidadoPorSemanaSeries, getTopRutasPorGastoSeries,
  getSeriesKpiCards,
  type ViajeRow,
  type DashboardKpis, type Acreditables, type Anomalia,
  type GastoSemanalSeries, type LiquidadoSemanalSeries, type TopRutasSeries, type SeriesKpiCards,
} from '@/lib/likida/analytics';
import { getConfig, type LikidaConfig } from '@/lib/likida/config';
import {
  resolverPeriodo, getGastosFiscales, getGastosFiscalesSeries, resumirPerdidas, opcionesDe,
  type GastoFiscal, type ResumenPerdidas, type GastosFiscalesSeries,
} from '@/lib/likida/fiscal';
import { saludo, ahoraMs } from '@/lib/saludo';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { estadoPanel, liquidacionesDeViajes } from './estado';
import { HeroSaludo, MotorFiscal, TituloSeccion } from './resumen-visual';
import { StatCard } from '../admin/ui/kit';
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
 * le pasan. El detalle por liquidación y la lista de anomalías no viven
 * aquí: Inicio es el vistazo, no el expediente.
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
  tenantId, tenantNombre, nombre, tenantExiste = true,
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `sin-flota.tsx`. Default `true` para no cambiar el render de
   *  ningún cliente real, cuyo tenant existe por llave foránea. */
  tenantExiste?: boolean;
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
  ] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId, diasEjercicio)),
    safe<DashboardKpis>(() => getKpis(tenantId)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    // `estadoPanel` y `PanelPeriodo` (Actividad) reusan este MISMO arreglo.
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

  return (
    // El scroll vive DENTRO del panel (patrón FASE 1.5): con la columna
    // scrolleando, el recuadro se corta a media fila y su borde redondeado
    // no aparece nunca — se lee como interfaz rota.
    <main>
      <div className="glass-panel overflow-hidden">
        <HeroSaludo saludo={saludo()} nombre={nombre ?? 'flota'} tagline="Todo listo para que sigas moviendo tu flota" />

        {/* La insignia de previsualización del superadmin: sin ella, un
            superadmin viendo "como Dueño" no sabe que no es su cuenta. */}
        {tenantNombre && (
          <div className="px-5 pt-2">
            <span className="inline-block text-[11px] px-2 py-0.5 rounded-full font-medium" style={{ color: 'var(--accent-fg)', background: 'var(--accent)' }}>
              viendo como superadmin · {tenantNombre}
            </span>
          </div>
        )}

        {/* ANTES QUE NINGUNA CIFRA. Lo de abajo son ceros de una flota que no
            existe, y esa frase tiene que llegar antes que los ceros. */}
        {!tenantExiste && (
          <div className="px-5 pt-2 pb-3.5"><AvisoSinFlota tenantId={tenantId} /></div>
        )}

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
        ) : (
          <>
            {/* `vacio` y `datos` son el MISMO layout — `estadoPanel` ya
                garantiza que todo cargó bien en ambos casos: "vacío" son las
                mismas piezas con sus propios ceros honestos. */}
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

            {/* ── KPIs de la flota (StatCard v3, 12-ago-2026) ── "Total
                viajes" y "Liquidado" no van aquí: ya se ven como GRÁFICA más
                abajo. "Ahorro generado" se queda (pedido explícito): mismo
                número que "Recuperable pidiendo factura", pero fijo al
                ejercicio fiscal completo — la lectura "de todo el año" vale
                la pena arriba aunque se repita el dato. La dirección
                buena/mala no es igual para las tres: gastar más no es bueno
                aunque el número suba. */}
            {kpis && (
              <div className="px-5 pb-4 pt-2">
                {seriesKpis ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <KpiPeriodo icono={<Wallet width={17} height={17} strokeWidth={1.75} />}
                      nombre="Gasto total" campo="gastoTotal" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                    <KpiPeriodo icono={<Calculator width={17} height={17} strokeWidth={1.75} />}
                      nombre="Costo por viaje" campo="costoPorViaje" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                    <StatCard icono={<PiggyBank width={17} height={17} strokeWidth={1.75} />}
                      etiqueta={`Ahorro generado — ${periodoFiscal.etiqueta}`}
                      valor={resumenPerdidas?.montoRecuperable ?? 0} formato="mxn" />
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el comparativo de KPIs.</p>
                )}
              </div>
            )}

            {/* ── Motor fiscal — el diferenciador real, no un TMS genérico.
                "En riesgo/perdido" y "Recuperable pidiendo factura" van
                ALINEADAS bajo este mismo título: todo lo fiscal vive junto. */}
            <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
              <TituloSeccion>Tu motor fiscal — {periodoFiscal.etiqueta}</TituloSeccion>
              {/* Las 3 tarjetas en la MISMA línea, todo el ancho (pedido
                  explícito, 8-ago-2026), misma altura (`h-full`). El diésel
                  elegible va en LITROS, no en pesos — el estímulo es cuota
                  DOF (semanal) × litros, y esa cuota no vive aquí.
                  `docs/conocimiento/guion-demo.md` + `guion_demo.test.ts`
                  atan el guion de venta a esto. */}
              <div className="mt-3 flex flex-wrap gap-2.5 items-stretch">
                <MotorFiscalPeriodo series={resumenPerdidasSeries} />
                {acred && (
                  <div className="flex-1 min-w-[200px]">
                    <StatCard icono={<Fuel width={17} height={17} strokeWidth={1.75} />}
                      etiqueta="Diésel elegible para el estímulo" valor={acred.litrosDiesel} formato="litros" />
                  </div>
                )}
              </div>
              <div className="mt-3">
                <MotorFiscal resumen={resumenPerdidas} />
              </div>
            </div>

            {/* ── Viajes / Actividad / Gasto por categoría / Liquidado /
                Top rutas — UN SOLO selector Semanal/Mensual/Histórico que
                mueve las 5 juntas (pedido explícito, 8-ago-2026). */}
            <div className="border-t pt-4" style={{ borderColor: 'var(--line)' }}>
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

        <p className="text-xs px-5 pb-5 pt-1" style={{ color: 'var(--muted)' }}>{LEYENDA_CORTA}</p>
      </div>
    </main>
  );
}
