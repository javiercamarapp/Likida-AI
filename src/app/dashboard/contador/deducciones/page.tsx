import { TriangleAlert, Receipt, ShieldAlert, Banknote, Info } from 'lucide-react';
import {
  resolverPeriodo, getGastosFiscales, contarGastosDelTenant, resumirPerdidas,
  type GastoFiscal, type ResumenPerdidas, type Gravedad,
} from '@/lib/likida/fiscal';
import { getConfig, type CuadraConfig } from '@/lib/likida/config';
import { etiquetaConcepto } from '@/lib/likida/cuadre/engine';
import { mxn } from '@/lib/utils';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { fechaMx } from '../../formato';
import { EstadoVacio, StatusPill, ChartCard, type Estado } from '../../../admin/ui/kit';
import { HBars } from '../../../admin/ui/graficas';
import CifraGrande from '../../cifra-grande';
import { EncabezadoFiscal } from '../periodo';
import { safe, extraDe, opcionesDe, etiquetaFormaPago, PieDeAlcance, SinDato, AvisoDeFallo, type Fallo, type ParamsPanel } from '../comun';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/contador/deducciones';

/**
 * DEDUCCIONES PERDIDAS — la pantalla que justifica el producto.
 *
 * Es dinero en la mesa: comprobantes por los que la flota YA pagó y que, por
 * cómo llegaron, no van a bajar la base gravable. El contador de una flota
 * vive de esto — no de reportes bonitos, sino de saber cuánto se le está
 * escapando y por qué, con el viaje y el operador de cada caso para poder ir a
 * buscar el papel.
 *
 * ── LAS DOS COSAS QUE ESTA PANTALLA SE PROHÍBE ─────────────────────────────
 *
 * 1. NO estima el IVA perdido. La cifra que un contador querría ver arriba es
 *    "cuánto IVA se perdió", y sería trivial pintarla como `monto × 0.16`. Es
 *    justo la que no se puede: el total de un ticket puede traer propina, IEPS,
 *    conceptos exentos o a tasa 0, y esa cifra entra a una declaración
 *    mensual. Se enseña el IVA que los comprobantes SÍ desglosan, se dice de
 *    cuántos salió, y se dice cuántos no lo traen.
 *
 * 2. NO cuenta el mismo peso dos veces. Un gasto sin CFDI Y pagado en efectivo
 *    sobre el tope tiene dos causas; el dinero se contabiliza en la más grave
 *    (`causaDominante`) y las dos se enseñan en su fila. Si las sumas por causa
 *    no cuadran con el total, el contador lo nota con una calculadora y deja de
 *    creerle a la pantalla.
 */
const ICONO_GRAVEDAD: Record<Gravedad, Estado> = {
  perdida: 'bad',
  en_riesgo: 'warn',
  recuperable: 'neutral',
};

