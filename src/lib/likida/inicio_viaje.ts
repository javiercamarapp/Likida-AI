// ═══════════════════════════════════════════════════════════════════════════
// QUE EL OPERADOR DIGA CUÁL VIAJE ARRANCA, ANTES DE QUE MANDE LA PRIMERA FOTO.
//
// Hoy los gastos se anotan contra "el viaje abierto". Eso funciona mientras el
// operador traiga uno solo. Con dos asignados —o con uno que empezó y no era el
// que le tocaba— el diésel de un flete se carga a la liquidación de otro, y el
// error NO se ve: las dos liquidaciones cierran, las dos cuadran contra su
// propio anticipo, y nadie tiene por qué sospechar. Se descubre semanas después,
// cuando el contralor cruza el PDF contra la factura del cliente equivocado.
//
// Por eso esta decisión NO se adivina. Es más barato mandar un mensaje de más
// —"¿cuál de los dos?"— que abrir el viaje equivocado.
//
// Es una máquina de estados PURA: no toca Supabase, ni WhatsApp, ni el reloj.
// Vive fuera del processor por la misma razón que `intake/decidir.ts`: allá
// adentro esta decisión queda pegada a tres servicios y deja de poderse probar.
// Quien la llame se encarga del I/O; aquí solo se decide qué contestar.
// ═══════════════════════════════════════════════════════════════════════════

import { strip_accents } from './cuadre/util';

// ───────────────────────────────────────────────────────────────────────────
// CONTRATO
// ───────────────────────────────────────────────────────────────────────────

export type EstadoInicio =
  /** No hay nada que arrancar: o nunca hubo asignación, o dijo que ninguno. */
  | 'sin_viaje'
  /** Ya se le preguntó; falta que conteste. */
  | 'esperando_confirmacion'
  /** Dijo cuál. `viajeElegido` trae el id. */
  | 'confirmado'
  /** Contestó algo que no identifica UN viaje. No se elige por él. */
  | 'ambiguo';

/** Qué quiso decir el operador. */
export type Respuesta = 'confirma' | 'niega' | 'elige_numero' | 'no_entendido';

/**
 * Lo mínimo para que un humano reconozca su viaje parado junto a la unidad.
 *
 * `folio`, `origen` y `destino` son opcionales porque en la tabla real
 * (`types/likida.ts`) lo son. Si faltan NO se rellenan: un folio inventado en
 * el mensaje es exactamente la cifra falsa que este producto no se permite.
 */
export interface ViajeAsignado {
  id: string;
  folio?: string | null;
  origen?: string | null;
  destino?: string | null;
}

export interface DecisionInicio {
  estado: EstadoInicio;
  mensaje: string;
  /** Solo viene con `estado: 'confirmado'`. */
  viajeElegido?: string;
}

/**
 * Cuántos viajes se enumeran EN EL CUERPO del mensaje.
 *
 * Tres, no "todos". El mensaje se lee en el celular, de pie, junto a una
 * unidad prendida: una lista de siete renglones no se lee, se ignora. Y el
 * número que conteste solo es válido dentro de lo que SE LE ENSEÑÓ — si trae
 * cinco asignados y contesta "4", ese 4 no corresponde a nada que haya visto.
 */
export const MAX_EN_CUERPO = 3;

// ───────────────────────────────────────────────────────────────────────────
// CÓMO SE LEE A UN OPERADOR MEXICANO
// ───────────────────────────────────────────────────────────────────────────

