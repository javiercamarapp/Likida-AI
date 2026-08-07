import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { mxn } from '@/lib/formato';
import { acotada } from './presupuesto';
import { traerTodo } from './pg';
import { ConsultaFallida } from './conv';

// ═══════════════════════════════════════════════════════════════════════════
// EL JEFE DE FLOTA DESPACHA DESDE WHATSAPP.
//
// Hoy un viaje solo nace en el panel. El chofer ya vive en WhatsApp —por ahí
// manda sus tickets y por ahí recibe su liquidación— y el jefe está en la misma
// aplicación contestándole; abrir el navegador para teclear "Puebla → Monterrey"
// es el paso que hace que los viajes se capturen tarde, o no se capturen.
//
// ── LO QUE ESTE MÓDULO NO HACE, A PROPÓSITO ──────────────────────────────
//
// No crea nada. `interpretarPeticionViaje` es PURA: lee un texto y devuelve lo
// que entendió. La escritura sigue siendo `crearViaje()` de `operacion.ts`, y
// entre las dos tiene que pasar `resumenParaConfirmar` por la pantalla del jefe.
//
// La razón no es de arquitectura, es de consecuencia: `crearViaje` le manda un
// WhatsApp al chofer en cuanto el insert vuelve (`avisarAlChofer`). O sea que
// un falso positivo de este parser no ensucia una tabla — le dice a una persona
// que salga a carretera. Eso no se hace sin que el jefe lea antes qué se va a
// crear.
//
// ── POR QUÉ EXPRESIONES REGULARES Y NO UN MODELO ─────────────────────────
//
// Mismo criterio que `consulta_chofer.ts`, y aquí pesa más: la regla número uno
// del producto es no inventar una cifra, y el campo que más importa de este
// mensaje ES una cifra. Un modelo que lee "12,5" y contesta 12,500 no deja
// rastro de que adivinó. La regla o entiende el número o dice que no lo
// entendió — y esa segunda rama es la que protege la liquidación.
//
// Un jefe escribe de cinco formas, no de mil. Lo que la regla no entienda cae
// al agente de siempre: esto es un ATAJO delante de él, no un reemplazo.
//
// ── EL ERROR CARO ES EL FALSO POSITIVO ───────────────────────────────────
//
// Devolver `null` cuesta que el mensaje siga su camino normal. Devolver `crear`
// sobre un mensaje que no lo era arranca un viaje con datos falsos, escribe un
// anticipo que nadie autorizó, y le manda a un chofer un aviso de salida. Por
// eso todo lo dudoso cae a `incompleto` o a `null`, nunca a `crear`.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que se alcanzó a entender del mensaje. Cada campo, `null` si no se leyó. */
export interface ViajeParcial {
  /** El TEXTO que escribió el jefe. No es un `operador_id` — ver `resolverOperadorPorNombre`. */
  operador: string | null;
  origen: string | null;
  destino: string | null;
  /** Pesos. `null` = no lo dijo, o lo dijo y no se entendió. Nunca una aproximación. */
  anticipo: number | null;
  /** El número económico tal cual lo escribió. No es un `unidad_id`. */
  unidad: string | null;
}

/**
 * Qué pidió el jefe.
 *
 * - `crear` — se entendió todo lo indispensable (operador + ruta completa) y
 *   ninguna cifra quedó en duda. Sigue faltando la confirmación humana.
 * - `incompleto` — era una petición de viaje, pero falta algo o algo no se
 *   entendió. `falta` lleva las claves: `operador`, `origen`, `destino`,
 *   `ruta` (los dos), `anticipo` (lo dijo y no se pudo leer) y `cifra` (hay un
 *   número en el mensaje que no se supo a qué corresponde).
 * - `null` — no era una petición de viaje. El mensaje sigue su camino al agente.
 */
export type IntencionViaje =
  | {
      tipo: 'crear';
      operador: string;
      origen: string | null;
      destino: string | null;
      anticipo: number | null;
      unidad: string | null;
    }
  | { tipo: 'incompleto'; falta: string[]; parcial: ViajeParcial }
  | null;

// ── Normalización ──────────────────────────────────────────────────────────

/**
 * Acentos a su letra base, UNO A UNO Y DEL MISMO LARGO.
 *
 * El camino obvio —`normalize('NFD').replace(/[̀-ͯ]/g,'')`— es el que
 * usa `consulta_chofer.ts`, y ahí sirve porque ese módulo solo necesita
 * RECONOCER. Aquí además hay que EXTRAER: el origen que se le enseña al jefe
 * tiene que salir "Querétaro" y no "queretaro", así que las coincidencias se
 * buscan sobre el texto aplanado y los valores se rebanan del original con esos
 * mismos índices. NFD cambia el largo (una "é" pasa a valer dos), así que los
 * índices dejarían de coincidir y el recorte saldría corrido.
 *
 * El bucle va por unidad UTF-16 y no por punto de código: un emoji ocupa dos
 * unidades y copiarlo "entero" en una iteración también desalinearía el largo.
 */
