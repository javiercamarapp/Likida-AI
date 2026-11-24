// ═══════════════════════════════════════════════════════════════════════════
// DIÁLOGOS DORADOS (sintéticos) — conversaciones tipo de un grupo de servicio al cliente de un transportista, con lo que el sistema
// tiene confirmado y la acción que el agente debe tomar. Todo el texto es inventado y genérico («caja 12», «planta A»); cualquier
// parecido con un cliente real es casualidad. Los ids D01-D67 siguen la numeración de la síntesis (no son contiguos).
// D68-D72 cubren el borrador final de la ficha (ficha_borrador.ts): faltantes sin rellenar, caja a un dígito y datos del operador a un solicitante sin verificar.
//
// Cada diálogo: mensajes con hora local, `ahora`, datos confirmados (`datos`), contexto extra y lo ESPERADO. Cuando el sistema no
// tiene el dato, lo esperado es `pedir_dato_a_persona` con los campos que faltan: el agente nunca los inventa.
// ═══════════════════════════════════════════════════════════════════════════
import type { Accion, NivelAviso } from './matriz_accion';
import type { NivelEscalamiento } from './escalamiento';
import type { IdPlantilla } from './plantillas';
import type { TipoSolicitud } from './taxonomia';
import type { ContextoDecision, ConfigDecision } from './decidir';
import type { Hilo } from './escalamiento';
import type { ReglasPorCliente } from './reglas_cliente';

export type HoraLocal = `${number}${number}:${number}${number}`;
export interface MensajeDorado { de: 'cliente' | 'equipo' | 'operador'; hora: HoraLocal; texto: string }

export interface EtaDorada {
  cita?: HoraLocal;
  historial: ReadonlyArray<{ eta: HoraLocal; actualizado: HoraLocal; punto: 'planta' | 'patio' | null; fuente?: 'persona' | 'sistema_gps'; causa?: string | null }>;
  zona?: string | null;
}

export interface DialogoDorado {
  id: string;
  titulo: string;
  mensajes: readonly MensajeDorado[];
  /** Si se omite, la hora del último mensaje. */
  ahora?: HoraLocal;
  /** Texto a evaluar si no es el de los mensajes sin atender del cliente (p. ej. lo escribió el equipo). */
  texto?: string;
  tipos?: readonly TipoSolicitud[];
  datos: readonly string[];
  eta?: EtaDorada;
  hilo?: Partial<Omit<Hilo, 'ahoraMs' | 'mensajes'>>;
  contexto?: ContextoDecision;
  config?: ConfigDecision;
  reglas?: Partial<ReglasPorCliente>;
  esperado: {
    accion: Accion;
    nivelAviso: NivelAviso | null;
    tiposContienen?: readonly TipoSolicitud[];
    camposFaltantes?: readonly string[];
    plantillaId?: IdPlantilla | null;
    envioParcial?: boolean;
    escalamiento?: { nivel: NivelEscalamiento; motivos?: readonly string[]; rutas?: readonly string[] };
    motivoContiene?: string;
    nuncaContiene?: readonly string[];
  };
}

const FICHA_COMPLETA = ['linea', 'numeroCaja', 'placasCaja', 'estadoCaja', 'eco', 'placaTracto', 'operadorNombre', 'ref', 'cita'] as const;
const c = (hora: HoraLocal, texto: string): MensajeDorado => ({ de: 'cliente', hora, texto });
const e = (hora: HoraLocal, texto: string): MensajeDorado => ({ de: 'equipo', hora, texto });
const zona = 'Centro';

