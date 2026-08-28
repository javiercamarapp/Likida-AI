import { TZ_MX } from '@/lib/formato';
import { logger } from '@/lib/logger';
import { strip_accents } from '../cuadre/util';
import { componerJornada, aHoras, type Asiento, type TipoAsiento } from './modelo';
import {
  asegurarDiaJornada, asentarMarca, diaMxDe, idDeJornada, jornadaQueCierra, sellarConformidad,
  type ResultadoAsiento,
} from './repo';

// ═══════════════════════════════════════════════════════════════════════════
// LA CAPTURA POR WHATSAPP — que es donde de verdad está el operador.
//
// Se reusa el canal y el motor de conversación que Likida ya tiene; esto es
// otro reconocedor más en la fila del `processor`, con exactamente el mismo
// contrato que `hitos_viaje.ts` (0090): lista CERRADA, frase COMPLETA, y lo que
// no esté en la lista sigue su camino.
//
// ── POR QUÉ TODAS LAS FRASES LLEVAN «JORNADA», «DESCANSO» O «COMER» ──────
//
// No es estilo: es la manera de garantizar CERO solape con los reconocedores
// que ya viven en esa fila. Los hitos hablan de llegar y descargar; la
// asistencia, de choques y varados; la talacha, de llantas. Ninguno menciona
// jornada ni descanso, y este no menciona nada de aquéllos. Un reconocedor que
// se come el mensaje de otro no falla ruidosamente: falla registrando el hecho
// equivocado, y aquí ese hecho es un dato laboral.
//
// ── LA HORA ES LA DEL MENSAJE, Y ESO SE DICE ─────────────────────────────
//
// Igual que en los hitos (DAT-38): el sello guarda la hora en que el mensaje
// llegó, no la del evento físico. El acuse dice «anotado: iniciaste a las
// 06:12» porque ESA es la anotación, y la procedencia queda
// `declarado_operador` — nunca se presenta como telemetría.
//
// ── LA CONFORMIDAD ES APARTE, Y EXIGE LA PALABRA ─────────────────────────
//
// El tercer párrafo del art. 132 fr. XXXIV dice que el registro «hará prueba
// plena si se acredita que fue acordado entre la persona trabajadora y
// empleadora». Un «ok» pelón NO es ese acuerdo: es un acuse de recibo. Por eso
// las frases de conformidad exigen la palabra «jornada» — el listón de lo que
// va a valer como prueba plena tiene que ser más alto que el de un pulgar
// arriba, no más bajo.
// ═══════════════════════════════════════════════════════════════════════════

/** Largo máximo del texto que este módulo mira. Igual que en los hitos: lo que
 *  trae más contexto no es una marca, es una conversación. */
const MAX_LARGO = 60;

