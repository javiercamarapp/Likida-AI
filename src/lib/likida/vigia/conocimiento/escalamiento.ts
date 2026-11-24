// ═══════════════════════════════════════════════════════════════════════════
// ESCALAMIENTO — los 30 disparadores consolidados de los grupos reales de transporte, como un evaluador puro.
//
// `evaluarEscalamiento(hilo, config)` mira un hilo (mensajes + hechos que el sistema ya conoce) y devuelve el nivel más alto que
// corresponde, los motivos (cada uno con su número de disparador) y a qué rol avisar. No envía nada, no guarda nada y NO sustituye a
// `vigia/escalamiento.ts` (la escalera con bitácora e idempotencia): es la lectura experta de «¿esto merece avisar a alguien?».
//
// Niveles: N1 = encargado de turno · N2 = gerencia de operación · N3 = dueño. Los umbrales son configuración (valores recomendados por
// omisión, a validar por el dueño). Ante la duda se escala: equivocarse hacia avisar cuesta segundos.
//
// Repregunta (anti-ruido): una ráfaga de 2-3 líneas escritas seguidas (≤ 2 min entre sí) cuenta como UN mensaje; repregunta =
// espera ≥ 10 min sin dato, o 3 mensajes del cliente en 30 min. Un acuse vacío del equipo («enterado», «reviso») NO cierra la espera.
// PURO: sin base, sin red, sin modelo.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizar } from '../entrada';
import { esRespuestaVacia } from '../respuesta_vacia';
import { detectarSolicitudes, detectarUrgencia, tiposDePeticion, type TipoSolicitud } from './taxonomia';
import type { NivelEta } from './politica_eta';

export type NivelEscalamiento = 'ninguno' | 'N1' | 'N2' | 'N3';
export type RolDestino =
  | 'encargado_turno' | 'gerencia_operacion' | 'dueno' | 'importacion_ccp' | 'cruces' | 'monitoreo' | 'control_equipo' | 'sistemas'
  | 'seguridad' | 'guardia_fin_de_semana';
export type Urgencia = 'I' | 'A' | 'M';

export interface MensajeHilo {
  de: 'cliente' | 'equipo';
  tsMs: number;
  texto: string;
  /** El mensaje del equipo trae el dato pedido. Si se omite se deduce: un acuse vacío no cuenta. */
  conDato?: boolean;
}

export interface Hilo {
  ahoraMs: number;
  mensajes: readonly MensajeHilo[];
  /** Tipos de solicitud del hilo; si se omite se deducen de los mensajes del cliente. */
  tipos?: readonly TipoSolicitud[];
  /** Minutos que faltan para la cita (negativo = ya pasó). */
  minutosParaCita?: number | null;
  llegoAPlanta?: boolean;
  /** ETA: nivel que pide `evaluarEta`. */
  etaNivel?: NivelEta;
  /** Hueco estructural de turno ya medido por `franjasConHueco`. */
  franja?: 'cambio_turno' | 'madrugada' | null;
  turnoCubierto?: boolean;
  finDeSemanaOFestivo?: boolean;
  operadorEsperandoMin?: number | null;
  operadorSinComerOSeRetira?: boolean;
  unidadDetenidaMin?: number | null;
  detenidaEnParadorAutorizado?: boolean;
  paradaNoAutorizada?: boolean;
  desvioDeRuta?: boolean;
  danoOIncidencia?: boolean;
  zonaDeRiesgoOHazmat?: boolean;
  rechazoDeCaja?: boolean;
  salidaSinAutorizacionOFotos?: boolean;
  /** Cambios de unidad/operador/caja en los últimos 60 min; y si ya había prealerta o QR. */
  cambiosDeUnidadEn60Min?: number;
  habiaPrealerta?: boolean;
  ccpMinSinTimbrar?: number | null;
  prealertaFaltanteEnCasetaMin?: number | null;
  faltantesBloqueantes?: boolean;
  cruceSinHitoConfirmado?: boolean;
  pendienteMasAntiguoDias?: number | null;
  podPedidoHaceHoras?: number | null;
  solicitanteNoAutorizado?: boolean;
}

