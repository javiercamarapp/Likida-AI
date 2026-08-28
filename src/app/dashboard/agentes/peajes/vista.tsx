import Link from 'next/link';
import { Scale, ArrowRight, Inbox, CircleCheck, CircleAlert, CircleSlash, FileDown, FileSpreadsheet } from 'lucide-react';
import type { ConciliacionConsolidado, LineaPorConciliar, DesgloseRecibido } from '@/lib/likida/analytics';
// SOLO tipos: el módulo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ResumenDesglose, DetalleDesglose, LineaDesgloseVista } from '@/lib/likida/intake/desglose_peaje';
import type { ResumenEvidenciaGps, EvidenciaGpsLinea } from '@/lib/likida/peajes/evidencia_gps';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { EstadoVacio } from '@/app/admin/ui/kit';
import { BarraPagina } from '../../resumen-visual';
import { SubirDesglose, type AccionSubir } from './subir';
import { BotonEjecutar, type AccionBarrer } from './controles';
import { SubirDesgloseProveedor, type AccionImportar } from './subir-desglose';
import { BotonConciliar, type AccionConciliar } from './conciliar-desglose';

/**
 * La ventana del Agente de Peajes (F5): lo que el estado de cuenta del
 * TAG/monedero dice contra lo que los viajes comprobaron. Tres cubetas
 * honestas — conciliadas / por conciliar / sin gasto que corresponda — y el
 * estado del estímulo de peaje (LIF 2026 art. 20, ap. A) SIN presentar el
 * bruto como ahorro. La mesa para resolver a mano vive en Combustible y
 * casetas.
 *
 * AUDITORÍA 3 FI-A1, ALTO: la card del estímulo citaba la RMF 9.1.8 —regla
 * SIN ficha en `normas/`— y pintaba en verde ("Factor 0.5 sobre el importe
 * sin IVA") lo que la ficha verificada `normas/lif-2026-20-A.yaml` deja SIN
 * RESOLVER (H4: la ley dice "gasto total erogado", el motor usa el subtotal
 * sin IVA). Ahora cada renglón dice exactamente lo que su ficha sostiene, la
 * única cita normativa es la que SÍ tiene ficha verificada, las cuatro
 * condiciones de elegibilidad de la ley se listan completas (antes solo una),
 * y la cifra lleva la leyenda de descargo de CFF 89 (`cuadre/leyendas.ts`)
 * que ya llevan las demás pantallas con cifra fiscal.
 *
 * 14-AGO-2026 (F5): la RMF 9.1.8 YA tiene ficha verificada en fuente primaria
 * (`normas/rmf-2026-9.1.8.yaml`), así que la card volvió a citarla — ahora
 * con sustento: la fr. IV RESUELVE H4 (la base es el importe sin IVA, lo que
 * el motor ya hacía) y la fr. II es exactamente la bitácora que la sección
 * del desglose del proveedor produce. H5 (Red Nacional) sigue abierto y así
 * se dice. Esta pantalla sigue sin afirmar que el estímulo proceda.
 */
