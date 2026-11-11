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

const SEMAFORO: Record<Semaforo, { etiqueta: string; tono: TonoEstado }> = {
  sin_reporte: { etiqueta: 'Sin reporte', tono: 'bad' },
  atrasado: { etiqueta: 'Atrasado', tono: 'warn' },
  a_tiempo: { etiqueta: 'A tiempo', tono: 'ok' },
  sin_ancla: { etiqueta: 'Sin ancla', tono: 'muted' },
  completo: { etiqueta: 'Completo', tono: 'neutral' },
};
export const ORDEN_SEMAFORO: Semaforo[] = ['sin_reporte', 'atrasado', 'a_tiempo', 'sin_ancla', 'completo'];

const EXCEPCION: Record<TipoExcepcion, string> = {
  escalado_sin_atender: 'Escalado sin atender', sin_reporte: 'Sin reporte', atrasado: 'Atrasado', sin_coincidencia: 'Ubicación sin coincidencia',
  llegada_sin_confirmar: 'Llegada sin confirmar', llegada_sin_sitio: 'Llegada sin sitio para conciliar',
  estadia_excedida: 'Estadía excedida', horas_incoherentes: 'Horas incoherentes', sin_a_quien_escalar: 'Sin a quién escalar', patio_entrega_distinto: 'Patio de entrega distinto',
  pendiente_cruce_largo: 'Pendiente de cruce por mucho tiempo', salida_tms_discrepante: 'Salida del TMS sin confirmar', local_abierto_sin_ccp: 'Sin Carta Porte (viaje local abierto)', sin_ruta_autorizada: 'Sin ruta autorizada',
};
const GRAVEDAD: Record<1 | 2 | 3, string> = { 3: 'Urgente', 2: 'Revisar', 1: 'Vigilar' };

/** T-A5-26: rótulo de los datos de demostración del seed. Nunca se mezclan con reales sin decirlo. */
export function EtiquetaSimulado() {
  return <span className="rv-cd__simulado">SIMULADO</span>;
}

export function PuntoSemaforo({ s }: { s: Semaforo }) {
  const c = SEMAFORO[s];
  return <StatusChip tono={c.tono}>{c.etiqueta}</StatusChip>;
}


/** T-A5-26: textos exactos de los estados vacíos y de falta, en lenguaje llano. */
export const TEXTO_SIN_VIAJES = 'Todavía no hay viajes en seguimiento. Marca operadores en Configuración y sube sus viajes.';
export const TEXTO_SIN_GPS = 'Sin GPS conectado: las llegadas por geocerca no están activas (se siguen pidiendo por WhatsApp).';
export const TEXTO_SIN_TELEFONO = 'Este operador no tiene teléfono: no se le puede escribir; se avisará al jefe.';

const minutos = (m: number): string => (m < 60 ? `${numero(Math.round(m))} min` : textoTiempo(m));

