import Link from 'next/link';
import { ArrowRight, Inbox, CircleCheck, CircleAlert, CircleSlash, FileDown, FileSpreadsheet, Settings2 } from 'lucide-react';
import type { ConciliacionConsolidado, ColaPorConciliar, DesgloseRecibido } from '@/lib/likida/analytics';

// SOLO tipos: el módulo importa supabaseAdmin y no debe entrar al bundle de la vista.
import type { ResumenDesglose, DetalleDesglose, LineaDesgloseVista } from '@/lib/likida/intake/desglose_peaje';
import type { ResumenEvidenciaGps, EvidenciaGpsLinea } from '@/lib/likida/peajes/evidencia_gps';
import type { ResumenVerificacion } from '@/lib/likida/peajes/verificacion';
import { mxn, numero, fechaCorta } from '@/lib/formato';
import { LEYENDA_CORTA } from '@/lib/likida/cuadre/leyendas';
import { SubirDesglose, type AccionSubir } from './subir';
import { BotonEjecutar, type AccionBarrer } from './controles';
import { SubirDesgloseProveedor, type AccionImportar } from './subir-desglose';
import { BotonConciliar, type AccionConciliar } from './conciliar-desglose';
import { BotonAnular, type AccionAnular } from './anular-desglose';
import { DeclararPeriodo, type AccionPeriodo } from './declarar-periodo';
import { RevisionCobros, type EstadoRevisionCobros } from './revision-cobros';
// SOLO tipo y constante pura: el módulo importa el perfil (servidor) y no debe entrar al bundle de la vista.
import type { SuperficiePeajes } from '@/lib/likida/peajes/superficie_perfil';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  BotonEnlace, EstadoError, EstadoVacio, FilaTarjetas, Icono, MarcoPagina, StatusChip, Tarjeta, TituloRecuadro,
} from '@/app/ui-v2/componentes';
import './peajes.css';

