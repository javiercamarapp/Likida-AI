// ═══════════════════════════════════════════════════════════════════════════
// GUARDIA DE FUNDAMENTO — el modelo no teclea un artículo de memoria.
//
// Gemela de `guardiaCifras`, para normas en vez de cifras. Un LLM sabe que
// existe "el artículo 27 fracción III de la LISR" y lo escribirá con total
// aplomo aunque nadie se lo haya dado — y escribirá "artículo 32 fracción XX"
// con exactamente el mismo aplomo.
//
// Frente a un contralor con fiscalista, una cita inventada cuesta más que un
// número mal puesto: el número se corrige en la siguiente frase, la credibilidad
// no. Y es justo lo que el producto vende: que cada veredicto traiga su
// fundamento.
//
// LA REGLA: el modelo solo puede referenciar una norma que una tool le devolvió
// EN ESE TURNO. Lo demás se quita. Sin esto, "no alucina el artículo" es una
// esperanza sobre el prompt; con esto es una propiedad del código.
//
// Misma asimetría que con las cifras: quitar una cita legítima cuesta que el
// mensaje sea menos preciso; dejar pasar una inventada cuesta la venta.
// ═══════════════════════════════════════════════════════════════════════════

import type { ConceptoGasto } from '@/types/cuadra';
import { NORMAS, IDS_NORMA, esVinculante } from './indice';

/** Marca de una cita que parece normativa pero no está en el índice. */
export const CITA_DESCONOCIDA = 'DESCONOCIDA';

/**
 * Patrones por norma, más anchos que `citas_en_codigo`: el modelo no copia y
 * pega, reformula. "LISR 27-III", "artículo 27 fracción III de la LISR" y
 * "art. 27 fr. III de la Ley del ISR" son la misma cita.
 */
