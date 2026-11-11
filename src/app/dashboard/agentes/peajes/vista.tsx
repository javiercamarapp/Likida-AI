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
import {
  BotonEnlace, EstadoError, EstadoVacio, FilaTarjetas, Icono, StatusChip, Tarjeta, TituloRecuadro,
} from '@/app/ui-v2/componentes';
import './peajes.css';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { TR_ES, rico, type TrAgentes, selloHoyTr, type TAgentes } from '../i18n-agentes';

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
  anularDesglose, puedeAnular = false, declararPeriodo, periodoOficial = null, notificaciones, revisionCobros, superficie = SUPERFICIE_TODA, tr = TR_ES,
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
  superficie?: SuperficiePeajes; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const total = conciliacion ? conciliacion.conciliadas + conciliacion.porConciliar + conciliacion.sinMatch : 0;
  const pct = conciliacion && total > 0 ? Math.round((conciliacion.conciliadas / total) * 100) : null;

  return (
    <EsqueletoTablaMaestra
      titulo={tx('peajes.vista.conciliacion_de_peajes')}
      apoyo={tx('peajes.vista.el_estado_de_cuenta_del')}
      cifras={superficie.cfdiYTickets ? [
        { etiqueta: tx('peajes.vista.lineas_conciliadas'), info: 'peajes.lineas_conciliadas', valor: conciliacion ? numero(conciliacion.conciliadas) : null,
          nota: pct !== null ? tx('peajes.vista.del_estado_de_cuenta', { pct: numero(pct) }) : tx('peajes.vista.aun_sin_estados_de_cuenta') },
        { etiqueta: tx('peajes.vista.por_conciliar'), info: 'peajes.por_conciliar', valor: conciliacion ? numero(conciliacion.porConciliar) : null,
          nota: tx('peajes.vista.esperan_a_un_humano'), tono: (conciliacion?.porConciliar ?? 0) > 0 ? 'warn' : undefined },
        { etiqueta: tx('peajes.vista.sin_gasto_que_corresponda'), info: 'peajes.sin_gasto', valor: conciliacion ? numero(conciliacion.sinMatch) : null,
          nota: tx('peajes.vista.revisadas_y_documentadas') },
        { etiqueta: tx('peajes.vista.estados_de_cuenta'), info: 'peajes.estados_cuenta', valor: conciliacion ? numero(conciliacion.cfdis) : null,
          nota: tx('peajes.vista.cfdi_consolidados_recibidos') },
      ] : undefined}
      etiquetaCifras={tx('peajes.vista.conciliacion_de_peajes')}
      selloCifras={selloHoyTr(tr, tx('peajes.vista.estados_de_cuenta_de_peaje'))}
    >

      {/* ── T-A2-27: la revisión de cobros, arriba del detalle ── */}
      <RevisionCobros tr={tr} estado={revisionCobros ?? { tipo: 'sin_archivo' }} />

      {/* ── La ingesta: el ritual del PoC (CFDI consolidado: stand-by con perfil) ── */}
      {superficie.cfdiYTickets && (<>
      <Tarjeta titulo={tx('peajes.vista.subir_estado_de_cuenta')} info="peajes.subir_estado_cuenta">
        <p className="rv-pj-sub">
          {tx('peajes.vista.el_xml_del_cfdi_consolidado')}
        </p>
        <SubirDesglose subirDesglose={subirDesglose} />
      </Tarjeta>

      <FilaTarjetas variante="6-6">
        {/* La cola honesta */}
        <Tarjeta
          titulo={tx('peajes.vista.esperan_a_un_humano_2')} info="peajes.esperan_humano"
          acciones={superficie.cfdiYTickets && (lineas?.length ?? 0) > 0 ? (
            <Link href={`/dashboard/combustible-casetas${sufijo}`} className="rv-pj-enlace">
              {rico(tx('peajes.vista.resolver_en_la_mesa'), { el: <Icono icono={ArrowRight} tam={14} /> })}
            </Link>
          ) : undefined}
        >
          <p className="rv-pj-sub">
            {tx('peajes.vista.lineas_del_estado_de_cuenta')}
          </p>
          <div>
            {/* FE-10: `.total` (medido, `count: 'exact'`), no `.length`
                (tope 200) — a un TAG de 800 tractos, decenas de miles de
                cruces/mes topan la mesa en "200 pendientes" cuando hay
                muchas más. */}
            <BotonEjecutar ejecutarAhora={ejecutarAhora} pendientes={lineas === null ? null : lineas.total} />
          </div>
          {lineas === null ? (
            <EstadoError compacto>{tx('peajes.vista.no_se_pudo_leer_la')}</EstadoError>
          ) : lineas.length === 0 ? (
            <EstadoVacio icono={Inbox} titulo={tx('peajes.vista.nada_espera_a_un_humano')}>
              {tx('peajes.vista.cada_linea_nueva_que_el')}
            </EstadoVacio>
          ) : (
            <ul className="rv-pj-lista">
              {lineas.slice(0, 6).map((l) => (
                <li key={l.id} className="rv-pj-lista__fila">
                  <span className="rv-pj-apagado rv-pj-fijo">{l.fecha ? fechaCorta(l.fecha, tr.idioma) : 'sin fecha'}</span>
                  <span className="rv-pj-corto" title={l.descripcion ?? undefined}>{l.descripcion ?? tx('peajes.vista.sin_descripcion')}</span>
                  <span className="rv-pj-der rv-pj-fijo cifra-mono">{mxn(l.monto, tr.idioma)}</span>
                  <span className="rv-pj-fijo rv-pj-nota">
                    {l.candidatos.length === 0 ? 'sin candidatos' : `${numero(l.candidatos.length)} candidato${l.candidatos.length === 1 ? '' : 's'}`}
                  </span>
                </li>
              ))}
              {lineas.total > 6 && (
                <li className="rv-pj-nota">{tx('peajes.vista.y_mas_en_la_mesa', { v0: numero(lineas.total - 6) })}</li>
              )}
            </ul>
          )}
        </Tarjeta>

        {/* Bitácora de desgloses */}
        <Tarjeta titulo={tx('peajes.vista.estados_de_cuenta_recibidos')} info="peajes.estados_recibidos">
          <p className="rv-pj-sub">{tx('peajes.vista.cada_consolidado_con_el_saldo')}</p>
          {desgloses === null ? (
            <EstadoError compacto>{tx('peajes.vista.no_se_pudo_leer_la_2')}</EstadoError>
          ) : desgloses.length === 0 ? (
            <EstadoVacio icono={Inbox} titulo={tx('peajes.vista.aun_sin_estados_de_cuenta_2')}>
              {tx('peajes.vista.subelo_arriba_o_reenvialo_por')}
            </EstadoVacio>
          ) : (
            <ul className="rv-pj-lista">
              {desgloses.map((d) => (
                <li key={d.cfdiXmlId} className="rv-pj-lista__fila">
                  <span className="cifra-mono rv-pj-nota rv-pj-fijo">{d.uuidCorto}</span>
                  <span className="rv-pj-apagado rv-pj-fijo">{d.recibido ? fechaCorta(d.recibido, tr.idioma) : '—'}</span>
                  {d.parcial && (
                    <span className="rv-pj-der rv-pj-fijo"
                      title={tx('peajes.vista.este_estado_de_cuenta_rebasa')}>
                      <StatusChip tono="warn">{tx('peajes.vista.parcial')}</StatusChip>
                    </span>
                  )}
                  <span className={`${d.parcial ? '' : 'rv-pj-der '}rv-pj-fijo cifra-mono`}>{d.parcial ? '≥ ' : ''}{mxn(d.monto, tr.idioma)}</span>
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
        titulo={tx('peajes.vista.desglose_del_proveedor_de_peaje')} info="peajes.desglose_proveedor"
        acciones={(
          <BotonEnlace href={`/dashboard/agentes/peajes/configuracion${sufijo}`} tamano="sm" icono={<Icono icono={Settings2} />}>
            {tx('peajes.vista.configuracion_tags_casetas_mapeo_de', { v0: superficie.gps ? 'geocercas, ' : '' })}
          </BotonEnlace>
        )}
      >
        <p className="rv-pj-sub">
          {rico(tx('peajes.vista.el_excel_csv_o_pdf'), { v0: superficie.gps ? tx('peajes.vista.y_cuando_hay_catalogo_de') : '', b: <b>{tx('peajes.vista.cuadra')}</b>, b2: <b>{tx('peajes.vista.sin_respaldo')}</b>, b3: <b>{tx('peajes.vista.por_verificar')}</b>, v4: superficie.bitacoraEstimulo && tx('peajes.vista.de_lo_que_cuadra_sale') })}
        </p>
        <SubirDesgloseProveedor importar={importarDesglose} />

        {desglosesProveedor === null ? (
          <EstadoError compacto>{tx('peajes.vista.no_se_pudo_leer_la_3')}</EstadoError>
        ) : desglosesProveedor.length === 0 ? (
          <EstadoVacio icono={FileSpreadsheet} titulo={tx('peajes.vista.aun_sin_desgloses_del_proveedor')}>
            {tx('peajes.vista.subelo_arriba_y_el_cruce')}
          </EstadoVacio>
        ) : (
          <div className="rv-pj-desglose">
            {/* La lista, cada uno con su % MEDIDO */}
            <div className="rv-pj-desglose__lista">
              <TituloRecuadro nivel="h3" info="peajes.desgloses_importados">{tx('peajes.vista.desgloses_importados')}</TituloRecuadro>
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
                            {d.proveedor ?? d.archivoNombre ?? tx('peajes.vista.desglose')}
                          </span>
                          <span className="rv-pj-der cifra-mono" data-tono={d.pctCuadra !== null && d.pctCuadra >= 100 ? 'ok' : undefined}>
                            {d.pctCuadra === null ? '—' : `${numero(d.pctCuadra)}%`}
                          </span>
                        </span>
                        <span className="rv-pj-nota">
                          {tx('peajes.vista.lineas', { v0: d.periodoDesde && d.periodoHasta
                            ? `${fechaCorta(d.periodoDesde, tr.idioma)} – ${fechaCorta(d.periodoHasta, tr.idioma)}`
                            : tx('peajes.vista.periodo_sin_medir_lineas_sin'), v1: ' · ', total: numero(d.total) })}
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
                      {tx('peajes.vista.bitacora_rmf_9_1_8')}
                    </BotonEnlace>
                  ) : (
                    <span className="rv-pj-nota">
                      {tx('peajes.vista.la_bitacora_rmf_9_1')}
                    </span>
                  )}
                  <BotonEnlace href={`/api/export/bitacora-conciliada?desglose=${desgloseSeleccionado.desgloseId}${sufijo ? `&${sufijo.slice(1)}` : ''}`}
                    icono={<Icono icono={FileDown} />}>
                    {tx('peajes.vista.bitacora_conciliada_csv')}
                  </BotonEnlace>
                  </>)}
                  <BotonEnlace href={`/api/export/peajes-vinculos?desglose=${desgloseSeleccionado.desgloseId}${sufijo ? `&${sufijo.slice(1)}` : ''}`}
                    icono={<Icono icono={FileDown} />}>
                    {tx('peajes.vista.casetas_ligadas_a_viaje_excel')}
                  </BotonEnlace>
                  <BotonEnlace variante="primary" href={`/dashboard/agentes/peajes/reclamacion${sufijo}${sufijo ? '&' : '?'}desglose=${desgloseSeleccionado.desgloseId}`}
                    icono={<Icono icono={FileDown} />}>
                    {tx('peajes.vista.reporte_de_reclamacion')}
                  </BotonEnlace>
                  <BotonEnlace href={`/dashboard/agentes/peajes/reclamacion${sufijo}${sufijo ? '&' : '?'}desglose=${desgloseSeleccionado.desgloseId}#revision-cobros`}>
                    {tx('peajes.vista.revision_de_cobros_candidatos')}
                  </BotonEnlace>
                </div>
                {declararPeriodo && (
                  <DeclararPeriodo declarar={declararPeriodo} desgloseId={desgloseSeleccionado.desgloseId}
                    desde={periodoOficial?.desde ?? null} hasta={periodoOficial?.hasta ?? null} />
                )}
                {superficie.gps && <EstadoConciliado tr={tr} v={verificacion} />}
                {detalleSeleccionado === null ? (
                  <EstadoError compacto>{tx('peajes.vista.no_se_pudo_leer_el')}</EstadoError>
                ) : (
                  <div className="rv-pj-cubetas">
                    <CubetaDesglose tr={tr}
                      titulo={tx('peajes.vista.cuadran')}
                      total={desgloseSeleccionado.cuadra}
                      nota={tx('peajes.vista.ligadas_a_su_gasto_de')}
                      tono="ok"
                      lineas={detalleSeleccionado.cuadra}
                      evidencia={evidenciaGps?.porLinea}
                    />
                    <CubetaDesglose tr={tr}
                      titulo={tx('peajes.vista.no_cuadran')}
                      total={desgloseSeleccionado.noCuadra}
                      nota={tx('peajes.vista.discrepancia_o_ambiguedad_el_porque')}
                      tono="warn"
                      lineas={detalleSeleccionado.noCuadra}
                      evidencia={evidenciaGps?.porLinea}
                    />
                    <CubetaDesglose tr={tr}
                      titulo={tx('peajes.vista.sin_contraparte')}
                      total={desgloseSeleccionado.sinContraparte}
                      nota={tx('peajes.vista.cruces_que_ningun_gasto_de')}
                      lineas={detalleSeleccionado.sinContraparte}
                      evidencia={evidenciaGps?.porLinea}
                    />
                  </div>
                )}
                {superficie.gps && <EvidenciaGpsResumen tr={tr} resumen={evidenciaGps?.resumen ?? null} />}
              </div>
            )}
          </div>
        )}
      </Tarjeta>

      {/* ── El estímulo de peaje: cada renglón dice lo que su ficha sostiene ── */}
      {superficie.estimulo && (
      <Tarjeta titulo={tx('peajes.vista.el_estimulo_de_peaje_hasta')} info="peajes.estimulo">
        <p className="rv-pj-sub">
          {tx('peajes.vista.la_ley_otorga_un_acreditamiento')}
        </p>
        <div className="rv-pj-requisitos">
          <Requisito tono="ok" texto={tx('peajes.vista.fr_ii_bitacora_de_viaje')} />
          <Requisito tono="ok" texto={tx('peajes.vista.fr_iv_factor_0_5')} />
          <Requisito tono="flota" texto={tx('peajes.vista.fr_i_aviso_en_marzo')} />
          <Requisito tono="flota" texto={tx('peajes.vista.fr_iii_pagar_las_autopistas')} />
          <Requisito tono="flota" texto={tx('peajes.vista.dedicacion_exclusiva_al_transporte_t')} />
          <Requisito tono="abierto" texto={tx('peajes.vista.casetas_de_la_red_nacional')} />
          <Requisito tono="flota" texto={tx('peajes.vista.ingresos_anuales_menores_a_300')} />
          <Requisito tono="flota" texto={tx('peajes.vista.no_ser_parte_relacionada_lisr')} />
        </div>
        {peajeAcreditable !== null && (
          <p className="rv-pj-pie">
            {rico(tx('peajes.vista.peaje_con_el_factor_ya'), { v0: ' ', strong: <strong className="cifra-mono">{mxn(peajeAcreditable, tr.idioma)}</strong>, v2: ' ' })}
          </p>
        )}
        <p className="rv-pj-nota">{LEYENDA_CORTA}</p>
      </Tarjeta>
      )}

      {notificaciones}
    </EsqueletoTablaMaestra>
  );
}