/** Minúsculas, sin puntuación, un espacio entre palabras. CONSERVA acentos. */
function limpiar(texto: string): string {
  return String(texto ?? '')
    .toLowerCase()
    // \p{L} deja pasar letras acentuadas y tira emoji: por eso los emoji se
    // buscan aparte, sobre el texto crudo.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿Alguno de estos tokens está en la frase, como PALABRA completa? */
function tieneToken(frase: string, tokens: readonly string[]): boolean {
  const palabras = frase.split(' ');
  return tokens.some((t) => palabras.includes(t));
}

/** ¿Aparece esta secuencia de palabras? Con bordes, para no cazar pedazos. */
function tieneFrase(frase: string, frases: readonly string[]): boolean {
  const acolchado = ` ${frase} `;
  return frases.some((f) => acolchado.includes(` ${f} `));
}

function tieneEmoji(crudo: string, emojis: readonly string[]): boolean {
  return emojis.some((e) => crudo.includes(e));
}

/**
 * NO ES UNA RESPUESTA, ES UN "¿MANDE?".
 *
 * Se revisa ANTES que la negación porque todas empiezan con "no", y leer
 * "no le entendí" como un NO le cierra el viaje a alguien que solo no oyó
 * bien. Un "no entiendo" merece la pregunta otra vez, no darlo por cancelado.
 */
// OJO CON LO QUE NO ESTÁ AQUÍ: "que", "qué", "cómo" y "perdón". Se probaron y
// se sacaron. "que" vive dentro de "va que va", que es un sí de manual, y esta
// lista se revisa ANTES que todo: una palabra tan común aquí convierte medio
// español en "no te entendí".
const CONFUSION = [
  'no entiendo', 'no entendi', 'no entendí',
  'no le entiendo', 'no le entendi', 'no le entendí',
  'no te entiendo', 'no te entendi', 'no te entendí',
  'no se', 'no sé', 'no supe', 'no me quedo claro', 'no me quedó claro',
  'mande', 'mandé', 'cual', 'cuál', 'cuales', 'cuáles',
] as const;

/**
 * LA NEGACIÓN LE GANA A TODO LO DEMÁS, Y ES A PROPÓSITO.
 *
 * "ese no" trae las dos cosas: "ese" (que confirma) y "no" (que niega). Quien
 * revise el orden va a ver que se pierden confirmaciones legítimas —"sí, no hay
 * bronca" se lee como un NO— y eso está medido y aceptado: el costo de esa
 * lectura es UN mensaje de más. El costo de la lectura contraria es abrir el
 * viaje equivocado.
 *
 * Por la misma razón un número junto a una negación ("el 1 no") tampoco elige:
 * distinguir "el 1 no" de "no, el 1" pide entender dónde cae la negación, y
 * equivocarse ahí cuesta una liquidación descuadrada.
 */
const NEGACION_TOKENS = [
  'no', 'nel', 'nop', 'nope', 'nou', 'nu', 'negativo', 'nunca', 'tampoco',
  'ninguno', 'ninguna', 'ningun', 'ningún',
  // "otro" es la forma en que un operador dice "no es ese, es el de junto".
  'otro', 'otra', 'cancelado', 'cancela',
] as const;

const NEGACION_FRASES = [
  'nel pastel', 'para nada', 'todavia no', 'todavía no', 'aun no', 'aún no',
  'ahorita no', 'al rato', 'mas al rato', 'más al rato', 'ese no es',
  'el otro', 'otro viaje', 'no es ese', 'no ese', 'ese no',
] as const;

/**
 * CONFIRMACIONES FUERTES: valen aunque vengan dentro de una frase larga.
 *
 * "sí" va con acento a propósito y se busca ANTES de quitar acentos: en
 * español "si" sin acento es *condicional*, y "si llego tarde te aviso" no es
 * un sí. El "si" pelón se trata como débil (ver abajo), que es como sí lo
 * escribe la mitad de la gente cuando contesta de una palabra.
 */
const AFIRMA_FUERTE = [
  'simon', 'simón', 'claro', 'correcto', 'exacto', 'afirmativo', 'positivo',
  'confirmo', 'confirmado', 'adelante', 'ok', 'okay', 'okey', 'oki', 'okis',
  'listo', 'dale', 'vale', 'orale', 'órale', 'andale', 'ándale', 'sobres',
  'enterado', 'copiado', 'chido', 'yes', 'sip', 'sipi', 'sipis',
] as const;

/** El "sí" acentuado, que solo se puede ver antes de normalizar. */
const AFIRMA_ACENTUADO = ['sí', 'sii', 'síi', 'síí'] as const;

const AFIRMA_FRASES = [
  'va que va', 'asi es', 'así es', 'esta bien', 'está bien', 'de acuerdo',
  'ese mero', 'ese es', 'esa es', 'asi mero', 'así mero', 'sale pues',
  'va pues', 'esta bueno', 'está bueno', 'ese meritito', 'ese mismo',
] as const;

/**
 * CONFIRMACIONES DÉBILES: solo valen cuando SON toda la respuesta.
 *
 * "va" y "sale" confirman de una palabra, pero también son verbos comunes:
 * "va a llegar tarde el cliente" y "ya voy llegando a la caseta" traen "va" y
 * "ya" y no confirman nada. Un reporte de avance leído como un sí abre el
 * viaje sin que nadie lo haya dicho, que es justo lo que este módulo existe
 * para evitar. Con dos palabras o menos la ambigüedad desaparece.
 */
const AFIRMA_DEBIL = [
  'si', 'sale', 'va', 'ya', 'ese', 'esa', 'arre', 'seguro', 'bueno', 'jale',
] as const;
const MAX_PALABRAS_DEBIL = 2;

const EMOJI_SI = ['👍', '👌', '✅', '☑️', '🆗', '🙌', '💪', '☝️'] as const;
const EMOJI_NO = ['👎', '❌', '🚫', '⛔', '🙅'] as const;

// "una" NO está, y es la misma trampa que "va": es un artículo. "espérame una
// hora" traería el número 1, y con un solo viaje asignado el 1 es válido — o
// sea que un "ahorita no puedo" abriría el viaje. "uno" sí, porque como
// artículo casi no aparece suelto ("ninguno" es otro token).
const PALABRA_NUMERO: Record<string, number> = {
  uno: 1, primero: 1, primer: 1, primera: 1,
  dos: 2, segundo: 2, segunda: 2,
  tres: 3, tercero: 3, tercer: 3, tercera: 3,
};

const EMOJI_NUMERO: ReadonlyArray<readonly [string, number]> = [
  ['1️⃣', 1], ['2️⃣', 2], ['3️⃣', 3],
];

/**
 * Un número suelto solo es una ELECCIÓN dentro de una respuesta corta.
 *
 * "voy en la 57 rumbo a 2 casetas" trae un 2 y no está eligiendo nada; leerlo
 * como elección arranca un viaje por un reporte de avance. Una elección real
 * cabe en cuatro palabras: "2", "el 1", "opción 3", "quiero el número 2".
 */
const MAX_PALABRAS_NUMERO = 4;

/**
 * Qué número dijo, si dijo UNO solo.
 *
 * Dos números ("el 1 o el 2") devuelven `null` a propósito: eso no es una
 * elección, es una pregunta. Y un folio con dígitos ("V-1042") tampoco cuenta,
 * porque solo se aceptan dígitos sueltos del 1 al 9 como palabra completa.
 *
 * Aquí NO se valida el rango: este módulo no sabe cuántas opciones se
 * enseñaron. Eso lo revisa `decidirInicio`, que sí las armó.
 */
export function numeroElegido(texto: string): number | null {
  const crudo = String(texto ?? '');
  const encontrados = new Set<number>();

  // Los emoji de teclado no tienen otra lectura posible, así que valen aunque
  // vengan dentro de un mensaje largo.
  for (const [emoji, n] of EMOJI_NUMERO) {
    if (crudo.includes(emoji)) encontrados.add(n);
  }

  const palabras = strip_accents(limpiar(crudo)).split(' ').filter(Boolean);
  if (palabras.length <= MAX_PALABRAS_NUMERO) {
    for (const p of palabras) {
      if (/^[1-9]$/.test(p)) encontrados.add(Number(p));
      else if (PALABRA_NUMERO[p] != null) encontrados.add(PALABRA_NUMERO[p]);
    }
  }

  return encontrados.size === 1 ? [...encontrados][0] : null;
}

/**
 * Qué quiso decir. El orden de las revisiones ES la regla de seguridad:
 * confusión → negación → número → afirmación. Ver los comentarios de cada
 * lista; ninguno de esos cuatro pasos se puede mover sin cambiar qué error
 * comete el agente cuando duda.
 */
export function interpretarRespuesta(texto: string): Respuesta {
  const crudo = String(texto ?? '');
  const conAcentos = limpiar(crudo);
  const sinAcentos = strip_accents(conAcentos);

  // Sin texto y sin emoji no hay nada que interpretar. Callarse no es un sí.
  if (!conAcentos && !crudo.trim()) return 'no_entendido';

  if (tieneFrase(conAcentos, CONFUSION) || tieneToken(conAcentos, CONFUSION)) {
    return 'no_entendido';
  }

  if (
    tieneEmoji(crudo, EMOJI_NO) ||
    tieneToken(sinAcentos, NEGACION_TOKENS.map(strip_accents)) ||
    tieneFrase(sinAcentos, NEGACION_FRASES.map(strip_accents))
  ) {
    return 'niega';
  }

  if (numeroElegido(crudo) != null) return 'elige_numero';

  const corta = conAcentos.split(' ').filter(Boolean).length <= MAX_PALABRAS_DEBIL;
  if (
    tieneEmoji(crudo, EMOJI_SI) ||
    tieneToken(conAcentos, AFIRMA_ACENTUADO) ||
    tieneToken(sinAcentos, AFIRMA_FUERTE.map(strip_accents)) ||
    tieneFrase(sinAcentos, AFIRMA_FRASES.map(strip_accents)) ||
    (corta && tieneToken(sinAcentos, AFIRMA_DEBIL.map(strip_accents)))
  ) {
    return 'confirma';
  }

  return 'no_entendido';
}

// ───────────────────────────────────────────────────────────────────────────
// CÓMO SE NOMBRA UN VIAJE EN UN MENSAJE DE WHATSAPP
// ───────────────────────────────────────────────────────────────────────────

/**
 * Se dice cuando el viaje no trae con qué reconocerlo.
 *
 * El id es un UUID: enseñárselo al operador no lo ayuda a identificar nada y
 * hace ver el producto roto. Se declara el hueco, que es lo que CLAUDE.md pide
 * cuando falta el dato, en vez de rellenarlo.
 */
export const SIN_SEÑAS = '(sin folio ni ruta registrados)';

/** El renglón con el que un humano reconoce su viaje. Nunca inventa datos. */
export function señaViaje(v: ViajeAsignado): string {
  const folio = v.folio?.trim();
  const origen = v.origen?.trim();
  const destino = v.destino?.trim();

  const ruta = origen && destino
    ? `${origen} → ${destino}`
    : origen
      ? `sale de ${origen}`
      : destino
        ? `va a ${destino}`
        : '';

  if (folio && ruta) return `*${folio}* — ${ruta}`;
  if (folio) return `*${folio}*`;
  if (ruta) return ruta;
  return SIN_SEÑAS;
}

/** "1", "1 o 2", "1, 2 o 3" — para pedirle el número sin que cuente él. */
function listaNumeros(n: number): string {
  if (n <= 1) return '1';
  const previos = Array.from({ length: n - 1 }, (_, i) => String(i + 1));
  return `${previos.join(', ')} o ${n}`;
}

// ───────────────────────────────────────────────────────────────────────────
// LA MÁQUINA
// ───────────────────────────────────────────────────────────────────────────

export interface ArgsInicio {
  viajesAsignados: ViajeAsignado[];
  /** Lo último que escribió. Vacío o ausente = todavía no se le pregunta. */
  respuesta?: string;
  /**
   * Cuál intento es este. 1 = su primera respuesta.
   *
   * Existe porque "se vuelve a preguntar UNA vez" no se puede cumplir sin
   * memoria, y esta función no tiene ninguna. En el intento 1 que no se
   * entiende se repregunta más simple; del 2 en adelante ya no se insiste: se
   * manda con el encargado. Repreguntar en bucle a alguien manejando no
   * consigue la respuesta, solo entrena a ignorar al bot.
   */
  intento?: number;
}

export function decidirInicio(args: ArgsInicio): DecisionInicio {
  const viajes = Array.isArray(args?.viajesAsignados) ? args.viajesAsignados : [];
  const respuesta = args?.respuesta?.trim() ?? '';
  const intento = Number.isFinite(args?.intento) ? Number(args.intento) : 1;

  // ── SIN NINGUNO ──────────────────────────────────────────────────────────
  // Antes que nada, y sin importar qué haya contestado: si no hay lista, no
  // hay nada que confirmar. Un "sí" no puede materializar un viaje.
  //
  // OJO QUIEN LLAME: una consulta que FALLÓ no puede llegar aquí como lista
  // vacía. Sería la trampa de `exigir()` en `analytics.ts` —base caída leída
  // como "no hay nada"— y aquí el resultado es peor: al operador se le diría
  // que no le asignaron viaje cuando sí se lo asignaron.
  if (viajes.length === 0) {
    return {
      estado: 'sin_viaje',
      mensaje:
        'No traes ningún viaje asignado ahorita.\n\n' +
        'Pídele a tu encargado que te asigne el que vas a hacer y aquí te aviso. ' +
        'Mientras no haya viaje abierto no puedo anotar tus gastos: no sabría a cuál cargarlos.',
    };
  }

  const enumerados = Math.min(MAX_EN_CUERPO, viajes.length);
  const unoSolo = viajes.length === 1;

  // ── TODAVÍA NO CONTESTA: se le pregunta ──────────────────────────────────
  if (!respuesta) return preguntar(viajes, enumerados, unoSolo);

  const leido = interpretarRespuesta(respuesta);

  // ── DIJO QUE NO ──────────────────────────────────────────────────────────
  // Queda en `sin_viaje` y no en `esperando_confirmacion`: repetirle la misma
  // pregunta a alguien que ya dijo que no es no haberlo escuchado. Y `sin_viaje`
  // es la verdad operativa —no hay viaje abierto—, que es lo que protege la
  // liquidación: sin viaje abierto, ningún gasto se carga a nadie.
  if (leido === 'niega') {
    return {
      estado: 'sin_viaje',
      mensaje: unoSolo
        ? 'Va, no lo arranco.\n\n' +
          'Si el que te toca es otro, pídeselo a tu encargado y aquí te aviso en cuanto caiga. ' +
          'Mientras tanto no anoto gastos: se irían al viaje equivocado.'
        : 'Va, entonces ninguno de esos.\n\n' +
          'Pídele a tu encargado que te asigne el que sí vas a hacer. ' +
          'Mientras tanto no anoto gastos: se irían al viaje equivocado.',
    };
  }

  // ── ELIGIÓ POR NÚMERO ────────────────────────────────────────────────────
  if (leido === 'elige_numero') {
    const n = numeroElegido(respuesta);
    // El rango es lo que SE LE ENSEÑÓ, no cuántos trae asignados. Con cinco
    // asignados solo vio tres, y un "4" no señala nada que haya leído.
    if (n != null && n >= 1 && n <= enumerados) {
      return confirmar(viajes[n - 1]);
    }
    return dudar(viajes, enumerados, unoSolo, intento, 'fuera_de_rango');
  }

  // ── DIJO QUE SÍ ──────────────────────────────────────────────────────────
  if (leido === 'confirma') {
    // Con uno solo, "sí" alcanza: no hay a qué otro pudo haberse referido.
    if (unoSolo) return confirmar(viajes[0]);
    // Con varios, "sí" no dice CUÁL. Es exactamente el caso que descuadra la
    // liquidación si se resuelve tomando el primero de la lista.
    return dudar(viajes, enumerados, unoSolo, intento, 'si_pero_cual');
  }

  // ── NO SE ENTENDIÓ ───────────────────────────────────────────────────────
  return dudar(viajes, enumerados, unoSolo, intento, 'no_entendido');
}

function preguntar(
  viajes: ViajeAsignado[],
  enumerados: number,
  unoSolo: boolean,
): DecisionInicio {
  if (unoSolo) {
    return {
      estado: 'esperando_confirmacion',
      mensaje:
        '¿Arrancas este viaje?\n\n' +
        `${señaViaje(viajes[0])}\n\n` +
        'Contéstame *sí* o *no*.',
    };
  }

  const lista = viajes
    .slice(0, enumerados)
    .map((v, i) => `${i + 1}) ${señaViaje(v)}`)
    .join('\n');

  // El renglón del sobrante solo aparece cuando hay sobrante. Ofrecerle "otro"
  // siempre lo invitaría a rechazar una lista que ya está completa.
  const sobran = viajes.length - enumerados;
  const escape = sobran > 0
    ? `\n\nSi el tuyo no está aquí, contéstame *otro* (traes ${sobran} más).`
    : '';

  return {
    estado: 'esperando_confirmacion',
    mensaje:
      `Traes ${viajes.length} viajes asignados. ¿Cuál vas a arrancar?\n\n` +
      `${lista}\n\n` +
      `Contéstame con el número: ${listaNumeros(enumerados)}.${escape}`,
  };
}

function confirmar(v: ViajeAsignado): DecisionInicio {
  return {
    estado: 'confirmado',
    viajeElegido: v.id,
    mensaje:
      '✅ Va, arrancamos:\n\n' +
      `${señaViaje(v)}\n\n` +
      'Mándame las fotos de tus tickets conforme vayan saliendo y los voy anotando a este viaje.',
  };
}

type MotivoDuda = 'no_entendido' | 'si_pero_cual' | 'fuera_de_rango';

/**
 * No se entendió, y NO se elige por él.
 *
 * Se repregunta más simple UNA vez. A la segunda se para: quien va manejando y
 * ya contestó dos veces algo que no se entiende no va a acertar a la tercera, y
 * el agente estaría a un mensaje de darse por vencido y tomar el primero de la
 * lista. Se pasa a un humano, que sí puede llamarle.
 */
function dudar(
  viajes: ViajeAsignado[],
  enumerados: number,
  unoSolo: boolean,
  intento: number,
  motivo: MotivoDuda,
): DecisionInicio {
  if (intento >= 2) {
    return {
      estado: 'ambiguo',
      mensaje:
        'Sigo sin entenderte y prefiero no arrancar el viaje equivocado: los gastos se irían ' +
        'a la liquidación de otro y eso ya no se nota hasta el cierre.\n\n' +
        'Márcale a tu encargado para que él lo abra.',
    };
  }

  const disculpa = motivo === 'no_entendido' ? 'Perdón, no te entendí.\n\n' : '';

  // Se repite el MISMO acomodo de la primera pregunta, no uno nuevo: repreguntar
  // "más simple" es repetir lo que ya se leyó bien, no reescribirlo. Meter el
  // folio y la ruta dentro del signo de interrogación hacía un renglón que no
  // se lee de corrido.
  if (unoSolo) {
    return {
      estado: 'ambiguo',
      mensaje:
        disculpa +
        '¿Arrancas este viaje?\n\n' +
        `${señaViaje(viajes[0])}\n\n` +
        'Contéstame *sí* o *no*.',
    };
  }

  const encabezado = motivo === 'si_pero_cual'
    ? `Sí, pero ¿cuál? Traes ${viajes.length}.\n\n`
    : motivo === 'fuera_de_rango'
      ? `Te puse ${enumerados} opciones.\n\n`
      : disculpa;

  return {
    estado: 'ambiguo',
    mensaje: encabezado + `Contéstame nomás con el número: ${listaNumeros(enumerados)}.`,
  };
}
