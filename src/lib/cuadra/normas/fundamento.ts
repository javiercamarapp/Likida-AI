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
    out.push(new RegExp(`(?:art[íi]culo|art\\.?|regla)\\s*${art}${fr}${FIN_DE_NUMERO}[^.]{0,45}${quien}`, 'i'));
    out.push(new RegExp(`${quien}[^.]{0,45}(?:art[íi]culo|art\\.?|regla)\\s*${art}${fr}${FIN_DE_NUMERO}`, 'i'));
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
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
 * Quita del texto toda cita normativa que no venga de `permitidas`.
 *
 * @param permitidas ids de norma que una tool devolvió EN ESTE TURNO.
 */
export function guardiaFundamento(reply: string, permitidas: string[]): ResultadoFundamento {
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
        return `\u0000${guardado.length - 1}\u0000`;
      });
    }
  }

  // ── 3. Fuera lo que no vino de una tool ───────────────────────────────────
  for (const id of sobran) {
    if (id === CITA_DESCONOCIDA) continue;
    for (const p of patronesDe(id)) texto = texto.replace(new RegExp(p.source, 'gi'), '');
  }
  if (sobran.includes(CITA_DESCONOCIDA)) {
    texto = texto
      .replace(/\b(?:art[íi]culo|art\.|arts\.|regla)\s*[\d.]+(?:[\s,;:—–-]*(?:fracci[oó]n|fr\.?)[\s,;:—–-]*[IVXLC]+)?/gi, '')
      .replace(new RegExp(`\\b(?:${SIGLAS.join('|')})\\s+[\\d.]+(?:-[IVXLC]+)?`, 'gi'), '')
      // La cita DESNUDA ("conforme al 27-III"). Se detectaba y no se borraba:
      // media guardia es peor que ninguna, porque el log dice "forzado" y el
      // texto sale igual.
      .replace(/(?<![\w-])\d{1,3}\s*-\s*(?:[IVXLC]{1,6}|[A-D])(?![\w-])/g, '')
      .replace(new RegExp(`(?<![\\w.-])\\d\\.\\d{1,3}(?:\\.\\d{1,3})*\\s+(?:de\\s+la\\s+)?(?:${SIGLAS.join('|')})\\b`, 'gi'), '');
  }

  // ── 4. Lo que no obliga, no se dice como si obligara ──────────────────────
  if (suavizar) {
    // No se borra la información —el plazo es útil—: se le quita el carácter de
    // obligación legal, que es lo que no le corresponde.
    texto = texto
      .replace(/\best[áa]s?\s+obligad\w*\s+a\b/gi, 'conviene')
      .replace(/\best[áa]s?\s+obligad\w*\b/gi, 'conviene')
      .replace(/\bes\s+obligatorio\b/gi, 'es lo recomendable')
      .replace(/\b(?:la\s+ley\s+exige|por\s+ley)\b/gi, 'según la política del comercio');
  }

  // ── 5. Se devuelven las protegidas a su sitio ─────────────────────────────
  texto = texto.replace(/\u0000(\d+)\u0000/g, (_m, n) => guardado[Number(n)]);

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
