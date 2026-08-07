import { Fuel, Route as RouteIcon, Receipt, CreditCard } from 'lucide-react';
import {
  resolverPeriodo, getGastosFiscales, resumirCombustibleCasetas, resumirFiscal, tope15DeGastos,
  type GastoFiscal,
} from '@/lib/likida/fiscal';
import { TOPE_EFECTIVO, UMBRAL_ALERTA } from '@/lib/likida/periodo/combustible';
import { getConfig, type CuadraConfig } from '@/lib/likida/config';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { KpiTile, EstadoVacio, ChartCard, StatusPill, type Estado } from '../../../admin/ui/kit';
import { HBars, Gauge } from '../../../admin/ui/graficas';
import { EncabezadoFiscal } from '../periodo';
import { safe, extraDe, opcionesDe, PieDeAlcance, AvisoDeFallo, type Fallo, type ParamsPanel } from '../comun';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/contador/combustible';

/**
 * COMBUSTIBLE & CASETAS, con ojos fiscales.
 *
 * Es la vista del contador sobre los dos conceptos que más pesan: cuánto está
 * facturado, con qué se pagó, y qué tan cerca va la flota del 15% de efectivo
 * que la RFA 2026 regla 2.9 le concede.
 *
 * DIFERENCIA CON `/dashboard/combustible-casetas`, que ya existía: aquella es
 * la vista del DUEÑO —cuánto se gastó, en qué, si hay cargas repetidas—. Esta
 * responde otra pregunta: cuánto de ese gasto va a sobrevivir a una revisión.
 * Comparten la tabla `gasto` y ninguna cifra: si dijeran lo mismo, sobraría una.
 *
 * EL % ELECTRÓNICO SE MIDE SOBRE LO QUE SE SABE. Un comprobante sin
 * `forma_pago` no entra al numerador ni al denominador, y el monto que queda
 * fuera se imprime. Meterlo como "no electrónico" acusaría a la flota de pagar
 * en efectivo algo que nadie observó.
 */
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
export default async function CombustibleFiscalPage({
  searchParams,
}: {
  searchParams: Promise<ParamsPanel>;
}) {
  const sp = await searchParams;
  const { tenantId } = await resolverTenantEfectivo(RUTA, sp);
  return <Contenido {...{ tenantId, sp }} />;
}

