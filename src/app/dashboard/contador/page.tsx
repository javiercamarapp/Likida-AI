import Link from 'next/link';
import {
  Landmark, Receipt, FileCheck2, Fuel, TriangleAlert, Percent, ArrowRight, ScanSearch,
} from 'lucide-react';
import {
  resolverPeriodo, periodoAnterior, getGastosFiscales, contarGastosDelTenant,
  resumirFiscal, resumirPerdidas,
  type GastoFiscal, type Periodo,
} from '@/lib/cuadra/fiscal';
import { getConfig, type CuadraConfig } from '@/lib/cuadra/config';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio, ChartCard } from '../../admin/ui/kit';
import { HBars } from '../../admin/ui/graficas';
import { EncabezadoFiscal, urlDePeriodo } from './periodo';
import { AvisoSinFlota } from '../sin-flota';
import { safe, extraDe, opcionesDe, PieDeAlcance, AvisoDeFallo, type Fallo, type ParamsPanel } from './comun';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/contador';

/**
 * PANEL FISCAL — la pantalla de aterrizaje del contador de la flota.
 *
 * ── EL COMPARATIVO CONTRA EL PERIODO ANTERIOR ─────────────────────────────
 *
 * Cada KPI puede llevar su variación, y NO se pinta si no hay historia que la
 * sostenga. Un "−100%" calculado contra un periodo en el que la flota todavía
 * no usaba el producto no mide una caída: mide la fecha de alta. Por eso el
 * comparativo solo aparece cuando el periodo anterior tiene al menos un
 * comprobante, y cuando no, se dice con esas palabras en vez de dejar el
 * espacio vacío (que se lee como "sin cambio").
 *
 * ── POR QUÉ NO HAY UN KPI DE "FACTURADO DEL PERIODO" ──────────────────────
 *
 * Porque este panel es del contador DE LA FLOTA, y lo que Likida captura es su
 * GASTO: los comprobantes que los operadores mandan por WhatsApp. Lo que la
 * flota le factura a sus clientes no pasa por aquí, así que un KPI de ingresos
 * en esta pantalla estaría o vacío o alimentado por una tabla que este panel no
 * debe leer. Se deja fuera y se dice, en vez de dejar una tarjeta en cero.
 */
async function cargar(tenantId: string, p: Periodo, registro: { que: string; en: Fallo[] }) {
  return safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, p), registro);
}

/**
 * SEPARADO EN DOS EN LA LÍNEA DE LA AUTORIZACIÓN, y no por gusto de arquitectura.
 *
 * `Page` hace UNA cosa: resolver quién entra y a qué flota (`resolverTenantEfectivo`,
 * que además gatea la ruta por rol). `Contenido` hace el resto — sus propias
 * consultas REALES a Supabase y todo el render.
 *
 * El corte existe porque estas pantallas viven detrás de sesión y la única forma
 * honesta de MIRAR el render es un preview temporal que importe el componente
 * REAL con datos REALES (CLAUDE.md, "Cómo se verifica"). Un preview que copie el
 * JSX verifica la copia. `Contenido` es ese punto de entrada: recibe el tenant ya
 * resuelto y no sabe de sesiones, así que se puede montar sin una.
 *
 * La autorización NO se movió de sitio: sigue corriendo antes, en `Page`, y es la
 * única puerta. `Contenido` no es una ruta — no hay URL que llegue a él.
 */
export default async function PanelFiscalPage({
  searchParams,
}: {
  searchParams: Promise<ParamsPanel>;
}) {
  const sp = await searchParams;
  const { tenantId, tenantExiste } = await resolverTenantEfectivo(RUTA, sp);
  return <Contenido {...{ tenantId, sp, tenantExiste }} />;
}