function patronesDe(id: string): RegExp[] {
  const n = NORMAS[id];
  if (!n) return [];
  const out: RegExp[] = n.citas.map((c) => new RegExp(esc(c).replace(/\s+/g, '\\s*') + FIN_DE_NUMERO, 'i'));

  // Forma larga. El modelo no dice siempre "LISR": dice "la Ley del ISR" o
  // "la Ley del Impuesto sobre la Renta". Se aceptan las tres.
  const siglas = (n.citas[0] ?? '').split(/\s+/)[0];
  const alias = [siglas, n.instrumento, aliasCorto(n.instrumento)].filter(Boolean) as string[];
  if (alias.length && n.articulo) {
    const art = esc(n.articulo);
    // SEPARADOR, no solo espacios. "artículo 27, fracción III" es la puntuación
    // más natural del español y la que un modelo escribe sin pensar; con `\s*`
    // esa forma no se detectaba y la cita pasaba entera. Peor aún al revés: una
    // cita legítima escrita así no se reconocía, no se protegía, y la limpieza
    // genérica se la comía a medias dejando el texto mutilado.
    const sep = '[\\s,;:—–-]*';
    const fr = n.fraccion ? `${sep}(?:fracci[oó]n|fr\\.?)${sep}${esc(n.fraccion)}` : '';
    const quien = `(?:${alias.map(esc).join('|')})`;
    // "artículo 27 fracción III ... LISR"  y  "LISR ... artículo 27 fracción III"
    // La ventana va LAZY (`{0,45}?`), no codiciosa, y eso decide un CRÍTICO.
    //
    // Con `{0,45}` el motor estira la ventana todo lo que puede antes de buscar
    // el nombre de la ley, así que en "artículo 27, fracción III de la LISR, y
    // además el 45-Z de la Ley del ISR" el patrón de la cita PERMITIDA casaba
    // hasta el ÚLTIMO "ISR" y se tragaba la inventada dentro de su propio match.
    // Al borrarse del texto para buscar lo que sobra, la inventada desaparecía
    // con ella: `citasEnTexto` devolvía solo ["lisr-27-fr-III"], `forzado` salía
    // false, y la cita que nadie autorizó llegaba íntegra al operador.
    //
    // Lazy liga la cita al instrumento MÁS CERCANO, que es además lo que
    // significa en español: "el artículo 27 de la LISR" habla de esa ley, no de
    // la que se nombre cuarenta caracteres después.
    out.push(new RegExp(`(?:art[íi]culo|art\\.?|regla)\\s*${art}${fr}${FIN_DE_NUMERO}[^.]{0,45}?${quien}`, 'i'));
    out.push(new RegExp(`${quien}[^.]{0,45}?(?:art[íi]culo|art\\.?|regla)\\s*${art}${fr}${FIN_DE_NUMERO}`, 'i'));
    // Sin instrumento cerca: "conforme al artículo 27, fracción III" a secas.
    //
    // El número por sí solo NO identifica la norma. CFF 27-III es el registro
    // del RFC y LISR 27-III es el pago en efectivo: mismo número, otra ley. Sin
    // esta comprobación este patrón no solo dejaba pasar "artículo 27, fracción
    // III del Código Fiscal de la Federación" teniendo permiso para la de la
    // LISR — la APROBABA, que es peor que callarse: certifica una cita que nadie
    // autorizó. Así que se acepta la forma a secas solo mientras el texto no
    // nombre un instrumento AJENO cerca; si lo nombra, manda la ley, no el número.
    const ajenos = ALIAS_DE_INSTRUMENTO.filter((a) => !alias.includes(a));
    const salvoOtraLey = ajenos.length ? `(?![^.]{0,45}(?:${ajenos.map(esc).join('|')}))` : '';
    if (n.fraccion) out.push(new RegExp(`(?:art[íi]culo|art\\.?|regla)\\s*${art}${fr}${FIN_DE_NUMERO}${salvoOtraLey}`, 'i'));
  }

  // ── LA SIGLA DESPUÉS DEL NÚMERO: "27-III LISR", "20-A LIF 2026" ────────────
  //
  // AUDITORÍA 6, rubro agéntico: esta forma la DETECTA `FORMA_DE_CITA` (su
  // penúltima alternativa) y no la reconocía nadie aquí. El efecto no era dejar
  // pasar una cita inventada, era BORRAR una legítima: la cita permitida no
  // entraba en `citadas`, caía en `CITA_DESCONOCIDA` por descarte, y la limpieza
  // la quitaba. "Te aplica el estímulo conforme al 20-A LIF 2026." salía como
  // "Te aplica el estímulo conforme al." — el estímulo del diésel, que es la
  // función que más vende el producto, sin artículo y sin ley.
  //
  // Se deriva de `citas_en_codigo`, NO de `articulo_o_regla`, y esa es la parte
  // que importa: `articulo_o_regla` es prosa para un humano —el del LIF dice
  // "20, apartado A (estímulos fiscales)"— y jamás casaría contra "20-A". Las
  // citas en código ya traen el token exacto con el que se cita en la calle.
  //
  // Que salga de la MISMA fuente es deliberado: la causa raíz que el propio
  // commit de ayer identificó son "dos catálogos que hay que sincronizar a
  // mano". Añadir aquí una cuarta lista escrita a mano repetiría el error que
  // este arreglo cierra.
  for (const cita of n.citas) {
    const num = numeroCitable(cita);
    if (!num) continue;
    if (!alias.length) continue;
    const quien = `(?:${alias.map(esc).join('|')})`;
    // MISMA DEFENSA QUE LA FORMA A SECAS, y hace falta: el número no identifica
    // la norma. Sin esto, "el 27-III CFF y también la LISR" casaría —la ventana
    // llega de sobra— y este patrón APROBARÍA una cita al Código Fiscal teniendo
    // permiso solo para la LISR. Certificar una cita ajena es peor que borrarla.
    const ajenos = ALIAS_DE_INSTRUMENTO.filter((a) => !alias.includes(a));
    const noAjena = ajenos.length ? `(?![^.]{0,20}(?:${ajenos.map(esc).join('|')}))` : '';
    // Ventana corta y LAZY, por la misma razón que arriba: liga el número al
    // instrumento MÁS CERCANO. "el 20-A LIF 2026" y "el 27-III de la LISR".
    out.push(new RegExp(`(?<![\\w-])${esc(num)}${FIN_DE_NUMERO}${noAjena}[^.]{0,20}?${quien}`, 'i'));
  }
  return out;
}