export const DIALOGOS_DORADOS: readonly DialogoDorado[] = [
  // ── Ficha de unidad ──────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D01', titulo: 'Ficha completa', mensajes: [c('04:10', 'buen día, tendrán datos de la unidad de hoy? cita 10')], datos: [...FICHA_COMPLETA, 'cuentaEspejo'],
    esperado: { accion: 'responder_con_datos', nivelAviso: null, tiposContienen: ['ficha_unidad'], camposFaltantes: [], plantillaId: 'ficha_unidad', escalamiento: { nivel: 'ninguno' } } },
  { id: 'D02', titulo: 'Ficha con datos faltantes (team y sello pendientes)', mensajes: [c('04:40', 'datos de la unidad de hoy? cita 9')], datos: [...FICHA_COMPLETA, 'cuentaEspejo'],
    reglas: { camposFichaObligatorios: [...FICHA_COMPLETA, 'teamNombre', 'sello'] },
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', camposFaltantes: ['teamNombre', 'sello'], plantillaId: 'ficha_unidad', envioParcial: true } },
  { id: 'D03', titulo: 'Petición anticipada la noche previa (sin asignación)', mensajes: [c('22:00', 'datos de las unidades de mañana pls')], datos: [],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', camposFaltantes: [...FICHA_COMPLETA], plantillaId: 'falta_dato', envioParcial: false } },

  // ── ETA ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D06', titulo: 'ETA pedido sin ETA vigente, repregunta', mensajes: [c('08:15', 'que eta tenemos? cita 10'), c('08:27', 'mismo eta?')], datos: ['posicionGps'],
    eta: { cita: '10:00', historial: [], zona },
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['eta'], camposFaltantes: ['eta_vigente'], plantillaId: 'falta_dato', escalamiento: { nivel: 'N1', motivos: ['repregunta_sin_dato'] } } },
  { id: 'D07', titulo: 'ETA vigente con retraso a minutos de la cita', mensajes: [c('09:40', 'chicos eta? ya me están esperando')], datos: [],
    eta: { cita: '10:00', historial: [{ eta: '10:15', actualizado: '09:35', punto: 'planta', fuente: 'persona', causa: 'diésel' }], zona },
    esperado: { accion: 'responder_con_datos', nivelAviso: 'N1', tiposContienen: ['eta'], camposFaltantes: [], plantillaId: 'eta_vigente' } },
  { id: 'D09', titulo: 'ETA que cambia sin causa: se retiene', mensajes: [c('11:30', 'eta?')], datos: [],
    eta: { cita: '14:00', historial: [{ eta: '13:00', actualizado: '11:10', punto: 'planta', fuente: 'persona' }, { eta: '13:30', actualizado: '11:25', punto: 'planta', fuente: 'persona', causa: null }], zona },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', camposFaltantes: ['causa_del_cambio'], plantillaId: 'falta_dato' } },
  { id: 'D10', titulo: 'ETA a patio presentado como a planta: se aclara el punto', mensajes: [c('10:05', 'por qué ETA 12pm si está a 2 hrs de planta?')], datos: [],
    eta: { cita: '13:00', historial: [{ eta: '12:00', actualizado: '10:00', punto: 'patio', fuente: 'persona' }], zona },
    esperado: { accion: 'responder_con_datos', nivelAviso: null, tiposContienen: ['eta'], plantillaId: 'eta_vigente' } },

  // ── Repregunta, ráfaga y urgencia ─────────────────────────────────────────────────────────────────────────────────────
  { id: 'D12', titulo: 'Repregunta por el sello (2 veces en 25 min)', mensajes: [c('09:00', 'como vamos con el sello?'), c('09:25', 'ya tenemos sello? la planta lo pide')], datos: [],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['sello_foto'], camposFaltantes: ['sello'], plantillaId: 'falta_dato', escalamiento: { nivel: 'N1', motivos: ['repregunta_sin_dato'] } } },
  { id: 'D13', titulo: 'Ráfaga de 3 mensajes en 30 min', mensajes: [c('07:00', 'datos?'), c('07:12', 'equipo?'), c('07:25', 'alguien en turno??')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['ficha_unidad', 'urgencia'], escalamiento: { nivel: 'N2', motivos: ['rafaga_de_presion'] } } },
  { id: 'D14', titulo: '«Me urge» sube la prioridad', mensajes: [c('07:30', 'me urge ccp de la caja 12')], datos: [],
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['ccp', 'urgencia'], escalamiento: { nivel: 'N1', motivos: ['urgencia_declarada'] } } },
  { id: 'D15', titulo: '«Gracias» pegado a la petición no la cierra', mensajes: [c('10:00', 'me ayudas con el POD de la caja 12? gracias')], datos: [],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['pod_doda'], camposFaltantes: ['documentoPod'] } },
  { id: 'D16', titulo: 'Un «enterado» del equipo no cierra la petición (10 min)', mensajes: [c('08:08', 'CP de cruce de las cajas 4 y 5'), e('08:10', 'enterado')], ahora: '08:20', datos: [],
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['ccp'], escalamiento: { nivel: 'N1', motivos: ['acuse_vacio_no_cierra'] } } },
  { id: 'D16b', titulo: 'Un «enterado» del equipo no cierra la petición (84 min)', mensajes: [c('08:08', 'CP de cruce de las cajas 4 y 5'), e('08:10', 'enterado')], ahora: '09:32', datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['ccp'], escalamiento: { nivel: 'N2', motivos: ['silencio_prolongado'] } } },
  { id: 'D17', titulo: 'Borrador interno con «reviso» se rechaza', mensajes: [c('09:00', 'que eta tenemos?')], datos: [], contexto: { borrador: 'reviso y te digo' },
    esperado: { accion: 'prohibido', nivelAviso: 'N1', motivoContiene: 'acuse_vacio' } },

  // ── CCP ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D18', titulo: 'CCP pedida sin estar lista: se avisa a importación', mensajes: [c('05:20', 'me ayudan con la ccp de la caja 12? ref 345')], datos: [],
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['ccp'], plantillaId: 'falta_dato', nuncaContiene: ['Emitir, corregir, regenerar o validar la CCP'] } },
  { id: 'D19', titulo: 'CCP con origen equivocado: solo se registra y pasa a importación', mensajes: [c('06:00', 'la ccp tiene mal el origen, debe ser edificio 8')], datos: [],
    esperado: { accion: 'solo_registrar', nivelAviso: 'N1', tiposContienen: ['ccp'] } },
  { id: 'D20', titulo: 'CCP más de 60 min sin timbrar', mensajes: [c('05:20', 'me ayudan con la ccp de la caja 12')], ahora: '06:25', datos: [], hilo: { ccpMinSinTimbrar: 65 }, contexto: { ccpMinSinTimbrar: 65 },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['ccp'], escalamiento: { nivel: 'N2', motivos: ['ccp_sin_timbrar_mas_de_una_hora'], rutas: ['sistemas'] } } },

  // ── Salida y autorización ─────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D22', titulo: 'El operador pide al agente autorizar la salida', mensajes: [{ de: 'operador', hora: '10:30', texto: 'ya puedo salir?' }], texto: 'ya puedo salir?', datos: [], contexto: { emisor: 'operador' },
    esperado: { accion: 'prohibido', nivelAviso: 'N1', tiposContienen: ['autorizacion_salida'], camposFaltantes: ['fotosCompletas'], nuncaContiene: ['Adelante / ya puedes salir / está autorizado'] } },
  { id: 'D23', titulo: 'El cliente da «adelante con el viaje»: se registra y se avisa', mensajes: [c('11:20', 'adelante con el viaje')], datos: [], contexto: { emisor: 'cliente' },
    esperado: { accion: 'solo_registrar', nivelAviso: 'N1', tiposContienen: ['autorizacion_salida'], plantillaId: null } },
  { id: 'D24', titulo: 'Salida sin autorización', mensajes: [e('11:40', 'la unidad ya salió de la planta')], texto: 'la unidad ya salió de la planta', tipos: ['autorizacion_salida'], datos: [], contexto: { salidaSinAutorizacion: true },
    hilo: { salidaSinAutorizacionOFotos: true },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', escalamiento: { nivel: 'N2', motivos: ['salida_sin_autorizacion_o_fotos'] } } },

  // ── Falsos, cancelaciones y cambios ───────────────────────────────────────────────────────────────────────────────────
  { id: 'D26', titulo: 'Preguntan si habrá cargo por el falso', mensajes: [c('12:00', 'habrá cargo por el falso?')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['cancelacion_falso'], nuncaContiene: ['Cotizar falso, demora o estadía'], escalamiento: { nivel: 'N2', motivos: ['dinero_o_penalizacion'] } } },
  { id: 'D27', titulo: 'Cancelación nocturna con unidad asignada', mensajes: [c('21:40', 'cancelen la de mañana 8am; retiren con todo y caja o drop?')], datos: [],
    esperado: { accion: 'solo_registrar', nivelAviso: 'N2', tiposContienen: ['cancelacion_falso'], camposFaltantes: [], escalamiento: { nivel: 'N2', motivos: ['cancelacion_o_riesgo_de_falso'] } } },
  { id: 'D29', titulo: 'Cambio de destino el mismo día', mensajes: [c('09:10', 'entregar en otro destino, es importante')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['cambio_instruccion'], escalamiento: { nivel: 'N2', motivos: ['cambio_de_instruccion_mismo_dia'] } } },
  { id: 'D30', titulo: 'Cambio de tracto después de la prealerta', mensajes: [e('09:55', 'cambio de tracto')], texto: 'cambio de tracto', datos: [], hilo: { habiaPrealerta: true, cambiosDeUnidadEn60Min: 1 },
    contexto: { cambiosDeUnidadEn60Min: 1 },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['cambio_unidad_operador'], plantillaId: 'ficha_unidad', escalamiento: { nivel: 'N1', motivos: ['cambio_tras_prealerta'] } } },
  { id: 'D31', titulo: 'Dos cambios de unidad en 15 minutos', mensajes: [e('08:12', 'cambio de tracto otra vez')], texto: 'cambio de tracto otra vez', datos: [], hilo: { cambiosDeUnidadEn60Min: 2 }, contexto: { cambiosDeUnidadEn60Min: 2 },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['cambio_unidad_operador'], escalamiento: { nivel: 'N2', motivos: ['cambios_repetidos_de_unidad'] } } },
  { id: 'D32', titulo: 'Cambio de caja por filtración (incidencia y cambio)', mensajes: [e('07:40', 'cambio de caja por filtración')], texto: 'cambio de caja por filtración', datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['cambio_unidad_operador', 'incidencia'] } },

  // ── Ruta, detención, daño ─────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D33', titulo: 'Parada no autorizada de 40 min', mensajes: [c('03:15', 'la unidad lleva 40 min detenida en el tramo 5, no es parador')], datos: ['posicionGps'],
    hilo: { unidadDetenidaMin: 40, paradaNoAutorizada: true }, contexto: { paradaNoAutorizada: true, unidadDetenidaMin: 40 },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['estatus_ruta_detencion'], plantillaId: 'detencion', escalamiento: { nivel: 'N1', motivos: ['parada_no_autorizada'], rutas: ['monitoreo'] } } },
  { id: 'D34', titulo: 'Parada en parador autorizado', mensajes: [c('14:10', 'se visualiza detenida')], datos: ['posicionGps'], hilo: { unidadDetenidaMin: 20, detenidaEnParadorAutorizado: true },
    esperado: { accion: 'responder_con_datos', nivelAviso: null, tiposContienen: ['estatus_ruta_detencion'], plantillaId: 'detencion', escalamiento: { nivel: 'ninguno' } } },
  { id: 'D35', titulo: 'Desvío de ruta', mensajes: [c('02:50', 'la unidad se está desviando, no está autorizado')], datos: ['posicionGps'], hilo: { desvioDeRuta: true }, contexto: { desvioDeRuta: true },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['estatus_ruta_detencion'], escalamiento: { nivel: 'N2', motivos: ['desvio_de_ruta'], rutas: ['monitoreo'] } } },
  { id: 'D36', titulo: 'Llanta suelta', mensajes: [c('05:05', 'llanta suelta posición 8; alto total')], datos: [], hilo: { danoOIncidencia: true },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['incidencia'], escalamiento: { nivel: 'N2', motivos: ['dano_o_incidencia'] }, nuncaContiene: ['Asignar culpa'] } },
  { id: 'D37', titulo: 'Caja rechazada en inspección', mensajes: [c('08:50', 'rechazan la caja por filtración')], datos: [], hilo: { rechazoDeCaja: true },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['incidencia'], escalamiento: { nivel: 'N2', motivos: ['rechazo_de_caja'], rutas: ['control_equipo'] } } },
  { id: 'D38', titulo: 'El candado no marca cerrado', mensajes: [c('09:20', 'el candado electrónico no marca cerrado')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['incidencia', 'sello_foto'], nuncaContiene: ['Autorizar continuar con el candado abierto'] } },
  { id: 'D39', titulo: 'Operador esperando 5 horas en planta', mensajes: [c('11:05', 'ya le dieron acceso?')], datos: ['estatusPlanta'], hilo: { operadorEsperandoMin: 300 }, contexto: { operadorEsperandoMin: 300 },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['estatus_planta_ingreso'], plantillaId: 'estatus_planta', escalamiento: { nivel: 'N2', motivos: ['operador_espera_larga'] } } },
  { id: 'D40', titulo: 'Sin prealerta con el operador en caseta (10 min)', mensajes: [c('06:10', 'no hay prealerta')], datos: [], hilo: { prealertaFaltanteEnCasetaMin: 10 },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['prealerta_acceso'], plantillaId: 'prealerta', escalamiento: { nivel: 'N1', motivos: ['prealerta_faltante_en_caseta'] } } },
  { id: 'D40b', titulo: 'Sin prealerta con el operador en caseta (35 min)', mensajes: [c('06:10', 'no hay prealerta')], datos: [], hilo: { prealertaFaltanteEnCasetaMin: 35 },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['prealerta_acceso'], escalamiento: { nivel: 'N2', motivos: ['prealerta_faltante_en_caseta'] } } },

  // ── QR, programa, pool ────────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D41', titulo: 'QR con datos incompletos', mensajes: [c('04:00', 'nos ayudan con qr de acceso')], datos: ['operadorNombre', 'placaTracto', 'numeroCaja'],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['qr_acceso'], camposFaltantes: ['color', 'anio', 'modelo', 'marca', 'lineaTransportista'], plantillaId: 'qr_acceso' } },
  { id: 'D42', titulo: 'QR con otro número de remolque', mensajes: [c('05:10', 'el qr trae otra caja')], datos: ['operadorNombre', 'placaTracto', 'numeroCaja', 'color', 'anio', 'modelo', 'marca', 'lineaTransportista'], contexto: { discrepancias: ['V2', 'V8'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['qr_acceso'], motivoContiene: 'discrepancia_detectada' } },
  { id: 'D43', titulo: 'Programa de mañana recibido', mensajes: [c('16:20', 'programa de mañana: 08:00 1 unidad en vivo; 10:00 2 unidades en vivo; 12:00 1 en drop')], datos: [], contexto: { programaRecibido: true },
    esperado: { accion: 'solo_registrar', nivelAviso: null, tiposContienen: ['pool_programa'], plantillaId: 'confirmacion_programa', camposFaltantes: [] } },
  { id: 'D44', titulo: 'El programa cambia', mensajes: [c('21:00', 'actualizo programa: 3 servicios, la de 12:00 pasa a pasado mañana')], datos: [], contexto: { programaRecibido: true, programaCambio: true },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['pool_programa'], plantillaId: 'confirmacion_programa' } },
  { id: 'D45', titulo: 'Pool con una caja duplicada: no se publica', mensajes: [c('09:50', 'me ayudas con el pool de cajas vacías y ubicación')], datos: [], contexto: { discrepancias: ['V6'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['pool_programa'], camposFaltantes: ['inventarioConfirmado', 'cajaVaciaConfirmada'], motivoContiene: 'V6' } },
  { id: 'D47', titulo: 'Colocación con caja confirmada', mensajes: [c('08:30', 'me ayudas colocando 1 caja vacía hoy? ref 345')], datos: ['cajaVaciaConfirmada'],
    esperado: { accion: 'responder_con_datos', nivelAviso: null, tiposContienen: ['caja_vacia_colocacion'], plantillaId: 'colocacion_remolque' } },
  { id: 'D48', titulo: 'Colocación sin caja confirmada', mensajes: [c('11:00', 'me ayudas colocando 1 caja vacía hoy? ref 345')], datos: [],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['caja_vacia_colocacion'], camposFaltantes: ['cajaVaciaConfirmada'], plantillaId: 'falta_dato', nuncaContiene: ['«Mañana la colocamos»'] } },

  // ── POD, sello, CE, cruce ─────────────────────────────────────────────────────────────────────────────────────────────
  { id: 'D50', titulo: 'POD pedido y solo hay carta porte sellada', mensajes: [c('10:00', 'mándame el POD de la caja 4 (DODA firmado)')], datos: [], contexto: { soloHayCartaPorteSellada: true },
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['pod_doda'], camposFaltantes: ['documentoPod'], plantillaId: 'falta_dato', motivoContiene: 'carta_porte_sellada_no_es_pod' } },
  { id: 'D51', titulo: 'POD recibido', mensajes: [c('10:00', 'mándame el POD de la caja 4')], datos: ['documentoPod'],
    esperado: { accion: 'responder_con_datos', nivelAviso: null, tiposContienen: ['pod_doda'], camposFaltantes: [] } },
  { id: 'D52', titulo: 'Sello distinto al declarado: se retiene', mensajes: [c('07:00', 'mándame la foto del sello')], datos: ['sello'], contexto: { discrepancias: ['V9'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['sello_foto'], motivoContiene: 'V9' } },
  { id: 'D53', titulo: 'Cuenta espejo vencida', mensajes: [c('13:00', 'la que teníamos expiró')], datos: [],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['cuenta_espejo'], camposFaltantes: ['cuentaEspejo'], plantillaId: 'falta_dato' } },
  { id: 'D54', titulo: 'Cruce sin confirmación: no se afirma', mensajes: [c('10:30', 'cruzó la caja 4?')], datos: [],
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['estatus_cruce'], camposFaltantes: ['hitoCruce'], plantillaId: 'estatus_cruce', nuncaContiene: ['«Ya está en patio» sin confirmación'] } },
  { id: 'D55', titulo: 'Referencia contra caja: sin tipo propio, va a una persona', mensajes: [c('09:00', '11787189 caja 4?')], datos: [],
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['otro'] } },

  // ── Validaciones y errores humanos ────────────────────────────────────────────────────────────────────────────────────
  { id: 'D56', titulo: 'Caja con un dígito distinto', mensajes: [c('08:00', 'en la CI dice caja 215 pero el inventario trae 214')], datos: [], contexto: { discrepancias: ['V2'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', motivoContiene: 'V2' } },
  { id: 'D57', titulo: 'Licencia vencida: la ficha no sale', mensajes: [c('04:00', 'datos de la unidad de hoy')], datos: [...FICHA_COMPLETA], contexto: { discrepancias: ['V4'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['ficha_unidad'], motivoContiene: 'V4' } },
  { id: 'D58', titulo: 'Placa de caja sin estado', mensajes: [c('04:00', 'datos de la unidad de hoy')], datos: FICHA_COMPLETA.filter((x) => x !== 'estadoCaja'),
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', camposFaltantes: ['estadoCaja'], plantillaId: 'ficha_unidad', envioParcial: true } },
  { id: 'D59', titulo: 'Fecha incoherente', mensajes: [c('09:00', 'entrega lunes 16/10')], datos: [], contexto: { discrepancias: ['V5'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', motivoContiene: 'V5' } },
  { id: 'D60', titulo: 'Documento de otra caja', mensajes: [c('06:30', 'adjunto la ccp de la caja 12')], datos: [], contexto: { discrepancias: ['V8'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['ccp'], motivoContiene: 'V8' } },

  // ── Seguridad, turnos, escalada comercial ─────────────────────────────────────────────────────────────────────────────
  { id: 'D61', titulo: 'Un número desconocido pide el teléfono del operador', mensajes: [c('15:00', '¿me das el teléfono del operador de la caja 12?')], datos: ['operadorNombre'], contexto: { solicitanteVerificado: false },
    hilo: { solicitanteNoAutorizado: true },
    esperado: { accion: 'solo_registrar', nivelAviso: 'N2', tiposContienen: ['datos_operador'], escalamiento: { nivel: 'N2', motivos: ['seguridad_o_custodia'], rutas: ['seguridad'] }, nuncaContiene: ['Teléfono, ubicación exacta, licencia, domicilio o nombre a no autorizados'] } },
  { id: 'D62', titulo: 'Custodias que no coinciden', mensajes: [c('18:00', 'se presentan 2 custodias por la caja 8, es la correcta?')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['custodia'], escalamiento: { nivel: 'N2', rutas: ['seguridad'] }, nuncaContiene: ['Confirmar que las custodias son las correctas'] } },
  { id: 'D63', titulo: 'Silencio de madrugada y nadie en turno', mensajes: [c('04:05', 'alguien en turno?')], ahora: '04:20', datos: [], hilo: { franja: 'madrugada', turnoCubierto: false },
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['urgencia'], escalamiento: { nivel: 'N2', motivos: ['nadie_en_turno'] } } },
  { id: 'D64', titulo: 'Cambio de turno con una petición abierta', mensajes: [c('13:45', 'eta de la caja 4?')], ahora: '13:50', datos: [], hilo: { franja: 'cambio_turno' },
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', tiposContienen: ['eta'], escalamiento: { nivel: 'N1', motivos: ['cambio_de_turno_con_pendientes'] } } },
  { id: 'D65', titulo: 'Amenaza comercial', mensajes: [c('10:00', 'si no lo tenemos hoy se cancela el proyecto; mi director está escalando')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N3', escalamiento: { nivel: 'N3', motivos: ['amenaza_comercial'] } } },
  { id: 'D66', titulo: 'Cruce en domingo (extraordinario)', mensajes: [c('11:00', '¿cruzamos el domingo?')], datos: [],
    esperado: { accion: 'escalar_gerente', nivelAviso: 'N2', tiposContienen: ['estatus_cruce'], escalamiento: { nivel: 'N2', motivos: ['dinero_o_penalizacion'] }, nuncaContiene: ['No habrá cargo / el falso es de X / se cobra X'] } },
  { id: 'D67', titulo: 'Estado de cada caja en el catálogo de 6 estados', mensajes: [c('09:30', 'ayuda con status de cada caja que ya está en embarcador')], datos: ['estatusPlanta'],
    esperado: { accion: 'responder_con_datos', nivelAviso: null, tiposContienen: ['estatus_planta_ingreso'], plantillaId: 'estatus_planta' } },
  // ── Borrador final de la ficha de unidad (ver ficha_borrador.ts) ───────────────────────────────────────────────────────
  { id: 'D68', titulo: 'Ficha pedida sin economico ni placa de la unidad: se pide a una persona, no se rellena', mensajes: [c('05:10', 'me pasas los datos de la unidad? cita 11')],
    datos: FICHA_COMPLETA.filter((x) => x !== 'eco' && x !== 'placaTracto'),
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', camposFaltantes: ['eco', 'placaTracto'], plantillaId: 'ficha_unidad', envioParcial: true } },
  { id: 'D69', titulo: 'Ficha pedida sin operador asignado: solo se piden los datos de la persona', mensajes: [c('05:20', 'datos de la unidad por favor')],
    datos: FICHA_COMPLETA.filter((x) => x !== 'operadorNombre'),
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', camposFaltantes: ['operadorNombre'], plantillaId: 'ficha_unidad', envioParcial: true } },
  { id: 'D70', titulo: 'Ficha pedida sin cita registrada: no se supone la hora', mensajes: [c('05:30', 'datos de la unidad de hoy?')],
    datos: FICHA_COMPLETA.filter((x) => x !== 'cita'),
    esperado: { accion: 'pedir_dato_a_persona', nivelAviso: 'N1', camposFaltantes: ['cita'], plantillaId: 'ficha_unidad', envioParcial: true } },
  { id: 'D71', titulo: 'Caja con un digito distinto en la ficha: se retiene y avisa al encargado', mensajes: [c('04:20', 'datos de la unidad de hoy, caja 215')], datos: [...FICHA_COMPLETA], contexto: { discrepancias: ['V2'] },
    esperado: { accion: 'avisar_encargado', nivelAviso: 'N1', tiposContienen: ['ficha_unidad'], motivoContiene: 'V2' } },
  { id: 'D72', titulo: 'Un solicitante sin verificar pide licencia y celular del operador en la ficha', mensajes: [c('15:10', 'pasame licencia y celular del operador de la caja 12')], datos: ['operadorNombre'], contexto: { solicitanteVerificado: false },
    hilo: { solicitanteNoAutorizado: true },
    esperado: { accion: 'solo_registrar', nivelAviso: 'N2', tiposContienen: ['datos_operador'], escalamiento: { nivel: 'N2', motivos: ['seguridad_o_custodia'], rutas: ['seguridad'] } } },
];

/** Diálogos de la síntesis que son disparos del sistema (sin mensaje del cliente): se prueban en `dialogos_dorados.test.ts` con el módulo que los genera. */
export const DIALOGOS_PROACTIVOS = ['D04', 'D08'] as const;