const ACENTOS: Readonly<Record<string, string>> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i', ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u', ñ: 'n', ç: 'c',
  Á: 'a', À: 'a', Ä: 'a', Â: 'a', Ã: 'a', É: 'e', È: 'e', Ë: 'e', Ê: 'e',
  Í: 'i', Ì: 'i', Ï: 'i', Î: 'i', Ó: 'o', Ò: 'o', Ö: 'o', Ô: 'o', Õ: 'o',
  Ú: 'u', Ù: 'u', Ü: 'u', Û: 'u', Ñ: 'n', Ç: 'c',
};

/** Minúsculas y sin acentos, con EXACTAMENTE el mismo largo que la entrada. */
function aplanar(t: string): string {
  let salida = '';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    const base = ACENTOS[ch];
    if (base !== undefined) { salida += base; continue; }
    const c = ch.charCodeAt(0);
    // Solo A-Z a mano: `toLowerCase()` de algunos caracteres (la 'İ' turca)
    // devuelve DOS unidades y rompería la invariante de largo.
    salida += (c >= 65 && c <= 90) ? String.fromCharCode(c + 32) : ch;
  }
  return salida;
}

/**
 * Lo ya consumido se tapa con esto.
 *
 * Es un carácter que NO puede venir de un teclado, y hace las dos cosas que
 * hacen falta: ocupa el mismo largo que lo que tapó —así los índices siguen
 * apuntando al original— y separa campos, para que lo que quedó a los lados no
 * se junte en una sola frase. Un espacio no serviría: uniría "López" con la
 * ciudad de al lado.
 */
const TAPA = '\u0000';
/** El mismo carácter, escrito para meterlo dentro del fuente de una expresión. */
const TAPA_RE = '\\u0000';

function tapar(s: string, ini: number, fin: number): string {
  return s.slice(0, ini) + TAPA.repeat(fin - ini) + s.slice(fin);
}

/** El pedazo del original entre dos índices, sin espacios de sobra ni puntuación de borde. */
function recorte(orig: string, ini: number, fin: number): string {
  return orig.slice(ini, fin)
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.;:¡!·|/\-–—]+|[\s,.;:¡!·|/\-–—]+$/g, '')
    .trim();
}

// ── Las puertas, antes de intentar entender nada ───────────────────────────

/**
 * Un despacho es corto. Un mensaje largo con "nuevo viaje" adentro es casi
 * siempre una explicación, no una orden — y por su tamaño trae más números y
 * más nombres de los que este parser puede atribuir con certeza.
 */
const MAX_LARGO = 220;

/**
 * Palabras que dicen que el mensaje NO es un alta, aunque hable de viajes.
 *
 * LISTA CERRADA DE PALABRAS COMPLETAS, nunca raíces. La primera versión usaba
 * `cerr\w*` y `cancel\w*`, que se ve más corto y veta "Cerro Azul a Poza Rica"
 * —una ruta real de Veracruz— sin que nadie lo note hasta el demo. Cada entrada
 * está aquí porque alguien la escribe para pedir OTRA cosa.
 *
 * Los interrogativos van sin `?` a propósito: "cuantos viajes van este mes" se
 * escribe seguido sin signo, y sin ellos dependeríamos solo del disparador.
 */
const VETO = new RegExp(
  '\\b(?:'
  + 'cancela|cancelar|cancelalo|cancelala|cancelado|cancelada|cancelen|cancele'
  + '|anula|anular|anulalo|anulado|borra|borrar|borralo|elimina|eliminar'
  + '|reasigna|reasignar|reasignale|reprograma|reprogramar'
  + '|liquida|liquidar|liquidacion|cierra|cierre|cerrar|termina|terminar'
  + '|modifica|modificar|cambia|cambiar|cambiale|corrige|corregir|edita|editar'
  + '|quita|quitar|quitale|suspende|suspender|pospon|posponer|posterga|postergar'
  + '|cuanto|cuanta|cuantos|cuantas|cuando|donde|quien|quienes|cual|cuales'
  + '|no|nunca|tampoco|reporte|reportes|estatus'
  + ')\\b',
);

/**
 * Cortesías y vocativos que un jefe pone antes de la orden.
 *
 * En lazo y no en una pasada: "oye jefe, nuevo viaje…" tiene dos, y con un solo
 * `replace` la segunda sobrevive y el disparador —que va anclado— no dispara.
 * Es la misma trampa que ya se documentó en `consulta_chofer.ts`.
 */
const CORTESIA = /^(?:oye|hola|hey|buenas|buenos|dias|tardes|noches|que onda|porfa|por favor|porfavor|disculpa|perdon|jefe|licenciado|lic|ing|inge|likida|bot|ok|okey|va|ah|eh)[\s,.:;]+/;

function saltarCortesias(plano: string): number {
  let i = 0;
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const resto = plano.slice(i);
    const espacios = /^\s+/.exec(resto);
    if (espacios) { i += espacios[0].length; continue; }
    const m = CORTESIA.exec(resto);
    if (!m) break;
    i += m[0].length;
  }
  return i;
}

