// ═══════════════════════════════════════════════════════════════════════════
// ¿ESTE TEXTO HABLA DE DINERO?
//
// Es el portón de la guardia: si dice que no, el texto del modelo va tal cual al
// WhatsApp del operador. Un falso negativo aquí es una cifra que nadie calculó
// en el teléfono de quien liquida.
//
// La versión anterior exigía $, coma de miles, .XX, "pesos/mxn" o una de ocho
// palabras clave PEGADA al número. Se colaban frases que un modelo escribe con
// toda naturalidad — medido: "Tu resultado final: 8000", "Tu saldo: 500 a tu
// favor", "Te sobraron ocho mil pesos".
//
// LA ASIMETRÍA MANDA. Un falso positivo cuesta que se reemplace el texto por el
// resumen determinístico del motor, que es correcto y hasta más útil. Un falso
// negativo cuesta la garantía sobre la que se vende el producto. Así que ante la
// duda se marca, y por eso el criterio es ancho: cualquier número de 2+ dígitos
// que NO sea claramente otra cosa.
// ═══════════════════════════════════════════════════════════════════════════

/** Formas explícitas de dinero: no dependen del contexto. */
const DINERO_EXPLICITO =
  /\$\s?\d|\d{1,3}(?:,\d{3})+|\d+\.\d{2}(?!\d)|\b\d+(?:[.,]\d+)?\s*(?:pesos?|mxn|m\.?\s?n\.?)\b/i;

/**
 * Cantidades escritas en PALABRAS. El regex viejo miraba dígitos, así que "ocho
 * mil pesos" ni le aparecía.
 */
const DINERO_EN_PALABRAS =
  /\b(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos)\s+(?:mil|millones?|pesos?)\b/i;

/**
 * Cardinales SUELTOS (sin "pesos"/"mil" pegado). AUDITORÍA 12, MEDIO: "te
 * sobran ochocientos del anticipo" o "me faltan trece" — español natural de
 * WhatsApp — no casaban el patrón de arriba (exige mil/pesos) ni los dígitos,
 * y una cifra que nadie calculó salía al teléfono de quien liquida. La
 * ambigüedad ("tres comprobantes") la resuelve el chequeo por cláusula de
 * `tieneCifrasDeDinero`, con el vocabulario de NO_ES_DINERO; la doctrina del
 * archivo prefiere marcar (el reemplazo es el cuadre determinístico del motor,
 * correcto y útil) a dejar pasar.
 */
const CARDINAL_SUELTO =
  /\b(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[ée]is|diecisiete|dieciocho|diecinueve|veinti(?:ún|uno|dos|tr[ée]s|cuatro|cinco|s[ée]is|siete|ocho|nueve)|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscient[oa]s?|trescient[oa]s?|cuatrocient[oa]s?|quinient[oa]s?|seiscient[oa]s?|setecient[oa]s?|ochocient[oa]s?|novecient[oa]s?|mil)\b/i;

/**
 * Contextos donde un número de 2+ dígitos NO es dinero. Sin esto, "van 8 fotos"
 * o un folio dispararían el reemplazo y el operador recibiría el cuadre en
 * respuesta a un "¿ya llegaron mis fotos?".
 */
