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
import { getConfig, type CuadraConfig } from '@/lib/likida/config';
import {
  resolverPeriodo, getGastosFiscales, getGastosFiscalesSeries, resumirPerdidas,
  type GastoFiscal, type ResumenPerdidas, type GastosFiscalesSeries,
} from '@/lib/likida/fiscal';
import { opcionesDe } from './contador/comun';
import { saludo, ahoraMs } from '@/lib/saludo';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { estadoPanel, liquidacionesDeViajes } from './estado';
import {
  HeroSaludo, KpiDegradado,
  MotorFiscal, TituloSeccion,
} from './resumen-visual';
import { KpiPeriodo } from './kpi-periodo';
import { MotorFiscalPeriodo } from './motor-fiscal-periodo';
import { PanelPeriodo } from './panel-periodo';
import { InicioOperacion } from './inicio-operacion';
import { puedeVerArea } from '@/lib/auth/visibilidad';
import { sufijoTenant } from './sufijo';
import { AvisoSinFlota } from './sin-flota';

export const dynamic = 'force-dynamic';

/** Resiliencia por sección: si una consulta falla, devuelve null y la
 *  tarjeta muestra un fallback en vez de tirar toda la pantalla. */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
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
  tenantId, tenantNombre, nombre, sp, tenantExiste = true,
}: {
  tenantId: string;
  tenantNombre: string | null;
  nombre: string | null;
  sp: { vista?: string; tenant?: string; rango?: string; rol?: string } | undefined;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `sin-flota.tsx`. Default `true` para no cambiar el render de
   *  ningún cliente real, cuyo tenant existe por llave foránea. */
  tenantExiste?: boolean;
}) {
  const sufijo = sufijoTenant(sp);

  // AUDITORÍA DE DISEÑO, 8-AGO-2026 — se quitó el filtro operativo 7d/30d/
  // Todo de esta página entera (vivía en un solo `GlobalFilter` arriba de
  // los KPIs). "Gasto por categoría" y "Liquidado por semana" volvieron como
  // GRÁFICAS de las últimas 5 semanas ISO (fijas, sin selector — la cifra ya
  // no vive en un KPI plano de arriba, así que no hace falta que el usuario
  // elija ventana), y con ellas no queda ninguna sección que necesite un
  // corte operativo elegible, así que:
  //   - `getKpis` ya NO recibe ventana: sin corte, para que "por revisar" y
  //     "comprobantes duplicados" (abajo, `alertas`) nunca escondan un
  //     pendiente real solo por ser viejo — ocultar un item accionable
  //     detrás de una ventana que ya no tiene control en pantalla sería un
  //     bug nuevo, no una limpieza.
  //   - `getAcreditables` (el diésel elegible del motor fiscal) ahora usa
  //     el MISMO periodo que el resto de "Tu motor fiscal" (`periodoFiscal`,
  //     el ejercicio fiscal en curso) en vez de una ventana operativa
  //     huérfana — dos cifras en la misma tarjeta con dos "cuándo" distintos
  //     se leen como un error de captura.
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
    // KPI y el resto de `PanelPeriodo` (dirección del 8-ago-2026: antes
    // esta gráfica vivía fija a 5 semanas, sin selector).
    safe<GastoSemanalSeries>(() => getGastoPorSemanaSeries(tenantId, hoy)),
    safe<LiquidadoSemanalSeries>(() => getLiquidadoPorSemanaSeries(tenantId, hoy)),
    // Semanal/mensual/histórico para las flechas ‹ › de las tarjetas de KPI
    // (dirección del 8-ago-2026) — cada tarjeta cicla su PROPIA
    // granularidad, independiente de las demás. `PanelPeriodo` también lo
    // reusa para la dona "Viajes" (liquidados/pendientes DEL periodo).
    safe<SeriesKpiCards>(() => getSeriesKpiCards(tenantId, hoy)),
    safe<CuadraConfig>(() => getConfig(tenantId)),
    safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodoFiscal)),
    // "En riesgo/perdido" y "Recuperable pidiendo factura" también ciclan
    // semanal/mensual/histórico ahora (`MotorFiscalPeriodo`) — serie
    // aparte de `gastosFiscales` (que sigue fija al ejercicio, para el
    // top-causas de "Tu motor fiscal" más abajo).
    safe<GastosFiscalesSeries>(() => getGastosFiscalesSeries(tenantId, hoy)),
    // `Actividad` pestaña Histórico — agregado real por mes, SIN el tope de
    // 100 filas de `viajes` (ver nota en `getViajesPorMes`): un tope ahí se
    // leería como "todo el histórico" en una flota que ya lo superó.
    safe<Array<{ dia: string; valor: number }>>(() => getViajesPorMes(tenantId)),
    safe<TopRutasSeries>(() => getTopRutasPorGastoSeries(tenantId, 5, hoy)),
  ]);
  const resumenPerdidas: ResumenPerdidas | null = cfgFiscal && gastosFiscales
    ? resumirPerdidas(gastosFiscales, opcionesDe(cfgFiscal))
    : null;
  // Las 3 vistas de "En riesgo/Recuperable" (`MotorFiscalPeriodo`, cliente) —
  // `resumirPerdidas` es pura, así que se calcula UNA vez por modo aquí en
  // el servidor y se manda ya resuelta: `fiscal.ts` importa `supabaseAdmin`
  // a nivel de módulo, así que un Client Component no puede importar esa
  // función en tiempo de ejecución sin arrastrar el service-role al bundle
  // del navegador (mismo caso que `pctCambio` se movió de `analytics.ts` a
  // `formato.ts` el 8-ago).
  const resumenPerdidasSeries: Record<'semanal' | 'mensual' | 'historico', ResumenPerdidas> | null =
    cfgFiscal && gastosFiscalesSeries
      ? {
        semanal: resumirPerdidas(gastosFiscalesSeries.semanal, opcionesDe(cfgFiscal)),
        mensual: resumirPerdidas(gastosFiscalesSeries.mensual, opcionesDe(cfgFiscal)),
        historico: resumirPerdidas(gastosFiscalesSeries.historico, opcionesDe(cfgFiscal)),
      }
      : null;

  // `liquidaciones` ya no se carga en esta página (se fue a /dashboard/cuadre),
  // así que el estado se decide con lo que SÍ vive aquí. AUDITORÍA 10, ALTO:
  // antes se le pasaba `porDia` (getLiquidacionesPorDia) en este lugar —
  // SIEMPRE tiene 7 o 30 elementos, uno por día, así que `.length` nunca daba
  // 0 y la rama 'vacio' de `estadoPanel` era inalcanzable ("0% tasa de
  // cuadre" se pintaba siempre). `liquidacionesDeViajes` filtra los VIAJES
  // reales (ya cargados arriba para "Actividad") a los que de verdad están
  // `liquidado` — un arreglo que sí puede quedar vacío.
  const estado = estadoPanel({ acreditables: acred, kpis, liquidaciones: liquidacionesDeViajes(viajes), anomalias });

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
    <main>
      <div className="glass-panel overflow-hidden">
        <HeroSaludo saludo={saludo()} nombre={nombre ?? 'flota'} tagline="Todo listo para que sigas moviendo tu flota" />

        {/* "Señalado por el motor" no está en la dirección visual del 7-ago
            — se retiró de aquí junto con la fila que los traía (el
            Calendario que daba la fecha también se quitó, 8-ago). El único
            sobreviviente de esa fila es la insignia de previsualización del
            superadmin: sin ella, un superadmin viendo "como Dueño" no tiene
            forma de saber que no es su propia cuenta. */}
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
                garantiza que todo cargó bien en ambos casos (ver estado.ts),
                así que "vacío" no es una pantalla aparte: son las mismas
                piezas con sus propios ceros honestos (`Dona` ya trae su
                fallback de "aún no hay X" cuando el arreglo viene vacío).
                Antes había una tarjeta centrada distinta con un botón "Ver
                el demo" — dos pantallas para un panel que solo tiene una
                flota real dada de alta se leía como que el producto no
                estaba terminado. */}
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

            {/* ── KPIs de la flota, en degradado (dirección de diseño del 7-ago-2026,
                revisada el 8-ago) ── "Total viajes" y "Liquidado" salieron de
                aquí: sus números ya se ven como GRÁFICA más abajo (la dona
                "Viajes" y "Liquidado por semana") — un KPI plano al lado de
                la misma cifra en gráfica es la cifra dos veces, no
                información nueva. "Ahorro generado" se queda (pedido
                explícito): mismo número que "Recuperable pidiendo factura"
                en Motor fiscal, pero fijo al ejercicio fiscal completo, no
                al ciclo semanal/mensual/histórico de esa tarjeta — la
                lectura "de todo el año" vale la pena tenerla arriba aunque
                se repita el dato. La dirección buena/mala no es la misma
                para las tres: gastar más no es bueno aunque el número
                suba (al revés de "más ahorro"). */}
            {kpis && (
              <div className="px-5 pb-4 pt-2">
                {seriesKpis ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <KpiPeriodo icono={<Wallet width={17} height={17} strokeWidth={1.75} />}
                      nombre="Gasto total" campo="gastoTotal" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                    <KpiPeriodo icono={<Calculator width={17} height={17} strokeWidth={1.75} />}
                      nombre="Costo por viaje" campo="costoPorViaje" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                    <KpiDegradado icono={<PiggyBank width={17} height={17} strokeWidth={1.75} />}
                      etiqueta={`Ahorro generado — ${periodoFiscal.etiqueta}`}
                      valor={resumenPerdidas?.montoRecuperable ?? 0} formato="mxn" />
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el comparativo de KPIs.</p>
                )}
              </div>
            )}

            {/* ── Motor fiscal — el diferenciador real, no un TMS genérico ──
                Subido justo debajo de los KPIs (dirección del 8-ago-2026):
                antes vivía hasta el fondo de la página. "En riesgo/perdido"
                y "Recuperable pidiendo factura" van ALINEADAS bajo este
                mismo título — antes eran una sección aparte, sin
                encabezado propio, flotando entre los KPI y "Tu motor
                fiscal"; ahora todo lo fiscal vive junto, con un solo
                título. */}
            <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
              <TituloSeccion>Tu motor fiscal — {periodoFiscal.etiqueta}</TituloSeccion>
              {/* Las 3 tarjetas en la MISMA línea, ocupando todo el ancho
                  (pedido explícito, 8-ago-2026: "que ocupen todo el ancho
                  de la pantalla", anchos desiguales están bien) y de la
                  MISMA altura (`h-full` en `KpiDegradado` — sin eso, la de
                  2 líneas quedaba más baja que las de 3). El diésel
                  elegible va en LITROS, no en pesos — el estímulo es cuota
                  DOF (semanal) × litros, y esa cuota no vive aquí.
                  `docs/conocimiento/guion-demo.md` + `guion_demo.test.ts`
                  atan el guion de venta a esto: si esto cambia, el guion
                  tiene que cambiar con ello. */}
              <div className="mt-3 flex flex-wrap gap-2.5 items-stretch">
                <MotorFiscalPeriodo series={resumenPerdidasSeries} />
                {acred && (
                  <div className="flex-1 min-w-[200px]">
                    <KpiDegradado icono={<Fuel width={17} height={17} strokeWidth={1.75} />}
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
                mueve las 5 juntas (pedido explícito, 8-ago-2026).
                "Próximos vencimientos" se quitó (pedido explícito, mismo
                día). */}
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
  const { tenantId, tenantNombre, nombre, rol, tenantExiste } = await resolverTenantEfectivo('/dashboard', sp, { esRaiz: true });

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
    return <InicioOperacion tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} sp={sp} tenantExiste={tenantExiste} />;
  }

  return <InicioContenido tenantId={tenantId} tenantNombre={tenantNombre} nombre={nombre} sp={sp} tenantExiste={tenantExiste} />;
}