/**
 * El disparador, ANCLADO AL PRINCIPIO del mensaje.
 *
 * Buscar "viaje" en cualquier posición era la primera versión y se tragaba
 * "el viaje de Juan ya salió" y "mándame el reporte de viajes". Anclado, el
 * mensaje tiene que EMPEZAR con la orden, que es como se despacha.
 *
 * NO SE ACEPTA EL SUFIJO `-me`. "dame el viaje de Juan" y "mándame el viaje"
 * son consultas —el jefe pide VER algo, no crear nada— y con `(?:me)?` en el
 * verbo entraban las dos como altas. Solo `-le`/`-les`, que apuntan al chofer.
 */
const VERBOS = [
  'creale', 'crea', 'crear', 'abrele', 'abre', 'abrir', 'armale', 'arma', 'armar',
  'programale', 'programa', 'programar', 'levantale', 'levanta', 'levantar',
  'generale', 'genera', 'generar', 'agendale', 'agenda', 'agendar',
  'registrale', 'registra', 'registrar', 'anotale', 'anota', 'apuntale', 'apunta',
  'asignale', 'asignarle', 'asigna', 'asignar', 'dale', 'darle', 'da',
  'mandale', 'mandarle', 'manda', 'ponle', 'pon', 'hazle', 'haz', 'cargale', 'carga',
].join('|');

const DISPARADOR = new RegExp(
  '^(?:'
  + '(?:nuevo|otro)\\s+viaje'
  + '|viaje\\s+nuevo'
  + `|(?:${VERBOS})(?:le|les)?\\s+(?:un|una|el|la|otro|este)?\\s*viaje`
  + ')\\b[\\s,.:;\\-–—]*',
);

// ── El anticipo: la parte que descuadra una liquidación si se lee mal ───────

/**
 * Un anticipo por arriba de esto se trata como dudoso y se pregunta.
 *
 * NO ES UNA REGLA DE NEGOCIO NI UN LÍMITE INVENTADO: es un umbral de revisión.
 * Cruzarlo no rechaza el viaje, lo manda a `incompleto` para que el jefe vuelva
 * a teclear la cifra. El modo de fallo que ataja es el dedo pesado —escribir
 * 8000000 queriendo 8000—, que en un mensaje de WhatsApp no tiene deshacer y
 * que en una confirmación se lee parecido si se pasa rápido.
 *
 * El número sale de los datos del propio repo: el anticipo más grande que hay
 * cargado es $10,600, así que $100,000 deja casi un orden de magnitud de
 * holgura sobre el máximo observado. Si una flota despacha anticipos mayores,
 * lo que se sube es esta constante — no se quita la revisión.
 */
const TOPE_ANTICIPO = 100_000;

const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;
const SUF = String.raw`(?:\s*(?:mil|millones|millon|mdp|k|mxn|pesos))?`;
const MONTO = `(?:\\$\\s*)?(?:${NUM})${SUF}`;

// El `con|y|mas` de adelante entra en la coincidencia para que se tape con el
// resto: sin él, "con 5 mil de anticipo" dejaba un "con" suelto que después se
// pegaba al nombre de la ciudad ("Guadalajara con").
const RE_ANTICIPO_DESPUES = new RegExp(String.raw`(?:\b(?:con|y|mas)\s+)?\banticipo\b\s*(?:de|por|:|=)?\s*(${MONTO})`);
const RE_ANTICIPO_ANTES = new RegExp(String.raw`(?:\b(?:con|y|mas)\s+)?(${MONTO})\s*(?:de\s+)?anticipo\b`);
const RE_PESOS = new RegExp(`\\$\\s*(?:${NUM})${SUF}`, 'g');
const RE_MENCION_ANTICIPO = /\banticipo\b/g;

type Cifra = { ok: true; valor: number } | { ok: false };

/**
 * Un texto de dinero a pesos, o la negativa.
 *
 * TODO LO QUE NO SEA INEQUÍVOCO SALE COMO DUDOSO. Los casos que de verdad
 * llegan, y por qué cada uno cae de su lado:
 *
 * - `8000`, `$12,500`, `$12,500.50` — sin ambigüedad posible.
 * - `8 mil`, `12.5k` — el sufijo ES el multiplicador, y lo puso el jefe.
 * - `8.500` — en México se escribe igual "ocho quinientos" (separador de miles
 *   a la europea) que "ocho con cincuenta". No hay forma de saberlo desde el
 *   texto, y errarle son 8,492 pesos que el chofer termina pagando. Dudosa.
 * - `1234,567` — una coma que no forma grupos de tres no es separador de miles.
 * - `-500` — un anticipo negativo no existe; si aparece, el mensaje dice otra
 *   cosa. Se detecta por el contexto, en `signoRaro`.
 * - `1000000` — cruza el umbral de revisión. Se pregunta.
 * - `0` — SE ACEPTA. El jefe dijo explícitamente que sale sin anticipo, y eso
 *   es un dato, no un hueco. Ojo con la asimetría: `crearViaje` escribe
 *   `anticipo ?? 0`, así que en la base un 0 dicho y un 0 por omisión son la
 *   misma fila. La diferencia solo existe aquí y en el resumen, que la dice.
 */