export function IndicadoresHitos({ i, dias }: { i: IndicadoresVista | null; dias: number }) {
  if (i === null) {
    return <p className="rv-cd__nota">No se pudieron calcular los indicadores ahora mismo.</p>;
  }
  return (
    <div>
      <TiraCifras sello={selloHoy('Viajes de la flota')}>
        <Cifra etiqueta="Hitos reportados sin insistencia" info="conductores_tablero.sin_insistencia"
          valor={i.tasaSinInsistencia === null ? null : porcentaje(i.tasaSinInsistencia * 100, 0)}
          nota={i.recibidos === 0 ? 'ningún hito recibido en el periodo' : `de ${numero(i.recibidos)} hitos; a lo más un mensaje del agente`} />
        <Cifra etiqueta="Tiempo medio de respuesta" info="conductores_tablero.tiempo_respuesta"
          valor={i.minutosRespuestaPromedio === null ? null : minutos(i.minutosRespuestaPromedio)}
          nota={i.conRespuestaMedida === 0 ? 'ninguna solicitud con respuesta medible' : `sobre ${numero(i.conRespuestaMedida)} solicitudes contestadas`} />
        <Cifra etiqueta="Hitos escalados" info="conductores_tablero.escalados" valor={numero(i.escalados)} tono={i.escalados > 0 ? 'warn' : undefined} nota="agotaron la escalera de recordatorios" />
        <Cifra etiqueta="Validados con ubicación" info="conductores_tablero.validados_ubicacion" valor={numero(i.validadosUbicacion)}
          nota={i.sinCoincidencia > 0 ? `${numero(i.sinCoincidencia)} sin coincidencia por revisar` : 'pin o GPS dentro del sitio'} />
        <Cifra etiqueta="Validación en modo degradado" info="conductores_tablero.validacion_degradada" valor={i.tasaValidacionDegradada === null ? null : porcentaje(i.tasaValidacionDegradada * 100, 0)}
          tono={i.tasaValidacionDegradada !== null && i.tasaValidacionDegradada > 0 ? 'warn' : undefined}
          nota={i.llegadasValidables === 0 ? 'ninguna llegada validable en el periodo' : `${numero(i.validacionDegradada)} de ${numero(i.llegadasValidables)} llegadas: sin geocerca o solo con el pin del chofer (sin GPS real)`} />
      </TiraCifras>
      <p className="rv-cd__micro">
        Hitos con actividad en los últimos {dias} {dias === 1 ? 'día' : 'días'}, con los mismos filtros de abajo.
        {i.capturadosOficina > 0 ? ` ${numero(i.capturadosOficina)} los capturó la oficina a mano.` : ''}
        {i.omitidos > 0 ? ` ${numero(i.omitidos)} se dieron por omitidos (el chofer avisó el siguiente).` : ''}
      </p>
    </div>
  );
}

