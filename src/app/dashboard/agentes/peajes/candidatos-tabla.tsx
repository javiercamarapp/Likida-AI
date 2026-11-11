import {
  BarraPeriodo, Boton, BotonEnlace, Casilla, CampoFecha, CampoTexto, EstadoError, EstadoVacio, hrefConParams, Icono, StatusChip, TablaBase, Tarjeta,
  type TonoEstado,
} from '@/app/ui-v2/componentes';
import './peajes.css';
import { FileDown } from 'lucide-react';
import { fechaMx, mxn, numero } from '@/lib/formato';
// SOLO tipos y módulos puros: la vista no debe arrastrar `supabaseAdmin` al bundle.
import {
  ESTADOS_CANDIDATO, ETIQUETA_ESTADO_CANDIDATO, TAMANO_PAGINA, TODAS_LAS_CATEGORIAS, aplicaAccion, etiquetaCategoriaFila, filtrosAQuery,
  type AccionCandidato, type EstadoCandidato, type FilaCandidato, type TablaCandidatos,
} from '@/lib/likida/peajes/candidatos_tabla';
import { ROTULO_CANDIDATO } from '@/lib/likida/peajes/reglas_cobro';
import { type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// LA TABLA DE CANDIDATOS CON SUS ACCIONES (T-A2-28): una página de a lo más 50 filas, con filtros por
// categoría, estado, unidad, caseta y fecha; totales de TODO lo que cumple el filtro; y por fila (o por
// lote, con confirmación) reclamar, descartar o justificar. Son CANDIDATOS a validar con el proveedor.
// ═══════════════════════════════════════════════════════════════════════════

export type AccionDecidir = (fd: FormData) => Promise<void>;

const TONO_ESTADO: Record<EstadoCandidato, TonoEstado> = { pendiente: 'warn', reclamado: 'ok', descartado: 'muted', justificado: 'muted' };
const ROTULO_ACCION: Record<AccionCandidato, string> = { reclamado: 'Marcar como reclamado', descartado: 'Descartar', justificado: 'Justificar' };
const ROTULO_LOTE: Record<AccionCandidato, string> = { reclamado: 'Marcar como reclamados', descartado: 'Descartar', justificado: 'Justificar' };

function Campos({ desglose, retorno, accion, indice, categoria }: { desglose: string; retorno: string; accion: AccionCandidato; indice: number; categoria: string }) {
  return (
    <>
      <input type="hidden" name="desglose" value={desglose} />
      <input type="hidden" name="retorno" value={retorno} />
      <input type="hidden" name="modo" value="fila" />
      <input type="hidden" name="accion" value={accion} />
      <input type="hidden" name="indice" value={indice} />
      <input type="hidden" name="categoria" value={categoria} />
    </>
  );
}

function AccionesDeFila({ f, desglose, retorno, decidir, tr = TR_ES }: { f: FilaCandidato; desglose: string; retorno: string; decidir: AccionDecidir; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (f.estado !== 'pendiente') {
    return (
      <div className="rv-pj-celda">
        <StatusChip tono={TONO_ESTADO[f.estado]}>{ETIQUETA_ESTADO_CANDIDATO[f.estado]}</StatusChip>
        {f.motivo && <p className="rv-pj-nota">{ricoT(tx('rest.b_motivo_b'), { b: (c) => <b>{c}</b> })}{' '}{f.motivo}</p>}
        {f.actor && f.decididoEn && <p className="rv-pj-nota">{f.actor} · {fechaMx(f.decididoEn)}</p>}
      </div>
    );
  }
  const puedeReclamar = aplicaAccion(f, 'reclamado').ok;
  return (
    <div className="rv-pj-celda">
      <StatusChip tono={TONO_ESTADO.pendiente}>{ETIQUETA_ESTADO_CANDIDATO.pendiente}</StatusChip>
      {puedeReclamar && (
        <form action={decidir}>
          <Campos desglose={desglose} retorno={retorno} accion="reclamado" indice={f.indice} categoria={f.categoria} />
          <Boton type="submit" variante="primary" tamano="sm">{ROTULO_ACCION.reclamado}</Boton>
        </form>
      )}
      {(['descartado', 'justificado'] as const).map((a) => (
        <form key={a} action={decidir} className="rv-pj-forma">
          <Campos desglose={desglose} retorno={retorno} accion={a} indice={f.indice} categoria={f.categoria} />
          <CampoTexto etiquetaOculta name="motivo" required minLength={3} maxLength={300} placeholder={a === 'descartado' ? tx('rest.por_que_se_descarta') : tx('rest.por_que_esta_justificado')}
            etiqueta={tx('rest.motivo_para_el_renglon', { v: a === 'descartado' ? 'descartar' : 'justificar', v2: f.indice + 1, etiquetaCategoriaFila: etiquetaCategoriaFila(f.categoria) })} />
          <Boton type="submit" tamano="sm">{ROTULO_ACCION[a]}</Boton>
        </form>
      ))}
    </div>
  );
}

function Lote({ tabla, desglose, retorno, decidir, aplicables, tr = TR_ES }: {
  tabla: TablaCandidatos; desglose: string; retorno: string; decidir: AccionDecidir; aplicables: Record<AccionCandidato, number>; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const f = tabla.filtros;
  const hay = (['reclamado', 'descartado', 'justificado'] as const).some((a) => aplicables[a] > 0);
  if (!hay) return null;
  return (
    <div className="rv-pj-caja" id="lote-candidatos">
      <p className="rv-pj-sub">{ricoT(tx('rest.b_acciones_en_lote_b_sobre'), { b: (c) => <b>{c}</b> })}</p>
      {(['reclamado', 'descartado', 'justificado'] as const).map((a) => aplicables[a] > 0 && (
        <form key={a} action={decidir} className="rv-pj-forma">
          <input type="hidden" name="desglose" value={desglose} />
          <input type="hidden" name="retorno" value={retorno} />
          <input type="hidden" name="modo" value="filtro" />
          <input type="hidden" name="accion" value={a} />
          <input type="hidden" name="esperado" value={aplicables[a]} />
          <input type="hidden" name="f_cat" value={f.categoria} />
          <input type="hidden" name="f_estado" value={f.estado} />
          <input type="hidden" name="f_unidad" value={f.unidad} />
          <input type="hidden" name="f_caseta" value={f.caseta} />
          <input type="hidden" name="f_desde" value={f.desde} />
          <input type="hidden" name="f_hasta" value={f.hasta} />
          <input type="hidden" name="f_orden" value={f.orden} />
          {a === 'reclamado'
            ? <CampoFecha etiqueta={tx('rest.enviado_el_si_ya_lo_enviaste')} name="enviado_en" />
            : <CampoTexto etiqueta={tx('rest.motivo')} name="motivo" required minLength={3} maxLength={300} aria-label={tx('rest.motivo_para_en_lote', { v: a === 'descartado' ? 'descartar' : 'justificar' })} />}
          <Casilla name="confirmar" required etiqueta={`Confirmo: ${ROTULO_LOTE[a].toLowerCase()} ${numero(aplicables[a])} ${aplicables[a] === 1 ? 'cruce' : 'cruces'}`} />
          <Boton type="submit" variante={a === 'reclamado' ? 'primary' : 'secondary'}>
            {ROTULO_LOTE[a]} ({numero(aplicables[a])})
          </Boton>
        </form>
      ))}
    </div>
  );
}

export function TablaCandidatosCobros({ tabla, error, desglose, sufijo, decidir, aplicables, tr = TR_ES }: {
  tabla: TablaCandidatos | null; error: boolean; desglose: string; sufijo: string;
  /** Sin ella la tabla es de solo lectura (sin botones). */
  decidir?: AccionDecidir;
  /** Cuántas filas tocaría cada acción en lote con el filtro actual (el número que se confirma). */
  aplicables?: Record<AccionCandidato, number>; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const ctx = sufijo ? `&${sufijo.slice(1)}` : '';
  if (error || !tabla) {
    return (
      <div id="candidatos">
        <Tarjeta titulo={tx('rest.candidatos_del_archivo')}>
          <EstadoError compacto>{tx('rest.no_se_pudo_leer_la_tabla')}</EstadoError>
        </Tarjeta>
      </div>
    );
  }
  const f = tabla.filtros;
  const retorno = filtrosAQuery(f);
  const enlace = (pag: number) => `?${new URLSearchParams([...new URLSearchParams(sufijo.replace(/^\?/, '')).entries(), ['desglose', desglose], ...new URLSearchParams(filtrosAQuery({ ...f, pagina: 1 }, false)).entries(), ...(pag > 1 ? [['pag', String(pag)] as [string, string]] : [])]).toString()}#candidatos`;
  const desde = tabla.total === 0 ? 0 : (tabla.pagina - 1) * TAMANO_PAGINA + 1;
  const hasta = Math.min(tabla.total, tabla.pagina * TAMANO_PAGINA);
  const ctxPares: Array<[string, string]> = [...new URLSearchParams(sufijo.replace(/^\?/, '')).entries(), ['desglose', desglose]];
  const baseCand: Record<string, string> = { ...Object.fromEntries(ctxPares), ...Object.fromEntries(new URLSearchParams(filtrosAQuery({ ...f, pagina: 1 }, false)).entries()) };
  const quitar = (cambios: Record<string, null>) => `${hrefConParams('', baseCand, cambios)}#candidatos`;
  const hayFiltro = f.categoria !== '' || f.estado !== '' || f.unidad !== '' || f.caseta !== '' || f.desde !== '' || f.hasta !== '';
  return (
    <div id="candidatos">
    <Tarjeta
      titulo={tx('rest.candidatos_del_archivo')}
      acciones={(
        <span className="rv-pj-total">
          <span className="rv-pj-rotulo">{hayFiltro ? tx('rest.cruces_con_este_filtro') : tx('rest.cruces_candidatos')}</span>
          <strong className="cifra-mono rv-pj-total__valor">{numero(tabla.total)}</strong>
          <span className="rv-pj-nota">{mxn(tabla.monto)}</span>
        </span>
      )}
    >
      <p className="rv-pj-sub">{tx('rest.decide_que_hacer_con_cada_cruce')}</p>
      <div><StatusChip tono="warn">{ROTULO_CANDIDATO}</StatusChip></div>

      <div className="rv-pj-acciones">
        {ESTADOS_CANDIDATO.map((e) => (
          <StatusChip key={e} tono={TONO_ESTADO[e]}>
            {ETIQUETA_ESTADO_CANDIDATO[e]} · {numero(tabla.porEstado[e].n)} · {mxn(tabla.porEstado[e].monto)}
          </StatusChip>
        ))}
        <BotonEnlace href={`/api/export/peajes-candidatos?desglose=${desglose}${ctx}`} icono={<Icono icono={FileDown} />}>{tx('rest.reporte_para_el_portal_del_proveedor')}</BotonEnlace>
      </div>

      <BarraPeriodo etiqueta={tx('rest.periodo_y_filtros_de_candidatos')}
        chips={[
          ...(f.desde || f.hasta ? [{ id: 'rango', etiqueta: `${f.desde ? fechaMx(f.desde) : 'Inicio'} – ${f.hasta ? fechaMx(f.hasta) : 'hoy'}`, hrefQuitar: quitar({ desde: null, hasta: null }) }] : []),
          ...(f.categoria ? [{ id: 'cat', etiqueta: tx('rest.categoria', { etiquetaCategoriaFila: etiquetaCategoriaFila(f.categoria) }), hrefQuitar: quitar({ cat: null }) }] : []),
          ...(f.estado ? [{ id: 'estado', etiqueta: `Estado: ${ETIQUETA_ESTADO_CANDIDATO[f.estado]}`, hrefQuitar: quitar({ estado: null }) }] : []),
          ...(f.unidad ? [{ id: 'unidad', etiqueta: `Unidad: ${f.unidad}`, hrefQuitar: quitar({ unidad: null }) }] : []),
          ...(f.caseta ? [{ id: 'caseta', etiqueta: `Caseta: ${f.caseta}`, hrefQuitar: quitar({ caseta: null }) }] : []),
        ]}
        cajon={{
          accion: '#candidatos', ocultos: ctxPares, limpiarHref: `${hrefConParams('', Object.fromEntries(ctxPares))}#candidatos`,
          nActivos: [f.categoria, f.estado, f.unidad, f.caseta, f.desde || f.hasta].filter(Boolean).length,
          periodo: { desde: f.desde || null, hasta: f.hasta || null },
          campos: { items: [
            { tipo: 'select', nombre: 'cat', etiqueta: tx('rest.categoria_2'), valor: f.categoria, opciones: [{ valor: '', rotulo: tx('rest.todas') }, ...TODAS_LAS_CATEGORIAS.map((c) => ({ valor: c, rotulo: etiquetaCategoriaFila(c) }))] },
            { tipo: 'select', nombre: 'estado', etiqueta: tx('proveedores.vista.estado'), valor: f.estado, opciones: [{ valor: '', rotulo: tx('rest.todos') }, ...ESTADOS_CANDIDATO.map((e) => ({ valor: e, rotulo: ETIQUETA_ESTADO_CANDIDATO[e] }))] },
            { tipo: 'texto', nombre: 'unidad', etiqueta: tx('rest.unidad'), valor: f.unidad },
            { tipo: 'texto', nombre: 'caseta', etiqueta: tx('rest.caseta'), valor: f.caseta },
            { tipo: 'select', nombre: 'orden', etiqueta: tx('rest.orden'), valor: f.orden, opciones: [{ valor: 'monto_desc', rotulo: tx('rest.mayor_monto_primero') }, { valor: 'monto_asc', rotulo: tx('rest.menor_monto_primero') }, { valor: 'fecha', rotulo: tx('rest.por_fecha') }] },
          ] },
        }} />

      {tabla.total === 0 ? (
        <EstadoVacio titulo={hayFiltro ? tx('rest.ningun_candidato_con_ese_filtro') : tx('rest.sin_candidatos_que_revisar')}>
          {hayFiltro ? tx('rest.ningun_candidato_cumple_este_filtro_quita') : tx('rest.este_archivo_no_tiene_candidatos_que')}
        </EstadoVacio>
      ) : (
        <>
          <p className="rv-pj-nota">{tx('rest.mostrando_de_las_paginas_son_de', { numero: numero(desde), numero2: numero(hasta), numero3: numero(tabla.total), tamanoPagina: TAMANO_PAGINA })}</p>
          <TablaBase<FilaCandidato>
            etiqueta={tx('rest.candidatos_de_peaje_por_fecha_y')}
            filas={tabla.filas}
            idFila={(c) => c.clave}
            altoMaximo={false}
            tarjetaMovil
            columnas={[
              { id: 'fecha', titulo: tx('rest.fecha_y_hora'), principal: true, celda: (c) => <>{c.fecha ?? '—'}{c.hora && <span className="rv-pj-nota">{c.hora}</span>}</> },
              { id: 'categoria', titulo: tx('rest.categoria_2'), celda: (c) => <>{c.etiquetaCategoria}{c.critica && <strong className="rv-pj-nota rv-pj-malo">{tx('rest.critico')}</strong>}</> },
              { id: 'caseta', titulo: tx('rest.caseta'), celda: (c) => c.caseta ?? '—' },
              { id: 'tag', titulo: tx('rest.tag_unidad'), celda: (c) => <>{c.tag ?? '—'}{c.unidad && <span className="rv-pj-nota">{c.unidad}</span>}</> },
              { id: 'clase', titulo: tx('rest.clase'), alinear: 'der', celda: (c) => <span className="cifra-mono">{c.clase ?? '—'}</span> },
              { id: 'importe', titulo: tx('rest.importe'), alinear: 'der', celda: (c) => <span className="cifra-mono">{mxn(c.monto)}</span> },
              {
                id: 'quepaso', titulo: tx('conductores.vista.que_paso'),
                celda: (c) => (
                  <div className="rv-pj-que">
                    <p className="rv-pj-texto">{c.quePaso}</p>
                    <details>
                      <summary className="rv-pj-nota">{tx('rest.que_significa_y_que_hacer')}</summary>
                      <p className="rv-pj-sub">{ricoT(tx('rest.b_que_significa_b'), { b: (c) => <b>{c}</b> })}{' '}{c.queSignifica}</p>
                      <p className="rv-pj-sub">{ricoT(tx('rest.b_que_hacer_b'), { b: (c) => <b>{c}</b> })}{' '}{c.queHacer}</p>
                    </details>
                  </div>
                ),
              },
              {
                id: 'accion', titulo: tx('rest.accion'),
                celda: (c) => decidir
                  ? <AccionesDeFila tr={tr} f={c} desglose={desglose} retorno={retorno} decidir={decidir} />
                  : <StatusChip tono={TONO_ESTADO[c.estado]}>{ETIQUETA_ESTADO_CANDIDATO[c.estado]}</StatusChip>,
              },
            ]}
          />
          {tabla.paginas > 1 && (
            <nav aria-label={tx('rest.paginas_de_candidatos')} className="rv-pj-paginas">
              {tabla.pagina > 1 ? <BotonEnlace href={enlace(tabla.pagina - 1)}>{tx('rest.anterior')}</BotonEnlace> : <span className="rv-pj-apagado">{tx('rest.anterior')}</span>}{ricoT(tx('rest.e0_pagina_de_e0', { numero: numero(tabla.pagina), numero2: numero(tabla.paginas) }), { e0: (c) => <span>{c}</span> })}{tabla.pagina < tabla.paginas ? <BotonEnlace href={enlace(tabla.pagina + 1)}>{tx('rest.siguiente')}</BotonEnlace> : <span className="rv-pj-apagado">{tx('rest.siguiente')}</span>}
            </nav>
          )}
        </>
      )}
      {decidir && aplicables && <Lote tr={tr} tabla={tabla} desglose={desglose} retorno={retorno} decidir={decidir} aplicables={aplicables} />}
    </Tarjeta>
    </div>
  );
}