export function VistaAgentePeajes({
  conciliacion, lineas, desgloses, peajeAcreditable, sufijo, subirDesglose, ejecutarAhora,
  desglosesProveedor, desgloseSeleccionado, detalleSeleccionado, evidenciaGps, importarDesglose, conciliarDesglose,
  notificaciones,
}: {
  conciliacion: ConciliacionConsolidado | null;
  lineas: LineaPorConciliar[] | null;
  desgloses: DesgloseRecibido[] | null;
  /** Peaje con factor 0.5 ya aplicado por el motor, histórico. null = no se pudo leer. */
  peajeAcreditable: number | null;
  sufijo: string;
  subirDesglose: AccionSubir;
  /** El barrido a demanda: re-cruza la cola contra los gastos de hoy. */
  ejecutarAhora: AccionBarrer;
  /** Los desgloses del PROVEEDOR (F5), con su % conciliado medido. null = no se pudo leer. */
  desglosesProveedor: ResumenDesglose[] | null;
  desgloseSeleccionado: ResumenDesglose | null;
  detalleSeleccionado: DetalleDesglose | null;
  /** Evidencia GPS del desglose seleccionado (post-plan-maestro #1). null =
   *  no se pudo leer — y se dice, en vez de un cero que parecería medición. */
  evidenciaGps: { resumen: ResumenEvidenciaGps; porLinea: Record<string, EvidenciaGpsLinea> } | null;
  importarDesglose: AccionImportar;
  conciliarDesglose: AccionConciliar;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
}) {
  const total = conciliacion ? conciliacion.conciliadas + conciliacion.porConciliar + conciliacion.sinMatch : 0;
  const pct = conciliacion && total > 0 ? Math.round((conciliacion.conciliadas / total) * 100) : null;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Scale width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Conciliación de peajes"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Líneas conciliadas" valor={conciliacion ? numero(conciliacion.conciliadas) : '—'}
              nota={pct !== null ? `${numero(pct)}% del estado de cuenta` : 'aún sin estados de cuenta'} />
            <Kpi titulo="Por conciliar" valor={conciliacion ? numero(conciliacion.porConciliar) : '—'}
              nota="esperan a un humano" tono={(conciliacion?.porConciliar ?? 0) > 0 ? 'warn' : undefined} />
            <Kpi titulo="Sin gasto que corresponda" valor={conciliacion ? numero(conciliacion.sinMatch) : '—'}
              nota="revisadas y documentadas" />
            <Kpi titulo="Estados de cuenta" valor={conciliacion ? numero(conciliacion.cfdis) : '—'}
              nota="CFDI consolidados recibidos" />
          </div>

          {/* ── La ingesta: el ritual del PoC ── */}
          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">Subir estado de cuenta</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              El XML del CFDI consolidado del TAG o del monedero — el mismo que el proveedor manda
              cada corte. El agente lo cruza contra los gastos de los viajes al instante.
              (También entra reenviándolo al WhatsApp de Likida desde la oficina. El desglose en
              Excel/PDF todavía no entra por aquí.)
            </p>
            <SubirDesglose subirDesglose={subirDesglose} />
          </section>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* La cola honesta */}
            <section className="card p-4 flex flex-col">
              <div className="flex items-start justify-between gap-3 mb-1">
                <h2 className="font-display text-[15px] font-semibold">Esperan a un humano</h2>
                {(lineas?.length ?? 0) > 0 && (
                  <Link href={`/dashboard/combustible-casetas${sufijo}`}
                    className="inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity shrink-0"
                    style={{ color: 'var(--marca)' }}>
                    Resolver en la mesa <ArrowRight width={12} height={12} strokeWidth={2} />
                  </Link>
                )}
              </div>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
                Líneas del estado de cuenta a las que el cruce automático no les encontró gasto único.
                El barrido las re-cruza contra los gastos que llegaron después.
              </p>
              <div className="mb-3">
                <BotonEjecutar ejecutarAhora={ejecutarAhora} pendientes={lineas === null ? null : lineas.length} />
              </div>
              {lineas === null ? (
                <Leyenda>No se pudo leer la cola ahora mismo.</Leyenda>
              ) : lineas.length === 0 ? (
                <Leyenda>Nada espera a un humano — cada línea nueva que el cruce no
                  resuelva solo, aparece aquí.</Leyenda>
              ) : (
                <div className="space-y-2">
                  {lineas.slice(0, 6).map((l) => (
                    <div key={l.id} className="flex items-center gap-2.5 text-[12.5px]">
                      <span className="shrink-0" style={{ color: 'var(--muted)' }}>{l.fecha ? fechaCorta(l.fecha) : 'sin fecha'}</span>
                      <span className="truncate" title={l.descripcion ?? undefined}>{l.descripcion ?? 'sin descripción'}</span>
                      <span className="ml-auto shrink-0 cifra-mono">{mxn(l.monto)}</span>
                      <span className="shrink-0 text-[11px]" style={{ color: 'var(--faint)' }}>
                        {l.candidatos.length === 0 ? 'sin candidatos' : `${numero(l.candidatos.length)} candidato${l.candidatos.length === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  ))}
                  {lineas.length > 6 && (
                    <p className="text-[11px] pt-1" style={{ color: 'var(--faint)' }}>
                      y {numero(lineas.length - 6)} más en la mesa.
                    </p>
                  )}
                </div>
              )}
            </section>

            {/* Bitácora de desgloses */}
            <section className="card p-4 flex flex-col">
              <h2 className="font-display text-[15px] font-semibold mb-1">Estados de cuenta recibidos</h2>
              <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>Cada consolidado, con el saldo de su cruce</p>
              {desgloses === null ? (
                <Leyenda>No se pudo leer la bitácora ahora mismo.</Leyenda>
              ) : desgloses.length === 0 ? (
                <EstadoVacio icono={<Inbox width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no llega ningún estado de cuenta — súbelo arriba o reenvíalo por WhatsApp
                  y el cruce corre solo.
                </EstadoVacio>
              ) : (
                <div className="space-y-2.5 text-[12.5px]">
                  {desgloses.map((d) => (
                    <div key={d.cfdiXmlId} className="flex items-center gap-2.5">
                      <span className="cifra-mono text-[11px] shrink-0" style={{ color: 'var(--faint)' }}>{d.uuidCorto}</span>
                      <span className="shrink-0" style={{ color: 'var(--muted)' }}>{d.recibido ? fechaCorta(d.recibido) : '—'}</span>
                      <span className="ml-auto shrink-0 cifra-mono">{mxn(d.monto)}</span>
                      <span className="shrink-0 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--ok)' }}>
                        <CircleCheck width={11} height={11} strokeWidth={2} /> {numero(d.conciliadas)}
                      </span>
                      {d.porConciliar > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--warn)' }}>
                          <CircleAlert width={11} height={11} strokeWidth={2} /> {numero(d.porConciliar)}
                        </span>
                      )}
                      {d.sinMatch > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 text-[11px]" style={{ color: 'var(--muted)' }}>
                          <CircleSlash width={11} height={11} strokeWidth={2} /> {numero(d.sinMatch)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* ── El desglose del PROVEEDOR (F5, PoC): tres cubetas y bitácora ── */}
          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">Desglose del proveedor de peaje</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              El Excel/CSV (o PDF con texto) que IAVE, PASE, TeleVía o el convenio directo mandan
              cada corte. El agente lo cruza contra los gastos de caseta de los viajes — por fecha
              (±1 día) y monto — y separa tres cubetas: cuadra, con discrepancia, sin contraparte.
              De lo que cuadra sale la bitácora de la RMF 9.1.8. (El cruce contra el GPS del TMS es
              v2: requiere acceso al TMS del cliente; hoy se cruza contra lo que Likida ya registró.)
            </p>
            <SubirDesgloseProveedor importar={importarDesglose} />

            {desglosesProveedor === null ? (
              <p className="text-[12.5px] mt-4" style={{ color: 'var(--muted)' }}>
                No se pudo leer la lista de desgloses ahora mismo.
              </p>
            ) : desglosesProveedor.length === 0 ? (
              <div className="mt-4">
                <EstadoVacio icono={<FileSpreadsheet width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  Aún no se importa ningún desglose del proveedor — súbelo arriba y el cruce corre al
                  instante, con su % conciliado medido.
                </EstadoVacio>
              </div>
            ) : (
              <div className="grid lg:grid-cols-[minmax(240px,1fr)_2fr] gap-4 mt-4">
                {/* La lista, cada uno con su % MEDIDO */}
                <div>
                  <h3 className="etiqueta-mono text-[10px] uppercase mb-2" style={{ color: 'var(--faint)' }}>Desgloses importados</h3>
                  <div className="space-y-1.5">
                    {desglosesProveedor.map((d) => {
                      const activo = d.desgloseId === desgloseSeleccionado?.desgloseId;
                      return (
                        <Link key={d.desgloseId}
                          href={`/dashboard/agentes/peajes${sufijo}${sufijo ? '&' : '?'}desglose=${d.desgloseId}`}
                          className="block rounded-lg px-2.5 py-2 hairline transition-colors hover:bg-[var(--canvas)]"
                          style={activo ? { background: 'var(--canvas)' } : undefined}>
                          <div className="flex items-center gap-2 text-[12.5px]">
                            <span className="truncate" title={d.archivoNombre ?? undefined}>
                              {d.proveedor ?? d.archivoNombre ?? 'desglose'}
                            </span>
                            <span className="ml-auto shrink-0 cifra-mono text-[12px]"
                              style={{ color: d.pctCuadra !== null && d.pctCuadra >= 100 ? 'var(--ok)' : undefined }}>
                              {d.pctCuadra === null ? '—' : `${numero(d.pctCuadra)}%`}
                            </span>
                          </div>
                          <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>
                            {d.periodoDesde && d.periodoHasta
                              ? `${fechaCorta(d.periodoDesde)} – ${fechaCorta(d.periodoHasta)}`
                              : 'periodo sin medir (líneas sin fecha)'}
                            {' · '}{numero(d.total)} líneas
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </div>

                {/* El detalle del seleccionado: las tres cubetas */}
                {desgloseSeleccionado && (
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-3">
                      <BotonConciliar conciliar={conciliarDesglose} desgloseId={desgloseSeleccionado.desgloseId} />
                      {desgloseSeleccionado.cuadra > 0 ? (
                        <a href={`/api/export/bitacora-peaje?desglose=${desgloseSeleccionado.desgloseId}${sufijo ? `&${sufijo.slice(1)}` : ''}`}
                          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg hairline transition-colors hover:bg-[var(--canvas)]"
                          style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                          <FileDown width={13} height={13} strokeWidth={2} /> Bitácora RMF 9.1.8 (CSV)
                        </a>
                      ) : (
                        <span className="text-[11px]" style={{ color: 'var(--faint)' }}>
                          La bitácora RMF 9.1.8 se habilita cuando al menos una línea cuadre.
                        </span>
                      )}
                    </div>
                    {detalleSeleccionado === null ? (
                      <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                        No se pudo leer el detalle de este desglose ahora mismo.
                      </p>
                    ) : (
                      <div className="grid md:grid-cols-3 gap-3">
                        <CubetaDesglose
                          titulo="Cuadran"
                          total={desgloseSeleccionado.cuadra}
                          nota="ligadas a su gasto de viaje"
                          tono="ok"
                          lineas={detalleSeleccionado.cuadra}
                          evidencia={evidenciaGps?.porLinea}
                        />
                        <CubetaDesglose
                          titulo="No cuadran"
                          total={desgloseSeleccionado.noCuadra}
                          nota="discrepancia o ambigüedad — el porqué, línea a línea"
                          tono="warn"
                          lineas={detalleSeleccionado.noCuadra}
                          evidencia={evidenciaGps?.porLinea}
                        />
                        <CubetaDesglose
                          titulo="Sin contraparte"
                          total={desgloseSeleccionado.sinContraparte}
                          nota="cruces que ningún gasto de caseta respalda"
                          lineas={detalleSeleccionado.sinContraparte}
                          evidencia={evidenciaGps?.porLinea}
                        />
                      </div>
                    )}
                    <EvidenciaGpsResumen resumen={evidenciaGps?.resumen ?? null} />
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── El estímulo de peaje: cada renglón dice lo que su ficha sostiene ── */}
          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-1">El estímulo de peaje — hasta 50% (LIF 2026 art. 20, ap. A · RMF 2026 regla 9.1.8)</h2>
            <p className="text-[11px] mb-3" style={{ color: 'var(--faint)' }}>
              La ley otorga un acreditamiento de hasta el 50% del gasto en autopistas de cuota; los
              requisitos operativos los fija la regla 9.1.8 de la RMF 2026 (texto verificado en
              fuente primaria — ficha rmf-2026-9.1.8). Cada renglón dice qué produce esta pantalla
              y qué corre por cuenta de la flota. Esta pantalla no afirma que el estímulo proceda.
            </p>
            <div className="grid md:grid-cols-2 gap-x-6 gap-y-1.5 text-[12.5px]">
              <Requisito tono="ok" texto="Fr. II — bitácora de viaje que coincida con el estado de cuenta del sistema electrónico de pago: es lo que esta pantalla produce con los cruces conciliados (botón «Bitácora RMF 9.1.8»); origen/destino salen del viaje y quedan vacíos si no se capturaron" />
              <Requisito tono="ok" texto="Fr. IV — factor 0.5 sobre el importe SIN IVA: la base que la regla fija y la que el motor ya aplica (la duda de «gasto total erogado» de la LIF quedó resuelta por esta fracción)" />
              <Requisito tono="flota" texto="Fr. I — aviso en MARZO del año siguiente por buzón tributario, con inventario vehicular desglosado — trámite de la flota, Likida no lo presenta" />
              <Requisito tono="flota" texto="Fr. III — pagar las autopistas con TAG o sistema electrónico y CONSERVAR los estados de cuenta — Likida no verifica la forma de pago de cada caseta; el efectivo en ventanilla mata el estímulo" />
              <Requisito tono="flota" texto="Dedicación EXCLUSIVA al transporte terrestre de carga, pasaje o turismo — lo declara la flota, Likida no lo verifica" />
              <Requisito tono="abierto" texto="Casetas de la Red Nacional de Autopistas de Cuota — el motor no distingue la red: aplica el factor a toda caseta (hallazgo H5 de la ficha LIF, abierto)" />
              <Requisito tono="flota" texto="Ingresos anuales menores a $300 millones — dato de la flota, Likida no lo conoce" />
              <Requisito tono="flota" texto="No ser parte relacionada (LISR art. 179) — dato de la flota, Likida no lo conoce" />
            </div>
            {peajeAcreditable !== null && (
              <p className="text-[12px] mt-3 pt-2.5 border-t" style={{ color: 'var(--muted)', borderColor: 'var(--line2)' }}>
                Peaje con el factor ya aplicado, histórico:{' '}
                <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{mxn(peajeAcreditable)}</span>
                {' '}— es estímulo BRUTO, sujeto a las condiciones de arriba, y es ingreso acumulable:
                tu contador lo neta de ISR.
              </p>
            )}
            <p className="text-[11px] pt-3" style={{ color: 'var(--faint)' }}>{LEYENDA_CORTA}</p>
          </section>

          {notificaciones}
        </div>
      </div>
    </main>
  );
}

/** El motivo de `detalle` dicho para una persona — nada de claves crudas. */
const MOTIVO_LEGIBLE: Record<string, string> = {
  sin_fecha: 'sin fecha legible en el archivo',
  sin_gastos_en_ventana: 'ningún gasto de caseta a ±1 día',
  contraparte_ya_reclamada: 'su contraparte ya la reclamó otra línea igual',
  ambigua_monto_exacto: 'dos gastos igual de buenos — decide un humano',
  ambigua_en_tolerancia: 'dos gastos igual de buenos — decide un humano',
  monto_distinto: 'el monto no coincide',
};

/** Rótulos de la evidencia GPS por línea. El de «con evidencia» AFIRMA
 *  (posiciones de esa unidad ese día); los demás nombran el dato que falta. */
const EVIDENCIA_LEGIBLE: Record<string, string> = {
  sin_fecha: 'GPS: sin fecha contra qué mirar',
  sin_viaje: 'GPS: sin viaje ligado — unidad desconocida',
  viaje_sin_unidad: 'GPS: el viaje no tiene unidad asignada',
  sin_posiciones_dia: 'GPS: sin posiciones ese día (¿GPS sin conectar?)',
};

/** El renglón chico bajo cada línea: viaje, diferencia medida, porqué y
 *  evidencia GPS — separados por «·» SOLO entre partes presentes. */
function MetaLinea({ linea, evidencia }: { linea: LineaDesgloseVista; evidencia?: EvidenciaGpsLinea }) {
  const partes: React.ReactNode[] = [];
  if (linea.viajeFolio) partes.push(<span key="v">viaje {linea.viajeFolio}</span>);
  if (linea.diferencia !== null && linea.diferencia !== 0) {
    partes.push(<span key="d" style={{ color: 'var(--warn)' }}>dif. {mxn(linea.diferencia)}</span>);
  }
  if (linea.motivo) partes.push(<span key="m">{MOTIVO_LEGIBLE[linea.motivo] ?? linea.motivo}</span>);
  if (evidencia) {
    partes.push(evidencia.estatus === 'con_evidencia'
      ? <span key="g" style={{ color: 'var(--ok)' }}>GPS: {numero(evidencia.posicionesDia)} posiciones ese día</span>
      : <span key="g">{EVIDENCIA_LEGIBLE[evidencia.motivo]}</span>);
  }
  if (partes.length === 0) return null;
  return (
    <div className="text-[10.5px]" style={{ color: 'var(--faint)' }}>
      {partes.map((p, i) => (
        <span key={i}>{i > 0 && ' · '}{p}</span>
      ))}
    </div>
  );
}

/**
 * El resumen de evidencia GPS del desglose completo. Tres verdades y ninguna
 * de más: cuántos cruces tienen posiciones de su unidad ese día, cuántos no
 * (con el motivo desglosado), y que la cubeta "inconsistente" (unidad LEJOS
 * de la caseta) NO existe todavía — exige la posición de las casetas, que no
 * tiene catálogo oficial (ficha red-nacional-autopistas). Prometerla sin ese
 * dato sería acusar con evidencia a medias.
 */
function EvidenciaGpsResumen({ resumen }: { resumen: ResumenEvidenciaGps | null }) {
  if (resumen === null) {
    return (
      <p className="text-[11px] mt-3" style={{ color: 'var(--faint)' }}>
        La evidencia GPS de este desglose no se pudo leer ahora mismo.
      </p>
    );
  }
  const m = resumen.porMotivo;
  const huecos: string[] = [];
  if (m.sin_viaje > 0) huecos.push(`${numero(m.sin_viaje)} sin viaje ligado`);
  if (m.viaje_sin_unidad > 0) huecos.push(`${numero(m.viaje_sin_unidad)} con viaje sin unidad`);
  if (m.sin_posiciones_dia > 0) huecos.push(`${numero(m.sin_posiciones_dia)} sin posiciones ese día`);
  if (m.sin_fecha > 0) huecos.push(`${numero(m.sin_fecha)} sin fecha legible`);
  return (
    <div className="rounded-xl hairline p-3 mt-3" style={{ background: 'var(--surface)' }}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold">Evidencia GPS del periodo</span>
        <span className="cifra-mono text-[13px] ml-auto">
          {numero(resumen.conEvidencia)} de {numero(resumen.total)} cruces con posiciones de su unidad ese día
        </span>
      </div>
      {/* LA FRASE, EXACTA (arreglo de agosto-2026). Decía que el conector
          «se activa en Conexiones» cuando los cinco de GPS estaban FUERA de
          esa pantalla: era falso y mandaba a buscar un botón que no existía.
          Ahora sí se capturan ahí, así que la primera mitad es verdad — y se
          agrega la segunda, que también hace falta: sin ligar la unidad a su
          dispositivo las lecturas llegan huérfanas, y de los cuatro solo
          Samsara tiene lector de posiciones escrito hoy (`LECTORES_POSICION`). */}
      {huecos.length > 0 && (
        <p className="text-[10.5px] mt-1" style={{ color: 'var(--faint)' }}>
          Sin evidencia: {huecos.join(' · ')}. «Sin posiciones» casi siempre significa GPS sin
          conectar: la credencial de tu proveedor se captura y se prueba en Conexiones, y cada
          unidad se liga a su número de dispositivo en Unidades. De los cuatro, el que hoy trae
          posiciones es Samsara; de Wialon, Geotab y Navixy se prueba la credencial y su lectura
          de posiciones está pendiente.
        </p>
      )}
      <p className="text-[10.5px] mt-1" style={{ color: 'var(--faint)' }}>
        Esto AFIRMA que la unidad anduvo ese día; no afirma cercanía a la caseta — eso exige la
        posición de cada plaza de cobro, sin catálogo oficial hoy. Un cruce sin evidencia no es
        un cruce falso: es un dato que falta, y esta tarjeta dice cuál.
      </p>
    </div>
  );
}

/**
 * Una cubeta del desglose del proveedor: el conteo COMPLETO (viene del
 * agregado, no de las filas enseñadas) y hasta 12 líneas de muestra con su
 * porqué. Si hay más de las que caben, se dice cuántas.
 */
function CubetaDesglose({ titulo, total, nota, tono, lineas, evidencia }: {
  titulo: string;
  total: number;
  nota: string;
  tono?: 'ok' | 'warn';
  lineas: LineaDesgloseVista[];
  /** id de línea → evidencia GPS, para el renglón chico de cada línea. */
  evidencia?: Record<string, EvidenciaGpsLinea>;
}) {
  return (
    <div className="rounded-xl hairline p-3" style={{ background: 'var(--surface)' }}>
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold">{titulo}</span>
        <span className="cifra-mono text-[15px] font-medium ml-auto"
          style={tono ? { color: `var(--${tono})` } : undefined}>{numero(total)}</span>
      </div>
      <p className="text-[10.5px] mb-2" style={{ color: 'var(--faint)' }}>{nota}</p>
      {lineas.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>Ninguna línea en esta cubeta.</p>
      ) : (
        <div className="space-y-1.5">
          {lineas.map((l) => (
            <div key={l.id} className="text-[11.5px] leading-snug">
              <div className="flex items-center gap-1.5">
                <span style={{ color: 'var(--muted)' }}>{l.fecha ? fechaCorta(l.fecha) : 'sin fecha'}</span>
                <span className="truncate" title={l.caseta ?? undefined}>{l.caseta ?? 'sin caseta'}</span>
                <span className="ml-auto shrink-0 cifra-mono">{mxn(l.monto)}</span>
              </div>
              <MetaLinea linea={l} evidencia={evidencia?.[l.id]} />
            </div>
          ))}
          {total > lineas.length && (
            <p className="text-[10.5px] pt-0.5" style={{ color: 'var(--faint)' }}>
              y {numero(total - lineas.length)} más en esta cubeta.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tres tonos y ninguno miente:
 * - `ok`      (palomita verde): hecho verificable en esta pantalla o sostenido
 *   por ficha verificada. Es el único que afirma.
 * - `abierto` (alerta ámbar): pregunta abierta — la ficha lo deja SIN RESOLVER
 *   o la regla no tiene texto verificado. Antes esto salía en verde (FI-A1).
 * - `flota`   (alerta gris): condición que va por cuenta de la flota; Likida
 *   no la conoce ni la verifica.
 */
function Requisito({ tono, texto }: { tono: 'ok' | 'abierto' | 'flota'; texto: string }) {
  return (
    <div className="flex items-start gap-2">
      {tono === 'ok'
        ? <CircleCheck width={13} height={13} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: 'var(--ok)' }} />
        : <CircleAlert width={13} height={13} strokeWidth={2} className="mt-0.5 shrink-0" style={{ color: tono === 'abierto' ? 'var(--warn)' : 'var(--muted)' }} />}
      <span style={{ color: tono === 'ok' ? undefined : 'var(--muted)' }}>{texto}</span>
    </div>
  );
}

function Leyenda({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 min-h-[110px] flex items-center justify-center">
      <p className="text-[12.5px] text-center max-w-[34ch]" style={{ color: 'var(--muted)' }}>{children}</p>
    </div>
  );
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}