/** Sin perfil: todo se pinta (valor local para no importar el módulo de servidor). */
const SUPERFICIE_TODA: SuperficiePeajes = { estimulo: true, cfdiYTickets: true, bitacoraEstimulo: true, gps: true, cursos: true };

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
  desglosesProveedor, desgloseSeleccionado, detalleSeleccionado, evidenciaGps, verificacion, importarDesglose, conciliarDesglose,
  anularDesglose, puedeAnular = false, declararPeriodo, periodoOficial = null, notificaciones, revisionCobros, superficie = SUPERFICIE_TODA,
}: {
  conciliacion: ConciliacionConsolidado | null;
  // FE-10: `ColaPorConciliar`, no `LineaPorConciliar[]` a secas — sin el
  // tipo con `.total` el prop perdía el conteo REAL que `getLineasPorConciliar`
  // ya trae, y la pantalla se quedaba con `lineas.length` (tope 200) como si
  // fuera el total.
  lineas: ColaPorConciliar | null;
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
  /** El estado conciliado del desglose abierto (cuadra / sin respaldo / por verificar). null = no se pudo leer. */
  verificacion: { resumen: ResumenVerificacion; sinEvaluarGps: number } | null;
  importarDesglose: AccionImportar;
  conciliarDesglose: AccionConciliar;
  /** Anular un desglose subido por error (0563). Solo se pinta si `puedeAnular` (área administración). */
  anularDesglose?: AccionAnular;
  puedeAnular?: boolean;
  /** A37-A2-12: declarar/corregir el periodo oficial de un desglose ya importado, y el que tiene hoy. */
  declararPeriodo?: AccionPeriodo;
  periodoOficial?: { desde: string | null; hasta: string | null } | null;
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
  /** T-A2-27: tarjetas y KPIs de la revisión de cobros del archivo abierto, ya calculados por la página.
   *  Sin la prop se pinta el estado vacío («sube el archivo del proveedor»). Un fallo aquí no toca el resto. */
  revisionCobros?: EstadoRevisionCobros;
  /** T-A2-31: qué partes del stand-by se pintan. Sin la prop (sin perfil) se pinta todo; con perfil `cinco_agentes` ninguna. */
  superficie?: SuperficiePeajes;
}) {
  const total = conciliacion ? conciliacion.conciliadas + conciliacion.porConciliar + conciliacion.sinMatch : 0;
  const pct = conciliacion && total > 0 ? Math.round((conciliacion.conciliadas / total) * 100) : null;

  return (
    <MarcoPagina titulo="Conciliación de peajes" apoyo="El estado de cuenta del TAG o monedero contra los gastos que comprobaron los viajes, y el estado del estímulo de peaje.">

      {superficie.cfdiYTickets && (
      <TiraCifras sello={selloHoy('Estados de cuenta de peaje')}>
        <Cifra etiqueta="Líneas conciliadas" info="peajes.lineas_conciliadas" valor={conciliacion ? numero(conciliacion.conciliadas) : '—'}
          nota={pct !== null ? `${numero(pct)}% del estado de cuenta` : 'aún sin estados de cuenta'} />
        <Cifra etiqueta="Por conciliar" info="peajes.por_conciliar" valor={conciliacion ? numero(conciliacion.porConciliar) : '—'}
          nota="esperan a un humano" tono={(conciliacion?.porConciliar ?? 0) > 0 ? 'warn' : undefined} />
        <Cifra etiqueta="Sin gasto que corresponda" info="peajes.sin_gasto" valor={conciliacion ? numero(conciliacion.sinMatch) : '—'}
          nota="revisadas y documentadas" />
        <Cifra etiqueta="Estados de cuenta" info="peajes.estados_cuenta" valor={conciliacion ? numero(conciliacion.cfdis) : '—'}
          nota="CFDI consolidados recibidos" />
      </TiraCifras>
      )}

      {/* ── T-A2-27: la revisión de cobros, arriba del detalle ── */}
      <RevisionCobros estado={revisionCobros ?? { tipo: 'sin_archivo' }} />

      {/* ── La ingesta: el ritual del PoC (CFDI consolidado: stand-by con perfil) ── */}
      {superficie.cfdiYTickets && (<>
      <Tarjeta titulo="Subir estado de cuenta" info="peajes.subir_estado_cuenta">
        <p className="rv-pj-sub">
          El XML del CFDI consolidado del TAG o del monedero — el mismo que el proveedor manda
          cada corte. El agente lo cruza contra los gastos de los viajes al instante.
          (También entra reenviándolo al WhatsApp de Likida desde la oficina. El desglose en
          Excel/PDF todavía no entra por aquí.)
        </p>
        <SubirDesglose subirDesglose={subirDesglose} />
      </Tarjeta>

      <FilaTarjetas variante="6-6">
        {/* La cola honesta */}
        <Tarjeta
          titulo="Esperan a un humano" info="peajes.esperan_humano"
          acciones={superficie.cfdiYTickets && (lineas?.length ?? 0) > 0 ? (
            <Link href={`/dashboard/combustible-casetas${sufijo}`} className="rv-pj-enlace">
              Resolver en la mesa <Icono icono={ArrowRight} tam={14} />
            </Link>
          ) : undefined}
        >
          <p className="rv-pj-sub">
            Líneas del estado de cuenta a las que el cruce automático no les encontró gasto único.
            El barrido las re-cruza contra los gastos que llegaron después.
          </p>
          <div>
            {/* FE-10: `.total` (medido, `count: 'exact'`), no `.length`
                (tope 200) — a un TAG de 800 tractos, decenas de miles de
                cruces/mes topan la mesa en "200 pendientes" cuando hay
                muchas más. */}
            <BotonEjecutar ejecutarAhora={ejecutarAhora} pendientes={lineas === null ? null : lineas.total} />
          </div>
          {lineas === null ? (
            <EstadoError compacto>No se pudo leer la cola ahora mismo.</EstadoError>
          ) : lineas.length === 0 ? (
            <EstadoVacio icono={Inbox} titulo="Nada espera a un humano">
              Cada línea nueva que el cruce no resuelva solo, aparece aquí.
            </EstadoVacio>
          ) : (
            <ul className="rv-pj-lista">
              {lineas.slice(0, 6).map((l) => (
                <li key={l.id} className="rv-pj-lista__fila">
                  <span className="rv-pj-apagado rv-pj-fijo">{l.fecha ? fechaCorta(l.fecha) : 'sin fecha'}</span>
                  <span className="rv-pj-corto" title={l.descripcion ?? undefined}>{l.descripcion ?? 'sin descripción'}</span>
                  <span className="rv-pj-der rv-pj-fijo cifra-mono">{mxn(l.monto)}</span>
                  <span className="rv-pj-fijo rv-pj-nota">
                    {l.candidatos.length === 0 ? 'sin candidatos' : `${numero(l.candidatos.length)} candidato${l.candidatos.length === 1 ? '' : 's'}`}
                  </span>
                </li>
              ))}
              {lineas.total > 6 && (
                <li className="rv-pj-nota">y {numero(lineas.total - 6)} más en la mesa.</li>
              )}
            </ul>
          )}
        </Tarjeta>

        {/* Bitácora de desgloses */}
        <Tarjeta titulo="Estados de cuenta recibidos" info="peajes.estados_recibidos">
          <p className="rv-pj-sub">Cada consolidado, con el saldo de su cruce</p>
          {desgloses === null ? (
            <EstadoError compacto>No se pudo leer la bitácora ahora mismo.</EstadoError>
          ) : desgloses.length === 0 ? (
            <EstadoVacio icono={Inbox} titulo="Aún sin estados de cuenta">
              Súbelo arriba o reenvíalo por WhatsApp y el cruce corre solo.
            </EstadoVacio>
          ) : (
            <ul className="rv-pj-lista">
              {desgloses.map((d) => (
                <li key={d.cfdiXmlId} className="rv-pj-lista__fila">
                  <span className="cifra-mono rv-pj-nota rv-pj-fijo">{d.uuidCorto}</span>
                  <span className="rv-pj-apagado rv-pj-fijo">{d.recibido ? fechaCorta(d.recibido) : '—'}</span>
                  {d.parcial && (
                    <span className="rv-pj-der rv-pj-fijo"
                      title="Este estado de cuenta rebasa la ventana de 1,000 líneas que se lee aquí: el importe y los conteos son un mínimo, no el total.">
                      <StatusChip tono="warn">parcial</StatusChip>
                    </span>
                  )}
                  <span className={`${d.parcial ? '' : 'rv-pj-der '}rv-pj-fijo cifra-mono`}>{d.parcial ? '≥ ' : ''}{mxn(d.monto)}</span>
                  <span className="rv-pj-fijo rv-pj-conteo" data-tono="ok">
                    <Icono icono={CircleCheck} tam={14} /> {numero(d.conciliadas)}
                  </span>
                  {d.porConciliar > 0 && (
                    <span className="rv-pj-fijo rv-pj-conteo" data-tono="warn">
                      <Icono icono={CircleAlert} tam={14} /> {numero(d.porConciliar)}
                    </span>
                  )}
                  {d.sinMatch > 0 && (
                    <span className="rv-pj-fijo rv-pj-conteo">
                      <Icono icono={CircleSlash} tam={14} /> {numero(d.sinMatch)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </FilaTarjetas>

      </>)}

      {/* ── El desglose del PROVEEDOR (F5, PoC): tres cubetas y bitácora ── */}
      <Tarjeta
        titulo="Desglose del proveedor de peaje" info="peajes.desglose_proveedor"
        acciones={(
          <BotonEnlace href={`/dashboard/agentes/peajes/configuracion${sufijo}`} tamano="sm" icono={<Icono icono={Settings2} />}>
            Configuración: TAGs, casetas, {superficie.gps ? 'geocercas, ' : ''}mapeo de columnas y buzón
          </BotonEnlace>
        )}
      >
        <p className="rv-pj-sub">
          El Excel/CSV (o PDF con texto) que IAVE, PASE, TeleVía o el convenio directo mandan
          cada corte — a mano aquí, o solo por el buzón firmado (ver Configuración). El agente lo
          cruza contra los gastos de caseta de los viajes — por fecha (±1 día) y monto, usando el
          TAG de cada unidad para desempatar{superficie.gps ? ' — y, cuando hay catálogo de casetas con coordenadas y la unidad tiene GPS, valida con la hora del cobro que la unidad estuvo en la caseta' : ''}.
          Cada línea queda <b>cuadra</b>, <b>sin respaldo</b> o <b>por verificar</b>: lo que el dato
          no alcanza a afirmar no se acusa.{superficie.bitacoraEstimulo && ' De lo que cuadra sale la bitácora de la RMF 9.1.8.'}
        </p>
        <SubirDesgloseProveedor importar={importarDesglose} />

        {desglosesProveedor === null ? (
          <EstadoError compacto>No se pudo leer la lista de desgloses ahora mismo.</EstadoError>
        ) : desglosesProveedor.length === 0 ? (
          <EstadoVacio icono={FileSpreadsheet} titulo="Aún sin desgloses del proveedor">
            Súbelo arriba y el cruce corre al instante, con su % conciliado medido.
          </EstadoVacio>
        ) : (
          <div className="rv-pj-desglose">
            {/* La lista, cada uno con su % MEDIDO */}
            <div className="rv-pj-desglose__lista">
              <TituloRecuadro nivel="h3" info="peajes.desgloses_importados">Desgloses importados</TituloRecuadro>
              <ul className="rv-pj-lista">
                {desglosesProveedor.map((d) => {
                  const activo = d.desgloseId === desgloseSeleccionado?.desgloseId;
                  return (
                    <li key={d.desgloseId}>
                      <Link
                        href={`/dashboard/agentes/peajes${sufijo}${sufijo ? '&' : '?'}desglose=${d.desgloseId}`}
                        className="rv-pj-item" data-activo={activo || undefined} aria-current={activo ? 'true' : undefined}>
                        <span className="rv-pj-item__cab">
                          <span className="rv-pj-corto" title={d.archivoNombre ?? undefined}>
                            {d.proveedor ?? d.archivoNombre ?? 'desglose'}
                          </span>
                          <span className="rv-pj-der cifra-mono" data-tono={d.pctCuadra !== null && d.pctCuadra >= 100 ? 'ok' : undefined}>
                            {d.pctCuadra === null ? '—' : `${numero(d.pctCuadra)}%`}
                          </span>
                        </span>
                        <span className="rv-pj-nota">
                          {d.periodoDesde && d.periodoHasta
                            ? `${fechaCorta(d.periodoDesde)} – ${fechaCorta(d.periodoHasta)}`
                            : 'periodo sin medir (líneas sin fecha)'}
                          {' · '}{numero(d.total)} líneas
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* El detalle del seleccionado: las tres cubetas */}
            {desgloseSeleccionado && (
              <div className="rv-pj-desglose__detalle">
                <div className="rv-pj-acciones">
                  <BotonConciliar conciliar={conciliarDesglose} desgloseId={desgloseSeleccionado.desgloseId} />
                  {puedeAnular && anularDesglose && <BotonAnular anular={anularDesglose} desgloseId={desgloseSeleccionado.desgloseId} />}
                  {superficie.bitacoraEstimulo && (<>
                  {desgloseSeleccionado.cuadra > 0 ? (
                    <BotonEnlace href={`/api/export/bitacora-peaje?desglose=${desgloseSeleccionado.desgloseId}${sufijo ? `&${sufijo.slice(1)}` : ''}`}
                      icono={<Icono icono={FileDown} />}>
                      Bitácora RMF 9.1.8 (CSV)
                    </BotonEnlace>
                  ) : (
                    <span className="rv-pj-nota">
                      La bitácora RMF 9.1.8 se habilita cuando al menos una línea cuadre.
                    </span>
                  )}
                  <BotonEnlace href={`/api/export/bitacora-conciliada?desglose=${desgloseSeleccionado.desgloseId}${sufijo ? `&${sufijo.slice(1)}` : ''}`}
                    icono={<Icono icono={FileDown} />}>
                    Bitácora conciliada (CSV)
                  </BotonEnlace>
                  </>)}
                  <BotonEnlace href={`/api/export/peajes-vinculos?desglose=${desgloseSeleccionado.desgloseId}${sufijo ? `&${sufijo.slice(1)}` : ''}`}
                    icono={<Icono icono={FileDown} />}>
                    Casetas ligadas a viaje (Excel)
                  </BotonEnlace>
                  <BotonEnlace variante="primary" href={`/dashboard/agentes/peajes/reclamacion${sufijo}${sufijo ? '&' : '?'}desglose=${desgloseSeleccionado.desgloseId}`}
                    icono={<Icono icono={FileDown} />}>
                    Reporte de reclamación
                  </BotonEnlace>
                  <BotonEnlace href={`/dashboard/agentes/peajes/reclamacion${sufijo}${sufijo ? '&' : '?'}desglose=${desgloseSeleccionado.desgloseId}#revision-cobros`}>
                    Revisión de cobros (candidatos)
                  </BotonEnlace>
                </div>
                {declararPeriodo && (
                  <DeclararPeriodo declarar={declararPeriodo} desgloseId={desgloseSeleccionado.desgloseId}
                    desde={periodoOficial?.desde ?? null} hasta={periodoOficial?.hasta ?? null} />
                )}
                {superficie.gps && <EstadoConciliado v={verificacion} />}
                {detalleSeleccionado === null ? (
                  <EstadoError compacto>No se pudo leer el detalle de este desglose ahora mismo.</EstadoError>
                ) : (
                  <div className="rv-pj-cubetas">
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
                {superficie.gps && <EvidenciaGpsResumen resumen={evidenciaGps?.resumen ?? null} />}
              </div>
            )}
          </div>
        )}
      </Tarjeta>

      {/* ── El estímulo de peaje: cada renglón dice lo que su ficha sostiene ── */}
      {superficie.estimulo && (
      <Tarjeta titulo="El estímulo de peaje — hasta 50% (LIF 2026 art. 20, ap. A · RMF 2026 regla 9.1.8)" info="peajes.estimulo">
        <p className="rv-pj-sub">
          La ley otorga un acreditamiento de hasta el 50% del gasto en autopistas de cuota; los
          requisitos operativos los fija la regla 9.1.8 de la RMF 2026 (texto verificado en
          fuente primaria — ficha rmf-2026-9.1.8). Cada renglón dice qué produce esta pantalla
          y qué corre por cuenta de la flota. Esta pantalla no afirma que el estímulo proceda.
        </p>
        <div className="rv-pj-requisitos">
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
          <p className="rv-pj-pie">
            Peaje con el factor ya aplicado, histórico:{' '}
            <strong className="cifra-mono">{mxn(peajeAcreditable)}</strong>
            {' '}— es estímulo BRUTO, sujeto a las condiciones de arriba, y es ingreso acumulable:
            tu contador lo neta de ISR.
          </p>
        )}
        <p className="rv-pj-nota">{LEYENDA_CORTA}</p>
      </Tarjeta>
      )}

      {notificaciones}
    </MarcoPagina>
  );
}

/** El motivo de `detalle` dicho para una persona — nada de claves crudas. */
const MOTIVO_LEGIBLE: Record<string, string> = {
  sin_fecha: 'sin fecha legible en el archivo',
  sin_gastos_en_ventana: 'ningún gasto de caseta a ±1 día',
  contraparte_ya_reclamada: 'su contraparte ya la reclamó otra línea igual (de este u otro archivo)',
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
/** El estado conciliado del desglose: tres cubetas honestas, con el dinero de cada una. */
function EstadoConciliado({ v }: { v: { resumen: ResumenVerificacion; sinEvaluarGps: number } | null }) {
  if (v === null) {
    return <EstadoError compacto>No se pudo calcular el estado conciliado ahora mismo.</EstadoError>;
  }
  const r = v.resumen;
  return (
    <div className="rv-pj-conciliado">
      <TiraCifras sello={selloHoy('Estados de cuenta de peaje')}>
        <Cifra etiqueta="Cuadran" info="peajes.cuadran" valor={numero(r.cuadra)} nota={mxn(r.montoCuadra)} />
        <Cifra etiqueta="Por verificar" info="peajes.por_verificar" valor={numero(r.porVerificar)} nota={`${mxn(r.montoPorVerificar)} · el dato no alcanza o hay una señal`} tono={r.porVerificar > 0 ? 'warn' : undefined} />
        <Cifra etiqueta="Sin respaldo" info="peajes.sin_respaldo" valor={numero(r.sinRespaldo)} nota={`${mxn(r.montoSinRespaldo)} · no es acusación`} tono={r.sinRespaldo > 0 ? 'bad' : undefined} />
      </TiraCifras>
      {v.sinEvaluarGps > 0 && (
        <p className="rv-pj-nota">
          {numero(v.sinEvaluarGps)} líneas no tienen evaluación GPS (el cruce es anterior a la hora del cobro): pulsa «Conciliar» para evaluarlas.
        </p>
      )}
    </div>
  );
}

function MetaLinea({ linea, evidencia }: { linea: LineaDesgloseVista; evidencia?: EvidenciaGpsLinea }) {
  const partes: React.ReactNode[] = [];
  if (linea.viajeFolio) partes.push(<span key="v">viaje {linea.viajeFolio}</span>);
  if (linea.diferencia !== null && linea.diferencia !== 0) {
    partes.push(<span key="d" className="rv-pj-tono" data-tono="warn">dif. {mxn(linea.diferencia)}</span>);
  }
  if (linea.motivo) partes.push(<span key="m">{MOTIVO_LEGIBLE[linea.motivo] ?? linea.motivo}</span>);
  if (evidencia) {
    partes.push(evidencia.estatus === 'con_evidencia'
      ? <span key="g" className="rv-pj-tono" data-tono="ok">GPS: {numero(evidencia.posicionesDia)} posiciones ese día</span>
      : <span key="g">{EVIDENCIA_LEGIBLE[evidencia.motivo]}</span>);
  }
  if (partes.length === 0) return null;
  return (
    <div className="rv-pj-nota">
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
    return <p className="rv-pj-nota">La evidencia GPS de este desglose no se pudo leer ahora mismo.</p>;
  }
  const m = resumen.porMotivo;
  const huecos: string[] = [];
  if (m.sin_viaje > 0) huecos.push(`${numero(m.sin_viaje)} sin viaje ligado`);
  if (m.viaje_sin_unidad > 0) huecos.push(`${numero(m.viaje_sin_unidad)} con viaje sin unidad`);
  if (m.sin_posiciones_dia > 0) huecos.push(`${numero(m.sin_posiciones_dia)} sin posiciones ese día`);
  if (m.sin_fecha > 0) huecos.push(`${numero(m.sin_fecha)} sin fecha legible`);
  return (
    <div className="rv-pj-caja">
      <div className="rv-pj-caja__cab">
        <strong>Evidencia GPS del periodo</strong>
        <span className="cifra-mono rv-pj-der">
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
        <p className="rv-pj-nota">
          Sin evidencia: {huecos.join(' · ')}. «Sin posiciones» casi siempre significa GPS sin
          conectar: la credencial de tu proveedor se captura y se prueba en Conexiones, y cada
          unidad se liga a su número de dispositivo en Unidades. De los cuatro, el que hoy trae
          posiciones es Samsara; de Wialon, Geotab y Navixy se prueba la credencial y su lectura
          de posiciones está pendiente.
        </p>
      )}
      <p className="rv-pj-nota">
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
    <div className="rv-pj-caja">
      <div className="rv-pj-caja__cab">
        <strong>{titulo}</strong>
        <span className="cifra-mono rv-pj-der rv-pj-caja__total" data-tono={tono}>{numero(total)}</span>
      </div>
      <p className="rv-pj-nota">{nota}</p>
      {lineas.length === 0 ? (
        <p className="rv-pj-nota">Ninguna línea en esta cubeta.</p>
      ) : (
        <ul className="rv-pj-lista">
          {lineas.map((l) => (
            <li key={l.id} className="rv-pj-cubeta__linea">
              <div className="rv-pj-lista__fila">
                <span className="rv-pj-apagado rv-pj-fijo">{l.fecha ? fechaCorta(l.fecha) : 'sin fecha'}</span>
                <span className="rv-pj-corto" title={l.caseta ?? undefined}>{l.caseta ?? 'sin caseta'}</span>
                <span className="rv-pj-der rv-pj-fijo cifra-mono">{mxn(l.monto)}</span>
              </div>
              <MetaLinea linea={l} evidencia={evidencia?.[l.id]} />
            </li>
          ))}
          {total > lineas.length && (
            <li className="rv-pj-nota">y {numero(total - lineas.length)} más en esta cubeta.</li>
          )}
        </ul>
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
    <div className="rv-pj-req" data-tono={tono}>
      <span className="rv-pj-req__icono"><Icono icono={tono === 'ok' ? CircleCheck : CircleAlert} /></span>
      <span className="rv-pj-req__texto">{texto}</span>
    </div>
  );
}