export interface ConfigEscalamiento {
  repreguntaEsperaMin: number;
  repreguntaMensajes: number;
  repreguntaVentanaMin: number;
  /** Mensajes del cliente separados por menos de esto cuentan como uno. */
  rafagaUnMensajeMin: number;
  silencioCriticoMin: number;
  silencioMin: number;
  esperaPlantaN1Min: number;
  esperaPlantaN2Min: number;
  esperaPlantaN3Min: number;
  detenidaFueraDeParadorMin: number;
  detenidaCualquierMin: number;
  paradorMaximoMin: number;
  ccpSinTimbrarMin: number;
  prealertaFaltanteMin: number;
  faltantesN1MinParaCita: number;
  faltantesN2MinParaCita: number;
  pendienteAntiguoDiasN2: number;
  podReclamoHoras: number;
  cambiosUnidadN2: number;
}

export const CONFIG_ESCALAMIENTO_POR_OMISION: ConfigEscalamiento = Object.freeze({
  repreguntaEsperaMin: 10,
  repreguntaMensajes: 3,
  repreguntaVentanaMin: 30,
  rafagaUnMensajeMin: 2,
  silencioCriticoMin: 30,
  silencioMin: 60,
  esperaPlantaN1Min: 60,
  esperaPlantaN2Min: 300,
  esperaPlantaN3Min: 600,
  detenidaFueraDeParadorMin: 30,
  detenidaCualquierMin: 60,
  paradorMaximoMin: 45,
  ccpSinTimbrarMin: 60,
  prealertaFaltanteMin: 30,
  faltantesN1MinParaCita: 90,
  faltantesN2MinParaCita: 30,
  pendienteAntiguoDiasN2: 6,
  podReclamoHoras: 24,
  cambiosUnidadN2: 2,
});

export interface MotivoEscalamiento {
  /** Número del disparador (1-30). */
  disparador: number;
  codigo: string;
  nivel: Exclude<NivelEscalamiento, 'ninguno'>;
  /** Rol del nivel (encargado, gerencia, dueño) o la guardia de fin de semana. */
  rol: RolDestino;
  /** Ruta funcional que también debe enterarse (importación, cruces, monitoreo, control de equipo, sistemas, seguridad). */
  ruta: RolDestino | null;
  urgencia: Urgencia;
}

export interface ResultadoEscalamiento {
  nivel: NivelEscalamiento;
  motivos: MotivoEscalamiento[];
  /** Rol al que se avisa por el motivo de mayor nivel (y mayor urgencia). null si no hay motivos. */
  destinatarioRol: RolDestino | null;
  /** Roles funcionales adicionales a quienes también corresponde el aviso. */
  rutasFuncionales: RolDestino[];
  urgencia: Urgencia | null;
  /** El hilo en sí: minutos de espera sin dato y mensajes (colapsados) del cliente sin atender. */
  esperaMin: number;
  mensajesSinAtender: number;
}

const RANGO: Record<NivelEscalamiento, number> = { ninguno: 0, N1: 1, N2: 2, N3: 3 };
const URG: Record<Urgencia, number> = { I: 3, A: 2, M: 1 };
const FUNCIONALES: readonly RolDestino[] = ['importacion_ccp', 'cruces', 'monitoreo', 'control_equipo', 'sistemas', 'seguridad', 'guardia_fin_de_semana'];