function leerCifra(bruto: string): Cifra {
  const t = bruto.trim().replace(/^\$\s*/, '').trim();
  const conSufijo = /^(.*?)\s*(mil|millones|millon|mdp|k|mxn|pesos)$/.exec(t);
  const cuerpo = (conSufijo ? conSufijo[1] : t).trim();
  const sufijo = conSufijo ? conSufijo[2] : '';

  let base: number;
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(cuerpo)) {
    base = Number(cuerpo.replace(/,/g, ''));
  } else if (/^\d+(?:\.\d{1,2})?$/.test(cuerpo)) {
    base = Number(cuerpo);
  } else {
    // Todo lo demás —`8.500`, `8,5`, `1234,567`, `8.0001`— es exactamente el
    // caso que esta función existe para NO resolver por su cuenta.
    return { ok: false };
  }

  const factor = sufijo === 'mil' || sufijo === 'k' ? 1_000
    : sufijo === 'millon' || sufijo === 'millones' || sufijo === 'mdp' ? 1_000_000
    : 1;
  const valor = Math.round(base * factor * 100) / 100;

  if (!Number.isFinite(valor) || valor < 0) return { ok: false };
  if (valor > TOPE_ANTICIPO) return { ok: false };
  return { ok: true, valor };
}

/**
 * ¿La cifra viene precedida de algo que le cambia el sentido?
 *
 * La expresión del monto no incluye el `-` a propósito: un guion también separa
 * ciudades ("Querétaro-Saltillo"), así que meterlo en la gramática del dinero
 * confundiría las dos cosas. Se mira el contexto inmediato en su lugar. Lo
 * mismo con "o", "entre" y "hasta": marcan un rango o una duda, y un anticipo
 * dudoso no se escribe en la base.
 */
function signoRaro(plano: string, ini: number): boolean {
  const antes = plano.slice(Math.max(0, ini - 14), ini);
  return /[-−–]\s*$/.test(antes) || /\b(?:menos|negativo|hasta|entre|o|aprox|como)\s*$/.test(antes);
}

interface LecturaAnticipo {
  valor: number | null;
  /** El jefe habló de dinero y no se pudo leer con certeza. */
  dudoso: boolean;
  plano: string;
}

function leerAnticipo(plano: string): LecturaAnticipo {
  const menciones = (plano.match(RE_MENCION_ANTICIPO) ?? []).length;

  // DOS "anticipo" EN EL MISMO MENSAJE no se desempatan: puede ser una
  // corrección ("anticipo 8000, no, anticipo 9000") o dos viajes en un renglón.
  if (menciones > 1) return { valor: null, dudoso: true, plano };

  if (menciones === 1) {
    const m = RE_ANTICIPO_DESPUES.exec(plano) ?? RE_ANTICIPO_ANTES.exec(plano);
    // Dijo "anticipo" y no hay número legible ni detrás ni delante ("anticipo
    // ocho mil quinientos", que no se parsea; "anticipo -500", que no es un
    // monto). Se pregunta, no se deja en `null`: dejarlo en `null` crearía el
    // viaje SIN el anticipo que el jefe sí dictó, y el chofer sale sin dinero.
    if (!m) return { valor: null, dudoso: true, plano };

    const grupo = m[1];
    const iniGrupo = m.index + m[0].indexOf(grupo);
    if (signoRaro(plano, iniGrupo)) return { valor: null, dudoso: true, plano };

    const c = leerCifra(grupo);
    if (!c.ok) return { valor: null, dudoso: true, plano };
    return { valor: c.valor, dudoso: false, plano: tapar(plano, m.index, m.index + m[0].length) };
  }

  // Sin la palabra "anticipo", lo único que se lee como dinero es lo que trae
  // signo de pesos. Un número pelón puede ser la unidad, un folio o una hora —
  // y tomarlo por dinero es justo el error que descuadra la liquidación.
  const pesos = [...plano.matchAll(RE_PESOS)];
  if (pesos.length === 0) return { valor: null, dudoso: false, plano };
  if (pesos.length > 1) return { valor: null, dudoso: true, plano };

  const p = pesos[0];
  if (signoRaro(plano, p.index)) return { valor: null, dudoso: true, plano };
  const c = leerCifra(p[0]);
  if (!c.ok) return { valor: null, dudoso: true, plano };
  return { valor: c.valor, dudoso: false, plano: tapar(plano, p.index, p.index + p[0].length) };
}

// ── Unidad ─────────────────────────────────────────────────────────────────

/**
 * `unidad 42`, `eco T-102`, `unidad #7`.
 *
 * El token TIENE que traer un dígito. Sin esa condición, "unidad disponible"
 * dejaba `unidad = "disponible"` — un número económico que no existe, que
 * después no resuelve contra la tabla `unidad`, y que el jefe leyó en el
 * resumen como si fuera un dato suyo.
 */
