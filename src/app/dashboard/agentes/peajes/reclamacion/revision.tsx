import { FileDown } from 'lucide-react';
import {
  Boton, BotonEnlace, BarraFiltros, CampoFecha, CampoTexto, FiltroCampo, FiltroOpciones, Icono, StatusChip, TablaBase, Tarjeta, type TonoEstado,
} from '@/app/ui-v2/componentes';
import '../peajes.css';
import { mxn, numero } from '@/lib/formato';
// SOLO tipos y módulos puros: la vista no debe arrastrar `supabaseAdmin` al bundle.
import type { ReporteRevision, ReclamoVista } from '@/lib/likida/peajes/revision_cobros';
import type { CierreMensual, CierreDosMeses } from '@/lib/likida/peajes/cierre_mensual';
import type { ResumenSeguimiento } from '@/lib/likida/peajes/reclamos_seguimiento';
import { ETIQUETA_ESTADO_RECLAMO, PLAZO_RECLAMO_MESES } from '@/lib/likida/peajes/reclamos_seguimiento';
import type { ResultadoCasado } from '@/lib/likida/peajes/notas_credito';
import { rotuloOrigenPeriodo } from '@/lib/likida/peajes/periodo';
import {
  CATEGORIAS_COBRO, ETIQUETA_CATEGORIA_COBRO, ROTULO_CANDIDATO, type CategoriaCobro, type CandidatoCobro,
} from '@/lib/likida/peajes/reglas_cobro';
import { ETIQUETA_SENAL } from '@/lib/likida/peajes/cruces_atipicos';
import { ETIQUETA_DOBLE_ENTRE_ARCHIVOS } from '@/lib/likida/peajes/doble_entre_archivos';
import { FormaRegistrarReclamo } from './forma-registrar-reclamo';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// LA REVISIÓN DE COBROS EN PANTALLA — lo que finanzas hace primero con el archivo
// del proveedor: ¿cada cobro es correcto?, ¿qué llegó tarde?, ¿qué no debía cruzarse?
//
// TODO lo que sale aquí es un CANDIDATO PARA VALIDAR CON EL PROVEEDOR: sin tarifario
// por caseta/clase ninguna regla puede afirmar que un monto esté mal. Cada candidato
// se explica en lenguaje llano: qué pasó / qué significa / qué hacer.
// ═══════════════════════════════════════════════════════════════════════════

type Accion = (fd: FormData) => Promise<void>;

export interface AccionesSeguimiento {
  crearReclamo: Accion; marcarEnviado: Accion; registrarNota: Accion; rechazar: Accion;
  /** «Justificar este cruce» (opcional: sin ella no se pinta el botón). */
  justificarCruce?: Accion;
}

/** Candidatos que se pintan por categoría; el resto va en el Excel (que trae TODOS). */
export const MAX_FILAS_POR_CATEGORIA = 100;

/** Qué significa la categoría, en general (cada candidato trae además su explicación). */
const explicacionCategoria = (tx: TAgentes = TR_ES.t): Record<CategoriaCobro, string> => ({
  unidad_inmovilizada: tx('rest.cruces_con_el_tag_de_una'),
  clase_fuera_de_3_5: tx('rest.lo_esperado_es_clase_3_tracto'),
  extemporaneo: tx('rest.el_cruce_es_anterior_al_periodo'),
  duplicado_exacto: tx('rest.mismo_tag_mismo_segundo_misma_caseta'),
  tag_dado_de_baja: tx('rest.cruces_posteriores_a_la_fecha_de'),
  caseta_no_debe_cruzarse: tx('rest.casetas_que_la_flota_marco_como'),
});

