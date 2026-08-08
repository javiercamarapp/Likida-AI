import Link from 'next/link';
import { Truck, Wallet, Calculator, Receipt, Fuel } from 'lucide-react';
import {
  getKpis, getAcreditables, detectarAnomalias, getLiquidacionesPorDia, getViajes, getViajesPorMes,
  contarViajes, getGastoPorConcepto, getGastoPorRuta,
  getSeriesKpiCards, getViajesConDiferencia, getViajesConCfdiSinValidar,
  type ViajeRow,
  type DashboardKpis, type Acreditables, type Anomalia,
  type GastoPorConcepto, type GastoPorRuta, type SeriesKpiCards,
} from '@/lib/likida/analytics';
import { getPorFacturar, type TicketPorFacturar } from '@/lib/likida/facturacion/pendientes';
import { getConfig, type CuadraConfig } from '@/lib/likida/config';
import { resolverPeriodo, getGastosFiscales, resumirPerdidas, type GastoFiscal, type ResumenPerdidas } from '@/lib/likida/fiscal';
import { opcionesDe } from './contador/comun';
import { saludo, ahoraMs } from '@/lib/saludo';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { estadoPanel, liquidacionesDeViajes } from './estado';
import { AreaChartSimple, Dona } from '../admin/charts';
import { HBars } from '../admin/ui/graficas';
import { GlobalFilter, resolverRango } from '../admin/ui/global-filter';
import {
  HeroSaludo, KpiDegradado, ProximosVencimientos,
  Pendientes, ViajesAtencion, MotorFiscal, TituloSeccion,
} from './resumen-visual';
import { KpiPeriodo } from './kpi-periodo';
import { Actividad } from './actividad';
import AvanceCierre from './avance-cierre';
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
  // cambia el default de vuelta a '30' en esta línea — y el filtro se entera
  // solo, que es justo lo que antes no pasaba (ver `resolverRango`).
  const r = resolverRango(sp?.rango, '7');
  const { rango, ventanaDias, ventana } = r;
  const sufijo = sufijoTenant(sp);

  // El filtro de arriba mueve TODO, no solo la gráfica: con 'todo' se pasa
  // `undefined` (sin corte) y con 7/30 la misma ventana a las tres consultas,
  // para que los rótulos "del periodo" digan la verdad.
  // Fiscal: mismo motor que /dashboard/contador/deducciones (getGastosFiscales
  // + resumirPerdidas + opcionesDe), no una copia — es el diferenciador real
  // contra un TMS genérico, y solo puede decir la verdad si usa el mismo
  // cálculo que ya se audita ahí. `resolverPeriodo(undefined, hoy)` cae al
  // default de esa pantalla ('ejercicio', el año fiscal en curso) — el
  // filtro 7d/30d/Todo de arriba es OPERATIVO, no fiscal, y mezclarlos haría
  // que "0 en 7 días" se leyera como "sin riesgo fiscal", que no es lo que
  // mide un corte de una semana.
  const hoy = new Date(ahoraMs()).toISOString().slice(0, 10);
  const periodoFiscal = resolverPeriodo(undefined, hoy);

  const [
    acred, kpis, anomalias, porDia, viajes, totalViajes,
    gastoConcepto, gastoRuta, porFacturar, seriesKpis, diferenciasPorViaje, cfdiSinValidar,
    cfgFiscal, gastosFiscales, viajesPorMes,
  ] = await Promise.all([
    safe<Acreditables>(() => getAcreditables(tenantId, ventana)),
    safe<DashboardKpis>(() => getKpis(tenantId, ventana)),
    safe<Anomalia[]>(() => detectarAnomalias(tenantId)),
    safe<Array<{ dia: string; valor: number }>>(() => getLiquidacionesPorDia(tenantId, ventanaDias)),
    // Para la barra de avance de cierre: se traen los viajes con su fecha y
    // estatus y el filtro por periodo se hace en el cliente, así cambiar de
    // semana a mes no cuesta una consulta por clic. "Requiere tu atención"
    // de abajo reusa este MISMO arreglo en vez de pedirlo de nuevo.
    safe<ViajeRow[]>(() => getViajes(tenantId)),
    // Piezas del Resumen visual (dirección elegida 7-ago-2026): cada una
    // envuelta en `safe` por separado, así que si una consulta nueva falla
    // no tumba el resto de una pantalla que ya funcionaba.
    safe<number | null>(() => contarViajes(tenantId)),
    safe<GastoPorConcepto[]>(() => getGastoPorConcepto(tenantId)),
    safe<GastoPorRuta[]>(() => getGastoPorRuta(tenantId)),
    safe<TicketPorFacturar[]>(() => getPorFacturar(tenantId)),
    // Semanal/mensual/histórico para las flechas ‹ › de las 4 tarjetas de
    // KPI (dirección del 8-ago-2026) — INDEPENDIENTE del filtro 'todo'/
    // '7'/'30' de arriba (ese ahora solo mueve la gráfica de "Liquidado",
    // ver `GlobalFilter` más abajo): cada tarjeta cicla su PROPIA
    // granularidad, no un rango compartido de la página.
    safe<SeriesKpiCards>(() => getSeriesKpiCards(tenantId, hoy)),
    safe<Map<string, number>>(() => getViajesConDiferencia(tenantId)),
    safe<Set<string>>(() => getViajesConCfdiSinValidar(tenantId)),
    safe<CuadraConfig>(() => getConfig(tenantId)),
    safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodoFiscal)),
    // `Actividad` pestaña Histórico — agregado real por mes, SIN el tope de
    // 100 filas de `viajes` (ver nota en `getViajesPorMes`): un tope ahí se
    // leería como "todo el histórico" en una flota que ya lo superó.
    safe<Array<{ dia: string; valor: number }>>(() => getViajesPorMes(tenantId)),
  ]);
  const resumenPerdidas: ResumenPerdidas | null = cfgFiscal && gastosFiscales
    ? resumirPerdidas(gastosFiscales, opcionesDe(cfgFiscal))
    : null;

  // `liquidaciones` ya no se carga en esta página (se fue a /dashboard/cuadre),
  // así que el estado se decide con lo que SÍ vive aquí. AUDITORÍA 10, ALTO:
  // antes se le pasaba `porDia` (getLiquidacionesPorDia) en este lugar —
  // SIEMPRE tiene 7 o 30 elementos, uno por día, así que `.length` nunca daba
  // 0 y la rama 'vacio' de `estadoPanel` era inalcanzable ("0% tasa de
  // cuadre" se pintaba siempre). `liquidacionesDeViajes` filtra los VIAJES
  // reales (ya cargados abajo para `AvanceCierre`) a los que de verdad están
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
                piezas con sus propios ceros honestos (`Dona`,
                `ProximosVencimientos` y `TablaViajesRecientes` ya traen su
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

            {/* ── KPIs de la flota, en degradado (dirección de diseño del 7-ago-2026) ──
                La dirección buena/mala NO es la misma para las cuatro: gastar
                más no es bueno para un jefe de flota aunque el número suba
                (al revés de "más viajes" o "más liquidado"). Costo por
                viaje es el que estaba escondido dividiendo gasto entre
                viajes en la cabeza de quien mira dos tarjetas "positivas"
                por separado. */}
            {kpis && (
              <div className="px-5 pb-4 pt-2">
                {seriesKpis ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <KpiPeriodo icono={<Wallet width={17} height={17} strokeWidth={1.75} />}
                      nombre="Gasto total" campo="gastoTotal" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                    <KpiPeriodo icono={<Truck width={17} height={17} strokeWidth={1.75} />}
                      nombre="Total viajes" campo="totalViajes" formato="entero" subeEsBueno={true} series={seriesKpis} />
                    <KpiPeriodo icono={<Calculator width={17} height={17} strokeWidth={1.75} />}
                      nombre="Costo por viaje" campo="costoPorViaje" formato="mxn" subeEsBueno={false} series={seriesKpis} />
                    <KpiPeriodo icono={<Receipt width={17} height={17} strokeWidth={1.75} />}
                      nombre="Liquidado" campo="liquidado" formato="mxn" subeEsBueno={true} series={seriesKpis} />
                  </div>
                ) : (
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar el comparativo de KPIs.</p>
                )}
              </div>
            )}

            {/* Línea de carga animada, a todo lo ancho — pedido explícito de
                Javier tras quitar la columna angosta donde vivía antes. */}
            <div className="px-5 pb-4">
              <AvanceCierre viajes={viajes ?? []} ahoraMs={ahoraMs()} rango={rango} />
            </div>

            {/* ── Próximos vencimientos / Viajes / Actividad ── */}
            <div className="px-5 pb-4 border-t pt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4" style={{ borderColor: 'var(--line)' }}>
              <div>
                <TituloSeccion>Próximos vencimientos</TituloSeccion>
                <div className="mt-2.5">
                  {porFacturar ? (
                    <ProximosVencimientos items={porFacturar.map((t) => ({
                      nombre: t.comercio?.nombre ?? t.concepto,
                      monto: t.monto,
                      caducidad: t.caducidad,
                    }))} />
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</p>
                  )}
                </div>
              </div>
              <div>
                <TituloSeccion>Viajes</TituloSeccion>
                <div className="mt-2.5">
                  {kpis && totalViajes !== null && totalViajes !== undefined && totalViajes > 0 ? (
                    <Dona segmentos={[
                      { etiqueta: 'Liquidados', valor: kpis.viajesLiquidados },
                      { etiqueta: 'Pendientes', valor: Math.max(0, totalViajes - kpis.viajesLiquidados) },
                    ]} />
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>Aún no hay viajes registrados.</p>
                  )}
                </div>
              </div>
              {/* Ocupa el doble de ancho que sus vecinas (el Calendario que
                  vivía aquí se quitó, 8-ago-2026) — más ancho y más alto,
                  pedido explícito para que la gráfica de Histórico (estilo
                  bolsa, `AreaChartSimple`) tenga aire. */}
              <div className="md:col-span-2">
                <Actividad viajes={viajes ?? []} porMes={viajesPorMes ?? []} />
              </div>
            </div>

            {/* ── Gasto por categoría / Liquidado por semana / Viajes recientes ── */}
            <div className="px-5 pb-4 border-t pt-4 grid grid-cols-1 xl:grid-cols-3 gap-4" style={{ borderColor: 'var(--line)' }}>
              <div>
                <TituloSeccion>Gasto por categoría</TituloSeccion>
                <div className="mt-2.5">
                  {gastoConcepto && gastoConcepto.length > 0 ? (
                    <Dona segmentos={gastoConcepto.map((g) => ({ etiqueta: g.concepto, valor: g.total }))} />
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>Aún no hay gastos capturados.</p>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-2">
                  <TituloSeccion>Liquidado — {rango === 'todo' ? 'histórico' : `últimos ${ventanaDias} días`}</TituloSeccion>
                  {/* Único control de rango que queda en la página — las 4
                      tarjetas de KPI de arriba ya no lo usan (dirección del
                      8-ago-2026, flechas ‹ › independientes por tarjeta);
                      esta gráfica sigue siendo la única sección que
                      necesita elegir 7d/30d/Todo. */}
                  <GlobalFilter base="/dashboard" r={r} extra={sufijoTenantParams(sp)} />
                </div>
                <div className="mt-2.5">
                  {rango === 'todo' ? (
                    <div className="flex flex-col items-center justify-center" style={{ height: 140 }}>
                      <div className="text-3xl font-semibold tracking-tight tabular">{kpis?.viajesLiquidados ?? 0}</div>
                      <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>liquidaciones cerradas — total histórico</div>
                    </div>
                  ) : porDia === null ? (
                    <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 140 }}>
                      No se pudo cargar esta gráfica.
                    </div>
                  ) : porDia.some((d) => d.valor > 0) ? (
                    <AreaChartSimple datos={porDia} etiquetaValor={(v) => String(v)} />
                  ) : (
                    <div className="flex items-center text-sm" style={{ color: 'var(--muted)', height: 140 }}>
                      Sin cierres en esta ventana — prueba con 30d o el histórico.
                    </div>
                  )}
                </div>
              </div>
              <div>
                <TituloSeccion>Requieren tu atención</TituloSeccion>
                <div className="mt-2.5 overflow-x-auto">
                  {viajes && diferenciasPorViaje && cfdiSinValidar ? (
                    <ViajesAtencion
                      viajes={viajes}
                      diferencias={diferenciasPorViaje}
                      cfdiSinValidar={cfdiSinValidar}
                      hoyMs={ahoraMs()}
                    />
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>No se pudo cargar esta sección.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Pendientes / Top rutas por gasto ── */}
            <div className="px-5 pb-4 border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4" style={{ borderColor: 'var(--line)' }}>
              <div>
                <TituloSeccion>Pendientes</TituloSeccion>
                <div className="mt-3">
                  <Pendientes items={alertas} />
                </div>
              </div>
              <div>
                <TituloSeccion>Top rutas por gasto</TituloSeccion>
                <div className="mt-3">
                  {gastoRuta && gastoRuta.length > 0 ? (
                    <HBars formato="mxn" datos={gastoRuta.map((r) => ({ etiqueta: r.ruta, valor: r.total }))} />
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--muted)' }}>Aún no hay gasto asociado a una ruta.</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Motor fiscal — el diferenciador real, no un TMS genérico ── */}
            <div className="px-5 pb-4 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
              <TituloSeccion>Tu motor fiscal — {periodoFiscal.etiqueta}</TituloSeccion>
              {/* El diésel elegible va en LITROS, no en pesos — el estímulo es
                  cuota DOF (semanal) × litros, y esa cuota no vive aquí.
                  `docs/conocimiento/guion-demo.md` + `guion_demo.test.ts`
                  atan el guion de venta a esto: si esto cambia, el guion
                  tiene que cambiar con ello. */}
              {acred && (
                <div className="mt-3 max-w-[220px]">
                  <KpiDegradado icono={<Fuel width={17} height={17} strokeWidth={1.75} />}
                    etiqueta="Diésel elegible para el estímulo" valor={acred.litrosDiesel} formato="litros" />
                </div>
              )}
              <div className="mt-3">
                <MotorFiscal resumen={resumenPerdidas} />
              </div>
            </div>
          </>
        )}

        <p className="text-xs px-5 pb-5 pt-1" style={{ color: 'var(--muted)' }}>{LEYENDA_CORTA}</p>
      </div>
    </main>
  );

}

/** AUDITORÍA 16, MEDIO: el filtro 7d/30d perdía el ?rol= de la previsualización
 *  "ver como encargado" y la volteaba al panel del dinero. Se arrastran
 *  tenant/vista/rol juntos — el mismo criterio que sufijoTenant. */
function sufijoTenantParams(sp: { tenant?: string; vista?: string; rol?: string } | undefined): Record<string, string> | undefined {
  if (!sp) return undefined;
  const out: Record<string, string> = {};
  if (sp.tenant) out.tenant = sp.tenant;
  else if (sp.vista) out.vista = sp.vista;
  if (sp.rol) out.rol = sp.rol;
  return Object.keys(out).length ? out : undefined;
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