export async function Contenido({ tenantId, sp }: { tenantId: string; sp: ParamsPanel; }) {
  const periodo = resolverPeriodo(sp?.p, new Date().toISOString().slice(0, 10));
  const extra = extraDe(sp);

  const fallos: Fallo[] = [];
  const [cfg, gastos] = await Promise.all([
    safe<CuadraConfig>(() => getConfig(tenantId), { que: 'Configuración fiscal de la flota', en: fallos }),
    safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodo), { que: 'Comprobantes del periodo', en: fallos }),
  ]);

  const opts = cfg ? opcionesDe(cfg) : null;
  const resumenes = gastos ? resumirCombustibleCasetas(gastos) : null;
  const fiscal = gastos && opts ? resumirFiscal(gastos, opts) : null;
  const tope = gastos && opts ? tope15DeGastos(gastos, opts) : null;

  const diesel = resumenes?.[0];
  const caseta = resumenes?.[1];

  const ESTADO_TOPE: Record<string, { estado: Estado; texto: string }> = {
    holgado: { estado: 'ok', texto: 'Holgado' },
    cerca: { estado: 'warn', texto: 'Cerca del tope' },
    excedido: { estado: 'bad', texto: 'Excedido' },
    sin_criterio: { estado: 'neutral', texto: 'No se puede evaluar' },
  };

  return (
    <div className="flex flex-col gap-4">
      <EncabezadoFiscal
        icono={<Fuel width={16} height={16} strokeWidth={1.75} />}
        titulo="Combustible & casetas"
        subtitulo="Cuánto de lo que más se gasta va a sobrevivir a una revisión"
        base={RUTA} periodo={periodo} extra={extra}
      />

      {gastos === null || cfg === null ? (
        <AvisoDeFallo fallos={fallos} />
      ) : !diesel || !caseta || !fiscal || !tope ? null : (
        <div className="glass-panel overflow-hidden">
          <section className="p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              {periodo.etiqueta}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              <KpiTile icono={<Fuel width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Diésel facturado" valor={diesel.montoConCfdi} formato="mxn"
                vacio={diesel.n === 0 ? 'Sin cargas de diésel en el periodo' : undefined}
                nota={diesel.n === 0 ? undefined : `${diesel.conCfdi} de ${diesel.n} cargas · ${mxn(diesel.montoSinCfdi)} sin CFDI`} />
              <KpiTile icono={<RouteIcon width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Casetas facturadas" valor={caseta.montoConCfdi} formato="mxn"
                vacio={caseta.n === 0 ? 'Sin casetas en el periodo' : undefined}
                nota={caseta.n === 0 ? undefined : `${caseta.conCfdi} de ${caseta.n} casetas · ${mxn(caseta.montoSinCfdi)} sin CFDI`} />
              <KpiTile icono={<CreditCard width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="Diésel con medio electrónico" valor={diesel.pctElectronico ?? 0} formato="porcentaje"
                vacio={diesel.pctElectronico === null
                  ? 'Ninguna carga trae forma de pago capturada: el porcentaje no se puede afirmar'
                  : undefined}
                nota={diesel.pctElectronico === null ? undefined
                  : diesel.montoSinFormaPago > 0
                    ? `Medido sobre lo que sí trae forma de pago. ${mxn(diesel.montoSinFormaPago)} quedan fuera del cálculo`
                    : 'LIF 2026 20-A: el estímulo de IEPS exige pago con monedero, tarjeta, cheque o transferencia'} />
              <KpiTile icono={<Receipt width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                etiqueta="IEPS de diésel desglosado" valor={fiscal.iepsDieselDocumentado} formato="mxn"
                nota="Trasladado en el CFDI. El estímulo es cuota del DOF × litros — no esta cifra" />
            </div>
          </section>

          {/* ── El 15% de la RFA ──────────────────────────────────────── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ChartCard
                titulo="Efectivo en combustible contra el 15%"
                subtitulo="RFA 2026 regla 2.9 — la base es combustible contra combustible"
                tamano="M"
                accion={<StatusPill estado={ESTADO_TOPE[tope.estado].estado}>{ESTADO_TOPE[tope.estado].texto}</StatusPill>}
              >
                {tope.estado === 'sin_criterio' ? (
                  <EstadoVacio icono={<Fuel width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    Hay efectivo registrado pero no un total de combustible contra el cual medirlo. Sin denominador
                    no hay razón que calcular, y un 0% ahí sería una afirmación que nadie hizo.
                  </EstadoVacio>
                ) : (
                  <>
                    {/* La escala es 0–100%, no 0–15%. Reescalarla al tope haría
                        que un 15% real se pintara como el arco COMPLETO, y el
                        contralor leería "al tope" donde la ley dice "en el
                        límite exacto". El número manda; el arco acompaña. */}
                    <Gauge valor={Math.round(tope.razon * 100)} etiqueta="del combustible pagado en efectivo" />
                    <div className="mt-3 space-y-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <p>
                        Tope legal: {Math.round(TOPE_EFECTIVO * 100)}%. Aviso temprano a partir del{' '}
                        {Math.round(UMBRAL_ALERTA * 100)}% — al llegar al tope la deducción ya se perdió y avisar
                        entonces no sirve de nada.
                      </p>
                      {opts?.elegible15 === false ? (
                        <p style={{ color: 'var(--bad)' }}>
                          La flota declaró que NO califica a la facilidad del 15% (RFA 2026 regla 2.9) — el
                          combustible en efectivo no es deducible.
                        </p>
                      ) : opts?.elegible15 === undefined ? (
                        <p style={{ color: 'var(--warn)' }}>
                          La facilidad del 15% (RFA 2026 regla 2.9) exige que la flota declare su dedicación y
                          régimen al registrarla; sin esa declaración el efectivo sale a revisión en cada
                          liquidación. Declárala en la consola de flotas.
                        </p>
                      ) : tope.excedente > 0
                        ? <p style={{ color: 'var(--bad)' }}>
                            Excedente del periodo: <strong className="tabular">{mxn(tope.excedente)}</strong>. Rebasar el
                            15% no reduce la deducción en proporción: tira el excedente completo.
                          </p>
                        : <p>
                            Todavía caben <strong className="tabular">{mxn(tope.margen)}</strong> de combustible en
                            efectivo dentro del periodo sin pasarse.
                          </p>}
                      <p style={{ color: 'var(--faint)' }}>
                        Ojo con el rango: la regla es del EJERCICIO completo. Con el filtro en un mes, esto mide ese
                        mes, no el año — para el dato que va a la declaración anual, pon el filtro en &quot;Ejercicio&quot;.
                      </p>
                    </div>
                  </>
                )}
              </ChartCard>

              <ChartCard titulo="Facturado contra no facturado" subtitulo="Por monto, no por número de tickets" tamano="M">
                {diesel.n + caseta.n === 0 ? (
                  <EstadoVacio icono={<Fuel width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                    No hay comprobantes de diésel ni de casetas con fecha en {periodo.etiqueta}.
                  </EstadoVacio>
                ) : (
                  <>
                    <HBars
                      datos={[
                        { etiqueta: 'Diésel con CFDI', valor: diesel.montoConCfdi },
                        { etiqueta: 'Diésel sin CFDI', valor: diesel.montoSinCfdi },
                        { etiqueta: 'Casetas con CFDI', valor: caseta.montoConCfdi },
                        { etiqueta: 'Casetas sin CFDI', valor: caseta.montoSinCfdi },
                      ]}
                      formato="mxn"
                    />
                    <p className="text-xs mt-3" style={{ color: 'var(--faint)' }}>
                      Lo de &quot;sin CFDI&quot; no está perdido todavía: se recupera si alguien lo factura antes de que venza el
                      plazo del comercio. Cuáles ya vencieron se ve en Deducciones perdidas.
                    </p>
                  </>
                )}
              </ChartCard>
            </div>
          </section>

          {/* ── Casetas: la base del estímulo ─────────────────────────── */}
          <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
            <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Base del estímulo de peaje
            </h2>
            <div className="mt-3">
              {caseta.n === 0 ? (
                <EstadoVacio icono={<RouteIcon width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Sin casetas en {periodo.etiqueta}.
                </EstadoVacio>
              ) : (
                <div className="card p-4">
                  <div className="flex items-baseline justify-between gap-3 flex-wrap">
                    <span className="text-sm">SubTotal de casetas leído en el periodo</span>
                    <span className="text-lg font-semibold tabular">{mxn(fiscal.subTotalCasetas)}</span>
                  </div>
                  <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
                    El estímulo es el 50% del gasto en peaje sin IVA (LIF 2026 20-A, para ingresos bajo $300M). La
                    base es el SubTotal, no el total: aplicar el 50% al total incluiría el IVA, que ya se acredita
                    por su lado.
                  </p>
                  {fiscal.casetasSinSubTotal > 0 && (
                    <p className="text-xs mt-2" style={{ color: 'var(--warn)' }}>
                      {fiscal.casetasSinSubTotal} caseta{fiscal.casetasSinSubTotal === 1 ? '' : 's'} sin SubTotal leído
                      quedan FUERA de esta base. Su importe existe en el papel; sin el XML no se puede citar, y
                      derivarlo dividiendo el total entre 1.16 sería inventarlo.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
            <PieDeAlcance>
              Los litros elegibles para el estímulo de IEPS no se cuentan en esta pantalla: salen del OCR del ticket
              y el motor ya los valida contra precio × litros al liquidar cada viaje. Se ven en la liquidación.
            </PieDeAlcance>
          </div>
        </div>
      )}
    </div>
  );
}
