import { CheckCircle2, CircleAlert, CircleDashed, Clock, MapPin, MapPinOff, Camera, UserCog, Flag, FileCheck2, FileWarning } from 'lucide-react';
import { fechaHoraMx, numero, porcentaje } from '@/lib/formato';
import type { ResumenDocumentosCierre } from '@/lib/likida/conductor/documentos_cierre';
import type { CatalogosFiltro } from '@/lib/likida/conductor/repo_validacion';
import { textoTiempo } from '@/lib/likida/conductor/planificador';
import { esFolioSimulado, type EpisodioVista, type Excepcion, type FilaTablero, type HitoVista, type IndicadoresVista, type Semaforo, type Tablero, type TipoExcepcion } from '@/lib/likida/conductor/tablero';
import type { Estancia } from '@/lib/likida/conductor/estadias_anden';
import type { ReubicacionesCliente } from '@/lib/likida/conductor/reubicaciones';
import { AccionesHito, FormaAsignarSitios, type AccionOficinaServidor, type ModoAccion, type OpcionSitio } from './acciones-forma';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import './conductores.css';
import { BarraFiltros, Disclosure, FiltroOpciones, Icono, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// EL TABLERO DE HITOS (0385) — la pantalla del jefe de tráfico.
//
// Presentación pura: recibe el modelo ya armado (`armarTablero`) y no lee nada. CERO pesos
// (área `operacion`). Cada cifra dice de dónde sale; un indicador sin datos dice «sin datos»,
// no «0».
// ═══════════════════════════════════════════════════════════════════════════

export interface FiltrosVista {
  terminalId: string;
  clienteId: string;
  operadorId: string;
  semaforo: Semaforo | '';
  dias: number;
}

const semaforoTr = (tx: TAgentes = TR_ES.t): Record<Semaforo, { etiqueta: string; tono: TonoEstado }> => ({
  sin_reporte: { etiqueta: tx('rest.sin_reporte'), tono: 'bad' },
  atrasado: { etiqueta: tx('rest.atrasado'), tono: 'warn' },
  a_tiempo: { etiqueta: tx('rest.a_tiempo'), tono: 'ok' },
  sin_ancla: { etiqueta: tx('rest.sin_ancla'), tono: 'muted' },
  completo: { etiqueta: tx('rest.completo'), tono: 'neutral' },
});
export const ORDEN_SEMAFORO: Semaforo[] = ['sin_reporte', 'atrasado', 'a_tiempo', 'sin_ancla', 'completo'];

const excepcion = (tx: TAgentes = TR_ES.t): Record<TipoExcepcion, string> => ({
  escalado_sin_atender: tx('rest.escalado_sin_atender'), sin_reporte: tx('rest.sin_reporte'), atrasado: tx('rest.atrasado'), sin_coincidencia: tx('rest.ubicacion_sin_coincidencia_2'),
  llegada_sin_confirmar: tx('rest.llegada_sin_confirmar'), llegada_sin_sitio: tx('rest.llegada_sin_sitio_para_conciliar'),
  estadia_excedida: tx('rest.estadia_excedida'), horas_incoherentes: tx('rest.horas_incoherentes'), sin_a_quien_escalar: tx('rest.sin_a_quien_escalar'), patio_entrega_distinto: tx('rest.patio_de_entrega_distinto'),
  pendiente_cruce_largo: tx('rest.pendiente_de_cruce_por_mucho_tiempo'), salida_tms_discrepante: tx('rest.salida_del_tms_sin_confirmar'), local_abierto_sin_ccp: 'Sin Carta Porte (viaje local abierto)', sin_ruta_autorizada: tx('rest.sin_ruta_autorizada'),
});
const GRAVEDAD: Record<1 | 2 | 3, string> = { 3: 'Urgente', 2: 'Revisar', 1: 'Vigilar' };

/** T-A5-26: rótulo de los datos de demostración del seed. Nunca se mezclan con reales sin decirlo. */
export function EtiquetaSimulado() {
  return <span className="rv-cd__simulado">SIMULADO</span>;
}

export function PuntoSemaforo({ s, tr = TR_ES }: { s: Semaforo; tr?: TrAgentes }) {
  const c = semaforoTr(tr.t)[s];
  return <StatusChip tono={c.tono}>{c.etiqueta}</StatusChip>;
}


/** T-A5-26: textos exactos de los estados vacíos y de falta, en lenguaje llano. */
export const textoSinViajes = (tx: TAgentes = TR_ES.t) => (tx('rest.todavia_no_hay_viajes_en_seguimiento'));
export const TEXTO_SIN_VIAJES = textoSinViajes();
export const textoSinGps = (tx: TAgentes = TR_ES.t) => (tx('rest.sin_gps_conectado_las_llegadas_por'));
export const TEXTO_SIN_GPS = textoSinGps();
export const textoSinTelefono = (tx: TAgentes = TR_ES.t) => (tx('rest.este_operador_no_tiene_telefono_no'));
export const TEXTO_SIN_TELEFONO = textoSinTelefono();

const minutos = (m: number): string => (m < 60 ? `${numero(Math.round(m))} min` : textoTiempo(m));

export function IndicadoresHitos({ i, dias, tr = TR_ES }: { i: IndicadoresVista | null; dias: number; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (i === null) {
    return <p className="rv-cd__nota">{tx('rest.no_se_pudieron_calcular_los_indicadores')}</p>;
  }
  return (
    <div>
      <TiraCifras sello={selloHoy(tx('conductores.vista.viajes_de_la_flota'))}>
        <Cifra etiqueta={tx('rest.hitos_reportados_sin_insistencia')} info="conductores_tablero.sin_insistencia"
          valor={i.tasaSinInsistencia === null ? null : porcentaje(i.tasaSinInsistencia * 100, 0)}
          nota={i.recibidos === 0 ? tx('rest.ningun_hito_recibido_en_el_periodo') : tx('rest.de_hitos_a_lo_mas_un', { numero: numero(i.recibidos) })} />
        <Cifra etiqueta={tx('rest.tiempo_medio_de_respuesta')} info="conductores_tablero.tiempo_respuesta"
          valor={i.minutosRespuestaPromedio === null ? null : minutos(i.minutosRespuestaPromedio)}
          nota={i.conRespuestaMedida === 0 ? tx('rest.ninguna_solicitud_con_respuesta_medible') : `sobre ${numero(i.conRespuestaMedida)} solicitudes contestadas`} />
        <Cifra etiqueta={tx('rest.hitos_escalados')} info="conductores_tablero.escalados" valor={numero(i.escalados)} tono={i.escalados > 0 ? 'warn' : undefined} nota={tx('rest.agotaron_la_escalera_de_recordatorios')} />
        <Cifra etiqueta={tx('rest.validados_con_ubicacion')} info="conductores_tablero.validados_ubicacion" valor={numero(i.validadosUbicacion)}
          nota={i.sinCoincidencia > 0 ? tx('rest.sin_coincidencia_por_revisar', { numero: numero(i.sinCoincidencia) }) : tx('rest.pin_o_gps_dentro_del_sitio')} />
        <Cifra etiqueta={tx('rest.validacion_en_modo_degradado')} info="conductores_tablero.validacion_degradada" valor={i.tasaValidacionDegradada === null ? null : porcentaje(i.tasaValidacionDegradada * 100, 0)}
          tono={i.tasaValidacionDegradada !== null && i.tasaValidacionDegradada > 0 ? 'warn' : undefined}
          nota={i.llegadasValidables === 0 ? tx('rest.ninguna_llegada_validable_en_el_periodo') : tx('rest.de_llegadas_sin_geocerca_o_solo', { numero: numero(i.validacionDegradada), numero2: numero(i.llegadasValidables) })} />
      </TiraCifras>
      <p className="rv-cd__micro">{tx(dias === 1 ? 'rest.hitos_actividad_ultimos_dias.uno' : 'rest.hitos_actividad_ultimos_dias.otros', { n: dias })}{i.capturadosOficina > 0 ? tx('rest.los_capturo_la_oficina_a_mano', { numero: numero(i.capturadosOficina) }) : ''}
        {i.omitidos > 0 ? tx('rest.se_dieron_por_omitidos_el_chofer', { numero: numero(i.omitidos) }) : ''}
      </p>
    </div>
  );
}

export function FiltrosTablero({ f, catalogos, ocultos, accionUrl, tr = TR_ES }: {
  f: FiltrosVista; catalogos: CatalogosFiltro | null; ocultos: Record<string, string>; accionUrl: string; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const todos = { valor: '', rotulo: tx('rest.todos') };
  const hay = Boolean(f.terminalId || f.clienteId || f.operadorId || f.semaforo);
  return (
    <BarraFiltros accion={accionUrl} ocultos={ocultos} etiqueta={tx('rest.filtros_del_tablero')} nActivos={hay ? 1 : 0}
      limpiarHref={accionUrl + (Object.keys(ocultos).length ? `?${new URLSearchParams(ocultos).toString()}` : '')}>
      <FiltroOpciones nombre="terminal" etiqueta={tx('rest.patio')} valor={f.terminalId} opciones={[todos, ...(catalogos?.terminales ?? []).map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
      <FiltroOpciones nombre="cliente" etiqueta={tx('vigia.vista.cliente')} valor={f.clienteId} opciones={[todos, ...(catalogos?.clientes ?? []).map((c) => ({ valor: c.id, rotulo: c.nombre }))]} />
      <FiltroOpciones nombre="chofer" etiqueta={tx('cobranza.gasto.chofer')} valor={f.operadorId} opciones={[todos, ...(catalogos?.operadores ?? []).map((o) => ({ valor: o.id, rotulo: o.nombre }))]} />
      <FiltroOpciones nombre="semaforo" etiqueta={tx('rest.semaforo')} valor={f.semaforo} opciones={[todos, ...ORDEN_SEMAFORO.map((s) => ({ valor: s, rotulo: semaforoTr(tx)[s].etiqueta }))]} />
      <FiltroOpciones nombre="dias" etiqueta={tx('rest.indicadores_de')} valor={String(f.dias)} porDefecto="7"
        opciones={[{ valor: '1', rotulo: tx('rest.ultimo_dia') }, { valor: '7', rotulo: tx('rest.ultimos_7_dias') }, { valor: '30', rotulo: tx('rest.ultimos_30_dias') }]} />
    </BarraFiltros>
  );
}

/** Qué se le puede hacer a una excepción. Las acciones tienen su propio candado en el servidor. */
function modosDeExcepcion(e: Excepcion): ModoAccion[] {
  switch (e.tipo) {
    case 'escalado_sin_atender': return ['atender', 'capturar'];
    case 'sin_reporte':
    case 'atrasado': return e.hitoId ? ['capturar'] : [];
    case 'sin_coincidencia':
    case 'llegada_sin_confirmar':
    case 'llegada_sin_sitio': return e.hitoId ? ['validar'] : [];
    default: return [];
  }
}

export function ColaExcepciones({ excepciones, puedeActuar, accion, tr = TR_ES }: { excepciones: Excepcion[]; puedeActuar: boolean; accion: AccionOficinaServidor; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <Tarjeta titulo={tx('rest.cola_de_excepciones')} info="conductores_tablero.excepciones" estado={excepciones.length === 0 ? 'vacio' : 'ok'}
      mensaje={tx('rest.nada_pendiente')} detalle={tx('rest.nada_pendiente_ningun_hito_escalado_atrasado')}>
      <p className="rv-cd__micro">{tx('rest.lo_que_pide_una_decision_tuya')}</p>
      <ul className="rv-cd__lista">
        {excepciones.slice(0, 50).map((e, i) => (
          <li key={`${e.viajeId}-${e.tipo}-${e.hitoId ?? i}`} className="rv-cd__item">
            <div className="rv-cd__linea">
              <span className="rv-cd__grav" data-g={e.gravedad}>{GRAVEDAD[e.gravedad]}</span>
              <span className="rv-cd__medio">{excepcion(tx)[e.tipo]}</span>
              <span className="rv-cd__medio">{e.folio ?? tx('rest.viaje_sin_folio')}</span>
              {e.desde && <span className="rv-cd__micro rv-cd__fin">desde {fechaHoraMx(e.desde)}</span>}
            </div>
            <p className="rv-cd__nota">{e.texto}</p>
            {puedeActuar && <AccionesHito accion={accion} modos={modosDeExcepcion(e)} hitoId={e.hitoId} viajeId={e.viajeId} />}
          </li>
        ))}
      </ul>
      {excepciones.length > 50 && (
        <p className="rv-cd__micro">{tx('rest.se_muestran_las_50_mas_urgentes', { numero: numero(excepciones.length) })}</p>
      )}
    </Tarjeta>
  );
}

const fotoTexto = (tx: TAgentes = TR_ES.t): Record<string, string> => ({ sello: 'sello', anden: tx('rest.anden_2'), recibido: 'recibido', otra: 'foto' });
const fuenteTexto = (tx: TAgentes = TR_ES.t): Record<string, string> => ({ texto: 'texto', boton: tx('rest.boton'), ubicacion: tx('rest.ubicacion'), foto: 'foto', sistema: 'sistema', oficina: 'oficina' });

/**
 * R10-8: por qué se ve «omitido». Antes TODO omitido decía «avisó el siguiente», incluso el hito escalado que cerró el barrido de viajes
 * abiertos hace más de 30 días (`viaje_abierto_vencido`): la oficina creía que el chofer había avisado el siguiente y nadie lo capturó.
 */
function textoOmitido(h: HitoVista, tx: TAgentes = TR_ES.t): string {
  if (h.omitidoMotivo === 'viaje_abierto_vencido') {
    return tx('rest.cerrado_sin_reporte_el_viaje_lleva', { v: h.escaladoEn ? ' y ya se había escalado' : '' });
  }
  return tx('rest.omitido_aviso_el_siguiente');
}

function CeldaHito({ h, puedeActuar, accion, viajeId, tr = TR_ES }: { h: HitoVista; puedeActuar: boolean; accion: AccionOficinaServidor; viajeId: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const resuelto = h.estado === 'recibido' || h.estado === 'validado';
  const icono = h.estado === 'validado' ? CheckCircle2 : resuelto ? CheckCircle2 : h.estado === 'escalado' ? Flag : h.estado === 'omitido' ? CircleDashed : Clock;
  const tono = resuelto ? 'ok' : h.estado === 'escalado' ? 'bad' : 'faint';
  const modos: ModoAccion[] = [];
  if (puedeActuar) {
    if (h.estado === 'esperado' || h.estado === 'escalado' || h.estado === 'omitido') modos.push('capturar');
    if (h.estado === 'recibido') modos.push('validar');
  }
  return (
    <li className="rv-cd__hito">
      <div className="rv-cd__hito-cab" data-e={tono}>
        <Icono icono={icono} tam={14} />
        <span>{h.etiqueta}</span>
      </div>
      {resuelto && h.horaMensaje ? (
        <div className="rv-ag-num" title={tx('rest.hora_del_mensaje_del_chofer_no')}>{fechaHoraMx(h.horaMensaje)}</div>
      ) : (
        <div className="rv-cd__faint">
          {h.estado === 'omitido' ? textoOmitido(h) : h.estado === 'escalado' ? `escalado${h.atendidaEn ? ' · atendido' : ''}` : h.tocaDesde ? `toca desde ${fechaHoraMx(h.tocaDesde)}` : 'pendiente'}
        </div>
      )}
      {resuelto && (
        <div className="rv-cd__linea rv-cd__micro" data-tono="muted">
          {h.fuente && <span>{tx('rest.via')}{' '}{fuenteTexto(tx)[h.fuente] ?? tx('rest.otro_medio')}</span>}
          {h.validadoPor && <span data-tono="ok" className="rv-cd__micro">{tx('rest.validado')}{h.validadoPor === 'gps' ? tx('rest.ubicacion') : h.validadoPor === 'oficina' ? 'oficina' : 'sistema'})</span>}
          {h.fotos.map((f) => (
            <a key={f.id} href={`/api/v1/evidencias/${f.id}`} target="_blank" rel="noopener noreferrer" className="rv-cd__foto" data-alerta={f.reusoTenant || undefined}
              title={f.reusoTenant ? tx('rest.abrir_la_foto_el_enlace_dura') : tx('rest.abrir_la_foto_el_enlace_dura_2')}>
              <Icono icono={Camera} tam={14} />{fotoTexto(tx)[f.tipo]}
              {f.reusoTenant && <Icono icono={CircleAlert} tam={14} />}
            </a>
          ))}
        </div>
      )}
      {h.contacto && <div className="rv-cd__micro" data-tono="muted">{tx('rest.lo_atiende')}{' '}{h.contacto}</div>}
      {h.sinContacto && <div className="rv-cd__micro">{tx('rest.sin_contacto_en_anden')}</div>}
      {h.reporte?.rampa && <div className="rv-cd__micro" data-tono="muted">{h.reporte.rampa}</div>}
      {h.reporte && h.reporte.reubicaciones > 0 && (
        <Disclosure titulo={h.reporte.reubicaciones === 1 ? tx('rest.1_cambio_de_rampa_o_contacto') : tx('rest.cambios_de_rampa_o_contacto', { reubicaciones: h.reporte.reubicaciones })} variante="linea">
          <ol className="rv-cd__lista">
            {h.reporte.historial.map((r) => <li key={r.en} className="rv-cd__micro" data-tono="muted"><span className="rv-ag-num">{fechaHoraMx(r.en)}</span> · {r.rampa ?? tx('rest.sin_rampa_registrada')}</li>)}
          </ol>
        </Disclosure>
      )}
      {h.validacion && h.validacion.resultado !== 'sin_dato' && (
        <div className="rv-cd__icono-linea rv-cd__micro" data-tono={h.validacion.resultado === 'validado' ? 'ok' : 'warn'} title={h.validacion.texto}>
          <Icono icono={h.validacion.resultado === 'validado' ? MapPin : MapPinOff} tam={14} />
          <span>{h.validacion.resultado === 'validado' ? tx('rest.en_el_sitio_m', { numero: numero(h.validacion.distanciaM ?? 0) }) : `fuera del sitio (${numero(h.validacion.distanciaM ?? 0)} m)`}</span>
        </div>
      )}
      {h.validacion?.resultado === 'sin_dato' && <div className="rv-cd__micro">{tx('rest.ubicacion_sin_dato')}</div>}
      {h.accionesOficina.length > 0 && (
        <div className="rv-cd__icono-linea rv-cd__micro" data-tono="muted">
          <Icono icono={UserCog} tam={14} />
          <span>{h.accionesOficina[0].email}: «{h.accionesOficina[0].motivo}»</span>
        </div>
      )}
      {modos.length > 0 && <AccionesHito accion={accion} modos={modos} hitoId={h.id} viajeId={viajeId} />}
    </li>
  );
}

/**
 * T-A5-69 (A5 Conductor): qué documentos de cierre faltan/llegaron/necesitan revisión en ESTE viaje — los MISMOS
 * datos que `GET /v1/evidencias`, armados con la misma `resumenDocumentosCierre`. `null` (no se pudo leer) o
 * `usaCatalogo: false` (sin solicitud: el cliente no tiene catálogo, o la perilla sigue apagada) NO pintan nada:
 * la regla del repo es nunca inventar una cifra, y «0 de 0 documentos» se leería como una medición que no existe.
 */
function DocumentosCierreFila({ r, tr = TR_ES }: { r: ResumenDocumentosCierre; tr?: TrAgentes }) {
  const { t: tx } = tr;
  if (!r.usaCatalogo) return null;
  const faltan = r.faltantes.length;
  const porRevisar = r.conProblemaDeCalidad.length;
  return (
    <p className="rv-cd__icono-linea" data-tono={faltan > 0 ? 'warn' : 'ok'} aria-label={tx('rest.documentos_de_cierre')}>
      <Icono icono={faltan > 0 ? FileWarning : FileCheck2} tam={14} />
      <span>{ricoT(tx('rest.e0_documentos_de_cierre_e0'), { e0: (c) => <span className="rv-cd__medio">{c}</span> })}{' '}<span className="rv-ag-num">{numero(r.recibidos)}</span> de <span className="rv-ag-num">{numero(r.total)}</span> recibidos
        {faltan > 0 && <>{tx('rest.faltan')}{' '}{r.faltantes.map((f) => f.nombreSolicitado).join(', ')}</>}
        {porRevisar > 0 && <span> · {numero(porRevisar)} {porRevisar === 1 ? tx('rest.con_foto_por_revisar_calidad') : tx('rest.con_fotos_por_revisar_calidad')}</span>}
      </span>
    </p>
  );
}

function ResumenEstancia({ e, tr = TR_ES }: { e: Estancia; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const texto = e.fase === 'cerrada' ? `${minutos(e.minutos ?? 0)} (cerrada)`
    : e.fase === 'en_curso' ? tx('rest.y_sigue_en_el_anden', { minutos: minutos(e.minutos ?? 0) })
      : e.fase === 'incoherente' ? 'horas incoherentes' : e.fase === 'sin_llegada' ? 'sin llegada registrada' : 'sin salida registrada';
  return <span>{e.lugar === 'carga' ? tx('rest.en_carga') : tx('rest.en_descarga')}: <span className="rv-ag-num">{texto}</span></span>;
}

export function TarjetaViaje({ f, puedeActuar, accion, accionSitios, sitios, sitiosHayMas = false, tr = TR_ES }: {
  f: FilaTablero; puedeActuar: boolean; accion: AccionOficinaServidor; accionSitios: AccionOficinaServidor; sitios: OpcionSitio[]; sitiosHayMas?: boolean; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const v = f.viaje;
  return (
    <li className="rv-cd__viaje" aria-label={`Viaje ${v.folio ?? tx('cobranza.vista.sin_folio_2')}`}>
      <div className="rv-cd__semaforo-linea">
        <PuntoSemaforo s={f.semaforo} tr={tr} />
        <span className="rv-cd__medio">{v.folio ?? tx('cobranza.vista.sin_folio_2')}</span>
        {esFolioSimulado(v.folio) && <EtiquetaSimulado />}
        <span className="rv-cd__nota">{v.operadorNombre ?? tx('conductores.vista.sin_operador')}</span>
        <span className="rv-cd__nota" data-tono="faint">
          {[v.terminalNombre, v.clienteNombre].filter(Boolean).join(' · ')}
        </span>
        <span className="rv-cd__nota rv-cd__fin">{v.origen ?? '—'} → {v.destino ?? '—'}</span>
      </div>
      <p className="rv-cd__nota">{f.motivo}</p>
      {v.operadorSinTelefono === true && (
        <p role="note" className="rv-cd__icono-linea" data-tono="warn">
          <Icono icono={CircleAlert} tam={14} />{textoSinTelefono(tx)}
        </p>
      )}
      <p className="rv-cd__icono-linea" data-tono={f.ubicacion.obsoleta ? 'warn' : 'muted'}>
        <Icono icono={f.ubicacion.fuente === 'sin_dato' ? MapPinOff : MapPin} tam={14} />
        {f.ubicacion.texto}
      </p>
      {f.transito && (
        <p className="rv-cd__icono-linea" data-tono="muted" aria-label={tx('rest.transito')}>
          <Icono icono={Flag} tam={14} />
          <span>{ricoT(tx('rest.e0_transito_e0'), { e0: (c) => <span className="rv-cd__medio">{c}</span> })}{' '}{f.transito.texto}</span>
        </p>
      )}
      {f.salidaTms && (
        <p className="rv-cd__icono-linea" data-tono={f.salidaTms.estado === 'discrepancia' ? 'warn' : 'muted'} aria-label={tx('rest.salida_del_tms')}>
          <Icono icono={Flag} tam={14} />
          {f.salidaTms.texto}
        </p>
      )}
      {(f.sitioCarga || f.sitioDescarga) ? (
        <p className="rv-cd__micro">{tx('rest.se_valida_contra')}{' '}{f.sitioCarga ?? tx('rest.carga_sin_sitio_asignado')} → {f.sitioDescarga ?? tx('rest.descarga_sin_sitio_asignado')}</p>
      ) : (
        <p className="rv-cd__micro">{tx('rest.sin_sitios_asignados_las_llegadas_de')}</p>
      )}
      {f.documentosCierre && <DocumentosCierreFila tr={tr} r={f.documentosCierre} />}
      {puedeActuar && <FormaAsignarSitios accion={accionSitios} viajeId={v.id} sitios={sitios} hayMas={sitiosHayMas} />}
      <ol className="rv-cd__hitos">
        {f.hitos.map((h) => <CeldaHito tr={tr} key={h.id} h={h} puedeActuar={puedeActuar} accion={accion} viajeId={v.id} />)}
      </ol>
      {f.estancias.length > 0 && (
        <p className="rv-cd__linea rv-cd__nota">
          {f.estancias.map((e) => <ResumenEstancia tr={tr} key={e.lugar} e={e} />)}
        </p>
      )}
    </li>
  );
}

/**
 * Los episodios de «sin señal de vida» del periodo (nota S de la re-auditoría): cada uno con su cadena de avisos y cómo terminó.
 * `null` = no se pudo leer (se dice, no se pinta un cero); `[]` = ninguno en el periodo.
 */
export function EpisodiosSenalVida({ episodios, dias, hayMas, tr = TR_ES }: { episodios: EpisodioVista[] | null; dias: number; hayMas?: boolean; tr?: TrAgentes }) {
  const { t: tx } = tr;
  return (
    <Tarjeta titulo={tx('rest.sin_senal_de_vida')} info="conductores_tablero.sin_senal"
      estado={episodios === null ? 'error' : episodios.length === 0 ? 'vacio' : 'ok'}
      mensaje={episodios === null ? tx('rest.no_se_pudieron_leer_los_episodios') : tx('rest.ningun_episodio_sin_senal')}
      detalle={tx(dias === 1 ? 'rest.ningun_tractor_sin_senal_ultimos_dias.uno' : 'rest.ningun_tractor_sin_senal_ultimos_dias.otros', { n: dias })}>
      {episodios !== null && (
        <ul className="rv-cd__lista">
          {episodios.map((e) => (
            <li key={e.id} className="rv-cd__bloque" data-urgente={e.urgente || undefined}>
              <div className="rv-cd__linea">
                <span className="rv-cd__medio">{e.folio}</span>
                <span className="rv-cd__muted">{e.chofer}</span>
                <StatusChip tono="muted">{e.motivo}</StatusChip>
                <span className="rv-ag-num rv-cd__micro">desde {fechaHoraMx(e.abiertoEn)}</span>
                <StatusChip tono={e.urgente ? 'bad' : e.abierto ? 'warn' : 'ok'}>{e.abierto ? tx('rest.abierto') : tx('rest.cerrado')}</StatusChip>
              </div>
              <div>{e.estado}</div>
              {e.pasos.length > 0 && (
                <ol className="rv-cd__linea rv-cd__micro" data-tono="muted">
                  {e.pasos.map((p) => <li key={p.texto}>{p.texto} · <span className="rv-ag-num">{fechaHoraMx(p.en)}</span></li>)}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
      {hayMas && <p className="rv-cd__micro">{tx('rest.hay_mas_episodios_en_el_periodo')}</p>}
    </Tarjeta>
  );
}

/**
 * T-A5-63: cuántas veces y cuántos minutos cada cliente reubicó a los choferes (otra rampa u otro edificio), con el CSV para disputar
 * un «no se presentó». «Sin dato» no es cero: un cliente sin respuestas del chofer no se pinta como 0 reubicaciones.
 */
export function ReubicacionesPorCliente({ filas, csv, tr = TR_ES }: { filas: ReubicacionesCliente[]; csv: string; tr?: TrAgentes }) {
  const { t: tx } = tr;
  const hayCsv = filas.some((f) => f.viajesConDato > 0);
  return (
    <Tarjeta titulo={tx('rest.reubicaciones_por_cliente')} info="conductores_tablero.reubicaciones" estado={filas.length === 0 ? 'vacio' : 'ok'}
      mensaje={tx('rest.sin_llegadas_con_reporte')} detalle={tx('rest.aun_no_hay_llegadas_con_reporte')}
      acciones={hayCsv ? (
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="reubicaciones-por-cliente.csv" className="rv-cd__enlace">{tx('rest.descargar_evidencia_csv')}</a>
      ) : undefined}>
      <div className="rv-cd__pila">
        <ul className="rv-cd__lista">
          {filas.map((f) => (
            <li key={f.clienteId ?? 'sin-cliente'} className="rv-cd__bloque">
              <div className="rv-cd__linea">
                <span className="rv-cd__medio">{f.clienteNombre}</span>
                {f.viajesConDato === 0 ? (
                  <span className="rv-cd__muted">{tx('rest.sin_dato_2', { numero: numero(f.viajes) })}{' '}{f.viajes === 1 ? 'viaje' : 'viajes'}{' '}{tx('rest.sin_respuesta_del_chofer')}</span>
                ) : (
                  <>
                    <span><span className="rv-ag-num">{numero(f.reubicaciones ?? 0)}</span> {f.reubicaciones === 1 ? tx('rest.reubicacion') : 'reubicaciones'}</span>
                    <span><span className="rv-ag-num">{numero(f.minutos ?? 0)}</span> min</span>
                    <span className="rv-cd__muted">{tx('rest.en_de', { numero: numero(f.viajesReubicados ?? 0), numero2: numero(f.viajesConDato) })}{' '}{f.viajesConDato === 1 ? tx('rest.viaje_con_dato') : tx('rest.viajes_con_dato')}</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="rv-cd__micro">{tx('rest.los_minutos_van_del_primer_al')}</p>
      </div>
    </Tarjeta>
  );
}

export function TableroHitos({
  tablero, indicadores, dias, filtros, catalogos, ocultos, accionUrl, puedeActuar, accion, accionSitios, sitios, sitiosHayMas = false, episodios, hayMasEpisodios, tr = TR_ES,
}: {
  /** Episodios de «sin señal de vida» del periodo; `undefined` = esta vista no los trae (no se pinta la sección). */
  episodios?: EpisodioVista[] | null; hayMasEpisodios?: boolean;
  tablero: Tablero; indicadores: IndicadoresVista | null; dias: number; filtros: FiltrosVista; catalogos: CatalogosFiltro | null;
  ocultos: Record<string, string>; accionUrl: string; puedeActuar: boolean; accion: AccionOficinaServidor;
  /** Asignar el sitio de carga y de descarga de un viaje (misma firma que las demás acciones del tablero). */
  accionSitios: AccionOficinaServidor; sitios: OpcionSitio[];
  /** A37-S13-03: el catálogo tiene más sitios activos de los que caben en el selector. */
  sitiosHayMas?: boolean; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  return (
    <>
      <IndicadoresHitos tr={tr} i={indicadores} dias={dias} />
      <Tarjeta titulo={tx('liquidacion.vista.viajes_en_curso')} info="conductores_tablero.viajes_en_curso" acciones={
        <span className="rv-cd__linea">
          {ORDEN_SEMAFORO.map((s) => (
            <span key={s} className="rv-cd__linea">
              <PuntoSemaforo s={s} tr={tr} /><span className="rv-ag-num rv-cd__muted">{numero(tablero.conteos[s])}</span>
            </span>
          ))}
        </span>
      }>
        <div className="rv-cd__pila">
          <FiltrosTablero tr={tr} f={filtros} catalogos={catalogos} ocultos={ocultos} accionUrl={accionUrl} />
          {tablero.sinGps && (
            <p role="note" className="rv-cd__icono-linea" data-tono="warn">
              <Icono icono={MapPinOff} tam={14} />{textoSinGps(tx)}
            </p>
          )}
          {tablero.hayMas && (
            <p className="rv-cd__nota" data-tono="warn">{tx('rest.hay_mas_viajes_en_curso_de')}</p>
          )}
        </div>
      </Tarjeta>
      <ColaExcepciones tr={tr} excepciones={tablero.excepciones} puedeActuar={puedeActuar} accion={accion} />
      {tablero.reubicaciones && <ReubicacionesPorCliente tr={tr} filas={tablero.reubicaciones.porCliente} csv={tablero.reubicaciones.csv} />}
      {episodios !== undefined && <EpisodiosSenalVida tr={tr} episodios={episodios} dias={dias} hayMas={hayMasEpisodios} />}
      {tablero.filas.length === 0 ? (
        <p className="rv-cd__icono-linea" data-tono="muted">
          <Icono icono={CircleAlert} tam={14} />
          {filtros.terminalId || filtros.clienteId || filtros.operadorId || filtros.semaforo
            ? tx('rest.ningun_viaje_en_curso_cumple_esos')
            : textoSinViajes(tx)}
        </p>
      ) : (
        <ul className="rv-cd__viajes">
          {tablero.filas.map((f) => <TarjetaViaje tr={tr} key={f.viaje.id} f={f} puedeActuar={puedeActuar} accion={accion} accionSitios={accionSitios} sitios={sitios} sitiosHayMas={sitiosHayMas} />)}
        </ul>
      )}
    </>
  );
}