/** El motivo de `detalle` dicho para una persona — nada de claves crudas. */
const MOTIVO_LEGIBLE = (tx: TAgentes): Record<string, string> => ({
  sin_fecha: tx('peajes.vista.sin_fecha_legible_en_el'),
  sin_gastos_en_ventana: tx('peajes.vista.ningun_gasto_de_caseta_a'),
  contraparte_ya_reclamada: tx('peajes.vista.su_contraparte_ya_la_reclamo'),
  ambigua_monto_exacto: tx('peajes.vista.dos_gastos_igual_de_buenos'),
  ambigua_en_tolerancia: tx('peajes.vista.dos_gastos_igual_de_buenos'),
  monto_distinto: tx('peajes.vista.el_monto_no_coincide'),
});

/** Rótulos de la evidencia GPS por línea. El de «con evidencia» AFIRMA
 *  (posiciones de esa unidad ese día); los demás nombran el dato que falta. */
const EVIDENCIA_LEGIBLE = (tx: TAgentes): Record<string, string> => ({
  sin_fecha: tx('peajes.vista.gps_sin_fecha_contra_que'),
  sin_viaje: 'GPS: sin viaje ligado — unidad desconocida',
  viaje_sin_unidad: tx('peajes.vista.gps_el_viaje_no_tiene'),
  sin_posiciones_dia: tx('peajes.vista.gps_sin_posiciones_ese_dia'),
});