const TEXTO_GRAVEDAD: Record<Gravedad, string> = {
  perdida: 'Ya no se recupera',
  en_riesgo: 'En riesgo',
  recuperable: 'Se recupera gestionando',
};

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
export default async function DeduccionesPerdidasPage({
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
  const [cfg, gastos, conteo] = await Promise.all([
    safe<CuadraConfig>(() => getConfig(tenantId), { que: 'Configuración fiscal de la flota', en: fallos }),
    safe<GastoFiscal[]>(() => getGastosFiscales(tenantId, periodo), { que: 'Comprobantes del periodo', en: fallos }),
    safe<{ total: number; sinFecha: number }>(() => contarGastosDelTenant(tenantId)),
  ]);

  // Sin la config del tenant NO se juzga: el tope de efectivo y las claves de
  // combustible salen de ahí, y evaluar con los defaults del demo produciría un
  // veredicto sobre reglas que no son las de esta flota.
  const resumen: ResumenPerdidas | null = cfg && gastos ? resumirPerdidas(gastos, opcionesDe(cfg)) : null;

  return (
    <div className="flex flex-col gap-4">
      <EncabezadoFiscal
        icono={<TriangleAlert width={16} height={16} strokeWidth={1.75} />}
        titulo="Deducciones perdidas"
        subtitulo="Dinero que ya salió de la caja y no va a bajar la base gravable"
        base={RUTA} periodo={periodo} extra={extra}
      />

      {gastos === null || cfg === null ? (
        <AvisoDeFallo fallos={fallos} />
      ) : resumen === null ? null : (
        <>
          <div className="glass-panel overflow-hidden">
            {/* ── La cifra ─────────────────────────────────────────────── */}
            <section className="p-5 flex flex-wrap items-end justify-between gap-6">
              <div className="min-w-0">
                <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  En juego · {periodo.etiqueta}
                </h2>
                <p className="text-sm mt-2 max-w-xl" style={{ color: 'var(--muted)' }}>
                  {resumen.filas.length === 0
                    ? 'Ningún comprobante del periodo tiene una observación fiscal.'
                    : `${resumen.filas.length} de ${gastos.length} comprobantes del periodo tienen algo que los separa de ser deducibles.`}
                </p>
                <div className="flex flex-wrap gap-x-8 gap-y-3 mt-4">
                  <div>
                    <div className="text-lg font-semibold tabular" style={{ color: 'var(--bad)' }}>{mxn(resumen.montoPerdido)}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Ya no se recupera</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold tabular" style={{ color: 'var(--warn)' }}>{mxn(resumen.montoEnRiesgo)}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>En riesgo</div>
                  </div>
                  <div>
                    <div className="text-lg font-semibold tabular">{mxn(resumen.montoRecuperable)}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>Se recupera pidiendo la factura</div>
                  </div>
                </div>
              </div>
              <CifraGrande
                valor={resumen.montoTotal}
                etiqueta="Gasto con observación fiscal"
                nota={periodo.etiqueta}
              />
            </section>

            {/* ── El IVA, dicho con toda su letra chica ─────────────────── */}
            <section className="px-5 pb-5">
              <div className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                    <Info width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                  </div>
                  <div className="text-sm">
                    {/* UN `$0.00` AQUÍ SERÍA LA MENTIRA MÁS CARA DE LA PANTALLA.
                        Cuando ningún comprobante desglosa IVA, el resultado no es
                        "se perdió cero de IVA" —eso diría que no había IVA que
                        perder— sino "no hay UN SOLO peso de IVA que se pueda
                        documentar". Se dice con palabras, sin cifra, porque la
                        cifra se copiaría. Con desglose sí se imprime: ahí el
                        número está en el papel. */}
                    {resumen.ivaPerdidoDocumentado > 0 ? (
                      <p>
                        IVA que se puede documentar como perdido:{' '}
                        <strong className="tabular">{mxn(resumen.ivaPerdidoDocumentado)}</strong>
                        {resumen.sinDesgloseDeIva > 0 && <> — y es un piso, no el total.</>}
                      </p>
                    ) : (
                      <p>
                        <strong>No se puede documentar ni un peso del IVA perdido.</strong>
                      </p>
                    )}
                    <p className="text-xs mt-1.5" style={{ color: 'var(--muted)' }}>
                      {resumen.sinDesgloseDeIva > 0 ? (
                        <>
                          {resumen.sinDesgloseDeIva === resumen.filas.length
                            ? `Ninguno de los ${resumen.sinDesgloseDeIva} comprobantes con observación desglosa el IVA: `
                            : `${resumen.sinDesgloseDeIva} de los ${resumen.filas.length} comprobantes con observación no desglosan el IVA: `}
                          ese impuesto existe en el papel, pero sin el comprobante no se puede citar. Multiplicar
                          el total por 16% daría una cifra que no está en ningún documento — y esa cifra se teclea en
                          una declaración. El dinero en juego sí está medido: es el monto de arriba.
                        </>
                      ) : (
                        <>Es la suma del IVA que los comprobantes traen DESGLOSADO. Todos los de esta lista lo
                        traen, así que la cifra está completa.</>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* ── Por causa ────────────────────────────────────────────── */}
            {resumen.porCausa.length > 0 && (
              <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  <ChartCard titulo="Cuánto pesa cada causa" subtitulo="Cada peso cuenta una sola vez, en su causa más grave" tamano="M">
                    <HBars
                      datos={resumen.porCausa.map((c) => ({ etiqueta: c.titulo, valor: c.monto }))}
                      formato="mxn"
                    />
                  </ChartCard>
                  <ChartCard titulo="Qué significa cada una" subtitulo="Con el artículo que la sostiene" tamano="M">
                    <div className="divide-y" style={{ borderColor: 'var(--line)' }}>
                      {resumen.porCausa.map((c) => (
                        <div key={c.causa} className="py-2.5 first:pt-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium">{c.titulo}</span>
                            <StatusPill estado={ICONO_GRAVEDAD[c.gravedad]}>{TEXTO_GRAVEDAD[c.gravedad]}</StatusPill>
                          </div>
                          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{c.detalle}</p>
                          <p className="text-xs mt-1 tabular" style={{ color: 'var(--faint)' }}>
                            {c.n} comprobante{c.n === 1 ? '' : 's'} · {mxn(c.monto)} · {c.norma}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ChartCard>
                </div>
              </section>
            )}

            {/* ── La lista, priorizada por monto ───────────────────────── */}
            <div className="pt-5 pb-2 px-5 border-t" style={{ borderColor: 'var(--line)' }}>
              <h2 className="text-xs font-semibold uppercase tracking-wide m-0" style={{ color: 'var(--muted)' }}>
                Comprobante por comprobante, del que más pesa al que menos
              </h2>
            </div>

            {resumen.filas.length === 0 ? (
              <div className="px-5 pb-5">
                <EstadoVacio icono={<Receipt width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  {gastos.length === 0 ? (
                    <>
                      No hay comprobantes con fecha dentro de {periodo.etiqueta}.
                      {conteo && conteo.total > 0 && (
                        <> La flota tiene {conteo.total} comprobantes capturados en total: prueba otro periodo.</>
                      )}
                      {conteo && conteo.total === 0 && (
                        <> Todavía no ha entrado ninguno. En cuanto un operador mande la primera foto por
                        WhatsApp aparece aquí con su lectura fiscal.</>
                      )}
                    </>
                  ) : (
                    <>Los {gastos.length} comprobantes de {periodo.etiqueta} pasaron sin observación: todos traen
                    CFDI, ninguno está cancelado ni viene de un emisor en lista EFOS, y ninguno rompe la regla del
                    medio de pago.</>
                  )}
                </EstadoVacio>
              </div>
            ) : (
              <div className="overflow-x-auto mt-1 pb-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-5 py-2.5 font-medium text-right">Monto</th>
                      <th className="px-5 py-2.5 font-medium">Qué pasa</th>
                      <th className="px-5 py-2.5 font-medium">Concepto</th>
                      <th className="px-5 py-2.5 font-medium">Fecha</th>
                      <th className="px-5 py-2.5 font-medium">Viaje</th>
                      <th className="px-5 py-2.5 font-medium">Operador</th>
                      <th className="px-5 py-2.5 font-medium">Forma de pago</th>
                      <th className="px-5 py-2.5 font-medium text-right">IVA desglosado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resumen.filas.map(({ gasto: g, dominante, causas }) => (
                      <tr key={g.id} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
                        <td className="px-5 py-3 text-right tabular font-semibold whitespace-nowrap">{mxn(g.monto)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusPill estado={ICONO_GRAVEDAD[dominante.gravedad]}>{dominante.titulo}</StatusPill>
                            {causas.filter((c) => c.causa !== dominante.causa).map((c) => (
                              <StatusPill key={c.causa} estado="neutral">{c.titulo}</StatusPill>
                            ))}
                          </div>
                          <div className="text-xs mt-1" style={{ color: 'var(--faint)' }}>{dominante.norma}</div>
                        </td>
                        <td className="px-5 py-3">{etiquetaConcepto(g.concepto)}</td>
                        <td className="px-5 py-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                          {g.fecha ? fechaMx(g.fecha) : <SinDato titulo="El comprobante no trae fecha legible" />}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs" style={{ color: 'var(--muted)' }}>
                          {g.viajeFolio ?? <SinDato titulo="El viaje no tiene folio" />}
                        </td>
                        <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                          {g.operadorNombre ?? <SinDato />}
                        </td>
                        <td className="px-5 py-3 text-xs" style={{ color: 'var(--muted)' }}>
                          {g.formaPago ? etiquetaFormaPago(g.formaPago) : <SinDato titulo="Sin forma de pago: no se juzga como efectivo" />}
                        </td>
                        <td className="px-5 py-3 text-right tabular">
                          {g.ivaTraslado === null ? <SinDato titulo="El comprobante no desglosa el IVA" /> : mxn(g.ivaTraslado)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Lo que no se pudo juzgar ─────────────────────────────── */}
            {(resumen.sinFormaPago > 0 || (conteo?.sinFecha ?? 0) > 0) && (
              <section className="p-5 border-t" style={{ borderColor: 'var(--line)' }}>
                <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Lo que no se pudo juzgar
                </h2>
                <div className="mt-3 space-y-2">
                  {resumen.sinFormaPago > 0 && (
                    <div className="card p-4 flex items-start gap-3">
                      <Banknote width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} className="mt-0.5 shrink-0" />
                      <p className="text-sm">
                        <strong>{resumen.sinFormaPago}</strong> comprobantes del periodo no traen forma de pago.
                        <span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          No se cuentan como efectivo: suponerlo los mandaría a &quot;no deducible&quot; sin que nadie lo
                          haya comprobado, y también inflaría el 15% de combustible contra la flota. Falta
                          `gasto.forma_pago`, que hoy solo se llena si el ticket lo dice o si llegó el XML.
                        </span>
                      </p>
                    </div>
                  )}
                  {(conteo?.sinFecha ?? 0) > 0 && (
                    <div className="card p-4 flex items-start gap-3">
                      <ShieldAlert width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} className="mt-0.5 shrink-0" />
                      <p className="text-sm">
                        <strong>{conteo!.sinFecha}</strong> comprobantes de la flota no tienen fecha y quedan FUERA de
                        cualquier corte por periodo — incluido este.
                        <span className="block text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          Meterlos en el mes actual los pondría en un periodo fiscal que no es el suyo. Se ven con el
                          filtro en &quot;Todo&quot;.
                        </span>
                      </p>
                    </div>
                  )}
                </div>
              </section>
            )}

            <div className="px-5 py-4 border-t" style={{ borderColor: 'var(--line)' }}>
              <PieDeAlcance>
                El tope fiscal de alimentación de $750 por día (LISR 28-V) no se evalúa aquí: es por día y por
                beneficiario, y ya lo reparte el motor al liquidar cada viaje. Repetirlo con otra implementación
                daría dos cifras para el mismo hecho.
              </PieDeAlcance>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