export function FiltrosTablero({ f, catalogos, ocultos, accionUrl }: {
  f: FiltrosVista; catalogos: CatalogosFiltro | null; ocultos: Record<string, string>; accionUrl: string;
}) {
  const todos = { valor: '', rotulo: 'Todos' };
  const hay = Boolean(f.terminalId || f.clienteId || f.operadorId || f.semaforo);
  return (
    <BarraFiltros accion={accionUrl} ocultos={ocultos} etiqueta="Filtros del tablero" nActivos={hay ? 1 : 0}
      limpiarHref={accionUrl + (Object.keys(ocultos).length ? `?${new URLSearchParams(ocultos).toString()}` : '')}>
      <FiltroOpciones nombre="terminal" etiqueta="Patio" valor={f.terminalId} opciones={[todos, ...(catalogos?.terminales ?? []).map((t) => ({ valor: t.id, rotulo: t.nombre }))]} />
      <FiltroOpciones nombre="cliente" etiqueta="Cliente" valor={f.clienteId} opciones={[todos, ...(catalogos?.clientes ?? []).map((c) => ({ valor: c.id, rotulo: c.nombre }))]} />
      <FiltroOpciones nombre="chofer" etiqueta="Chofer" valor={f.operadorId} opciones={[todos, ...(catalogos?.operadores ?? []).map((o) => ({ valor: o.id, rotulo: o.nombre }))]} />
      <FiltroOpciones nombre="semaforo" etiqueta="Semáforo" valor={f.semaforo} opciones={[todos, ...ORDEN_SEMAFORO.map((s) => ({ valor: s, rotulo: SEMAFORO[s].etiqueta }))]} />
      <FiltroOpciones nombre="dias" etiqueta="Indicadores de" valor={String(f.dias)} porDefecto="7"
        opciones={[{ valor: '1', rotulo: 'Último día' }, { valor: '7', rotulo: 'Últimos 7 días' }, { valor: '30', rotulo: 'Últimos 30 días' }]} />
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

export function ColaExcepciones({ excepciones, puedeActuar, accion }: { excepciones: Excepcion[]; puedeActuar: boolean; accion: AccionOficinaServidor }) {
  return (
    <Tarjeta titulo="Cola de excepciones" info="conductores_tablero.excepciones" estado={excepciones.length === 0 ? 'vacio' : 'ok'}
      mensaje="Nada pendiente" detalle="Nada pendiente: ningún hito escalado, atrasado ni sin coincidencia en los viajes que se listan.">
      <p className="rv-cd__micro">Lo que pide una decisión tuya, lo más urgente primero.</p>
      <ul className="rv-cd__lista">
        {excepciones.slice(0, 50).map((e, i) => (
          <li key={`${e.viajeId}-${e.tipo}-${e.hitoId ?? i}`} className="rv-cd__item">
            <div className="rv-cd__linea">
              <span className="rv-cd__grav" data-g={e.gravedad}>{GRAVEDAD[e.gravedad]}</span>
              <span className="rv-cd__medio">{EXCEPCION[e.tipo]}</span>
              <span className="rv-cd__medio">{e.folio ?? 'viaje sin folio'}</span>
              {e.desde && <span className="rv-cd__micro rv-cd__fin">desde {fechaHoraMx(e.desde)}</span>}
            </div>
            <p className="rv-cd__nota">{e.texto}</p>
            {puedeActuar && <AccionesHito accion={accion} modos={modosDeExcepcion(e)} hitoId={e.hitoId} viajeId={e.viajeId} />}
          </li>
        ))}
      </ul>
      {excepciones.length > 50 && (
        <p className="rv-cd__micro">Se muestran las 50 más urgentes de {numero(excepciones.length)}.</p>
      )}
    </Tarjeta>
  );
}

const FOTO_TEXTO: Record<string, string> = { sello: 'sello', anden: 'andén', recibido: 'recibido', otra: 'foto' };
const FUENTE_TEXTO: Record<string, string> = { texto: 'texto', boton: 'botón', ubicacion: 'ubicación', foto: 'foto', sistema: 'sistema', oficina: 'oficina' };

/**
 * R10-8: por qué se ve «omitido». Antes TODO omitido decía «avisó el siguiente», incluso el hito escalado que cerró el barrido de viajes
 * abiertos hace más de 30 días (`viaje_abierto_vencido`): la oficina creía que el chofer había avisado el siguiente y nadie lo capturó.
 */
function textoOmitido(h: HitoVista): string {
  if (h.omitidoMotivo === 'viaje_abierto_vencido') {
    return `cerrado sin reporte: el viaje lleva más de 30 días abierto${h.escaladoEn ? ' y ya se había escalado' : ''} · captúralo a mano si hace falta`;
  }
  return 'omitido (avisó el siguiente)';
}

function CeldaHito({ h, puedeActuar, accion, viajeId }: { h: HitoVista; puedeActuar: boolean; accion: AccionOficinaServidor; viajeId: string }) {
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
        <div className="cifra-mono" title="Hora del mensaje del chofer (no del evento físico)">{fechaHoraMx(h.horaMensaje)}</div>
      ) : (
        <div className="rv-cd__faint">
          {h.estado === 'omitido' ? textoOmitido(h) : h.estado === 'escalado' ? `escalado${h.atendidaEn ? ' · atendido' : ''}` : h.tocaDesde ? `toca desde ${fechaHoraMx(h.tocaDesde)}` : 'pendiente'}
        </div>
      )}
      {resuelto && (
        <div className="rv-cd__linea rv-cd__micro" data-tono="muted">
          {h.fuente && <span>vía {FUENTE_TEXTO[h.fuente] ?? 'otro medio'}</span>}
          {h.validadoPor && <span data-tono="ok" className="rv-cd__micro">validado ({h.validadoPor === 'gps' ? 'ubicación' : h.validadoPor === 'oficina' ? 'oficina' : 'sistema'})</span>}
          {h.fotos.map((f) => (
            <a key={f.id} href={`/api/v1/evidencias/${f.id}`} target="_blank" rel="noopener noreferrer" className="rv-cd__foto" data-alerta={f.reusoTenant || undefined}
              title={f.reusoTenant ? 'Abrir la foto (el enlace dura 10 minutos) — ALERTA: esta misma foto ya se usó como evidencia de OTRO viaje/hito de la flota. Revísala.' : 'Abrir la foto (el enlace dura 10 minutos)'}>
              <Icono icono={Camera} tam={14} />{FOTO_TEXTO[f.tipo]}
              {f.reusoTenant && <Icono icono={CircleAlert} tam={14} />}
            </a>
          ))}
        </div>
      )}
      {h.contacto && <div className="rv-cd__micro" data-tono="muted">Lo atiende {h.contacto}</div>}
      {h.sinContacto && <div className="rv-cd__micro">sin contacto en andén</div>}
      {h.reporte?.rampa && <div className="rv-cd__micro" data-tono="muted">{h.reporte.rampa}</div>}
      {h.reporte && h.reporte.reubicaciones > 0 && (
        <Disclosure titulo={h.reporte.reubicaciones === 1 ? '1 cambio de rampa o contacto' : `${h.reporte.reubicaciones} cambios de rampa o contacto`} variante="linea">
          <ol className="rv-cd__lista">
            {h.reporte.historial.map((r) => <li key={r.en} className="rv-cd__micro" data-tono="muted"><span className="cifra-mono">{fechaHoraMx(r.en)}</span> · {r.rampa ?? 'sin rampa registrada'}</li>)}
          </ol>
        </Disclosure>
      )}
      {h.validacion && h.validacion.resultado !== 'sin_dato' && (
        <div className="rv-cd__icono-linea rv-cd__micro" data-tono={h.validacion.resultado === 'validado' ? 'ok' : 'warn'} title={h.validacion.texto}>
          <Icono icono={h.validacion.resultado === 'validado' ? MapPin : MapPinOff} tam={14} />
          <span>{h.validacion.resultado === 'validado' ? `en el sitio (${numero(h.validacion.distanciaM ?? 0)} m)` : `fuera del sitio (${numero(h.validacion.distanciaM ?? 0)} m)`}</span>
        </div>
      )}
      {h.validacion?.resultado === 'sin_dato' && <div className="rv-cd__micro">ubicación sin dato</div>}
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
function DocumentosCierreFila({ r }: { r: ResumenDocumentosCierre }) {
  if (!r.usaCatalogo) return null;
  const faltan = r.faltantes.length;
  const porRevisar = r.conProblemaDeCalidad.length;
  return (
    <p className="rv-cd__icono-linea" data-tono={faltan > 0 ? 'warn' : 'ok'} aria-label="Documentos de cierre">
      <Icono icono={faltan > 0 ? FileWarning : FileCheck2} tam={14} />
      <span>
        <span className="rv-cd__medio">Documentos de cierre:</span>{' '}
        <span className="cifra-mono">{numero(r.recibidos)}</span> de <span className="cifra-mono">{numero(r.total)}</span> recibidos
        {faltan > 0 && <> · faltan: {r.faltantes.map((f) => f.nombreSolicitado).join(', ')}</>}
        {porRevisar > 0 && <span> · {numero(porRevisar)} {porRevisar === 1 ? 'con foto por revisar (calidad)' : 'con fotos por revisar (calidad)'}</span>}
      </span>
    </p>
  );
}

function ResumenEstancia({ e }: { e: Estancia }) {
  const texto = e.fase === 'cerrada' ? `${minutos(e.minutos ?? 0)} (cerrada)`
    : e.fase === 'en_curso' ? `${minutos(e.minutos ?? 0)} y sigue en el andén`
      : e.fase === 'incoherente' ? 'horas incoherentes' : e.fase === 'sin_llegada' ? 'sin llegada registrada' : 'sin salida registrada';
  return <span>{e.lugar === 'carga' ? 'En carga' : 'En descarga'}: <span className="cifra-mono">{texto}</span></span>;
}

export function TarjetaViaje({ f, puedeActuar, accion, accionSitios, sitios, sitiosHayMas = false }: {
  f: FilaTablero; puedeActuar: boolean; accion: AccionOficinaServidor; accionSitios: AccionOficinaServidor; sitios: OpcionSitio[]; sitiosHayMas?: boolean;
}) {
  const v = f.viaje;
  return (
    <li className="rv-cd__viaje" aria-label={`Viaje ${v.folio ?? 'sin folio'}`}>
      <div className="rv-cd__semaforo-linea">
        <PuntoSemaforo s={f.semaforo} />
        <span className="rv-cd__medio">{v.folio ?? 'sin folio'}</span>
        {esFolioSimulado(v.folio) && <EtiquetaSimulado />}
        <span className="rv-cd__nota">{v.operadorNombre ?? 'Sin operador'}</span>
        <span className="rv-cd__nota" data-tono="faint">
          {[v.terminalNombre, v.clienteNombre].filter(Boolean).join(' · ')}
        </span>
        <span className="rv-cd__nota rv-cd__fin">{v.origen ?? '—'} → {v.destino ?? '—'}</span>
      </div>
      <p className="rv-cd__nota">{f.motivo}</p>
      {v.operadorSinTelefono === true && (
        <p role="note" className="rv-cd__icono-linea" data-tono="warn">
          <Icono icono={CircleAlert} tam={14} />{TEXTO_SIN_TELEFONO}
        </p>
      )}
      <p className="rv-cd__icono-linea" data-tono={f.ubicacion.obsoleta ? 'warn' : 'muted'}>
        <Icono icono={f.ubicacion.fuente === 'sin_dato' ? MapPinOff : MapPin} tam={14} />
        {f.ubicacion.texto}
      </p>
      {f.transito && (
        <p className="rv-cd__icono-linea" data-tono="muted" aria-label="Tránsito">
          <Icono icono={Flag} tam={14} />
          <span><span className="rv-cd__medio">Tránsito:</span> {f.transito.texto}</span>
        </p>
      )}
      {f.salidaTms && (
        <p className="rv-cd__icono-linea" data-tono={f.salidaTms.estado === 'discrepancia' ? 'warn' : 'muted'} aria-label="Salida del TMS">
          <Icono icono={Flag} tam={14} />
          {f.salidaTms.texto}
        </p>
      )}
      {(f.sitioCarga || f.sitioDescarga) ? (
        <p className="rv-cd__micro">Se valida contra: {f.sitioCarga ?? 'carga sin sitio asignado'} → {f.sitioDescarga ?? 'descarga sin sitio asignado'}</p>
      ) : (
        <p className="rv-cd__micro">Sin sitios asignados: las llegadas de este viaje no se pueden validar contra la ubicación.</p>
      )}
      {f.documentosCierre && <DocumentosCierreFila r={f.documentosCierre} />}
      {puedeActuar && <FormaAsignarSitios accion={accionSitios} viajeId={v.id} sitios={sitios} hayMas={sitiosHayMas} />}
      <ol className="rv-cd__hitos">
        {f.hitos.map((h) => <CeldaHito key={h.id} h={h} puedeActuar={puedeActuar} accion={accion} viajeId={v.id} />)}
      </ol>
      {f.estancias.length > 0 && (
        <p className="rv-cd__linea rv-cd__nota">
          {f.estancias.map((e) => <ResumenEstancia key={e.lugar} e={e} />)}
        </p>
      )}
    </li>
  );
}

/**
 * Los episodios de «sin señal de vida» del periodo (nota S de la re-auditoría): cada uno con su cadena de avisos y cómo terminó.
 * `null` = no se pudo leer (se dice, no se pinta un cero); `[]` = ninguno en el periodo.
 */
export function EpisodiosSenalVida({ episodios, dias, hayMas }: { episodios: EpisodioVista[] | null; dias: number; hayMas?: boolean }) {
  return (
    <Tarjeta titulo="Sin señal de vida" info="conductores_tablero.sin_senal"
      estado={episodios === null ? 'error' : episodios.length === 0 ? 'vacio' : 'ok'}
      mensaje={episodios === null ? 'No se pudieron leer los episodios ahora mismo.' : 'Ningún episodio sin señal'}
      detalle={`Ningún tractor quedó sin señal de vida en los últimos ${dias} ${dias === 1 ? 'día' : 'días'} (o la flota no tiene encendido este aviso: se enciende en la configuración del Conductor).`}>
      {episodios !== null && (
        <ul className="rv-cd__lista">
          {episodios.map((e) => (
            <li key={e.id} className="rv-cd__bloque" data-urgente={e.urgente || undefined}>
              <div className="rv-cd__linea">
                <span className="rv-cd__medio">{e.folio}</span>
                <span className="rv-cd__muted">{e.chofer}</span>
                <StatusChip tono="muted">{e.motivo}</StatusChip>
                <span className="cifra-mono rv-cd__micro">desde {fechaHoraMx(e.abiertoEn)}</span>
                <StatusChip tono={e.urgente ? 'bad' : e.abierto ? 'warn' : 'ok'}>{e.abierto ? 'Abierto' : 'Cerrado'}</StatusChip>
              </div>
              <div>{e.estado}</div>
              {e.pasos.length > 0 && (
                <ol className="rv-cd__linea rv-cd__micro" data-tono="muted">
                  {e.pasos.map((p) => <li key={p.texto}>{p.texto} · <span className="cifra-mono">{fechaHoraMx(p.en)}</span></li>)}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
      {hayMas && <p className="rv-cd__micro">Hay más episodios en el periodo de los que se listan: se muestran los más recientes.</p>}
    </Tarjeta>
  );
}

/**
 * T-A5-63: cuántas veces y cuántos minutos cada cliente reubicó a los choferes (otra rampa u otro edificio), con el CSV para disputar
 * un «no se presentó». «Sin dato» no es cero: un cliente sin respuestas del chofer no se pinta como 0 reubicaciones.
 */
export function ReubicacionesPorCliente({ filas, csv }: { filas: ReubicacionesCliente[]; csv: string }) {
  const hayCsv = filas.some((f) => f.viajesConDato > 0);
  return (
    <Tarjeta titulo="Reubicaciones por cliente" info="conductores_tablero.reubicaciones" estado={filas.length === 0 ? 'vacio' : 'ok'}
      mensaje="Sin llegadas con reporte" detalle="Aún no hay llegadas con reporte del chofer en los viajes en curso."
      acciones={hayCsv ? (
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="reubicaciones-por-cliente.csv" className="rv-cd__enlace">
          Descargar evidencia (CSV)
        </a>
      ) : undefined}>
      <div className="rv-cd__pila">
        <ul className="rv-cd__lista">
          {filas.map((f) => (
            <li key={f.clienteId ?? 'sin-cliente'} className="rv-cd__bloque">
              <div className="rv-cd__linea">
                <span className="rv-cd__medio">{f.clienteNombre}</span>
                {f.viajesConDato === 0 ? (
                  <span className="rv-cd__muted">Sin dato ({numero(f.viajes)} {f.viajes === 1 ? 'viaje' : 'viajes'} sin respuesta del chofer)</span>
                ) : (
                  <>
                    <span><span className="cifra-mono">{numero(f.reubicaciones ?? 0)}</span> {f.reubicaciones === 1 ? 'reubicación' : 'reubicaciones'}</span>
                    <span><span className="cifra-mono">{numero(f.minutos ?? 0)}</span> min</span>
                    <span className="rv-cd__muted">en {numero(f.viajesReubicados ?? 0)} de {numero(f.viajesConDato)} {f.viajesConDato === 1 ? 'viaje con dato' : 'viajes con dato'}</span>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="rv-cd__micro">Los minutos van del primer al último cambio registrado: es lo que se puede probar con horas guardadas, no el tiempo total de espera.</p>
      </div>
    </Tarjeta>
  );
}

export function TableroHitos({
  tablero, indicadores, dias, filtros, catalogos, ocultos, accionUrl, puedeActuar, accion, accionSitios, sitios, sitiosHayMas = false, episodios, hayMasEpisodios,
}: {
  /** Episodios de «sin señal de vida» del periodo; `undefined` = esta vista no los trae (no se pinta la sección). */
  episodios?: EpisodioVista[] | null; hayMasEpisodios?: boolean;
  tablero: Tablero; indicadores: IndicadoresVista | null; dias: number; filtros: FiltrosVista; catalogos: CatalogosFiltro | null;
  ocultos: Record<string, string>; accionUrl: string; puedeActuar: boolean; accion: AccionOficinaServidor;
  /** Asignar el sitio de carga y de descarga de un viaje (misma firma que las demás acciones del tablero). */
  accionSitios: AccionOficinaServidor; sitios: OpcionSitio[];
  /** A37-S13-03: el catálogo tiene más sitios activos de los que caben en el selector. */
  sitiosHayMas?: boolean;
}) {
  return (
    <>
      <IndicadoresHitos i={indicadores} dias={dias} />
      <Tarjeta titulo="Viajes en curso" info="conductores_tablero.viajes_en_curso" acciones={
        <span className="rv-cd__linea">
          {ORDEN_SEMAFORO.map((s) => (
            <span key={s} className="rv-cd__linea">
              <PuntoSemaforo s={s} /><span className="cifra-mono rv-cd__muted">{numero(tablero.conteos[s])}</span>
            </span>
          ))}
        </span>
      }>
        <div className="rv-cd__pila">
          <FiltrosTablero f={filtros} catalogos={catalogos} ocultos={ocultos} accionUrl={accionUrl} />
          {tablero.sinGps && (
            <p role="note" className="rv-cd__icono-linea" data-tono="warn">
              <Icono icono={MapPinOff} tam={14} />{TEXTO_SIN_GPS}
            </p>
          )}
          {tablero.hayMas && (
            <p className="rv-cd__nota" data-tono="warn">
              Hay más viajes en curso de los que este tablero lista: usa los filtros (patio, cliente o chofer) para ver el resto.
            </p>
          )}
        </div>
      </Tarjeta>
      <ColaExcepciones excepciones={tablero.excepciones} puedeActuar={puedeActuar} accion={accion} />
      {tablero.reubicaciones && <ReubicacionesPorCliente filas={tablero.reubicaciones.porCliente} csv={tablero.reubicaciones.csv} />}
      {episodios !== undefined && <EpisodiosSenalVida episodios={episodios} dias={dias} hayMas={hayMasEpisodios} />}
      {tablero.filas.length === 0 ? (
        <p className="rv-cd__icono-linea" data-tono="muted">
          <Icono icono={CircleAlert} tam={14} />
          {filtros.terminalId || filtros.clienteId || filtros.operadorId || filtros.semaforo
            ? 'Ningún viaje en curso cumple esos filtros.'
            : TEXTO_SIN_VIAJES}
        </p>
      ) : (
        <ul className="rv-cd__viajes">
          {tablero.filas.map((f) => <TarjetaViaje key={f.viaje.id} f={f} puedeActuar={puedeActuar} accion={accion} accionSitios={accionSitios} sitios={sitios} sitiosHayMas={sitiosHayMas} />)}
        </ul>
      )}
    </>
  );
}