const PRESION = /\b(cliente|clientes) (encima|presionando|molesto|escalando|enojado)\b|\bal cliente encima\b|\bme (estan|esta) presionando\b|\bya me escalaron\b|\bmi director\b|\bescalando\b/;
const AMENAZA = /\bse cancel\w{0,4} (el|todo el) proyecto\b|\bcancelar\w{0,3} el proyecto\b|\bpodemos parar (la )?linea\b|\bparar (la )?linea\b|\blimitados a\b|\bperder (la )?(ventana|cuenta|cliente)\b|\bmultas?\b|\bafecta\w{0,3} (mis|nuestros|los) (metricas|kpi|kpis)\b|\bcambiar al que nos atiende\b|\bstop shipment\b|\bparo de embarques\b|\bconsidero la falta de respuesta como un no\b|\bno podemos facturar sin\b/;
const DINERO = /\bfalsos?\b|\bdemoras?\b|\bestadias?\b|\bnos van a cobrar\b|\bse les traspasa\b|\bpenaliz\w{0,6}\b|\bextraordinario\b|\btarifa\b|\bdomingo\b|\bfestivo\b|\bcargo por\b|\bhabra cargo\b|\bcuanto cuesta\b|\bcosto\b/;
const KPI = /\bsegundo dia llegando tarde\b|\bperdimos (la |las )?citas?\b|\bperdi (la )?cita\b|\bkpi\b|\bmetricas\b/;
const SEGURIDAD_TEXTO = /\bcontactad\w{0,3} por (un )?(desconocido|numero desconocido)\b|\bno brindar informacion\b|\bresguardar (la )?caja\b|\bcustodias? (no coinciden|equivocad\w{0,3})\b|\bla caja no esta\b/;
const CRITICOS: ReadonlySet<TipoSolicitud> = new Set<TipoSolicitud>(['caja_vacia_colocacion', 'eta', 'estatus_planta_ingreso', 'estatus_cruce']);

/** ¿El texto trae frases de presión o amenaza del cliente? (para otros módulos). */
export function detectarPresion(texto: string): { presion: boolean; amenazaComercial: boolean; dinero: boolean } {
  const n = normalizar(texto ?? '');
  return { presion: PRESION.test(n), amenazaComercial: AMENAZA.test(n), dinero: DINERO.test(n) };
}

/** Mensajes del cliente que siguen sin respuesta con dato, colapsando ráfagas (≤ `rafagaUnMensajeMin` entre sí). */
export function mensajesSinAtender(mensajes: readonly MensajeHilo[], rafagaMin: number): MensajeHilo[] {
  const orden = [...mensajes].sort((a, b) => a.tsMs - b.tsMs);
  let ultimoDato = -Infinity;
  for (const m of orden) if (m.de === 'equipo' && (m.conDato ?? !esRespuestaVacia(m.texto))) ultimoDato = m.tsMs;
  const pend = orden.filter((m) => m.de === 'cliente' && m.tsMs > ultimoDato);
  const colapsados: MensajeHilo[] = [];
  let prev: MensajeHilo | null = null;
  for (const m of pend) {
    if (prev && m.tsMs - prev.tsMs <= rafagaMin * 60_000) { prev = m; continue; }
    colapsados.push(m); prev = m;
  }
  return colapsados;
}