/**
 * El token con el que una cita se escribe en la calle: "LISR 27-III" → `27-III`,
 * "LIF 2026 Art. 20-A" → `20-A`, "LIF Art. 20-A fr. IV" → `20-A`.
 *
 * Dos formas, y el orden importa: si la cita nombra el artículo ("Art.",
 * "regla"), el número es el que va DESPUÉS —en "LIF 2026 Art. 20-A" el primer
 * número es el AÑO, no el artículo—. Si no lo nombra, el número es el último,
 * porque lo que va antes es la sigla ("RFA 2026 2.9").
 */
function numeroCitable(cita: string): string | null {
  const TOKEN = /\d+(?:[.\-][A-Za-zÁ-Úá-ú0-9]+)*/g;
  const marca = /\b(?:art[íi]culo|art\.?|regla)\s*/i.exec(cita);
  const resto = marca ? cita.slice(marca.index + marca[0].length) : cita;
  const tokens = resto.match(TOKEN);
  if (!tokens?.length) return null;
  return marca ? tokens[0] : tokens[tokens.length - 1];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ═══════════════════════════════════════════════════════════════════════════
// MEMORIA POR TEMA, NO POR ID — AUDITORÍA 9, ALTO agéntico.
//
// La memoria (AUDITORÍA 8, AG-2) le permite al modelo repetir SIN tool una cita
// que el propio sistema ya entregó en este viaje. El error que abrió esa
// memoria: se concedía por `norma_id` solo, sin comprobar que la afirmación
// ACTUAL fuera la misma que la justificó la primera vez. Dos citas con el mismo
// id pueden ser sobre cosas distintas — "RFA 2026 regla 2.9" es el tope del 15%
// de DIÉSEL en efectivo, y nada impide que el modelo la pegue en una frase sobre
// una CASETA. El id coincide, el tema no, y el id solo no lo distingue.
//
// Por eso la memoria compara la ORACIÓN que trae la cita ahora contra las
// oraciones que la trajeron antes, por palabras compartidas fuera de la cita
// misma. Sin contexto que comparar (oración pelada, o sin historial) la memoria
// no se concede — falla cerrado, que es la misma asimetría del resto del
// archivo: quitar una cita legítima cuesta precisión; dejar pasar una mal
// aplicada cuesta la credibilidad frente al fiscalista del contralor.
// ═══════════════════════════════════════════════════════════════════════════

/** Palabras que no distinguen tema en español. */
const RELLENO = new Set([
  'de', 'la', 'el', 'en', 'y', 'a', 'que', 'tu', 'se', 'por', 'con', 'del',
  'las', 'los', 'un', 'una', 'al', 'es', 'lo', 'no', 'si', 'ya', 'te', 'me',
  'su', 'para', 'como', 'pero', 'ojo', 'esa', 'ese', 'esto', 'eso', 'ha',
]);

function palabrasClave(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !RELLENO.has(w)),
  );
}

/**
 * Oraciones (separadas por '.', salto de línea o ';') que contienen la cita.
 *
 * El punto NO parte la oración cuando es DECIMAL —dígito a los dos lados,
 * como en "regla 2.9"—: partirlo ahí desarma la propia cita ("regla 2" y "9"
 * por separado) y ninguna mitad vuelve a casar contra `patrones`.
 */