export async function Contenido({ tenantId, sp, tenantExiste = true }: {
  tenantId: string;
  sp: ParamsPanel;
  /** `false` cuando el uuid al que apunta la página no tiene fila en `tenant`
   *  — ver `../sin-flota.tsx`. Es la pantalla donde más pesa: cuatro KPIs
   *  fiscales en $0.00 no se distinguen de una flota que no dedujo nada. */
  tenantExiste?: boolean;
}) {
  const periodo = resolverPeriodo(sp?.p, new Date().toISOString().slice(0, 10));
  const anterior = periodoAnterior(periodo);
  const extra = extraDe(sp);

  const fallos: Fallo[] = [];
  const [cfg, gastos, gastosAnterior, conteo] = await Promise.all([
    safe<CuadraConfig>(() => getConfig(tenantId), { que: 'Configuración fiscal de la flota', en: fallos }),
    cargar(tenantId, periodo, { que: 'Comprobantes del periodo', en: fallos }),
    // El comparativo es lo ÚNICO que puede fallar sin tumbar la pantalla: si no
    // se lee, no se enseña el comparativo — no se enseña un cero.
    anterior ? cargar(tenantId, anterior, { que: 'Comprobantes del periodo anterior', en: fallos }) : Promise.resolve(null),
    safe<{ total: number; sinFecha: number }>(() => contarGastosDelTenant(tenantId)),
  ]);

  const opts = cfg ? opcionesDe(cfg) : null;
  const fiscal = gastos && opts ? resumirFiscal(gastos, opts) : null;
  const perdidas = gastos && opts ? resumirPerdidas(gastos, opts) : null;
  // El comparativo solo existe si el periodo anterior tiene comprobantes. Cero
  // contra cero no es una variación, es la ausencia de dos mediciones.
  const previo = gastosAnterior && gastosAnterior.length > 0 && opts
    ? resumirFiscal(gastosAnterior, opts)
    : null;
  const sinHistoria = anterior
    ? `Sin comparativo: ${anterior.etiqueta} no tiene comprobantes capturados.`
    : 'Sin comparativo: "Todo" no tiene un periodo anterior contra el cual medir.';

  const variacion = (hoy: number, antes: number | undefined): number | null => {
    if (previo === null || antes === undefined || antes === 0) return null;
    return Math.round(((hoy - antes) / antes) * 100);
  };

  return (
    <div className="flex flex-col gap-4">
      <EncabezadoFiscal
        icono={<Landmark width={16} height={16} strokeWidth={1.75} />}
        titulo="Panel fiscal"
        subtitulo="Lo que se puede acreditar y deducir de los comprobantes que entraron por WhatsApp"
        base={RUTA} periodo={periodo} extra={extra}
      />

      {!tenantExiste && <AvisoSinFlota tenantId={tenantId} />}

      {gastos === null || cfg === null ? (
        <AvisoDeFallo fallos={fallos} />
      ) : fiscal === null || perdidas === null ? null : (
        <div className="glass-panel overflow-hidden">
          {/* ── Los números del periodo ────────────────────────────────── */}
          <section className="p-5">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                {periodo.etiqueta}
              </h2>
              <span className="text-xs" style={{ color: 'var(--faint)' }}>
                {fiscal.n} comprobantes con fecha en el periodo
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiTile
                icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="IVA acreditable documentado" valor={fiscal.ivaAcreditable} formato="mxn"
                tendencia={variacion(fiscal.ivaAcreditable, previo?.ivaAcreditable)}
                nota={previo
                  ? `${anterior!.etiqueta}: ${mxn(previo.ivaAcreditable)}`
                  : sinHistoria}
              />
              <KpiTile
                icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="IEPS de diésel desglosado" valor={fiscal.iepsDieselDocumentado} formato="mxn"
                nota="Es el IEPS TRASLADADO en el CFDI, no el estímulo: ese es cuota del DOF × litros (LIF 2026 20-A)"
              />
              <KpiTile
                icono={<TriangleAlert width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Gasto con observación fiscal" valor={perdidas.montoTotal} formato="mxn"
                destacar={perdidas.montoTotal > 0}
                nota={`${perdidas.filas.length} de ${fiscal.n} comprobantes`}
              />
              <KpiTile
                icono={<ScanSearch width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="CFDI por validar ante el SAT" valor={fiscal.porValidar} formato="entero"
                nota={fiscal.conCfdi === 0
                  ? 'Ningún comprobante del periodo trae CFDI amarrado'
                  : `De ${fiscal.conCfdi} con CFDI: ${fiscal.vigentes} vigentes, ${fiscal.cancelados} cancelados`}
              />
            </div>
          </section>

          {/* ── Deducible contra lo que no ─────────────────────────────── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard
                titulo="El gasto del periodo, por su suerte fiscal"
                subtitulo="Cada peso en una sola cubeta"
                tamano="M"
              >
                {fiscal.gastoTotal === 0 ? (
                  <EstadoVacio icono={<Receipt width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    No hay gasto con fecha dentro de {periodo.etiqueta}.
                    {conteo && conteo.total > 0 && <> La flota tiene {conteo.total} comprobantes en total — prueba otro periodo.</>}
                  </EstadoVacio>
                ) : (
                  <>
                    <HBars
                      datos={[
                        { etiqueta: 'Sin observación', valor: Math.max(0, fiscal.gastoTotal - perdidas.montoTotal) },
                        { etiqueta: 'Recuperable', valor: perdidas.montoRecuperable },
                        { etiqueta: 'En riesgo', valor: perdidas.montoEnRiesgo },
                        { etiqueta: 'Ya no se recupera', valor: perdidas.montoPerdido },
                      ]}
                      formato="mxn"
                    />
                    <p className="text-xs mt-3" style={{ color: 'var(--faint)' }}>
                      Las cuatro suman {mxn(fiscal.gastoTotal)}, el gasto total del periodo. &quot;Sin observación&quot; no es
                      lo mismo que &quot;deducible&quot;: quiere decir que ninguna regla que estas columnas permiten evaluar lo
                      objeta. Que sea estrictamente indispensable lo decide el contador.
                    </p>
                  </>
                )}
              </ChartCard>

              <ChartCard titulo="Estado del papel" subtitulo="Qué tan documentado está el gasto" tamano="M">
                <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                  <Renglon etiqueta="Comprobantes con CFDI" valor={`${fiscal.conCfdi} de ${fiscal.n}`} />
                  <Renglon etiqueta="Sin CFDI" valor={String(fiscal.sinCfdi)}
                    nota="Un ticket sin timbrar no ampara deducción — todavía se puede pedir si el plazo del comercio no venció" />
                  <Renglon etiqueta="Con CFDI pero sin desglose de impuestos" valor={String(fiscal.conCfdiSinDesglose)}
                    nota="Hay UUID pero no llegó el XML: el IVA existe en el papel y aquí no se puede afirmar" />
                  <Renglon etiqueta="Base de casetas (SubTotal leído)" valor={mxn(fiscal.subTotalCasetas)}
                    nota={fiscal.casetasSinSubTotal > 0
                      ? `${fiscal.casetasSinSubTotal} casetas sin SubTotal: su base no entra en esta suma`
                      : 'El estímulo del 50% de peaje se calcula sobre esta base (LIF 2026 20-A)'} />
                  <Renglon etiqueta="IVA desglosado NO acreditable" valor={mxn(fiscal.ivaNoAcreditable)}
                    nota="Desglosado en el CFDI, pero el comprobante o el medio de pago no lo sostienen (LIVA 5)" />
                </div>
              </ChartCard>
            </div>
          </section>

          {/* ── A dónde ir ─────────────────────────────────────────────── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              El trabajo de aquí
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <Atajo
                href={urlDePeriodo('/dashboard/contador/deducciones', periodo.clave, extra)}
                icono={<TriangleAlert width={16} height={16} strokeWidth={1.75} />}
                titulo="Deducciones perdidas"
                detalle={perdidas.montoTotal > 0
                  ? `${mxn(perdidas.montoTotal)} en ${perdidas.filas.length} comprobantes`
                  : 'Ningún comprobante del periodo tiene observación'}
              />
              <Atajo
                href={urlDePeriodo('/dashboard/contador/cfdi', periodo.clave, extra)}
                icono={<FileCheck2 width={16} height={16} strokeWidth={1.75} />}
                titulo="CFDI recibidos"
                detalle={`${fiscal.conCfdi} con UUID · ${fiscal.porValidar} sin validar ante el SAT`}
              />
              <Atajo
                href={urlDePeriodo('/dashboard/contador/combustible', periodo.clave, extra)}
                icono={<Fuel width={16} height={16} strokeWidth={1.75} />}
                titulo="Combustible & casetas"
                detalle="Facturado contra no facturado, y el 15% de la RFA"
              />
            </div>
          </section>

          {/* ── Lo que este panel NO puede decir ───────────────────────── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Lo que este panel no puede decirte
            </h2>
            <div className="mt-3">
              <EstadoVacio icono={<Percent width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                <strong>Retenciones de IVA.</strong> El importe retenido vive en el nodo{' '}
                <code className="text-xs">cfdi:Retenciones</code> del CFDI del proveedor, y ni se parsea al importar
                el XML ni hay columna en <code className="text-xs">gasto</code> donde guardarlo. Derivarlo como 4%
                del subtotal sería inventarlo.{' '}
                <Link href={urlDePeriodo('/dashboard/contador/retenciones', periodo.clave, extra)} className="underline">
                  Ver qué haría falta
                </Link>.
                <br /><br />
                <strong>El estímulo de IEPS en pesos.</strong> Es la cuota semanal del DOF por los litros, no el IEPS
                trasladado. Sin ese acuerdo cargado en el sistema, la cifra en pesos no se puede afirmar — lo que sí
                se cuenta son los litros elegibles.
                <br /><br />
                <strong>Ingresos, cartera y facturación a clientes.</strong> Están fuera a propósito: lo que Likida
                captura es el GASTO de la flota. Un panel que enseñara cero ingresos daría a entender que la flota no
                facturó.
              </EstadoVacio>
            </div>
          </section>

          <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <PieDeAlcance />
          </div>
        </div>
      )}
    </div>
  );
}

function Renglon({ etiqueta, valor, nota }: { etiqueta: string; valor: string; nota?: string }) {
  return (
    <div className="py-2.5 first:pt-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{etiqueta}</span>
        <span className="text-sm font-semibold tabular whitespace-nowrap">{valor}</span>
      </div>
      {nota && <p className="text-xs mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</p>}
    </div>
  );
}

function Atajo({ href, icono, titulo, detalle }: { href: string; icono: React.ReactNode; titulo: string; detalle: string }) {
  return (
    <Link href={href} className="card p-4 flex items-start gap-3 hover:opacity-80 transition-opacity">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
        {icono}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium flex items-center gap-1.5">
          {titulo}
          <ArrowRight width={13} height={13} strokeWidth={2} style={{ color: 'var(--muted)' }} />
        </div>
        <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{detalle}</p>
      </div>
    </Link>
  );
}