function configEfectiva(c: Partial<ConfigEscalamiento> | undefined): ConfigEscalamiento {
  const out: Record<string, number> = { ...CONFIG_ESCALAMIENTO_POR_OMISION };
  if (c) for (const [k, v] of Object.entries(c)) if (k in out && typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = v;
  return out as unknown as ConfigEscalamiento;
}

/** Evalúa un hilo contra los 30 disparadores. Nunca lanza. */
export function evaluarEscalamiento(hilo: Hilo, configParcial?: Partial<ConfigEscalamiento>): ResultadoEscalamiento {
  const cfg = configEfectiva(configParcial);
  const motivos: MotivoEscalamiento[] = [];
  const DE_NIVEL: Record<MotivoEscalamiento['nivel'], RolDestino> = { N1: 'encargado_turno', N2: 'gerencia_operacion', N3: 'dueno' };
  const add = (disparador: number, codigo: string, nivel: MotivoEscalamiento['nivel'], rol: RolDestino, urgencia: Urgencia): void => {
    if (motivos.some((m) => m.codigo === codigo)) return;
    const funcional = FUNCIONALES.includes(rol) && rol !== 'guardia_fin_de_semana';
    motivos.push({ disparador, codigo, nivel, rol: funcional ? DE_NIVEL[nivel] : rol, ruta: funcional ? rol : null, urgencia });
  };
  const ahora = hilo.ahoraMs;
  const pend = mensajesSinAtender(hilo.mensajes ?? [], cfg.rafagaUnMensajeMin);
  const textosPend = (hilo.mensajes ?? []).filter((m) => m.de === 'cliente' && pend.length > 0 && m.tsMs >= pend[0].tsMs).map((m) => m.texto);
  const nPend = normalizar(textosPend.join(' . '));
  const crudoPend = textosPend.join('\n');
  const tipos = hilo.tipos ?? tiposDePeticion(detectarSolicitudes(crudoPend));
  const peticionesPend = pend.filter((m) => tiposDePeticion(detectarSolicitudes(m.texto)).length > 0 || /[?¿]/.test(m.texto) || detectarUrgencia(m.texto));
  const esperaMin = pend.length > 0 ? Math.max(0, Math.floor((ahora - pend[0].tsMs) / 60_000)) : 0;
  const hay = (t: TipoSolicitud): boolean => tipos.includes(t);
  const urgente = detectarUrgencia(crudoPend);
  const presion = PRESION.test(nPend);
  const amenaza = AMENAZA.test(nPend);

  // 1-2 · repregunta y ráfaga.
  const enVentana = pend.filter((m) => ahora - m.tsMs <= cfg.repreguntaVentanaMin * 60_000 + 60_000).length;
  const repregunta = peticionesPend.length >= 2 && esperaMin >= cfg.repreguntaEsperaMin;
  const rafaga = enVentana >= cfg.repreguntaMensajes;
  if (repregunta || rafaga) add(1, 'repregunta_sin_dato', 'N1', 'encargado_turno', 'A');
  if (rafaga && (urgente || presion || pend.length >= cfg.repreguntaMensajes)) add(2, 'rafaga_de_presion', 'N2', 'gerencia_operacion', 'I');
  // 3 · urgencia por verbo.
  if (urgente && peticionesPend.length > 0) add(3, 'urgencia_declarada', 'N1', 'encargado_turno', 'A');
  // 4 · «cliente encima».
  if (presion) {
    const sube = repregunta || (hilo.etaNivel === 'N2') || (hilo.minutosParaCita != null && hilo.minutosParaCita < 0);
    add(4, 'cliente_presionando', sube ? 'N2' : 'N1', sube ? 'gerencia_operacion' : 'encargado_turno', 'A');
  }
  // 5 · cita vencida sin unidad.
  if (hilo.minutosParaCita != null && hilo.minutosParaCita < 0 && hilo.llegoAPlanta === false) add(5, 'cita_vencida_sin_unidad', 'N2', 'gerencia_operacion', 'I');
  // 6 · ETA que cambia.
  if (hilo.etaNivel === 'N1') add(6, 'eta_inestable', 'N1', 'encargado_turno', 'A');
  if (hilo.etaNivel === 'N2') add(6, 'eta_muy_inestable', 'N2', 'gerencia_operacion', 'A');
  // 7 · silencio.
  const hayCritico = tipos.some((t) => CRITICOS.has(t));
  if (pend.length > 0 && peticionesPend.length > 0) {
    if (esperaMin >= cfg.silencioMin) add(7, 'silencio_prolongado', 'N2', 'gerencia_operacion', 'A');
    else if (hayCritico && esperaMin >= cfg.silencioCriticoMin) add(7, 'silencio_en_tema_critico', 'N1', 'encargado_turno', 'A');
  }
  // Un acuse vacío del equipo («enterado») no cierra la espera.
  if (pend.length > 0 && esperaMin >= cfg.repreguntaEsperaMin && peticionesPend.length > 0 && (hilo.mensajes ?? []).some((m) => m.de === 'equipo' && m.tsMs > pend[0].tsMs && !(m.conDato ?? !esRespuestaVacia(m.texto)))) {
    add(7, 'acuse_vacio_no_cierra', 'N1', 'encargado_turno', 'A');
  }
  // 8 · hueco estructural de turno.
  if (hilo.franja && pend.length > 0) {
    if (hilo.franja === 'madrugada' && esperaMin >= cfg.repreguntaEsperaMin) add(8, 'madrugada_sin_acuse', 'N2', 'gerencia_operacion', 'A');
    if (hilo.franja === 'cambio_turno') add(8, 'cambio_de_turno_con_pendientes', 'N1', 'encargado_turno', 'A');
  }
  // 9 · nadie en turno.
  if (hilo.turnoCubierto === false) add(9, 'nadie_en_turno', 'N2', 'gerencia_operacion', 'I');
  // 10 · operador esperando en planta.
  const esp = hilo.operadorEsperandoMin ?? null;
  if (esp !== null) {
    if (hilo.operadorSinComerOSeRetira || esp >= cfg.esperaPlantaN3Min) add(10, 'operador_espera_extrema', 'N3', 'dueno', 'I');
    else if (esp >= cfg.esperaPlantaN2Min) add(10, 'operador_espera_larga', 'N2', 'gerencia_operacion', 'A');
    else if (esp >= cfg.esperaPlantaN1Min) add(10, 'operador_espera_en_planta', 'N1', 'encargado_turno', 'A');
  }
  // 11-13 · ruta.
  if (hilo.paradaNoAutorizada) add(11, 'parada_no_autorizada', 'N1', 'monitoreo', 'I');
  const det = hilo.unidadDetenidaMin ?? null;
  if (det !== null) {
    if (hilo.detenidaEnParadorAutorizado && det > cfg.paradorMaximoMin) add(11, 'parador_excede_maximo', 'N1', 'monitoreo', 'I');
    if (!hilo.detenidaEnParadorAutorizado && det >= cfg.detenidaFueraDeParadorMin) add(12, 'detenida_fuera_de_parador', 'N1', 'monitoreo', 'A');
    if (det >= cfg.detenidaCualquierMin) add(12, 'detenida_mas_de_una_hora', 'N2', 'monitoreo', 'A');
  }
  if (hilo.desvioDeRuta) add(13, 'desvio_de_ruta', 'N2', 'monitoreo', 'I');
  // 14 · daño / incidencia.
  if (hay('incidencia') || hilo.danoOIncidencia) add(14, 'dano_o_incidencia', hilo.zonaDeRiesgoOHazmat ? 'N3' : 'N2', hilo.zonaDeRiesgoOHazmat ? 'dueno' : 'gerencia_operacion', 'I');
  // 15 · salida sin autorización.
  if (hilo.salidaSinAutorizacionOFotos) add(15, 'salida_sin_autorizacion_o_fotos', 'N2', 'gerencia_operacion', 'I');
  // 16 · cambios tras prealerta.
  const cam = hilo.cambiosDeUnidadEn60Min ?? 0;
  if (cam >= cfg.cambiosUnidadN2) add(16, 'cambios_repetidos_de_unidad', 'N2', 'gerencia_operacion', 'A');
  else if (cam >= 1 && hilo.habiaPrealerta) add(16, 'cambio_tras_prealerta', 'N1', 'encargado_turno', 'A');
  else if (hay('cambio_unidad_operador')) add(16, 'cambio_de_unidad_solicitado', 'N1', 'encargado_turno', 'A');
  // 17-18 · cancelación, falso y dinero.
  if (hay('cancelacion_falso')) add(17, 'cancelacion_o_riesgo_de_falso', 'N2', 'gerencia_operacion', 'A');
  if (DINERO.test(nPend) || hay('cancelacion_falso')) add(18, 'dinero_o_penalizacion', amenaza ? 'N3' : 'N2', amenaza ? 'dueno' : 'gerencia_operacion', 'A');
  // 19 · amenaza comercial.
  if (amenaza) add(19, 'amenaza_comercial', 'N3', 'dueno', 'I');
  // 20 · facturación bloqueada.
  if ((hay('pod_doda') || hay('facturacion_documentos')) && (/\bno podemos facturar\b|\bnos urge facturar\b|\bpara poder proceder a pago\b/.test(nPend) || (hilo.podPedidoHaceHoras ?? 0) >= cfg.podReclamoHoras)) add(20, 'facturacion_bloqueada', 'N2', 'importacion_ccp', 'M');
  // 21 · CCP sin timbrar.
  if ((hilo.ccpMinSinTimbrar ?? 0) >= cfg.ccpSinTimbrarMin) add(21, 'ccp_sin_timbrar_mas_de_una_hora', 'N2', 'sistemas', 'A');
  // 22 · prealerta faltante en caseta.
  if ((hilo.prealertaFaltanteEnCasetaMin ?? 0) > 0) {
    const m = hilo.prealertaFaltanteEnCasetaMin as number;
    add(22, 'prealerta_faltante_en_caseta', m >= cfg.prealertaFaltanteMin ? 'N2' : 'N1', m >= cfg.prealertaFaltanteMin ? 'gerencia_operacion' : 'encargado_turno', 'A');
  }
  // 23 · rechazo de caja.
  if (hilo.rechazoDeCaja) add(23, 'rechazo_de_caja', 'N2', 'control_equipo', 'A');
  // 24 · seguridad.
  if (hilo.solicitanteNoAutorizado && (hay('datos_operador') || hay('custodia')) || SEGURIDAD_TEXTO.test(nPend) || hay('custodia')) add(24, 'seguridad_o_custodia', 'N2', 'seguridad', 'I');
  // 25 · cambio de instrucción.
  if (hay('cambio_instruccion')) add(25, 'cambio_de_instruccion_mismo_dia', 'N2', 'gerencia_operacion', 'I');
  // 26 · cruce sin hito.
  if (hilo.cruceSinHitoConfirmado && (hay('estatus_cruce'))) add(26, 'cruce_pedido_sin_hito', 'N1', 'cruces', 'A');
  // 27 · datos faltantes bloqueantes cerca de la cita.
  if (hilo.faltantesBloqueantes && hilo.minutosParaCita != null && hilo.minutosParaCita >= 0) {
    if (hilo.minutosParaCita < cfg.faltantesN2MinParaCita) add(27, 'faltantes_bloqueantes_inminentes', 'N2', 'gerencia_operacion', 'A');
    else if (hilo.minutosParaCita < cfg.faltantesN1MinParaCita) add(27, 'faltantes_bloqueantes_proximos', 'N1', 'encargado_turno', 'A');
  }
  // 28 · pendientes muy antiguos.
  if ((hilo.pendienteMasAntiguoDias ?? 0) >= cfg.pendienteAntiguoDiasN2) add(28, 'pendiente_muy_antiguo', 'N2', 'gerencia_operacion', 'M');
  // 29 · KPI / pérdida de citas.
  if (KPI.test(nPend)) add(29, 'cliente_menciona_kpi_o_citas_perdidas', amenaza ? 'N3' : 'N2', amenaza ? 'dueno' : 'gerencia_operacion', 'A');
  // 30 · fin de semana o festivo.
  if (hilo.finDeSemanaOFestivo && (hay('autorizacion_salida') || hay('ccp') || hay('incidencia'))) add(30, 'guardia_fin_de_semana', 'N1', 'guardia_fin_de_semana', 'A');

  let nivel: NivelEscalamiento = 'ninguno';
  for (const m of motivos) if (RANGO[m.nivel] > RANGO[nivel]) nivel = m.nivel;
  const top = motivos.filter((m) => m.nivel === nivel).sort((a, b) => URG[b.urgencia] - URG[a.urgencia])[0] ?? null;
  const urg = motivos.reduce<Urgencia | null>((acc, m) => (acc === null || URG[m.urgencia] > URG[acc] ? m.urgencia : acc), null);
  const rutas = [...new Set(motivos.map((m) => m.ruta).filter((r): r is RolDestino => r !== null))];
  return { nivel, motivos, destinatarioRol: top?.rol ?? null, rutasFuncionales: rutas, urgencia: urg, esperaMin, mensajesSinAtender: pend.length };
}
