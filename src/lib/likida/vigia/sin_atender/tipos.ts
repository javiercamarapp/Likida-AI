// ═══ CONTRATO: src/lib/likida/vigia/sin_atender/tipos.ts (el carril MOTOR lo escribe; el carril AVISOS puede crear una copia IDENTICA byte a byte en su worktree para compilar: git fusiona sin conflicto dos altas idénticas. Prohibido cambiar su forma; si hace falta, se reporta). ═══
// Puro: sin red, sin base, sin IA, sin logs. Solo type-imports de ../turnos.
import type { TurnoActual } from '../turnos';

export type RolChat = 'cliente' | 'equipo';

/** Mensaje normalizado. MensajeHistorial (historial/export_whatsapp.ts) es asignable tal cual. */
export interface MensajeChat {
  /** ISO 8601 UTC. Fecha ilegible => el mensaje se ignora y se cuenta. */
  enviadoEn: string;
  rol: RolChat;
  /** Hash corto del autor (12 hex). NUNCA el nombre. */
  autorHash: string;
  /** Texto ya con telefonos y correos tapados. El motor no lo registra ni lo envia a ningun lado. */
  texto: string;
  /** El mensaje trae archivo/imagen/audio (opcional). */
  adjunto?: boolean;
}

/** Un chat (un grupo exportado). */
export interface ChatEntrada {
  /** Id estable y opaco (el id del grupo). */
  chatId: string;
  /** Nombre del grupo, para pantalla y correo. */
  nombre: string;
  /** Grupo critico => usa umbralCriticoMin. */
  critico: boolean;
  /** Cualquier orden; el motor ordena estable y deduplica (enviadoEn, autorHash, texto). */
  mensajes: readonly MensajeChat[];
  /** Instante de la foto (ms epoch) de ESTA exportacion. Si falta, se usa ahoraMs. La antiguedad se mide contra el. */
  fotoMs?: number;
}

export const MOTIVOS_SIN_ATENDER = ['espera_sobre_umbral', 'insistencia', 'urgencia', 'pregunta', 'palabra_clave'] as const;
export type MotivoSinAtender = (typeof MOTIVOS_SIN_ATENDER)[number];
export type NivelAlerta = 'alta' | 'normal';

export interface ConfigSinAtender {
  /** Minutos sin respuesta para avisar (grupo normal). 1-1440. Default 30 (igual que vigia_config.slaRespuestaMin). El 5 y el 10 hablados NO son reglas fijadas. */
  umbralMin: number;
  /** Idem para grupo critico. 1-1440. Default 10 (igual que slaCriticoMin). */
  umbralCriticoMin: number;
  /** Umbral para hilos con urgencia o palabra clave. 1-1440, se aplica min(esto, umbral del grupo). Default 10. */
  umbralUrgenteMin: number;
  /** Mensajes sustantivos del cliente seguidos sin respuesta que disparan 'insistencia'. 0 = apagado. Default 2 ("pregunta dos veces"). */
  insistenciaMin: number;
  /** Ventana (min) en la que cuentan para insistencia. Default 120. */
  insistenciaVentanaMin: number;
  /** Palabras o frases EXTRA que marcan urgencia (se suman a las de prioridadDe). Max 30, 40 car. cada una. Comparacion por tokens, nunca RegExp. */
  palabrasUrgentes: readonly string[];
  /** Palabras que marcan tema importante (motivo palabra_clave). Default ['embarque', 'embarques']. */
  palabrasClave: readonly string[];
  /** Hashes de autor que cuentan como equipo aunque la fila diga cliente (reclasificar sin resubir). */
  equipoHashes: readonly string[];
  /** Una respuesta del equipo mas tarde que esto NO cierra el mensaje. null = cualquier respuesta posterior lo cierra (default). */
  ventanaRespuestaMin: number | null;
  /** Para calcular el turno de cada alerta (solo etiqueta; no oculta nada). IANA. Default TZ_MX. */
  zona: string;
  /** Festivos 'YYYY-MM-DD' de la flota. */
  festivos: readonly string[];
  /** Ventana de noche (hora local). Default { desdeHora: 20, hastaHora: 7 } (turnos.ts NOCHE_POR_OMISION). */
  noche: { desdeHora: number; hastaHora: number };
  /** Tope de alertas por chat. Default 3. */
  maxAlertasPorChat: number;
  /** Largo maximo de vistaPrevia. 0 (default) => vistaPrevia siempre null. La pantalla pasa 160; el correo NUNCA la usa. */
  vistaPreviaMax: number;
}

export interface AlertaSinAtender {
  chatId: string;
  chatNombre: string;
  critico: boolean;
  nivel: NivelAlerta;
  motivos: readonly MotivoSinAtender[];
  /** ISO del primer mensaje sin atender del hilo. */
  desde: string;
  /** ISO del ultimo mensaje sin atender del hilo. */
  ultimoEn: string;
  /** ISO de la foto contra la que se midio. */
  fotoEn: string;
  /** Minutos enteros entre desde y la foto (>= 0). */
  antiguedadMin: number;
  /** Umbral que se aplico a este hilo. */
  umbralAplicadoMin: number;
  /** max(0, antiguedadMin - umbralAplicadoMin). */
  excesoMin: number;
  mensajesSinAtender: number;
  preguntasSinAtender: number;
  /** Turno del instante `desde`: dia | noche | festivo (turnos.ts turnoActual). */
  turno: TurnoActual;
  /** Idempotente: sha256 hex (32 primeros) de `${chatId}|${Date.parse(desde)}|${nivel}`. */
  clave: string;
  /** Recorte del ultimo mensaje sin atender (ya sin telefonos/correos) o null si vistaPreviaMax = 0. */
  vistaPrevia: string | null;
}

export interface ResumenSinAtender {
  chatsRevisados: number;
  chatsConAlerta: number;
  alertas: number;
  altas: number;
  normales: number;
  /** Mensajes de cliente ignorados por prioridadDe nivel 0. */
  ignorados: number;
  mensajesAnalizados: number;
  /** Mensajes descartados por fecha ilegible o duplicados exactos. */
  descartados: number;
  masAntiguaMin: number | null;
  porTurno: Record<TurnoActual, number>;
}

export interface ResultadoSinAtender {
  /** ISO de ahoraMs. */
  ahoraEn: string;
  /** Ya ordenadas con ordenarAlertas. */
  alertas: AlertaSinAtender[];
  resumen: ResumenSinAtender;
}