/** minúsculas, sin acentos, sin puntuación/emoji, espacios colapsados. */
function limpiar(texto: string): string {
  return strip_accents(texto.toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Las formas reales de cada marca, ya normalizadas. Cerradas: agregar una
 *  frase = una línea y un caso en el test. */
const FRASES: Readonly<Record<TipoAsiento, readonly string[]>> = {
  inicio_jornada: [
    'inicio jornada', 'inicio de jornada', 'inicio mi jornada', 'inicia mi jornada',
    'empiezo jornada', 'empiezo mi jornada', 'arranco jornada', 'arranco mi jornada',
    'comienzo jornada', 'comienzo mi jornada', 'inicio turno', 'inicio de turno',
    'inicio mi turno', 'empiezo mi turno',
  ],
  fin_jornada: [
    'fin jornada', 'fin de jornada', 'fin de mi jornada', 'termino jornada',
    'termino mi jornada', 'termine jornada', 'termine mi jornada',
    'acabo mi jornada', 'acabe mi jornada', 'cierro jornada', 'cierro mi jornada',
    'fin turno', 'fin de turno', 'termine mi turno', 'termino mi turno',
  ],
  inicio_descanso: [
    'inicio descanso', 'inicio mi descanso', 'inicio de descanso',
    'empiezo mi descanso', 'voy a descansar', 'me voy a descansar',
    'paro a descansar', 'inicio comida', 'inicio mi comida', 'voy a comer',
    'me voy a comer', 'paro a comer',
  ],
  fin_descanso: [
    'fin descanso', 'fin de descanso', 'fin de mi descanso', 'termino descanso',
    'termino mi descanso', 'termine mi descanso', 'termine el descanso',
    'ya descanse', 'regreso del descanso', 'ya regrese del descanso',
    'fin de comida', 'termine mi comida', 'termine de comer', 'ya comi',
  ],
};

const INDICE = new Map<string, TipoAsiento>();
for (const tipo of Object.keys(FRASES) as TipoAsiento[]) {
  for (const f of FRASES[tipo]) INDICE.set(f, tipo);
}

/**
 * La conformidad del operador con su registro (LFT 132 fr. XXXIV, párr. 3).
 * TODAS exigen la palabra «jornada»: ver el encabezado.
 */
const FRASES_CONFORMIDAD: readonly string[] = [
  'confirmo mi jornada', 'confirmo jornada', 'de acuerdo con mi jornada',
  'estoy de acuerdo con mi jornada', 'si estoy de acuerdo con mi jornada',
  'mi jornada esta bien', 'esta bien mi jornada', 'asi fue mi jornada',
  'correcta mi jornada', 'es correcta mi jornada',
];
const CONFORMIDAD = new Set(FRASES_CONFORMIDAD);

/**
 * ¿El mensaje es una marca de jornada? `null` = no lo es y sigue su camino.
 *
 * Una PREGUNTA nunca marca: «¿ya termino mi jornada?» es alguien preguntando,
 * no declarando — y `limpiar` le quitaría los signos y lo volvería
 * indistinguible de la afirmación. Mismo criterio que los hitos.
 */
export function interpretarMarcaJornada(texto: string | undefined): TipoAsiento | null {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  if (texto.length > MAX_LARGO) return null;
  if (/[?¿]/.test(texto)) return null;
  return INDICE.get(limpiar(texto)) ?? null;
}

/** ¿El mensaje es la conformidad del operador con su registro? */
export function interpretarConformidadJornada(texto: string | undefined): boolean {
  if (typeof texto !== 'string' || !texto.trim()) return false;
  if (texto.length > MAX_LARGO) return false;
  if (/[?¿]/.test(texto)) return false;
  return CONFORMIDAD.has(limpiar(texto));
}

function horaMx(momento: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TZ_MX, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(momento);
}

export interface ResultadoMarcaWa {
  resultado: ResultadoAsiento;
  respuesta: string;
  /** El expediente al que se asentó, para el log del llamador. */
  jornadaId: string | null;
  /** El día al que quedó asentada, que puede NO ser el del mensaje. */
  dia: string | null;
}

/**
 * Atiende una marca declarada por el operador.
 *
 * ── A QUÉ DÍA VA UNA MARCA DE MADRUGADA ──────────────────────────────────
 *
 * Una jornada que arranca a las 18:00 y termina a las 02:00 es UNA jornada, no
 * dos días de media. Por defecto la marca va al día de México de su propio
 * mensaje; pero un `fin_jornada` (o un `fin_descanso`) que llega con el
 * expediente de AYER abierto —con inicio vivo, sin fin, y a menos de 24 h de
 * ese inicio— cierra ESE, que es la jornada que de verdad está cerrando.
 *
 * Y cuando eso pasa QUEDA ESCRITO en `detalle`: el día del mensaje, el día al
 * que se asentó y por qué. La atribución es una decisión del sistema, y una
 * decisión del sistema sobre un dato laboral no puede ser invisible.
 */
export async function atenderMarcaJornada(args: {
  tenantId: string;
  operadorId: string;
  tipo: TipoAsiento;
  momento: Date;
  texto: string;
  waMessageId: string | null;
  viajeId?: string | null;
}): Promise<ResultadoMarcaWa> {
  const diaMensaje = diaMxDe(args.momento);
  let dia = diaMensaje;
  let detalle: Record<string, unknown> = { frase: args.texto.slice(0, 120), dia_del_mensaje: diaMensaje };

  if (args.tipo === 'fin_jornada' || args.tipo === 'fin_descanso') {
    const anterior = await jornadaQueCierra(args.tenantId, args.operadorId, diaMensaje, args.momento);
    if (anterior.error) {
      logger.error('jornada.wa_dia_anterior_ilegible', { operador: args.operadorId, err: anterior.error });
      return {
        resultado: 'fallo',
        respuesta: 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏',
        jornadaId: null,
        dia: null,
      };
    }
    if (anterior.jornada) {
      dia = anterior.jornada.dia;
      detalle = {
        ...detalle,
        asentado_en_dia: dia,
        motivo_de_atribucion: 'cierra la jornada que quedó abierta del día anterior (menos de 24 h desde su inicio)',
      };
    }
  }

  const expediente = await asegurarDiaJornada(args.tenantId, args.operadorId, dia);
  if ('error' in expediente) {
    return {
      resultado: 'fallo',
      respuesta: 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏',
      jornadaId: null,
      dia,
    };
  }

  const resultado = await asentarMarca({
    jornadaId: expediente.id,
    tenantId: args.tenantId,
    tipo: args.tipo,
    momento: args.momento,
    procedencia: 'declarado_operador',
    waMessageId: args.waMessageId,
    viajeId: args.viajeId ?? null,
    detalle,
  });

  return {
    resultado,
    respuesta: mensajeMarca(args.tipo, resultado, args.momento, dia !== diaMensaje ? dia : null),
    jornadaId: expediente.id,
    dia,
  };
}

/**
 * El acuse al operador. Corto, con la hora ANOTADA, y sin regañar.
 *
 * Dice «anoté» y no «trabajaste»: lo que Likida guarda es lo que él declaró, y
 * el acuse tiene que sonar a lo que es — un recibo de su declaración, no un
 * veredicto sobre su día.
 */
export function mensajeMarca(
  tipo: TipoAsiento,
  resultado: ResultadoAsiento,
  momento: Date,
  diaDistinto: string | null,
): string {
  if (resultado === 'fallo') return 'No pude anotarlo ahorita — mándamelo de nuevo en un momento. 🙏';
  if (resultado === 'ya_estaba') return 'Ya lo tenía anotado. 👍';
  const hora = horaMx(momento);
  const nota = diaDistinto ? ` (queda en tu jornada del ${diaDistinto}, que traías abierta)` : '';
  switch (tipo) {
    case 'inicio_jornada':
      return `Anoté que iniciaste tu jornada a las ${hora}. 🕕 Cuando pares a comer o a descansar, mándame «inicio descanso».`;
    case 'fin_jornada':
      return `Anoté que terminaste tu jornada a las ${hora}${nota}. 🕗 Ahorita te paso el resumen del día.`;
    case 'inicio_descanso':
      return `Anoté tu descanso desde las ${hora}. ☕ Cuando regreses, mándame «fin de descanso».`;
    case 'fin_descanso':
      return `Anoté que regresaste del descanso a las ${hora}${nota}. 👍`;
  }
}

/**
 * El resumen que se le manda al operador cuando cierra su jornada, y la
 * petición de conformidad.
 *
 * ES LA PIEZA QUE PERSIGUE LA «PRUEBA PLENA» del art. 132 fr. XXXIV: el
 * registro vale más si se acredita que fue acordado. Para poder acordar algo
 * hay que verlo primero, así que se le enseña EXACTAMENTE lo que quedó
 * escrito, incluidas las marcas que no puso él.
 *
 * Y si falta algo, se dice: nunca se le enseña un total redondo construido con
 * una hora que nadie declaró.
 */
export function resumenParaOperador(dia: string, asientos: readonly Asiento[]): string {
  const j = componerJornada(asientos);
  const lineas: string[] = [`Tu jornada del ${dia}:`];

  lineas.push(j.inicio ? `• Inicio: ${horaMx(new Date(j.inicio.momento))}${sufijoProcedencia(j.inicio)}` : '• Inicio: no lo tengo anotado.');
  lineas.push(j.fin ? `• Fin: ${horaMx(new Date(j.fin.momento))}${sufijoProcedencia(j.fin)}` : '• Fin: no lo tengo anotado.');

  if (j.descansos.length === 0) {
    lineas.push('• Descansos: no me reportaste ninguno.');
  } else {
    for (const d of j.descansos) {
      const desde = horaMx(new Date(d.inicio.momento));
      lineas.push(
        d.fin
          ? `• Descanso: ${desde} a ${horaMx(new Date(d.fin.momento))} (${d.minutos} min)`
          : `• Descanso: desde las ${desde}, sin regreso anotado.`,
      );
    }
  }

  const horas = aHoras(j.minutosEfectivos ?? j.minutosBrutos);
  lineas.push(
    horas === null
      ? '• Total: no lo puedo calcular con lo que tengo. No lo voy a suponer.'
      : `• Total: ${horas} h.`,
  );

  lineas.push('');
  lineas.push('Si así fue, contéstame «confirmo mi jornada». Si algo no cuadra, dime qué y lo corrige la oficina.');
  return lineas.join('\n');
}

/** De dónde salió la marca, dicho en corto y en el idioma del chofer. */
function sufijoProcedencia(a: Asiento): string {
  switch (a.procedencia) {
    case 'declarado_operador': return ' (me lo dijiste tú)';
    case 'hito_viaje': return ' (lo saqué de tu aviso del viaje)';
    case 'gps': return ' (lo saqué del GPS de la unidad)';
    case 'capturado_contralor': return ' (lo capturó la oficina)';
  }
}

/**
 * Atiende la conformidad. El sello es idempotente por el `WHERE ... IS NULL` de
 * `sellarConformidad`: el mismo mensaje reentregado por Meta no mueve la hora
 * del acuerdo.
 */
export async function atenderConformidadJornada(args: {
  tenantId: string;
  operadorId: string;
  momento: Date;
  waMessageId: string | null;
}): Promise<{ resultado: 'sellada' | 'ya_estaba' | 'fallo' | 'sin_dia'; respuesta: string }> {
  // Sin id de mensaje no hay evidencia del acuerdo, y sin evidencia no se
  // sella: es exactamente lo que el constraint de la 0241 exige. Falla cerrado
  // y se le dice al operador en vez de fingir que quedó.
  if (!args.waMessageId) {
    return {
      resultado: 'fallo',
      respuesta: 'No pude registrar tu confirmación ahorita — mándamela otra vez en un momento. 🙏',
    };
  }

  const dia = diaMxDe(args.momento);
  const abierta = await jornadaQueCierra(args.tenantId, args.operadorId, dia, args.momento);
  if (abierta.error) {
    return { resultado: 'fallo', respuesta: 'No pude registrar tu confirmación ahorita — mándamela otra vez en un momento. 🙏' };
  }

  // La conformidad es sobre el día que acaba de cerrar; si no hay expediente de
  // ayer abierto, es sobre el de hoy — y si tampoco existe, no hay qué
  // confirmar y se dice.
  const objetivo = abierta.jornada?.id ?? (await idDeJornada(args.tenantId, args.operadorId, dia));
  if (!objetivo) {
    return {
      resultado: 'sin_dia',
      respuesta: 'Todavía no tengo un registro de jornada tuyo que confirmar. Mándame «inicio jornada» cuando arranques. 👍',
    };
  }

  const sello = await sellarConformidad({
    tenantId: args.tenantId, jornadaId: objetivo, waMessageId: args.waMessageId, ahora: args.momento,
  });
  if (sello === 'fallo') {
    return { resultado: 'fallo', respuesta: 'No pude registrar tu confirmación ahorita — mándamela otra vez en un momento. 🙏' };
  }
  return {
    resultado: sello,
    respuesta: sello === 'ya_estaba'
      ? 'Ya tenía tu confirmación. 👍'
      : 'Listo, quedó tu confirmación de la jornada. Gracias. 🙌',
  };
}