const RE_UNIDAD = /\b(?:unidad(?:es)?|economico|eco)\s*(?:#|num\.?|numero|no\.?)?\s*((?=[a-z0-9-]*\d)[a-z0-9]{1,10}(?:-[a-z0-9]{1,10})?)\b/;

// ── Ruta ───────────────────────────────────────────────────────────────────

/**
 * Un nombre de lugar: de una a cuatro palabras de dos letras o más, sin dígitos.
 *
 * El mínimo de dos letras hace un trabajo silencioso pero central: impide que la
 * propia "a" de "Puebla **a** Monterrey" se cuele dentro del lugar. Sin él,
 * "cdmx a guadalajara" era un solo lugar válido y la ruta no se leía. Los
 * dígitos quedan fuera para que "5 mil" nunca pase por ciudad.
 */
const LUGAR = String.raw`[a-z.']{2,}(?:\s+[a-z.']{2,}){0,3}`;

const RE_SEGMENTO_A = new RegExp(`^(?:ruta\\s+|de\\s+)?(${LUGAR})\\s+a\\s+(${LUGAR})$`);
const RE_SEGMENTO_GUION = new RegExp(`^(?:ruta\\s+)?(${LUGAR})\\s*(?:[-–—]+|>+|=>)\\s*(${LUGAR})$`);
const RE_DE_A = new RegExp(`\\bde\\s+(${LUGAR})\\s+a\\s+(${LUGAR})\\s*(?=$|[,;:${TAPA_RE}])`);

/**
 * Palabras que pueden quedar pegadas al FINAL de un lugar y no son parte de él:
 * "Monterrey hoy", "Saltillo urgente", "Guadalajara porfa".
 *
 * SOLO POR LA DERECHA. Recortar también por la izquierda parecía simétrico y
 * rompe ciudades reales: "La Paz" se quedaría en "Paz" y "Los Mochis" en
 * "Mochis". El borde izquierdo ya viene anclado por el patrón que encontró la
 * ruta ("de X a Y", o el segmento completo), así que no hace falta.
 */
const COLA_LUGAR = new Set([
  'con', 'y', 'mas', 'para', 'por', 'en', 'que', 'sale', 'salen', 'saliendo',
  'hoy', 'manana', 'ahorita', 'ahora', 'ya', 'temprano', 'urgente', 'porfa',
  'favor', 'pues', 'ok', 'va', 'gracias',
]);

function ajustarLugar(plano: string, ini: number, fin: number): [number, number] | null {
  let f = fin;
  for (let vuelta = 0; vuelta < 4; vuelta++) {
    const m = /\s+([a-z.']+)$/.exec(plano.slice(ini, f));
    if (!m || !COLA_LUGAR.has(m[1])) break;
    f -= m[0].length;
  }
  return f > ini ? [ini, f] : null;
}

interface Trozo { ini: number; fin: number; texto: string }

/**
 * Parte el resto en campos.
 *
 * Separan la coma, el punto y coma, los dos puntos, lo ya consumido, y el punto
 * SEGUIDO DE ESPACIO —"nuevo viaje para Juan Pérez. Puebla a Monterrey" es una
 * forma real de escribirlo—. El punto pegado no separa, para no partir
 * "$12,500.50" ni "Av. Juárez".
 */
function trozos(plano: string): Trozo[] {
  const salida: Trozo[] = [];
  let ini = 0;
  const corta = (i: number): boolean => {
    const ch = plano[i];
    if (ch === ',' || ch === ';' || ch === ':' || ch === TAPA) return true;
    return ch === '.' && (i + 1 >= plano.length || /\s/.test(plano[i + 1]));
  };
  for (let i = 0; i <= plano.length; i++) {
    if (i !== plano.length && !corta(i)) continue;
    const bruto = plano.slice(ini, i);
    const texto = bruto.trim();
    if (texto) {
      const desplazamiento = bruto.length - bruto.trimStart().length;
      salida.push({ ini: ini + desplazamiento, fin: ini + desplazamiento + texto.length, texto });
    }
    ini = i + 1;
  }
  return salida;
}

interface LecturaRuta {
  origen: [number, number] | null;
  destino: [number, number] | null;
  plano: string;
}

function leerRuta(plano: string): LecturaRuta {
  // Primero por segmentos: es la forma que trae la puntuación del propio jefe y
  // no depende de adivinar dónde acaba el nombre y dónde empieza la ciudad.
  const candidatos: Array<{ o: [number, number]; d: [number, number]; t: Trozo }> = [];
  for (const t of trozos(plano)) {
    const m = RE_SEGMENTO_A.exec(t.texto) ?? RE_SEGMENTO_GUION.exec(t.texto);
    if (!m) continue;
    const iO = t.ini + t.texto.indexOf(m[1]);
    const iD = t.ini + t.texto.lastIndexOf(m[2]);
    candidatos.push({ o: [iO, iO + m[1].length], d: [iD, iD + m[2].length], t });
  }

  // DOS SEGMENTOS CON FORMA DE RUTA no se desempatan. Pasa de verdad cuando el
  // nombre del chofer lleva una inicial suelta ("Mario A López") y cuando el
  // jefe mete dos viajes en un renglón. Sin ruta, cae a `incompleto`.
  if (candidatos.length > 1) return { origen: null, destino: null, plano };
  if (candidatos.length === 1) {
    const c = candidatos[0];
    return {
      origen: ajustarLugar(plano, c.o[0], c.o[1]),
      destino: ajustarLugar(plano, c.d[0], c.d[1]),
      plano: tapar(plano, c.t.ini, c.t.fin),
    };
  }

  // Sin comas: "a Ramírez de CDMX a Guadalajara". El marco "de … a …" es lo
  // único que separa el nombre de la ruta sin adivinar dónde corta.
  const m = RE_DE_A.exec(plano);
  if (!m) return { origen: null, destino: null, plano };
  const iO = m.index + m[0].indexOf(m[1]);
  const iD = m.index + m[0].lastIndexOf(m[2]);
  return {
    origen: ajustarLugar(plano, iO, iO + m[1].length),
    destino: ajustarLugar(plano, iD, iD + m[2].length),
    plano: tapar(plano, m.index, m.index + m[0].length),
  };
}

// ── Operador ───────────────────────────────────────────────────────────────

const RE_CONECTOR = /^(?:para|a|al|con|el|la|los|las|un|una|de|del)\s+/;
const RE_TRATAMIENTO = /^(?:sr\.?|sra\.?|srita\.?|don|dona|ing\.?|lic\.?|chofer|operador|compa|compadre)\s+/;
const RE_NOMBRE = /^[a-z.'\- ]{2,40}$/;

/**
 * El nombre sale del PRIMER pedazo que sobró, no de buscar "para".
 *
 * Buscar la preposición fallaba con "viaje nuevo: López" —no hay ninguna— y con
 * "asígnale un viaje a Ramírez de CDMX" se llevaba "a Ramírez de CDMX" entero.
 * Consumiendo antes el dinero, la unidad y la ruta, lo que queda al frente ya
 * es el nombre y nada más.
 *
 * Lo que este módulo NO hace con él: resolverlo. Se devuelve el texto. Elegir a
 * qué chofer corresponde exige hablar con la base y poder negarse, y eso vive
 * en `resolverOperadorPorNombre`.
 */
function leerOperador(plano: string): [number, number] | null {
  const t = trozos(plano)[0];
  if (!t) return null;

  let ini = t.ini;
  let texto = t.texto;
  for (let vuelta = 0; vuelta < 3; vuelta++) {
    const m = RE_TRATAMIENTO.exec(texto) ?? RE_CONECTOR.exec(texto);
    if (!m) break;
    ini += m[0].length;
    texto = texto.slice(m[0].length);
  }

  if (!texto || !RE_NOMBRE.test(texto)) return null;
  if (texto.split(/\s+/).length > 4) return null;
  return [ini, ini + texto.length];
}

// ── La función ─────────────────────────────────────────────────────────────

/**
 * ¿El jefe está pidiendo un viaje, y con qué datos?
 *
 * PURA: no consulta la base, no escribe nada, no manda mensajes. Devuelve el
 * texto tal como lo escribió el jefe — el nombre del operador y el número
 * económico quedan SIN resolver a propósito.
 */
export function interpretarPeticionViaje(texto: string): IntencionViaje {
  if (typeof texto !== 'string') return null;

  // NFC de una vez, y a partir de aquí ÉSTE es el original: `aplanar` conserva
  // el largo sobre él, y los recortes usan sus mismos índices.
  const original = texto.normalize('NFC');
  if (!original.trim() || original.length > MAX_LARGO) return null;

  // Una pregunta no es una orden. "¿le doy viaje a Martínez?" es el jefe
  // pensando en voz alta, y crear el viaje ahí es contestarle que sí por él.
  if (/[?¿]/.test(original)) return null;

  // Los saltos de línea se vuelven separador de campo, no espacio: un despacho
  // en renglones ("nuevo viaje\nJuan Pérez\nPuebla a Monterrey") es tan común
  // como el de una sola línea.
  const plano0 = aplanar(original).replace(/[\n\r\t]/g, ';');
  if (VETO.test(plano0)) return null;

  const tras = saltarCortesias(plano0);
  const m = DISPARADOR.exec(plano0.slice(tras));
  if (!m) return null;

  const inicio = tras + m[0].length;
  const restoOrig = original.slice(inicio);
  let resto = plano0.slice(inicio);

  const anticipo = leerAnticipo(resto);
  resto = anticipo.plano;

  let unidad: string | null = null;
  const mu = RE_UNIDAD.exec(resto);
  if (mu) {
    const i = mu.index + mu[0].indexOf(mu[1]);
    unidad = recorte(restoOrig, i, i + mu[1].length) || null;
    resto = tapar(resto, mu.index, mu.index + mu[0].length);
  }

  // CUALQUIER DÍGITO QUE SIGA VIVO AQUÍ ES UN NÚMERO SIN DUEÑO. Ni una ciudad
  // ni un nombre llevan dígitos, así que lo que queda es un folio, una hora,
  // una segunda cifra — o el anticipo escrito de una forma que no se entendió.
  // En los cuatro casos lo honesto es preguntar: seguir de largo crearía el
  // viaje ignorando un dato que el jefe sí escribió.
  const cifraSuelta = /\d/.test(resto);

  const ruta = leerRuta(resto);
  resto = ruta.plano;

  const op = leerOperador(resto);

  const operador = op ? (recorte(restoOrig, op[0], op[1]) || null) : null;
  const origen = ruta.origen ? (recorte(restoOrig, ruta.origen[0], ruta.origen[1]) || null) : null;
  const destino = ruta.destino ? (recorte(restoOrig, ruta.destino[0], ruta.destino[1]) || null) : null;

  const falta: string[] = [];
  if (!operador) falta.push('operador');
  if (!origen && !destino) falta.push('ruta');
  else if (!origen) falta.push('origen');
  else if (!destino) falta.push('destino');
  if (anticipo.dudoso) falta.push('anticipo');
  else if (cifraSuelta) falta.push('cifra');

  if (falta.length > 0) {
    // NINGUNA CIFRA SOBREVIVE A UNA DUDA SOBRE LAS CIFRAS. Si el anticipo quedó
    // en duda, `anticipo.valor` ya es `null`. Y si sobró un número sin dueño
    // —"anticipo 5000 o 6000"— tampoco se enseña el 5,000 que sí se leyó: al
    // lado de "hay un número que no supe a qué corresponde", esa cifra se lee
    // como confirmada y es justo la que está en disputa.
    const seguro = falta.includes('cifra') ? null : anticipo.valor;
    return {
      tipo: 'incompleto',
      falta,
      parcial: { operador, origen, destino, anticipo: seguro, unidad },
    };
  }

  return { tipo: 'crear', operador: operador as string, origen, destino, anticipo: anticipo.valor, unidad };
}

// ── Lo que el jefe lee ANTES de que exista el viaje ─────────────────────────

const EJEMPLO = '«nuevo viaje para Juan Pérez, Puebla a Monterrey, anticipo 8000»';

const DICE_FALTA: Readonly<Record<string, string>> = {
  operador: 'a qué operador es',
  ruta: 'la ruta (de dónde a dónde)',
  origen: 'de dónde sale',
  destino: 'a dónde va',
  anticipo: 'el anticipo — dijiste una cifra y no la pude leer con seguridad',
  cifra: 'hay un número en tu mensaje que no supe a qué corresponde',
};

/** El anticipo dicho en palabras que distinguen las tres situaciones reales. */
function diceAnticipo(n: number | null): string {
  if (n === null) return 'no lo capturaste (el chofer va a leer «sin anticipo registrado»)';
  if (n === 0) return `${mxn(0)} — sale sin anticipo`;
  return mxn(n);
}

function diceRuta(origen: string | null, destino: string | null): string {
  if (origen && destino) return `${origen} → ${destino}`;
  if (origen) return `sale de ${origen}, falta el destino`;
  if (destino) return `llega a ${destino}, falta el origen`;
  return 'falta capturarla';
}

/**
 * El texto que se le enseña al jefe ANTES de crear nada.
 *
 * Existe porque `crearViaje` no es una escritura callada: en cuanto el insert
 * vuelve, `avisarAlChofer` le manda un WhatsApp a una persona diciéndole que
 * tiene viaje. Un parser equivocado sin este paso saca a un chofer a carretera.
 *
 * Enseña TODOS los campos, incluidos los que faltan, y los que faltan los dice
 * en voz alta en vez de dejarlos en blanco: un renglón vacío se lee como "no
 * aplica" y un `$0.00` se lee como una cifra medida. Mismo criterio que el
 * aviso al chofer de `notificar.ts`.
 *
 * Ante `null` devuelve la cadena VACÍA. `null` significa que el mensaje no era
 * para este módulo, así que no hay nada que confirmar; contestar cualquier cosa
 * secuestraría un mensaje que le toca al agente.
 */
export function resumenParaConfirmar(intencion: IntencionViaje): string {
  if (!intencion) return '';

  if (intencion.tipo === 'crear') {
    return [
      'Voy a crear este viaje:',
      `• Operador: ${intencion.operador}`,
      `• Ruta: ${diceRuta(intencion.origen, intencion.destino)}`,
      `• Anticipo: ${diceAnticipo(intencion.anticipo)}`,
      `• Unidad: ${intencion.unidad ?? 'no la capturaste'}`,
      '',
      'Al confirmar le llega el aviso por WhatsApp al chofer.',
      'Responde SÍ para crearlo, o NO para dejarlo.',
    ].join('\n');
  }

  const p = intencion.parcial;
  return [
    'Para crear el viaje me falta:',
    ...intencion.falta.map((f) => `• ${DICE_FALTA[f] ?? f}`),
    '',
    'De tu mensaje entendí:',
    `• Operador: ${p.operador ?? '—'}`,
    `• Ruta: ${diceRuta(p.origen, p.destino)}`,
    `• Anticipo: ${diceAnticipo(p.anticipo)}`,
    `• Unidad: ${p.unidad ?? '—'}`,
    '',
    `Mándamelo completo, por ejemplo: ${EJEMPLO}.`,
  ].join('\n');
}

// ── Del nombre al chofer: la parte que sí habla con la base ─────────────────

export interface CandidatoOperador {
  operadorId: string;
  nombre: string;
}

/**
 * El nombre que escribió el jefe corresponde a más de un chofer activo.
 *
 * Mismo criterio que `OperadorAmbiguo` de `conv.ts`, y por la misma razón: no
 * hay contexto que desempate dos "Martínez", y elegir uno le manda un viaje —y
 * su anticipo— a la persona equivocada. La diferencia con aquél es que allá el
 * dato ambiguo es un error de captura que hay que corregir en la base, y aquí
 * es normal: una flota TIENE dos Martínez y los dos son válidos. Por eso la
 * excepción viaja con los candidatos, para que quien llame pueda preguntar.
 */
export class OperadorNombreAmbiguo extends Error {
  readonly candidatos: CandidatoOperador[];
  constructor(mensaje: string, candidatos: CandidatoOperador[]) {
    super(mensaje);
    this.name = 'OperadorNombreAmbiguo';
    this.candidatos = candidatos;
  }
}

/** Palabras que no identifican a nadie y que no deben decidir una coincidencia. */
const VACIAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'don', 'sr', 'sra']);

function palabrasUtiles(t: string): string[] {
  return aplanar(t)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length >= 2 && !VACIAS.has(p));
}

/**
 * ¿A qué chofer se refiere el jefe? `null` si no hay ninguno con ese nombre.
 *
 * SE NIEGA ANTE LA AMBIGÜEDAD, igual que `resolveOperador`.
 *
 * ── POR QUÉ SE TRAE LA LISTA Y SE COMPARA AQUÍ ──────────────────────────
 *
 * `ilike '%ramirez%'` en Postgres es sensible a acentos: el jefe escribe
 * "Ramirez" desde un teclado sin acentos y la fila dice "Ramírez", y la consulta
 * devuelve cero. El agente contestaría "no tengo a ese chofer" sobre alguien que
 * SÍ está dado de alta — la misma clase de negación falsa que ya costó encontrar
 * con el "1" de los teléfonos mexicanos (ver `variantesTelefono`).
 *
 * Y va por `traerTodo`: PostgREST recorta a 1,000 filas en silencio, así que sin
 * paginar el chofer 1,001 de una flota grande sería indistinguible de uno que no
 * existe.
 *
 * ── LO QUE NO SE HACE: PARECIDOS ────────────────────────────────────────
 *
 * La coincidencia es por palabra COMPLETA. "Martin" no encuentra a "Martínez", y
 * eso es correcto: la distancia entre dos apellidos parecidos es exactamente lo
 * que separa a dos personas, y aquí el premio por acertar de más es mandarle el
 * viaje de uno al otro.
 */
export async function resolverOperadorPorNombre(
  tenantId: string,
  texto: string,
): Promise<CandidatoOperador | null> {
  // Sin tenant no se consulta. Un filtro vacío sobre `tenant_id` es la puerta
  // por la que un chofer de OTRA flota se cuela en la respuesta, y este producto
  // es multi-tenant: el jefe leería un nombre que no es de su empresa.
  if (!tenantId) throw new Error('resolverOperadorPorNombre: falta tenantId');

  const buscado = palabrasUtiles(typeof texto === 'string' ? texto : '');
  // Sin una sola palabra útil, "todas las palabras coinciden" sería literalmente
  // cierto para todos — y con un solo chofer en la flota devolvería ESE, con
  // toda la apariencia de un acierto.
  if (buscado.length === 0) return null;

  const admin = supabaseAdmin();
  let filas: Array<{ id: unknown; nombre: unknown }>;
  try {
    filas = await traerTodo<{ id: unknown; nombre: unknown }>(
      (d, h) => acotada(
        admin.from('operador').select('id, nombre')
          .eq('tenant_id', tenantId).eq('activo', true).order('id').range(d, h),
        'resolverOperadorPorNombre',
      ),
      'resolverOperadorPorNombre',
    );
  } catch (e) {
    // "No pude preguntar" NO es "no está dado de alta". Con el `Error` pelado
    // que lanza `traerTodo`, un blip de Supabase le diría al jefe que su chofer
    // no existe. `ConsultaFallida` es el tipo que el resto del pipeline ya sabe
    // distinguir para contestar "inténtalo de nuevo".
    throw new ConsultaFallida(`operadores del tenant: ${(e as Error).message}`);
  }

  const q = buscado.join(' ');
  const exactos: CandidatoOperador[] = [];
  const parciales: CandidatoOperador[] = [];

  for (const f of filas) {
    const nombre = typeof f.nombre === 'string' ? f.nombre : '';
    const id = typeof f.id === 'string' ? f.id : '';
    if (!nombre || !id) continue;

    const suyas = palabrasUtiles(nombre);
    if (suyas.length === 0) continue;

    const cand = { operadorId: id, nombre };
    if (suyas.join(' ') === q) { exactos.push(cand); continue; }
    if (buscado.every((p) => suyas.includes(p))) parciales.push(cand);
  }

  // EL EXACTO GANA SOBRE EL PARCIAL: con "Juan Pérez" y "Juan Pérez López" en la
  // misma flota, escribir "Juan Pérez" no es ambiguo — es el nombre completo de
  // uno de los dos. Sin esta precedencia el módulo se volvería inservible justo
  // donde los apellidos se repiten, que es en todas las flotas.
  const candidatos = exactos.length > 0 ? exactos : parciales;

  if (candidatos.length === 0) return null;
  if (candidatos.length > 1) {
    logger.error('operador.nombre_ambiguo', {
      tenantId,
      buscado: q,
      operadores: candidatos.map((c) => c.operadorId),
    });
    throw new OperadorNombreAmbiguo(
      `"${texto}" corresponde a ${candidatos.length} operadores activos`,
      candidatos,
    );
  }
  return candidatos[0];
}
