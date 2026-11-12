import { FileDown, ArrowLeft, ShieldAlert } from 'lucide-react';
import { mxn, numero } from '@/lib/formato';

// El módulo `reclamacion` es puro (sin base): el bundle de la vista puede importarlo.
import { ETIQUETA_MOTIVO_RECLAMACION, type ReporteReclamacion, type MotivoReclamacion } from '@/lib/likida/peajes/reclamacion';
import { TEXTO_SIN_POSICIONES } from '@/lib/likida/peajes/reclamacion_perfil';
import { textoEvidencia } from '@/lib/likida/peajes/reclamacion_archivos';
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual, CierreDosMeses } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { SeccionRevisionCobros, SeccionCierreMensual, SeccionSeguimiento, type AccionesSeguimiento, type PropuestaNota } from './revision';
import { TablaCandidatosCobros, type AccionDecidir } from '../candidatos-tabla';
import type { TablaCandidatos, AccionCandidato } from '@/lib/likida/peajes/candidatos_tabla';
import {
  AvisoCompacto, Boton, BotonEnlace, CampoTexto, Icono, StatusChip, TablaBase, Tarjeta,
} from '@/app/ui-v2/componentes';
import '../peajes.css';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

export type EstadoReclamacion = 'sin_desglose' | 'no_existe' | 'error' | 'ok';

/** Lo que la pantalla suma a la reclamación con GPS: la revisión de cobros del archivo, el cierre mensual y el seguimiento. Todo opcional. */
export interface ExtrasReclamacion {
  revision: ReporteRevision | null;
  /** La tabla de candidatos con sus acciones (T-A2-28). */
  candidatos?: { tabla: TablaCandidatos | null; error: boolean; decidir?: AccionDecidir; aplicables?: Record<AccionCandidato, number> };
  /** El reporte con GPS no se pudo leer (la revisión de cobros sí). */
  errorGps?: boolean;
  mes: string | null;
  cierre: CierreMensual | null;
  /** Los meses que ofrece el selector (del más reciente al más viejo). */
  mesesOpciones?: string[];
  /** Vista de dos meses juntos (`?meses=2`) y su resultado. */
  dosMeses?: boolean;
  cierreDos?: CierreDosMeses | null;
  errorCierre?: boolean;
  seguimiento: { reclamos: ReclamoVista[]; resumen: ResumenSeguimiento } | null;
  errorSeguimiento?: boolean;
  /** La propuesta de a qué reclamo corresponde la nota de crédito que se tecleó (`?nota=`). */
  propuestaNota?: PropuestaNota | null;
  acciones: AccionesSeguimiento;
  aviso?: string | null;
  error?: string | null;
}

/**
 * Perfil `cinco_agentes` (T-A2-24): el reporte enseña solo los motivos visibles, todo como «candidato», sin descargas (la ruta de
 * export es stand-by) y con el margen de distancia de la flota. Ausente = flota sin perfil: todo como siempre.
 */
export interface CandidatoReclamacion {
  motivos: readonly MotivoReclamacion[];
  margenLejosM: number;
  /** Fija el margen de la flota (acción de servidor con su propia puerta). Sin ella no se pinta el formulario. */
  guardarMargen?: (fd: FormData) => void | Promise<void>;
}