const NO_ES_DINERO =
  /\b(?:folio|uuid|rfc|ticket|comprobantes?|fotos?|litros?|lts?|km|kil[oó]metros?|placas?|a[nñ]o|d[ií]as?|horas?|minutos?|%|por\s?ciento|art[ií]culo|regla|migraci[oó]n|viaje\s*#)\b/i;

/**
 * Un número suelto de 2+ dígitos que NO forma parte de un identificador.
 *
 * Los lookarounds por `[\w-]` son los que salvan a los folios: en
 * "VJ-2026-0847" el 2026 lleva un guion pegado, así que no cuenta. Sin ellos, un
 * folio de viaje disparaba el reemplazo y el operador recibía el cuadre entero
 * en respuesta a "¿sigue abierto mi viaje?".
 */
const NUMERO_SUELTO = /(?<![\w-])\d{2,}(?:[.,]\d+)?(?![\w-])/;

/**
 * Años. Un "2026" suelto casi nunca es dinero, y aparece en fechas, folios y
 * referencias a normas. Un monto de $2,026 sí se distingue: lleva símbolo o coma
 * de miles, y esos ya los atrapa DINERO_EXPLICITO antes de llegar aquí.
 */
const ANIO = /(?<![\w-])(?:19|20)\d{2}(?![\w-])/g;

/**
 * Divide el texto en cláusulas para que "comprobantes" en una parte del
 * mensaje no apague un número de dinero real en otra. AUDITORÍA 8, CRÍTICO:
 * "Llevas 6 comprobantes y te sobran 3200 del anticipo." apagaba TODOS los
 * números del mensaje por la palabra "comprobantes", y el 3200 —que nadie
 * calculó— salía tal cual.
 */
const SEPARADOR_DE_CLAUSULA = /[,;.:!?¡¿]|\s+(?:y|o|pero|porque)\s+/i;

export function tieneCifrasDeDinero(texto: string): boolean {
  if (DINERO_EXPLICITO.test(texto) || DINERO_EN_PALABRAS.test(texto)) return true;
  // Un número suelto SOLO cuenta si nada en SU cláusula lo explica como otra
  // cosa. Antes se miraba la frase entera, y una palabra del vocabulario del
  // producto en cualquier parte del mensaje apagaba números sin relación con
  // ella. Ahora cada cláusula se evalúa por separado: "Ya recibí tus 3
  // comprobantes" sigue sin marcar (el 3 y "comprobantes" viven juntos), pero
  // "Llevas 6 comprobantes y te sobran 3200 del anticipo" sí marca (el 3200
  // vive en una cláusula sin ninguna palabra de la lista).
  const sinAnios = texto.replace(ANIO, ' ');
  const clausulas = sinAnios.split(SEPARADOR_DE_CLAUSULA);
  return clausulas.some((c) =>
    (NUMERO_SUELTO.test(c) || CARDINAL_SUELTO.test(c)) && !NO_ES_DINERO.test(c),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ¿QUÉ CIFRA DEL TEXTO NO SALIÓ DE NINGUNA TOOL?
//
// `tieneCifrasDeDinero` solo dice si hay dinero en el texto. Eso bastaba para
// la regla gruesa ("¿llamó una tool?"), pero esa regla tenía una puerta
// trasera: llamando `consultar_politica` —barata e irrelevante— el modelo
// desbloqueaba narrar CUALQUIER cifra, incluidas las que nadie calculó.
//
// Grounded tiene que significar que la cifra está en lo que la tool devolvió.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Las mismas formas que detecta el portón, pero capturando el número.
 *
 * TIENE que ver al menos lo mismo que `tieneCifrasDeDinero`. Si el portón dice
 * "aquí hay dinero" y este extractor no encuentra la cifra, `cifrasSinRespaldo`
 * devuelve lista vacía y la guardia concluye que TODO está respaldado — o sea,
 * la deja pasar justo por haberla detectado. Pasó: al ensanchar el portón para
 * cerrar el bypass, este se quedó con el criterio viejo.
 */
const MONEY_G = /\$\s?(\d[\d,]*(?:\.\d+)?)|((?<![\w-])\d[\d,]*(?:\.\d+)?(?![\w-]))/g;

/** Centavo de tolerancia: el motor redondea y el modelo formatea. */
const TOL = 0.011;

function numerosDe(valor: unknown, acc: number[], profundidad = 0): number[] {
  if (profundidad > 8 || acc.length > 5000) return acc;   // cota dura: los resultados de tool son datos ajenos
  if (typeof valor === 'number') { if (Number.isFinite(valor)) acc.push(valor); return acc; }
  if (typeof valor === 'string') {
    // Un string puede ser "750.00" o traer cifras embebidas en una nota.
    for (const m of valor.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
      const n = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(n)) acc.push(n);
    }
    return acc;
  }
  if (Array.isArray(valor)) { for (const v of valor) numerosDe(v, acc, profundidad + 1); return acc; }
  if (valor && typeof valor === 'object') {
    for (const v of Object.values(valor as Record<string, unknown>)) numerosDe(v, acc, profundidad + 1);
  }
  return acc;
}

/**
 * Devuelve las cifras de dinero del texto que NO aparecen en ningún resultado
 * de tool. Lista vacía = todo lo que el modelo dijo salió de una herramienta.
 *
 * Estricto a propósito: una cifra DERIVADA por el modelo (restar el anticipo
 * del comprobado, por ejemplo) no está respaldada aunque sus operandos sí lo
 * estén. Quien calcula diferencias es el motor; si el número no salió de él,
 * no se manda por WhatsApp.
 */
/**
 * `true` si el texto habla de dinero pero NO se puede extraer ninguna cifra
 * numérica que cotejar — típicamente porque va escrita en palabras ("ocho mil
 * pesos").
 *
 * Existe porque `cifrasSinRespaldo` devuelve lista vacía en ese caso, y una
 * lista vacía significa "todo respaldado". Leer un fallo de verificación como
 * una aprobación es justo el error que la guardia viene a impedir.
 */
export function hablaDeDineroSinCifraVerificable(texto: string): boolean {
  if (!tieneCifrasDeDinero(texto)) return false;
  return [...texto.replace(ANIO, ' ').matchAll(MONEY_G)].length === 0;
}

export function cifrasSinRespaldo(texto: string, resultados: unknown[]): number[] {
  const respaldo = numerosDe(resultados, []);
  const fuera: number[] = [];
  // Los años se quitan antes: aparecen en fechas y referencias a normas, y no
  // son cifras que el modelo tenga que justificar contra una tool.
  for (const m of texto.replace(ANIO, ' ').matchAll(MONEY_G)) {
    const crudo = m.slice(1).find((g) => g != null);
    if (!crudo) continue;
    const n = Number(crudo.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (respaldo.some((r) => Math.abs(r - n) <= TOL)) continue;
    if (!fuera.includes(n)) fuera.push(n);
  }
  return fuera;
}