function FilasCandidatos({ candidatos, justificar, desglose, tr = TR_ES }: { candidatos: CandidatoCobro[]; justificar?: Accion; desglose?: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const visibles = candidatos.slice(0, MAX_FILAS_POR_CATEGORIA);
  return (
    <>
      <TablaBase<CandidatoCobro>
        etiqueta={tx('rest.cruces_de_caseta_en_revision')}
        filas={visibles}
        idFila={(c) => `${c.indice}-${c.categoria}`}
        altoMaximo={false}
        columnas={[
          { id: 'fecha', titulo: tx('rest.fecha_y_hora'), principal: true, celda: (c) => <>{c.fecha ?? '—'}{c.hora && <span className="rv-pj-nota">{c.hora}</span>}</> },
          { id: 'caseta', titulo: tx('rest.caseta'), celda: (c) => c.caseta ?? '—' },
          { id: 'tag', titulo: tx('rest.tag_unidad'), celda: (c) => <>{c.tag ?? '—'}{c.unidad && <span className="rv-pj-nota">{c.unidad}</span>}</> },
          { id: 'clase', titulo: tx('rest.clase'), alinear: 'der', celda: (c) => <span className="rv-ag-num">{c.clase ?? '—'}</span> },
          { id: 'importe', titulo: tx('rest.importe'), alinear: 'der', celda: (c) => <span className="rv-ag-num">{mxn(c.monto)}</span> },
          {
            id: 'quepaso', titulo: tx('rest.que_paso_que_significa_que_hacer'),
            celda: (c) => (
              <div className="rv-pj-que rv-pj-que--ancho">
                <StatusChip tono="warn">{ROTULO_CANDIDATO}</StatusChip>
                <p className="rv-pj-texto">{ricoT(tx('rest.b_que_paso_b'), { b: (c) => <b>{c}</b> })}{' '}{c.quePaso}</p>
                <p className="rv-pj-sub">{ricoT(tx('rest.b_que_significa_b'), { b: (c) => <b>{c}</b> })}{' '}{c.queSignifica}</p>
                <p className="rv-pj-sub">{ricoT(tx('rest.b_que_hacer_b'), { b: (c) => <b>{c}</b> })}{' '}{c.queHacer}</p>
                {c.categoria === 'caseta_no_debe_cruzarse' && c.justificacion && (
                  <p className="rv-pj-texto"><StatusChip tono="muted">{tx('rest.justificado')}</StatusChip>{' '}{ricoT(tx('rest.b_motivo_b'), { b: (c) => <b>{c}</b> })}{' '}{c.justificacion}</p>
                )}
                {c.categoria === 'caseta_no_debe_cruzarse' && !c.justificacion && justificar && desglose && (
                  <form action={justificar} className="rv-pj-forma">
                    <input type="hidden" name="desglose" value={desglose} />
                    <input type="hidden" name="indice" value={c.indice} />
                    <CampoTexto etiqueta={tx('rest.motivo')} name="motivo" required minLength={3} maxLength={300} placeholder={tx('rest.salida_de_servicio_autorizada')}
                      aria-label={tx('rest.motivo_para_justificar_el_cruce_del', { v: c.indice + 1 })} />
                    <Boton type="submit">{tx('rest.justificar_este_cruce')}</Boton>
                  </form>
                )}
              </div>
            ),
          },
        ]}
      />
      {candidatos.length > visibles.length && (
        <p className="rv-pj-sub">{tx('rest.se_muestran_los_primeros_de_el', { numero: numero(visibles.length), numero2: numero(candidatos.length) })}</p>
      )}
    </>
  );
}

export function SeccionRevisionCobros({ revision, desglose, sufijo, justificarCruce, tr = TR_ES }: { revision: ReporteRevision; desglose: string; sufijo: string; justificarCruce?: Accion; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  const r = revision.revision;
  const cal = revision.calidad as {
    sinEncabezadoConDatos?: string[]; noReconocidas?: string[]; columnasFaltantes?: string[];
    lineasSinTag?: number; lineasSinUnidad?: number; lineasSinClase?: number; hojasIgnoradas?: string[]; hojaLeida?: string | null;
  } | null;
  const avisosCalidad: string[] = [];
  if (cal) {
    if ((cal.sinEncabezadoConDatos?.length ?? 0) > 0) avisosCalidad.push(tx('rest.columnas_sin_encabezado_con_datos_no', { length: cal.sinEncabezadoConDatos?.length ?? 0, cal: cal.sinEncabezadoConDatos?.join(', ') ?? '' }));
    if ((cal.columnasFaltantes?.length ?? 0) > 0) avisosCalidad.push(tx('rest.el_archivo_no_trae_columna_de', { cal: cal.columnasFaltantes?.join(', ') ?? '' }));
    if ((cal.lineasSinTag ?? 0) > 0) avisosCalidad.push(tx('rest.lineas_sin_tag', { numero: numero(cal.lineasSinTag ?? 0) }));
    if ((cal.lineasSinUnidad ?? 0) > 0) avisosCalidad.push(tx('rest.lineas_sin_unidad', { numero: numero(cal.lineasSinUnidad ?? 0) }));
    if ((cal.lineasSinClase ?? 0) > 0) avisosCalidad.push(tx('rest.lineas_sin_clase_legible_no_se', { numero: numero(cal.lineasSinClase ?? 0) }));
    if ((cal.hojasIgnoradas?.length ?? 0) > 0) avisosCalidad.push(tx('rest.se_leyo_solo_la_hoja_repite', { hojaLeida: cal.hojaLeida ?? '', cal: cal.hojasIgnoradas?.join('», «') ?? '' }));
  }
  return (
    <div id="revision-cobros">
    <Tarjeta
      titulo={tx('rest.revision_de_cobros_del_archivo')}
      acciones={(
        <span className="rv-pj-total">{ricoT(tx('rest.e0_cruces_con_algun_candidato_e0'), { e0: (c) => <span className="rv-pj-rotulo">{c}</span> })}<strong className="rv-ag-num rv-pj-total__valor">{numero(r.lineasConCandidato)}</strong>
          <span className="rv-pj-nota">{mxn(r.montoConCandidato)}</span>
        </span>
      )}
    >
      <p className="rv-pj-sub">
        {revision.archivoNombre ? `${revision.archivoNombre} · ` : ''}
        {revision.periodoOficialDesde && revision.periodoOficialHasta
          ? `Periodo ${revision.periodoOficialDesde} a ${revision.periodoOficialHasta} (${rotuloOrigenPeriodo(revision.periodoOrigen)}) · `
          : tx('rest.periodo_del_archivo_no_declarado')}{tx('rest.cruces', { numero: numero(r.lineasRevisadas), mxn: mxn(r.montoRevisado) })}</p>
      <div><StatusChip tono="warn">{ROTULO_CANDIDATO}</StatusChip></div>
      <div className="rv-pj-acciones">
        <BotonEnlace variante="primary" href={`/api/export/peajes-revision?desglose=${desglose}${ctx}`} icono={<Icono icono={FileDown} />}>{tx('rest.excel_de_la_revision')}</BotonEnlace>
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}${ctx}`} icono={<Icono icono={FileDown} />}>{tx('rest.reporte_para_el_portal_del_proveedor')}</BotonEnlace>
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}&excluirReclamados=1${ctx}`}>{tx('rest.sin_lo_que_ya_reclamaste')}</BotonEnlace>
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}&formato=csv${ctx}`}>
          CSV
        </BotonEnlace>
      </div>

      <p className="rv-pj-nota">{tx('rest.son_candidatos_no_cobros_indebidos_sin', { plazoReclamoMeses: PLAZO_RECLAMO_MESES })}</p>

      <div className="rv-pj-categorias">
        {CATEGORIAS_COBRO.map((c) => (
          <a key={c} href={`#cat-${c}`} className="rv-pj-caja rv-pj-caja--enlace">
            <span className="rv-pj-rotulo">{ETIQUETA_CATEGORIA_COBRO[c]}</span>
            <span className="rv-pj-caja__monto rv-ag-num">{numero(r.porCategoria[c].n)}</span>
            <span className="rv-pj-nota">{mxn(r.porCategoria[c].monto)}</span>
          </a>
        ))}
      </div>

      {r.reglasNoAplicadas.length > 0 && (
        <div role="note" className="rv-pj-caja">{ricoT(tx('rest.b_reglas_que_no_se_pudieron'), { b: (c) => <b>{c}</b> })}<ul className="rv-pj-notas">
            {r.reglasNoAplicadas.map((n) => <li key={n.regla}>{ETIQUETA_CATEGORIA_COBRO[n.regla]}: {n.motivo}</li>)}
          </ul>
        </div>
      )}
      {avisosCalidad.length > 0 && (
        <div role="note" className="rv-pj-caja">{ricoT(tx('rest.b_calidad_del_archivo_b'), { b: (c) => <b>{c}</b> })}<ul className="rv-pj-notas">{avisosCalidad.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
      )}
      {r.sugerenciasPasada.length > 0 && (
        <div role="note" className="rv-pj-caja rv-pj-sub">{ricoT(tx('rest.b_tarifa_por_pasada_b_en', { r: r.sugerenciasPasada.map((s) => `${s.caseta} (${numero(s.cruces)})`).join(', ') }), { b: (c) => <b>{c}</b> })}</div>
      )}

      {CATEGORIAS_COBRO.map((c) => {
        const lista = r.candidatos.filter((x) => x.categoria === c);
        if (lista.length === 0) return null;
        return (
          <details key={c} id={`cat-${c}`} className="rv-pj-det" open={lista.length <= 10}>
            <summary className="rv-pj-det__cab">
              {ETIQUETA_CATEGORIA_COBRO[c]} · {numero(lista.length)} · {mxn(r.porCategoria[c].monto)}
            </summary>
            <p className="rv-pj-sub">{explicacionCategoria(tx)[c]}</p>
            <FilasCandidatos tr={tr} candidatos={lista} justificar={justificarCruce} desglose={desglose} />
          </details>
        );
      })}

      {revision.dobleEntreArchivos && revision.dobleEntreArchivos.candidatos.length > 0 && (
        <details className="rv-pj-det" id="doble-entre-archivos" open={revision.dobleEntreArchivos.candidatos.length <= 10}>
          <summary className="rv-pj-det__cab">
            {ETIQUETA_DOBLE_ENTRE_ARCHIVOS} · {numero(revision.dobleEntreArchivos.candidatos.length)} · {mxn(revision.dobleEntreArchivos.montoCandidatos)}
          </summary>
          <p className="rv-pj-sub">{tx('rest.el_proveedor_cobro_tarde_un_cruce', { ventanaMeses: revision.dobleEntreArchivos.ventanaMeses })}</p>
          <ul className="rv-pj-lista">
            {revision.dobleEntreArchivos.candidatos.slice(0, MAX_FILAS_POR_CATEGORIA).map((c) => (
              <li key={`${c.indice}-${c.archivoPrevioId}`} className="rv-pj-caja">
                <StatusChip tono="warn">{mxn(c.monto)} · {ROTULO_CANDIDATO}</StatusChip>
                <p className="rv-pj-texto">{ricoT(tx('rest.b_que_paso_b'), { b: (c) => <b>{c}</b> })}{' '}{c.quePaso}</p>
                <p className="rv-pj-sub">{ricoT(tx('rest.b_que_hacer_b'), { b: (c) => <b>{c}</b> })}{' '}{c.queHacer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      {revision.atipicos.atipicos.length > 0 && (
        <details className="rv-pj-det" id="atipicos">
          <summary className="rv-pj-det__cab">{tx('rest.cruces_atipicos_2')}{' '}{numero(revision.atipicos.atipicos.length)}</summary>
          <p className="rv-pj-sub">{tx('rest.patrones_poco_comunes_de_una_misma')}</p>
          <ul className="rv-pj-lista">
            {revision.atipicos.atipicos.slice(0, MAX_FILAS_POR_CATEGORIA).map((a) => (
              <li key={`${a.senal}-${a.indices.join('-')}`} className="rv-pj-caja">
                <StatusChip tono="warn">{ETIQUETA_SENAL[a.senal]} · {ROTULO_CANDIDATO}</StatusChip>
                <p className="rv-pj-texto">{ricoT(tx('rest.b_que_paso_b'), { b: (c) => <b>{c}</b> })}{' '}{a.quePaso}</p>
                <p className="rv-pj-sub">{ricoT(tx('rest.b_que_significa_b'), { b: (c) => <b>{c}</b> })}{' '}{a.queSignifica}</p>
                <p className="rv-pj-sub">{ricoT(tx('rest.b_que_hacer_b'), { b: (c) => <b>{c}</b> })}{' '}{a.queHacer}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {revision.atipicos.noAplicadas.length > 0 && (
        <p className="rv-pj-nota">{tx('rest.senales_de_cruces_atipicos_sin_aplicar', { revision: revision.atipicos.noAplicadas.map((n) => `${ETIQUETA_SENAL[n.senal]} (${n.motivo})`).join(' · ') })}</p>
      )}
    </Tarjeta>
    </div>
  );
}

// ── El cierre mensual ───────────────────────────────────────────────────────

export function SeccionCierreMensual({ mes, cierre, error, sufijo, desglose, opciones = [], dosMeses = false, cierreDos = null, tr = TR_ES }: {
  mes: string | null; cierre: CierreMensual | null; error: boolean; sufijo: string; desglose: string | null;
  /** Los meses que ofrece el selector (del más reciente al más viejo). Vacío = campo de texto AAAA-MM. */
  opciones?: string[];
  /** Vista de DOS meses juntos (el pedido y el anterior). */
  dosMeses?: boolean;
  cierreDos?: CierreDosMeses | null; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const lista = mes && opciones.length > 0 && !opciones.includes(mes) ? [mes, ...opciones] : opciones;
  return (
    <div id="cierre-mensual">
    <Tarjeta titulo={tx('rest.cierre_mensual')}>
      <p className="rv-pj-sub">{tx('rest.junta_las_tres_decenas_de_un')}</p>
      <BarraFiltros accion="?" etiqueta={tx('rest.periodo_del_cierre_mensual')} ocultos={[...new URLSearchParams(sufijo.replace(/^\?/, '')).entries(), ...(desglose ? [['desglose', desglose] as const] : [])]}>
        {lista.length > 0 ? (
          <FiltroOpciones nombre="mes" etiqueta="Mes" valor={mes ?? lista[0]} porDefecto="" opciones={lista.map((m) => ({ valor: m, rotulo: m }))} />
        ) : (
          <FiltroCampo etiqueta="Mes"><input className="border-0 bg-transparent" name="mes" defaultValue={mes ?? ''} placeholder="2026-09" pattern="\d{4}-(0[1-9]|1[0-2])" required data-anillo="envolvente" /></FiltroCampo>
        )}
        <FiltroOpciones nombre="meses" etiqueta={tx('rest.ventana')} valor={dosMeses ? '2' : '1'} porDefecto="1"
          opciones={[{ valor: '1', rotulo: tx('rest.un_mes') }, { valor: '2', rotulo: tx('rest.dos_meses_juntos') }]} />
      </BarraFiltros>
      {error && <p role="alert" className="rv-pj-sub rv-pj-malo">{tx('rest.no_se_pudo_armar_el_cierre')}</p>}
      {dosMeses && cierreDos && <CierreDosMesesVista tr={tr} c={cierreDos} />}
      {!dosMeses && cierre && (
        <div className="rv-pj-bloque">
          <div className="rv-pj-cab">
            <div>
              <strong>{cierre.mes}</strong>{' '}
              <StatusChip tono={cierre.completo ? 'ok' : 'warn'}>{cierre.completo ? tx('rest.mes_completo') : tx('rest.mes_incompleto')}</StatusChip>
            </div>
            <div className="rv-pj-der">
              <strong className="rv-ag-num rv-pj-caja__monto">{numero(cierre.cruces)}</strong>{' '}{tx('rest.cruces_2')}{' '}<span className="rv-ag-num">{mxn(cierre.monto)}</span>
            </div>
          </div>
          <div className="rv-pj-decenas">
            {cierre.decenas.map((d) => <TarjetaDecena tr={tr} key={d.etiqueta} d={d} />)}
          </div>
          <p className="rv-pj-texto">{tx('rest.cobros_tardios_candidatos_validar_con_el', { numero: numero(cierre.tardiosMesAnterior.n), mxn: mxn(cierre.tardiosMesAnterior.monto), numero2: numero(cierre.tardiosDecenaAnterior.n), mxn2: mxn(cierre.tardiosDecenaAnterior.monto) })}{cierre.repetidosEntreArchivos.length > 0 && <>{ricoT(tx('rest.b_cobros_aparecen_en_mas_de', { numero: numero(cierre.repetidosEntreArchivos.length) }), { b: (c) => <b>{c}</b> })}</>}
          </p>
          {cierre.avisos.length > 0 && (
            <ul className="rv-pj-notas">{cierre.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
          )}
        </div>
      )}
    </Tarjeta>
    </div>
  );
}

function TarjetaDecena({ d, tr = TR_ES }: { d: CierreMensual['decenas'][number]; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <div className="rv-pj-caja">{ricoT(tx('rest.e0_decena_e0', { etiqueta: d.etiqueta }), { e0: (c) => <span className="rv-pj-rotulo">{c}</span> })}{d.cubierta
        ? <span><strong className="rv-pj-caja__monto rv-ag-num">{numero(d.cruces)}</strong> <span className="rv-pj-nota">{mxn(d.monto)}</span></span>
        : <span className="rv-pj-sub rv-pj-malo">{tx('rest.falta_el_archivo_2')}</span>}
    </div>
  );
}

function CierreDosMesesVista({ c, tr = TR_ES }: { c: CierreDosMeses; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <div className="rv-pj-bloque" id="cierre-dos-meses">
      <div className="rv-pj-cab">
        <div>
          <strong>{c.meses[0]} + {c.meses[1]}</strong>{' '}
          <StatusChip tono={c.completo ? 'ok' : 'warn'}>{c.completo ? tx('rest.dos_meses_completos') : tx('rest.ventana_incompleta')}</StatusChip>
        </div>
        <div className="rv-pj-der">
          <strong className="rv-ag-num rv-pj-caja__monto">{numero(c.cruces)}</strong>{' '}{tx('rest.cruces_2')}{' '}<span className="rv-ag-num">{mxn(c.monto)}</span>
        </div>
      </div>
      <div className="rv-pj-decenas">
        {c.decenas.map((d) => <TarjetaDecena tr={tr} key={d.etiqueta} d={d} />)}
      </div>
      <p className="rv-pj-texto">{tx('rest.cobros_tardios_que_caen_dentro_de', { numero: numero(c.acomodados.n), mxn: mxn(c.acomodados.monto), v: c.meses[0], numero2: numero(c.tardiosFueraDeVentana.n), mxn2: mxn(c.tardiosFueraDeVentana.monto) })}{c.repetidosEntreArchivos.length > 0 && <>{ricoT(tx('rest.b_cobros_aparecen_en_mas_de', { numero: numero(c.repetidosEntreArchivos.length) }), { b: (c) => <b>{c}</b> })}</>}
      </p>
      {c.avisos.length > 0 && (
        <ul className="rv-pj-notas">{c.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
    </div>
  );
}

// ── El seguimiento de reclamos y notas de crédito ───────────────────────────

const TONO_ALERTA: Record<ReclamoVista['evaluacion']['alerta'], TonoEstado> = { ok: 'ok', por_vencer: 'warn', vencido: 'bad', cerrado: 'muted' };
const ROTULO_ALERTA: Record<ReclamoVista['evaluacion']['alerta'], string> = { ok: 'En plazo', por_vencer: 'Por vencer', vencido: 'Vencido', cerrado: 'Cerrado' };

/**
 * La PROPUESTA de a qué reclamo(s) corresponde una nota de crédito (`casarNota`). Es solo una sugerencia por suma exacta: nada se
 * registra solo; la persona confirma capturando la nota en el reclamo que corresponda. `texto` es lo que escribió (se devuelve al campo).
 */
export interface PropuestaNota {
  texto: string;
  /** `null` = el texto no es un importe válido (`motivo` dice por qué) o no se pudo calcular (`fallo`). */
  importe: number | null;
  resultado: ResultadoCasado | null;
  motivo?: string;
  fallo?: boolean;
}

function etiquetaReclamo(r: ReclamoVista | undefined, id: string, tx: TAgentes = TR_ES.t): string {
  if (!r) return `reclamo ${id.slice(0, 8)}`;
  const cat = (CATEGORIAS_COBRO as readonly string[]).includes(r.categoria) ? ETIQUETA_CATEGORIA_COBRO[r.categoria as CategoriaCobro] : r.categoria;
  const falta = Math.round((r.montoReclamado - r.montoAcreditado) * 100) / 100;
  return tx('rest.cruces_por_acreditar_cobro_mas_antiguo', { cat, numero: numero(r.nCruces), mxn: mxn(falta), fechaCobroMasAntiguo: r.fechaCobroMasAntiguo, v: r.referenciaPortal ? ` · folio ${r.referenciaPortal}` : '' });
}

/** «¿A qué reclamo corresponde esta nota?»: formulario GET (no escribe nada) y, si hay importe, la propuesta de `casarNota`. */
export function CasarNota({ propuesta, reclamos, sufijo, desglose, mes, tr = TR_ES }: {
  propuesta: PropuestaNota | null; reclamos: ReclamoVista[]; sufijo: string; desglose: string | null; mes: string | null; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const previos = new URLSearchParams(sufijo.replace(/^\?/, ''));
  if (desglose) previos.set('desglose', desglose);
  if (mes) previos.set('mes', mes);
  previos.delete('nota');
  const porId = new Map(reclamos.map((r) => [r.id, r]));
  const r = propuesta?.resultado ?? null;
  return (
    <div className="rv-pj-caja" id="casar-nota">
      {/* sin-info: rótulo de un bloque dentro de la tarjeta de seguimiento */}
      <h3 className="rv-pj-rotulo">{tx('rest.a_que_reclamo_corresponde_una_nota')}</h3>
      <p className="rv-pj-sub">{tx('rest.el_proveedor_manda_la_nota_sin')}</p>
      <form method="get" action="/dashboard/agentes/peajes/reclamacion" className="rv-pj-forma">
        {[...previos.entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <CampoTexto etiqueta={tx('rest.importe_de_la_nota_mxn')} name="nota" inputMode="decimal" required maxLength={20} defaultValue={propuesta?.texto ?? ''} />
        <Boton type="submit">{tx('rest.proponer_reclamo')}</Boton>
      </form>
      {propuesta?.fallo && <p role="alert" className="rv-pj-sub rv-pj-malo">{tx('rest.no_se_pudo_calcular_la_propuesta')}</p>}
      {propuesta && !propuesta.fallo && propuesta.importe === null && <p role="alert" className="rv-pj-sub rv-pj-malo">{propuesta.motivo ?? tx('rest.el_importe_no_es_valido')}</p>}
      {r && propuesta?.importe != null && (
        <div className="rv-pj-bloque" role="status">
          {r.alertas.includes('nota_mayor_que_reclamado') && (
            <p className="rv-pj-sub rv-pj-tono" data-tono="warn">{tx('rest.la_nota_es_mayor_que_todo', { mxn: mxn(propuesta.importe) })}</p>
          )}
          {r.tipo === 'seguro' && (
            <p className="rv-pj-texto">{tx('rest.coincide_exactamente_con')}{' '}<b>{etiquetaReclamo(porId.get(r.reclamoIds[0]), r.reclamoIds[0])}</b>{tx('rest.confirmalo_capturando_la_nota_en_ese')}</p>
          )}
          {r.tipo === 'sugerido' && (
            <>
              <p className="rv-pj-texto">{r.ambiguo ? tx('rest.hay_mas_de_una_combinacion_posible') : tx('rest.podria_corresponder_a_la_suma_de')}</p>
              <ul className="rv-pj-notas">
                {r.opciones.map((op, i) => <li key={i}>{op.map((id) => etiquetaReclamo(porId.get(id), id)).join(' + ')}</li>)}
              </ul>
              {r.truncado && <p className="rv-pj-sub">{tx('rest.hay_mas_combinaciones_de_las_que')}</p>}
            </>
          )}
          {r.tipo === 'demasiados' && <p className="rv-pj-sub">{r.mensaje}</p>}
          {r.tipo === 'sin_casar' && !r.alertas.includes('importe_invalido') && (
            <p className="rv-pj-sub">{tx('rest.ningun_reclamo_enviado_ni_combinacion_de', { mxn: mxn(propuesta.importe) })}</p>
          )}
        </div>
      )}
    </div>
  );
}

export function SeccionSeguimiento({ reclamos, resumen, acciones, desglose, revision, error, propuestaNota, sufijo = '', mes = null, tr = TR_ES }: {
  reclamos: ReclamoVista[] | null; resumen: ResumenSeguimiento | null; acciones: AccionesSeguimiento; desglose: string | null;
  revision: ReporteRevision | null; error: boolean; propuestaNota?: PropuestaNota | null; sufijo?: string; mes?: string | null; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const conCandidatos = revision ? CATEGORIAS_COBRO.filter((c) => revision.revision.porCategoria[c].n > 0) : [];
  return (
    <div id="seguimiento">
    <Tarjeta titulo={tx('rest.seguimiento_de_reclamos_y_notas_de')}>
      <p className="rv-pj-sub">{tx('rest.el_proveedor_no_atiende_por_telefono', { plazoReclamoMeses: PLAZO_RECLAMO_MESES })}</p>
      {error && <p role="alert" className="rv-pj-sub rv-pj-malo">{tx('rest.no_se_pudo_leer_el_seguimiento')}</p>}
      {resumen && reclamos && (
        <p className="rv-pj-texto">{ricoT(tx('rest.reclamos_reclamado_acreditado_b_por_acreditar', { numero: numero(resumen.reclamos), mxn: mxn(resumen.montoReclamado), mxn2: mxn(resumen.montoAcreditado), mxn3: mxn(resumen.pendienteAcreditar) }), { b: (c) => <b>{c}</b> })}{resumen.preparados > 0 && <>{ricoT(tx('rest.e0_preparados_sin_enviar_aun_no', { numero: numero(resumen.preparados), mxn: mxn(resumen.montoPreparado) }), { e0: (c) => <span className="rv-pj-apagado">{c}</span> })}</>}
          {resumen.porVencer > 0 && <>{ricoT(tx('rest.e0_por_vencer_e0', { numero: numero(resumen.porVencer) }), { e0: (c) => <span className="rv-pj-tono" data-tono="warn">{c}</span> })}</>}
          {resumen.vencidos > 0 && <>{ricoT(tx('rest.e0_vencidos_e0', { numero: numero(resumen.vencidos) }), { e0: (c) => <span className="rv-pj-malo">{c}</span> })}</>}
        </p>
      )}
      {reclamos && reclamos.length === 0 && <p className="rv-pj-sub">{tx('rest.aun_no_registras_reclamos')}</p>}
      {reclamos && reclamos.length > 0 && (
        <div className="rv-pj-bloque">
          {reclamos.map((r) => (
            <div key={r.id} className="rv-pj-caja">
              <div className="rv-pj-acciones">
                <strong>{(CATEGORIAS_COBRO as readonly string[]).includes(r.categoria) ? ETIQUETA_CATEGORIA_COBRO[r.categoria as CategoriaCobro] : r.categoria}</strong>
                <StatusChip tono={TONO_ALERTA[r.evaluacion.alerta]}>{ROTULO_ALERTA[r.evaluacion.alerta]}</StatusChip>
                <span className="rv-pj-apagado">{ETIQUETA_ESTADO_RECLAMO[r.estado]}</span>
                {r.referenciaPortal && <span className="rv-ag-num rv-pj-nota">{tx('rest.folio')}{' '}{r.referenciaPortal}</span>}
              </div>
              <p className="rv-pj-texto">{tx('rest.cruces_reclamado_acreditado', { numero: numero(r.nCruces), mxn: mxn(r.montoReclamado), mxn2: mxn(r.montoAcreditado) })}{r.evaluacion.pctAcreditado !== null && ` (${r.evaluacion.pctAcreditado}%)`}{' '}{tx('rest.cobro_mas_antiguo_vence', { fechaCobroMasAntiguo: r.fechaCobroMasAntiguo, fechaLimite: r.evaluacion.fechaLimite })}</p>
              <p className="rv-pj-sub">{r.evaluacion.mensaje}</p>
              {r.estado === 'preparado' && (
                <form action={acciones.marcarEnviado} className="rv-pj-forma">
                  <input type="hidden" name="reclamo" value={r.id} />
                  <CampoFecha etiqueta={tx('rest.enviado_el')} name="enviado_en" required />
                  <CampoTexto etiqueta={tx('rest.folio_del_portal_opc')} name="referencia" maxLength={120} />
                  <Boton type="submit" variante="primary">{tx('rest.marcar_como_enviado')}</Boton>
                </form>
              )}
              {(r.estado === 'enviado' || r.estado === 'acreditado_parcial') && (
                <div className="rv-pj-forma">
                  <form action={acciones.registrarNota} className="rv-pj-forma">
                    <input type="hidden" name="reclamo" value={r.id} />
                    {/* A33-06: lo que esta pantalla vio; un doble clic o pestaña repetida manda lo mismo y la base lo registra una sola vez. */}
                    <input type="hidden" name="version_vista" value={`${r.estado}:${r.montoAcreditado}`} />
                    <CampoTexto etiqueta={tx('rest.nota_de_credito_mxn')} name="monto" inputMode="decimal" required />
                    <CampoFecha etiqueta={tx('proveedores.vista.fecha')} name="fecha" required />
                    <CampoTexto etiqueta={tx('rest.folio_de_la_nota_opc')} name="referencia" maxLength={120} />
                    <Boton type="submit" variante="primary">{tx('rest.registrar_nota_de_credito')}</Boton>
                  </form>
                  <form action={acciones.rechazar}>
                    <input type="hidden" name="reclamo" value={r.id} />
                    <Boton type="submit">{tx('rest.el_proveedor_lo_rechazo')}</Boton>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {reclamos && reclamos.some((r) => r.estado === 'enviado' || r.estado === 'acreditado_parcial') && (
        <CasarNota tr={tr} propuesta={propuestaNota ?? null} reclamos={reclamos} sufijo={sufijo} desglose={desglose} mes={mes} />
      )}
      {desglose && conCandidatos.length > 0 && (
        <FormaRegistrarReclamo
          accion={acciones.crearReclamo} desglose={desglose}
          opciones={conCandidatos.map((c) => ({ categoria: c, n: revision?.revision.porCategoria[c].n ?? 0 }))}
        />
      )}
      {desglose && conCandidatos.length > 0 && (
        <p className="rv-pj-nota">{tx('rest.el_numero_de_cruces_el_importe')}</p>
      )}
    </Tarjeta>
    </div>
  );
}