function oracionesConCita(texto: string, patrones: RegExp[]): string[] {
  return texto
    .split(/(?:(?<!\d)\.|\.(?!\d))+|[\n;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && patrones.some((p) => p.test(s)));
}

/** El tema de una oración: sus palabras clave con la cita misma quitada. */
function temaDe(oracion: string, patrones: RegExp[]): Set<string> {
  let sinCita = oracion;
  for (const p of patrones) sinCita = sinCita.replace(new RegExp(p.source, 'gi'), ' ');
  return palabrasClave(sinCita);
}

/** Al menos dos palabras de tema compartidas, fuera de la cita. */
const UMBRAL_TEMA = 2;

// ═══════════════════════════════════════════════════════════════════════════
// EL SUJETO DE LA AFIRMACIÓN — AUDITORÍA 10, ALTO agéntico (rondas 8, 9 y 10).
//
// La comparación por palabras cierra la FRASE del ejemplo de la ronda 9 y no la
// CLASE, porque el vocabulario compartido lo puso el propio sistema en el turno
// anterior: el modelo que reformula la frase del motor aplicándola a OTRO gasto
// obtiene la memoria justamente POR reformularla bien.
//
//   historial (motor):  "Diésel pagado en EFECTIVO — cuenta contra el tope del
//                        15% del combustible del ejercicio (RFA 2026 regla 2.9)"
//   modelo, sin tool:   "Tu CASETA pagada en efectivo cuenta contra el tope del
//                        15% del combustible del ejercicio (RFA 2026 regla 2.9)"
//
// Siete palabras compartidas contra un umbral de dos: pasaba entera, y la regla
// 2.9 de la RFA 2026 es el tope del 15% del COMBUSTIBLE en efectivo — ni una
// caseta ni una comida están dentro.
//
// Así que la memoria deja de atarse solo al vocabulario y se ata al SUJETO: de
// qué gasto habla la afirmación. Si la oración de hoy nombra un gasto que la de
// ayer no nombraba, no es la misma afirmación, por muchas palabras que compartan.
//
// El sujeto solo VETA, nunca concede: cuando la oración de ayer no nombra gasto
// alguno ("el pago en efectivo tiene tope conforme al artículo 27 fr. III"), no
// hay conflicto que detectar y sigue mandando la comparación de palabras.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las palabras con las que se nombra un gasto en la prosa que escribe el modelo,
 * agrupadas por el `ConceptoGasto` del producto. Las claves van SIN acento y en
 * minúscula porque es como salen de `palabrasClave`.
 *
 * Los grupos son los conceptos que ya existen —no una taxonomía nueva—: lo que
 * decide es si dos oraciones hablan del MISMO gasto, y "diésel", "combustible" y
 * "gasolina" son el mismo para este producto.
 */
const SUJETO_DE_GASTO: Record<string, ConceptoGasto> = {
  diesel: 'diesel', combustible: 'diesel', combustibles: 'diesel',
  gasolina: 'diesel', gasolinas: 'diesel', gasolinera: 'diesel',
  magna: 'diesel', premium: 'diesel',
  caseta: 'caseta', casetas: 'caseta', peaje: 'caseta', peajes: 'caseta',
  telepeaje: 'caseta', iave: 'caseta', autopista: 'caseta', autopistas: 'caseta',
  comida: 'alimentacion', comidas: 'alimentacion', alimento: 'alimentacion',
  alimentos: 'alimentacion', alimentacion: 'alimentacion',
  restaurante: 'alimentacion', desayuno: 'alimentacion', cena: 'alimentacion',
  hospedaje: 'hospedaje', hotel: 'hospedaje', hoteles: 'hospedaje',
  motel: 'hospedaje', alojamiento: 'hospedaje',
  transporte: 'transporte', taxi: 'transporte', autobus: 'transporte',
  vuelo: 'transporte',
  flete: 'flete', fletes: 'flete', paqueteria: 'flete',
  viatico: 'viaticos', viaticos: 'viaticos',
};

/** Los gastos que una oración nombra. Vacío si no nombra ninguno. */
function sujetosDe(palabras: Set<string>): Set<ConceptoGasto> {
  const out = new Set<ConceptoGasto>();
  for (const w of palabras) {
    const c = SUJETO_DE_GASTO[w];
    if (c) out.add(c);
  }
  return out;
}

/**
 * `true` si la cita `id`, tal como aparece en `reply`, está hablando del MISMO
 * asunto que la trajo en `historial`. Sin historial, o sin palabras de tema en
 * ninguno de los dos lados, no hay nada que comparar y la memoria no aplica.
 *
 * AUDITORÍA 12, ALTO (reincidente de la clase 8-9-10): antes se evaluaba SOLO
 * la primera oración del reply que traía la cita. Una respuesta multi-oración
 * ("Tu diésel… aplica la regla 2.9. Tu caseta… aplica la regla 2.9.") pasaba
 * la segunda cabalgando sobre el permiso de la primera — la cita real aplicada
 * al gasto equivocado, con tool ausente. Ahora TODAS las oraciones con la cita
 * tienen que pasar el veto de sujeto; si alguna nombra un gasto distinto al
 * del historial, la cita no se admite (fail-closed: se pierde una repetición
 * legítima antes que certificar una falsa).
 */
function citaEsMismoTema(id: string, reply: string, historial: string): boolean {
  if (!historial) return false;
  const patrones = patronesDe(id);
  const oraciones = oracionesConCita(reply, patrones);
  if (oraciones.length === 0) return false;
  return oraciones.every((oracionActual) => {
    const temaActual = temaDe(oracionActual, patrones);
    if (temaActual.size === 0) return false; // cita pelada, sin tema → no se admite
    const sujetoActual = sujetosDe(temaActual);
    return oracionesConCita(historial, patrones).some((h) => {
      const temaHistorico = temaDe(h, patrones);
      // EL SUJETO VETA ANTES DE CONTAR PALABRAS. Si la oración de ayer nombraba
      // un gasto y la de hoy nombra OTRO, no es la misma afirmación: el modelo
      // movió la norma de gasto, que es exactamente lo que la memoria no puede
      // certificar. Cuando la de ayer no nombra ninguno no hay conflicto que
      // detectar y decide la comparación de palabras, como hasta ahora.
      const sujetoHistorico = sujetosDe(temaHistorico);
      if (sujetoHistorico.size) {
        for (const s of sujetoActual) if (!sujetoHistorico.has(s)) return false;
      }
      let compartidas = 0;
      for (const w of temaActual) if (temaHistorico.has(w)) compartidas++;
      return compartidas >= UMBRAL_TEMA;
    });
  });
}

/**
 * "Ley del Impuesto sobre la Renta" → "Ley del ISR", que es como lo abrevia un
 * humano (y el modelo). Sin esto, la forma larga más común se escapa.
 */
function aliasCorto(instrumento?: string): string | undefined {
  if (!instrumento) return undefined;
  const m = /^Ley del Impuesto (?:sobre la Renta|al Valor Agregado)$/i.exec(instrumento);
  if (!m) return undefined;
  return /Renta/i.test(instrumento) ? 'Ley del ISR' : 'Ley del IVA';
}

/**
 * Siglas de instrumento conocidas, sacadas del propio índice. Sirven para cazar
 * una cita INVENTADA con forma de sigla ("LISR 32-XX"), que no lleva la palabra
 * "artículo" y por eso se escapaba del patrón general.
 */
const SIGLAS = [...new Set(IDS_NORMA.map((id) => (NORMAS[id].citas[0] ?? '').split(/\s+/)[0]).filter((s) => /^[A-Z]{3,6}$/.test(s)))];

/**
 * El número de la norma TERMINA donde termina. Sin esta frontera "2.9" calzaba
 * dentro de "2.9.1", "57" dentro de "570" y "29-A" dentro de "29-A9": el modelo
 * inventa una subregla que no existe y la guardia la reconoce como la de verdad.
 * Solo corta cuando lo que sigue ALARGA el número —otro dígito, o un punto o
 * guion seguido de dígito—, para no matar la cita que cierra una frase.
 */
const FIN_DE_NUMERO = '(?![.-]?\\d)';

/**
 * Todos los alias de instrumento del índice. Sirven para lo contrario que
 * `SIGLAS`: reconocer que el texto habla de una ley AJENA a la norma que se está
 * probando.
 */
const ALIAS_DE_INSTRUMENTO = [...new Set(
  IDS_NORMA.flatMap((id) => {
    const n = NORMAS[id];
    return [(n.citas[0] ?? '').split(/\s+/)[0], n.instrumento, aliasCorto(n.instrumento)];
  }).filter((s): s is string => typeof s === 'string' && s.length > 2),
)];

/**
 * Cualquier cosa con forma de cita normativa, se reconozca o no. Es lo que
 * permite detectar una INVENTADA: si parece un artículo y no está en el índice,
 * el modelo se lo sacó de la manga.
 */
const FORMA_DE_CITA = new RegExp(
  `\\b(?:art[íi]culo|art\\.|arts\\.|regla|fracci[oó]n|fr\\.)\\s*\\d+` +
  `|\\b(?:${SIGLAS.join('|')})\\s+\\d+` +
  // LA CITA DESNUDA: "conforme al 27-III", sin la palabra "artículo" ni sigla
  // alguna. Es la forma más corta de citar en español y la que usa un modelo
  // cuando ya nombró la ley en la frase anterior. Salía [NADA] —ni siquiera
  // DESCONOCIDA— así que pasaba entera y sin log. Hallazgo reincidente de las
  // rondas 3 y 4.
  //
  // El patrón exige NÚMERO + guion + ROMANO, o número + apartado en letra
  // (20-A). Eso lo distingue de un folio ("A-4501" empieza por letra), de una
  // fecha ("2026-07-28" tiene cuatro dígitos y termina en número) y de un rango
  // ("del 1-3"): los romanos y los apartados no aparecen en esos.
  `|(?<![\\w-])\\d{1,3}\\s*-\\s*(?:[IVXLC]{1,6}|[A-D])(?![\\w-])` +
  // "el 2.9 de la RFA": regla con punto decimal citada sin la palabra "regla".
  `|(?<![\\w.-])\\d\\.\\d{1,3}(?:\\.\\d{1,3})*\\s+(?:de\\s+la\\s+)?(?:${SIGLAS.join('|')})\\b` +
  // La sigla DESPUÉS del número: "27-III LISR". Es tan natural en español
  // hablado como la forma directa, y sin esto no llegaba ni a DESCONOCIDA.
  `|\\b\\d+\\s*-\\s*[IVXLC]+\\s*(?:${SIGLAS.join('|')})\\b` +
  // Número con sufijo pegado al nombre de la ley: "el 45-Z de la Ley del ISR".
  // Se exige el instrumento cerca justamente para no confundir un folio
  // ("A-4501") ni una fecha ("2026-07-28") con una cita: el folio empieza por
  // letra y la fecha no lleva letras tras el guion.
  `|\\b\\d+\\s*-\\s*[A-Za-z]{1,4}\\b[^.]{0,45}(?:${ALIAS_DE_INSTRUMENTO.map(esc).join('|')})` +
  // El número escrito en palabras: "artículo veintisiete fracción tres". Se
  // piden las DOS palabras clave para que la prosa normal no dispare.
  `|\\b(?:art[íi]culo|regla)\\s+[a-zá-úñ]+(?:\\s+[a-zá-úñ]+){0,3}\\s*(?:fracci[oó]n|fr\\.)\\s+[a-zá-úñ]+`,
  'i',
);

/**
 * Ids de norma citados en el texto. Incluye `CITA_DESCONOCIDA` si hay algo con
 * forma de cita que el índice no reconoce.
 */
export function citasEnTexto(texto: string): string[] {
  const encontradas = IDS_NORMA.filter((id) => patronesDe(id).some((p) => p.test(texto)));

  // ¿Queda alguna forma de cita sin explicar? Se borran las reconocidas y se
  // mira si sobra algo con pinta de artículo.
  let resto = texto;
  for (const id of encontradas) {
    for (const p of patronesDe(id)) resto = resto.replace(new RegExp(p.source, 'gi'), ' ');
  }
  if (FORMA_DE_CITA.test(resto)) encontradas.push(CITA_DESCONOCIDA);
  return encontradas;
}

/**
 * Deja el texto legible tras quitar una cita: sin paréntesis vacíos ni dobles
 * espacios, PERO conservando los saltos de línea.
 *
 * `\s{2,}` incluye `\n`, así que la versión anterior convertía en un párrafo
 * corrido cualquier mensaje multilínea cada vez que la guardia actuaba — y el
 * resumen de WhatsApp es multilínea: viñetas, secciones, párrafos. Se limpia
 * RENGLÓN A RENGLÓN para no tocar la estructura.
 */
function limpiar(texto: string): string {
  return texto
    .split('\n')
    .map((linea) =>
      linea
        .replace(/\(\s*[,;]?\s*\)/g, '')   // "( )" o "(,)" que quedan al vaciar
        .replace(/[ \t]+([,.;:])/g, '$1')    // espacio antes de puntuación
        .replace(/[ \t]{2,}/g, ' ')          // solo espacios horizontales
        .replace(/[ \t]+$/, ''),
    )
    .join('\n')
    .trim();
}

export interface ResultadoFundamento {
  reply: string;
  /** `true` si se tocó el texto. */
  forzado: boolean;
  /** Qué se quitó y por qué. Para el log, no para el operador. */
  quitadas: string[];
}

/**
 * Quita del texto toda cita normativa que no venga de `permitidas` NI sea, por
 * su ORACIÓN, la misma afirmación que ya se entregó en `historial`.
 *
 * @param permitidas ids de norma que una tool devolvió EN ESTE TURNO.
 * @param historial texto de los turnos `assistant` previos de este viaje —
 *   fuente de la memoria por tema. Sin él, no hay memoria: solo `permitidas`.
 */
export function guardiaFundamento(reply: string, permitidas: string[], historial = ''): ResultadoFundamento {
  const ok = new Set(permitidas);

  // ── 1. ¿Se presenta como obligación algo que NO obliga? ───────────────────
  // Se comprueba ANTES de mirar las citas, porque una norma de nivel 6 —el plazo
  // del portal de una gasolinera— casi nunca se cita por su nombre: se cuela en
  // la frase ("estás obligado a facturar en 72 horas"). Si esperáramos a
  // detectar la cita, este caso saldría siempre limpio.
  const noVinculantes = permitidas.filter((id) => NORMAS[id] && !esVinculante(NORMAS[id].jerarquia));
  const OBLIGA = /\b(?:est[áa]s?\s+obligad\w*|es\s+obligatorio|la\s+ley\s+exige|por\s+ley)\b/i;
  const suavizar = noVinculantes.length > 0 && OBLIGA.test(reply);

  const citadas = citasEnTexto(reply);
  // MEMORIA POR TEMA: una cita que ninguna tool trajo este turno se admite si,
  // y SOLO si, la oración que la trae ahora habla del mismo asunto que la
  // oración que la trajo antes. El id solo no basta — ver comentario arriba de
  // `citaEsMismoTema`.
  for (const id of citadas) {
    if (id !== CITA_DESCONOCIDA && !ok.has(id) && citaEsMismoTema(id, reply, historial)) ok.add(id);
  }
  const sobran = citadas.filter((id) => !ok.has(id));
  if (sobran.length === 0 && !suavizar) return { reply, forzado: false, quitadas: [] };

  // ── 2. Se PROTEGEN las citas legítimas antes de borrar nada ───────────────
  // La limpieza de citas desconocidas es por FORMA ("regla 2.9", "artículo 27"),
  // así que sin proteger antes se llevaba por delante una cita permitida que
  // tuviera la misma forma. Pasó: al quitar una inventada, se comió el
  // "regla 2.9" que sí venía de una tool.
  const guardado: string[] = [];
  let texto = reply;
  for (const id of citadas.filter((c) => ok.has(c))) {
    for (const p of patronesDe(id)) {
      texto = texto.replace(new RegExp(p.source, 'gi'), (m) => {
        guardado.push(m);
        return ` ${guardado.length - 1} `;
      });
    }
  }

  // ── 3. Fuera lo que no vino de una tool ───────────────────────────────────
  for (const id of sobran) {
    if (id === CITA_DESCONOCIDA) continue;
    for (const p of patronesDe(id)) texto = texto.replace(new RegExp(p.source, 'gi'), '');
  }
  if (sobran.includes(CITA_DESCONOCIDA)) {
    // SE LIMPIA CON EL MISMO PATRÓN QUE DETECTÓ, no con una copia a mano.
    //
    // Aquí vivían cuatro `replace` escritos aparte, y `FORMA_DE_CITA` se fue
    // ensanchando sin ellos: en la ronda 5 quedaban al menos tres formas que la
    // guardia DETECTABA y no borraba —"el 45-Z de la Ley del ISR", "el artículo
    // veintisiete fracción tres", "la regla dos punto nueve"—. El resultado era
    // peor que no tener guardia: el log decía `quitadas: [DESCONOCIDA]` y el
    // texto salía idéntico, así que quien leyera el log creería que la cita
    // inventada nunca llegó al operador. Media guardia que además miente.
    //
    // Es el mismo modo de falla que este proyecto ya pagó con los conceptos y
    // con los dos catálogos de portales: dos listas que hay que mantener iguales
    // a mano divergen siempre. Con una sola fuente no hay nada que sincronizar,
    // y ensanchar la detección mañana ensancha la limpieza sola.
    texto = texto.replace(new RegExp(FORMA_DE_CITA.source, 'gi'), '');
  }

  // ── 4. Lo que no obliga, no se dice como si obligara ──────────────────────
  if (suavizar) {
    // No se borra la información —el plazo es útil—: se le quita el carácter de
    // obligación legal, que es lo que no le corresponde.
    //
    // AUDITORÍA 12, MEDIO: los cuatro replace corrían a ciegas sobre negaciones.
    // "No estás obligado a facturar en 72 horas" (verdad: el plazo del portal
    // no es obligación legal) se convertía en "No conviene facturar en 72
    // horas" (falso: facturar a tiempo es justo lo que se vende). Un reescrito
    // que cambia el SENTIDO es peor que el texto original. Ahora cada reemplazo
    // se salta la cláusula si viene negada — un "no/nunca/jamás/tampoco" con el
    // verbo en medio ("no me parece que estés obligado") NO casa la ventana y
    // se reescribe, que es el caso que sí es una afirmación disfrazada.
    const NEGADA = /(?:no|nunca|jamás|tampoco)\s*$/i;
    const reescribirSalvoNegacion = (patron: RegExp, reemplazo: string): string =>
      texto.replace(new RegExp(patron.source, 'gi'), (m, ...args) => {
        const offset = args[args.length - 2] as number;
        const antes = texto.slice(Math.max(0, offset - 60), offset);
        return NEGADA.test(antes) ? m : reemplazo;
      });
    texto = reescribirSalvoNegacion(/\best[áa]s?\s+obligad\w*\s+a\b/, 'conviene');
    texto = reescribirSalvoNegacion(/\best[áa]s?\s+obligad\w*\b/, 'conviene');
    texto = reescribirSalvoNegacion(/\bes\s+obligatorio\b/, 'es lo recomendable');
    texto = reescribirSalvoNegacion(/\b(?:la\s+ley\s+exige|por\s+ley)\b/, 'según la política del comercio');
  }

  // ── 5. Se devuelven las protegidas a su sitio ─────────────────────────────
  texto = texto.replace(/ (\d+) /g, (_m, n) => guardado[Number(n)]);

  return { reply: limpiar(texto), forzado: true, quitadas: sobran };
}

/**
 * Saca los `norma_id` que las tools devolvieron en este turno.
 *
 * Solo mira lo que la tool devolvió DE VERDAD, no lo que el modelo diga que le
 * devolvieron: si se leyera del texto del modelo, la guardia se estaría
 * preguntando a sí misma.
 */
export function normasDeToolCalls(resultados: unknown[]): string[] {
  const out = new Set<string>();
  const visitar = (v: unknown, prof = 0): void => {
    if (prof > 6 || v == null) return;
    if (Array.isArray(v)) { for (const x of v) visitar(x, prof + 1); return; }
    if (typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (typeof o.norma_id === 'string' && NORMAS[o.norma_id]) out.add(o.norma_id);
    for (const x of Object.values(o)) visitar(x, prof + 1);
  };
  visitar(resultados);
  return [...out];
}