/** El renglón chico bajo cada línea: viaje, diferencia medida, porqué y
 *  evidencia GPS — separados por «·» SOLO entre partes presentes. */
/** El estado conciliado del desglose: tres cubetas honestas, con el dinero de cada una. */
function EstadoConciliado({ v, tr = TR_ES }: { v: { resumen: ResumenVerificacion; sinEvaluarGps: number } | null; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  if (v === null) {
    return <EstadoError compacto>{tx('peajes.vista.no_se_pudo_calcular_el')}</EstadoError>;
  }
  const r = v.resumen;
  return (
    <div className="rv-pj-conciliado">
      <TiraCifras sello={selloHoyTr(tr, tx('peajes.vista.estados_de_cuenta_de_peaje'))}>
        <Cifra etiqueta={tx('peajes.vista.cuadran')} info="peajes.cuadran" valor={numero(r.cuadra)} nota={mxn(r.montoCuadra, tr.idioma)} />
        <Cifra etiqueta={tx('peajes.vista.por_verificar_2')} info="peajes.por_verificar" valor={numero(r.porVerificar)} nota={tx('peajes.vista.el_dato_no_alcanza_o', { montoPorVerificar: mxn(r.montoPorVerificar, tr.idioma) })} tono={r.porVerificar > 0 ? 'warn' : undefined} />
        <Cifra etiqueta={tx('peajes.vista.sin_respaldo_2')} info="peajes.sin_respaldo" valor={numero(r.sinRespaldo)} nota={tx('peajes.vista.no_es_acusacion', { montoSinRespaldo: mxn(r.montoSinRespaldo, tr.idioma) })} tono={r.sinRespaldo > 0 ? 'bad' : undefined} />
      </TiraCifras>
      {v.sinEvaluarGps > 0 && (
        <p className="rv-pj-nota">
          {tx('peajes.vista.lineas_no_tienen_evaluacion_gps', { sinEvaluarGps: numero(v.sinEvaluarGps) })}
        </p>
      )}
    </div>
  );
}

function MetaLinea({ linea, evidencia, tr = TR_ES }: { linea: LineaDesgloseVista; evidencia?: EvidenciaGpsLinea; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  const partes: React.ReactNode[] = [];
  if (linea.viajeFolio) partes.push(<span key="v">{tx('peajes.vista.viaje', { viajeFolio: linea.viajeFolio })}</span>);
  if (linea.diferencia !== null && linea.diferencia !== 0) {
    partes.push(<span key="d" className="rv-pj-tono" data-tono="warn">{tx('peajes.vista.dif', { diferencia: mxn(linea.diferencia, tr.idioma) })}</span>);
  }
  if (linea.motivo) partes.push(<span key="m">{MOTIVO_LEGIBLE(tx)[linea.motivo] ?? linea.motivo}</span>);
  if (evidencia) {
    partes.push(evidencia.estatus === 'con_evidencia'
      ? <span key="g" className="rv-pj-tono" data-tono="ok">{tx('peajes.vista.gps_posiciones_ese_dia', { posicionesDia: numero(evidencia.posicionesDia) })}</span>
      : <span key="g">{EVIDENCIA_LEGIBLE(tx)[evidencia.motivo]}</span>);
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
function EvidenciaGpsResumen({ resumen, tr = TR_ES }: { resumen: ResumenEvidenciaGps | null; tr?: TrAgentes; }) {
  const { t: tx } = tr;
  if (resumen === null) {
    return <p className="rv-pj-nota">{tx('peajes.vista.la_evidencia_gps_de_este')}</p>;
  }
  const m = resumen.porMotivo;
  const huecos: string[] = [];
  if (m.sin_viaje > 0) huecos.push(tx('peajes.vista.sin_viaje_ligado', { sin_viaje: numero(m.sin_viaje) }));
  if (m.viaje_sin_unidad > 0) huecos.push(tx('peajes.vista.con_viaje_sin_unidad', { viaje_sin_unidad: numero(m.viaje_sin_unidad) }));
  if (m.sin_posiciones_dia > 0) huecos.push(tx('peajes.vista.sin_posiciones_ese_dia', { sin_posiciones_dia: numero(m.sin_posiciones_dia) }));
  if (m.sin_fecha > 0) huecos.push(tx('peajes.vista.sin_fecha_legible', { sin_fecha: numero(m.sin_fecha) }));
  return (
    <div className="rv-pj-caja">
      <div className="rv-pj-caja__cab">
        <strong>{tx('peajes.vista.evidencia_gps_del_periodo')}</strong>
        <span className="cifra-mono rv-pj-der">
          {tx('peajes.vista.de_cruces_con_posiciones_de', { conEvidencia: numero(resumen.conEvidencia), total: numero(resumen.total) })}
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
          {tx('peajes.vista.sin_evidencia_sin_posiciones_casi', { v0: huecos.join(' · ') })}
        </p>
      )}
      <p className="rv-pj-nota">
        {tx('peajes.vista.esto_afirma_que_la_unidad')}
      </p>
    </div>
  );
}

/**
 * Una cubeta del desglose del proveedor: el conteo COMPLETO (viene del
 * agregado, no de las filas enseñadas) y hasta 12 líneas de muestra con su
 * porqué. Si hay más de las que caben, se dice cuántas.
 */
function CubetaDesglose({ titulo, total, nota, tono, lineas, evidencia, tr = TR_ES }: {
  titulo: string;
  total: number;
  nota: string;
  tono?: 'ok' | 'warn';
  lineas: LineaDesgloseVista[];
  /** id de línea → evidencia GPS, para el renglón chico de cada línea. */
  evidencia?: Record<string, EvidenciaGpsLinea>; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <div className="rv-pj-caja">
      <div className="rv-pj-caja__cab">
        <strong>{titulo}</strong>
        <span className="cifra-mono rv-pj-der rv-pj-caja__total" data-tono={tono}>{numero(total)}</span>
      </div>
      <p className="rv-pj-nota">{nota}</p>
      {lineas.length === 0 ? (
        <p className="rv-pj-nota">{tx('peajes.vista.ninguna_linea_en_esta_cubeta')}</p>
      ) : (
        <ul className="rv-pj-lista">
          {lineas.map((l) => (
            <li key={l.id} className="rv-pj-cubeta__linea">
              <div className="rv-pj-lista__fila">
                <span className="rv-pj-apagado rv-pj-fijo">{l.fecha ? fechaCorta(l.fecha, tr.idioma) : 'sin fecha'}</span>
                <span className="rv-pj-corto" title={l.caseta ?? undefined}>{l.caseta ?? tx('peajes.vista.sin_caseta')}</span>
                <span className="rv-pj-der rv-pj-fijo cifra-mono">{mxn(l.monto, tr.idioma)}</span>
              </div>
              <MetaLinea tr={tr} linea={l} evidencia={evidencia?.[l.id]} />
            </li>
          ))}
          {total > lineas.length && (
            <li className="rv-pj-nota">{tx('peajes.vista.y_mas_en_esta_cubeta', { v0: numero(total - lineas.length) })}</li>
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