export function VistaReclamacionPeajes({ sufijo, desglose, estado, reporte, extras, candidato, tr = TR_ES }: {
  sufijo: string; desglose: string | null; estado: EstadoReclamacion; reporte: ReporteReclamacion | null; extras?: ExtrasReclamacion; candidato?: CandidatoReclamacion; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  const motivosVisibles = (Object.keys(ETIQUETA_MOTIVO_RECLAMACION) as MotivoReclamacion[]).filter((m) => !candidato || candidato.motivos.includes(m));
  // Sin nada evaluado (ni una línea confirmada ni un cruce) no hay con qué comparar: no se pinta como «todo bien».
  const faltanDatos = !!candidato && !!reporte && reporte.resumen.reclamables === 0 && reporte.resumen.confirmadas === 0;
  return (
    <EsqueletoTablaMaestra
      titulo={tx('rest.reporte_de_reclamacion_de_peajes')}
      apoyo={tx('rest.los_cruces_candidatos_a_reclamo_de')}
      acciones={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/peajes${sufijo}`} icono={<Icono icono={ArrowLeft} />}>{tx('rest.volver_al_agente')}</BotonEnlace>}
      avisos={(
        <>
          {estado === 'no_existe' && <AvisoCompacto tono="error" resumen={tx('rest.ese_desglose_no_existe_en_tu')} />}
          {estado === 'error' && <AvisoCompacto tono="error" resumen={tx('rest.no_se_pudo_armar_el_reporte')} />}
          {extras?.aviso && <AvisoCompacto tono="ok" resumen={extras.aviso} />}
          {extras?.error && <AvisoCompacto tono="error" resumen={extras.error} />}
          {estado === 'ok' && !reporte && extras?.errorGps && (
            <AvisoCompacto tono="error" resumen={tx('rest.el_reporte_con_evidencia_de_gps')} />
          )}
        </>
      )}
      // Tira de cifras solo con reporte armado (nunca ceros sin lectura): los mismos números que el encabezado del reporte, a la vista primero.
      cifras={estado === 'ok' && reporte ? [
        { etiqueta: tx('f26d.reclamacion.cruces'), valor: numero(reporte.resumen.reclamables), tono: reporte.resumen.reclamables > 0 ? 'warn' : undefined },
        { etiqueta: tx('f26d.reclamacion.monto'), valor: mxn(reporte.resumen.montoReclamable) },
        { etiqueta: tx('f26d.reclamacion.confirmadas'), valor: numero(reporte.resumen.confirmadas) },
        { etiqueta: tx('f26d.reclamacion.sin_datos'), valor: numero(reporte.resumen.sinDatos) },
      ] : estado === 'sin_desglose' ? [
        // Sin desglose no hay lectura: la tira va con guiones (nunca ceros) para que la página tenga la misma forma que con datos.
        { etiqueta: tx('f26d.reclamacion.cruces'), valor: '—' },
        { etiqueta: tx('f26d.reclamacion.monto'), valor: '—' },
        { etiqueta: tx('f26d.reclamacion.confirmadas'), valor: '—' },
        { etiqueta: tx('f26d.reclamacion.sin_datos'), valor: '—' },
      ] : undefined}
      selloCifras={estado === 'sin_desglose' ? tx('f26d3.reclamacion.sin_desglose_sello') : undefined}
      etiquetaCifras={tx('rest.reporte_de_reclamacion_de_peajes')}
    >
      <PasosReclamacion tx={tx} estado={estado} />

      {estado === 'sin_desglose' && (
        <Tarjeta
          titulo={tx('f26d3.reclamacion.tarjeta_reporte')} estado="vacio" iconoVacio={ShieldAlert}
          mensaje={tx('rest.elige_un_desglose')} detalle={tx('rest.elige_un_desglose_en_el_agente')}
          accionVacio={<BotonEnlace tamano="sm" variante="secondary" href={`/dashboard/agentes/peajes${sufijo}`}>{tx('f26d3.reclamacion.ir_al_agente')}</BotonEnlace>}
        />
      )}

      {estado === 'ok' && extras?.revision && desglose && (
        <SeccionRevisionCobros tr={tr} revision={extras.revision} desglose={desglose} sufijo={sufijo} justificarCruce={extras.acciones.justificarCruce} />
      )}
      {estado === 'ok' && extras?.candidatos && desglose && (
        <TablaCandidatosCobros tr={tr} tabla={extras.candidatos.tabla} error={extras.candidatos.error} desglose={desglose} sufijo={sufijo}
          decidir={extras.candidatos.decidir} aplicables={extras.candidatos.aplicables} />
      )}
      {extras && (estado === 'ok' || estado === 'sin_desglose') && (
        <>
          <SeccionCierreMensual tr={tr} mes={extras.mes} cierre={extras.cierre} error={extras.errorCierre === true} sufijo={sufijo} desglose={desglose}
            opciones={extras.mesesOpciones} dosMeses={extras.dosMeses === true} cierreDos={extras.cierreDos ?? null} />
          <SeccionSeguimiento tr={tr}
            reclamos={extras.seguimiento?.reclamos ?? null} resumen={extras.seguimiento?.resumen ?? null} acciones={extras.acciones}
            desglose={estado === 'ok' ? desglose : null} revision={extras.revision} error={extras.errorSeguimiento === true}
            propuestaNota={extras.propuestaNota ?? null} sufijo={sufijo} mes={extras.mes} />
        </>
      )}
      {estado === 'ok' && reporte && desglose && (
        <>
          <Tarjeta
            titulo={candidato
              ? (reporte.resumen.reclamables === 0 ? tx('rest.sin_cruces_candidatos') : tx(reporte.resumen.reclamables === 1 ? 'rest.n_cruce_candidato_para_pedir_revision.uno' : 'rest.n_cruce_candidato_para_pedir_revision.otros', { n: numero(reporte.resumen.reclamables) }))
              : (reporte.resumen.reclamables === 0 ? tx('rest.sin_cruces_para_reclamar') : tx(reporte.resumen.reclamables === 1 ? 'rest.n_cruce_para_pedir_revision.uno' : 'rest.n_cruce_para_pedir_revision.otros', { n: numero(reporte.resumen.reclamables) }))}
            info="peajes_reclamacion.cruces"
            acciones={(
              <span className="rv-pj-total">{ricoT(tx('rest.e0_monto_reclamable_e0'), { e0: (c) => <span className="rv-pj-rotulo">{c}</span> })}<strong className="rv-ag-num rv-pj-total__valor">{mxn(reporte.resumen.montoReclamable)}</strong>
              </span>
            )}
          >
            <p className="rv-pj-sub">
              {reporte.proveedor ? `Proveedor ${reporte.proveedor} · ` : ''}
              {reporte.periodoDesde && reporte.periodoHasta ? `Periodo ${reporte.periodoDesde} a ${reporte.periodoHasta} · ` : ''}{tx('rest.lineas_en_el_desglose', { numero: numero(reporte.resumen.lineas) })}</p>
            {!candidato && <div className="rv-pj-acciones">
              <BotonEnlace variante="primary" href={`/api/export/peajes-reclamacion?desglose=${desglose}&formato=xlsx${ctx}`} icono={<Icono icono={FileDown} />}>
                Excel
              </BotonEnlace>
              <BotonEnlace href={`/api/export/peajes-reclamacion?desglose=${desglose}&formato=pdf${ctx}`} icono={<Icono icono={FileDown} />}>
                PDF
              </BotonEnlace>
            </div>}
            {faltanDatos && <AvisoCompacto tono="info" resumen={TEXTO_SIN_POSICIONES} />}
            {candidato?.guardarMargen && (
              <form action={candidato.guardarMargen} className="rv-pj-forma">
                <input type="hidden" name="desglose" value={desglose} />
                <CampoTexto tipo="number" etiqueta={tx('rest.margen_de_distancia_a_la_caseta')} name="margen" inputMode="numeric" min={100} max={5000} step={1} defaultValue={candidato.margenLejosM} />
                <Boton type="submit">{tx('rest.guardar_margen')}</Boton>{ricoT(tx('rest.e0_un_cruce_se_marca_como'), { e0: (c) => <span className="rv-pj-sub">{c}</span> })}</form>
            )}
            <div className="rv-pj-categorias">
              {motivosVisibles.map((m) => (
                <div key={m} className="rv-pj-caja">
                  <span className="rv-pj-rotulo">{ETIQUETA_MOTIVO_RECLAMACION[m]}</span>
                  <span><strong className="rv-pj-caja__monto rv-ag-num">{numero(reporte.resumen.porMotivo[m].n)}</strong> <span className="rv-pj-nota">{mxn(reporte.resumen.porMotivo[m].monto)}</span></span>
                </div>
              ))}
            </div>
            <p className="rv-pj-nota">{tx('rest.no_se_reclaman_sin_evidencia_en', { numero: numero(reporte.resumen.confirmadas), numero2: numero(reporte.resumen.sinDatos) })}{reporte.resumen.sinEvaluar > 0 ? tx('rest.sin_evaluar_vuelve_a_conciliar_el', { numero: numero(reporte.resumen.sinEvaluar) }) : ''}{tx('rest.sin_datos_no_es_evidencia_en')}{!candidato && reporte.resumen.sinCurso > 0 ? tx('rest.de_lineas_no_tienen_curso_declarado', { numero: numero(reporte.resumen.sinCurso), numero2: numero(reporte.resumen.lineas) }) : ''}
            </p>
          </Tarjeta>

          {reporte.cruces.length > 0 && (
            <Tarjeta titulo={tx('rest.cruces_de_caseta_en_reclamacion')} info="peajes_reclamacion.cruces">
              <TablaBase<ReporteReclamacion['cruces'][number]>
                etiqueta={tx('rest.cruces_de_caseta_en_reclamacion')}
                filas={reporte.cruces}
                idFila={(c) => String(c.indice)}
                altoMaximo={false}
                columnas={[
                  { id: 'fecha', titulo: tx('rest.fecha_y_hora'), principal: true, celda: (c) => <>{c.fecha}{c.hora && <span className="rv-pj-nota">{c.hora.slice(0, 8)}</span>}</> },
                  { id: 'caseta', titulo: tx('rest.caseta'), celda: (c) => c.casetaCatalogo || c.caseta || '—' },
                  { id: 'tag', titulo: tx('rest.tag_unidad'), celda: (c) => <>{c.tag || '—'}{c.unidad && <span className="rv-pj-nota">{c.unidad}</span>}</> },
                  { id: 'monto', titulo: tx('rest.monto'), alinear: 'der', celda: (c) => <span className="rv-ag-num">{mxn(c.monto)}</span> },
                  {
                    id: 'porque', titulo: candidato ? tx('rest.por_que_es_candidato') : tx('rest.por_que_se_reclama'),
                    celda: (c) => (
                      <div className="rv-pj-que rv-pj-que--ancho">
                        <StatusChip tono={c.confianza === 'alta' ? 'bad' : 'warn'}>
                          {ETIQUETA_MOTIVO_RECLAMACION[c.motivo]} · {candidato ? 'candidato' : c.confianza}
                        </StatusChip>
                        <span>{c.porQue}</span>
                        {c.evidencia.length > 0 && (
                          <ul className="rv-pj-notas">
                            {c.evidencia.map((e) => <li key={e.en}>{textoEvidencia(e)}</li>)}
                          </ul>
                        )}
                      </div>
                    ),
                  },
                ]}
              />
            </Tarjeta>
          )}

          <Tarjeta titulo={tx('rest.que_significa_y_que_no_afirma')} info="peajes_reclamacion.leyendas">
            <ul className="rv-pj-notas">
              {reporte.leyendas.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </Tarjeta>
        </>
      )}
      <span className="rv-ag-sin-filete-marca" hidden aria-hidden="true" />
    </EsqueletoTablaMaestra>
  );
}

/** Los cuatro pasos de la reclamación como tarjetas de paso (Rovaq FL): el actual lleva borde de tinta. El estado sale solo de si hay un desglose
 *  elegido; no se cuenta nada que el sistema no haya medido. */
function PasosReclamacion({ tx, estado }: { tx: TrAgentes['t']; estado: EstadoReclamacion }) {
  const hayDesglose = estado === 'ok';
  const pasos = [
    { id: 1, estado: hayDesglose ? 'hecho' : 'actual' },
    { id: 2, estado: hayDesglose ? 'actual' : 'siguiente' },
    { id: 3, estado: 'siguiente' },
    { id: 4, estado: 'siguiente' },
  ] as const;
  const tono = { hecho: 'ok', actual: 'neutral', siguiente: 'neutral' } as const;
  return (
    <ol className="rv-pj-pasos" aria-label={tx('f26d3.reclamacion.pasos_etiqueta')}>
      {pasos.map((p) => (
        <li key={p.id} className="rv-pj-paso" data-actual={p.estado === 'actual' || undefined} aria-current={p.estado === 'actual' ? 'step' : undefined}>
          <div className="rv-pj-paso__cab">
            <span className="rv-pj-paso__n" aria-hidden="true">{p.id}</span>
            <StatusChip tono={tono[p.estado]}>{tx(`f26d3.reclamacion.estado_${p.estado}`)}</StatusChip>
          </div>
          {/* sin-info: nombre del paso en una tarjeta de progreso, no un recuadro de cifras */}
          <h3 className="rv-pj-paso__titulo">{tx(`f26d3.reclamacion.paso_${p.id}`)}</h3>
          <p className="rv-pj-paso__ayuda">{tx(`f26d3.reclamacion.paso_${p.id}_ayuda`)}</p>
        </li>
      ))}
    </ol>
  );
}
