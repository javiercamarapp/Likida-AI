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
  /\b(?:un|una|uno|medi[oa]|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|doscientos|trescientos|cuatrocientos|quinientos|seiscientos|setecientos|ochocientos|novecientos)\s+(?:mil|mill[oó]n(?:es)?|pesos?)\b/i;

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
  /\b(?:dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[ée]is|diecisiete|dieciocho|diecinueve|veinti(?:ún|uno|dos|tr[ée]s|cuatro|cinco|s[ée]is|siete|ocho|nueve)|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien(?:to)?|doscient[oa]s?|trescient[oa]s?|cuatrocient[oa]s?|quinient[oa]s?|seiscient[oa]s?|setecient[oa]s?|ochocient[oa]s?|novecient[oa]s?|mil)\b/i;

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
 * de miles, y esos ya los atrapa DINERO_EXPLICITO antes de llegar aquí — cierto
 * para el PORTÓN de abajo, que es el único que consulta DINERO_EXPLICITO.
 */
const ANIO = /(?<![\w-])(?:19|20)\d{2}(?![\w-])/g;

/** Un `$` (con o sin espacio) justo antes: es un monto, no un año. */
const MARCA_DE_DINERO_ANTES = /\$\s?$/;
/**
 * Lo que vuelve AÑO a un entero de la banda 1900-2099, y la única razón para
 * borrarlo. SEG/AG/TC-32C10-C1 (AUDITORÍA 32 c10, CRÍTICO): hasta aquí el
 * criterio estaba INVERTIDO —se borraba salvo que hubiera marca de dinero—, así
 * que un monto pelado (`te sobran 2000`), que es como se escribe en WhatsApp,
 * desaparecía antes de cotejarse y la guardia lo sellaba como respaldado.
 *
 * Una preposición o un sustantivo de periodo delante (`en 2026`, `del 2026 al
 * 2027`, `el ejercicio 2026`), o una referencia normativa (`RFA 2026`, `regla
 * 2.9 de la RFA 2026`), o un separador de fecha pegado (`01/01/2026`, y el
 * `-` cubre además lo que el lookbehind de `ANIO` ya excluye). Nada más.
 */
const CONTEXTO_DE_ANIO_ANTES =
  /(?:\b(?:en|del|de|al|para|desde|hasta|durante|hacia|entre|ejercicio|a[nñ]o|ciclo|RFA|RMF|LIF|LISR|LIVA|CFF|circular|regla|norma|anexo|DOF)\s+|[/-]\s*)$/i;
/** Un separador de fecha justo después: `2026/01/01`, `2026-01-01`. */
const CONTEXTO_DE_ANIO_DESPUES = /^\s*[/-]\d/;
/** `pesos`/`mxn`/`m.n.` justo después, o una cola decimal que lo vuelve monto. */
const MARCA_DE_DINERO_DESPUES = /^(?:\s*(?:pesos?|mxn|m\.?\s?n\.?)\b|[.,]\d)/i;

/**
 * Quita los años del texto ANTES del cotejo, respetando los montos.
 *
 * SEG-32C9-C1 (AUDITORÍA 32 c9, CRÍTICO). El cotejo borraba los años con `ANIO`
 * a secas, y el lookbehind `(?<![\w-])` deja pasar el `$`: los 200 enteros de
 * 1900 a 2099 desaparecían del texto antes de compararse contra el respaldo, y
 * la lista salía VACÍA — que significa «todo respaldado». La única diferencia
 * entre que la guardia atrape la cifra y que la apruebe era la coma de miles.
 * Lo que justificaba borrarlos —«esos ya los atrapa DINERO_EXPLICITO antes de
 * llegar aquí»— vale para el portón y NO vale aquí: en el cotejo no hay ningún
 * «antes de llegar aquí», el reemplazo corre incondicionalmente y
 * DINERO_EXPLICITO no participa. Medido con el respaldo real de `estado_viaje`
 * (anticipo 8000, comprobado 6000):
 *
 *     "…te sobran $2,000.00."  → [2000]  se sustituye por el resumen del motor
 *     "…te sobran $2000."      → []      SALÍA TAL CUAL al WhatsApp del chofer
 *     "…te sobran 2000 pesos." → []      ídem
 *     "…te sobran $2000.50."   → [50]    reportaba una cifra que nadie escribió
 *
 * Y no había segunda capa: `hablaDeDineroSinCifraVerificable` tampoco lo salva
 * cuando el texto trae otros montos, porque entonces `MONEY_G` sí encuentra algo.
 *
 * La asimetría del archivo manda igual que en el portón: ante la duda se
 * CONSERVA el número, porque conservarlo cuesta que se sustituya el texto por el
 * resumen determinístico del motor —correcto y hasta más útil— y borrarlo cuesta
 * la garantía sobre la que se vende el producto.
 *
 * CORRECCIÓN (AUDITORÍA 32 c10, SEG/AG/TC-32C10-C1). Esta cabecera afirmaba que
 * «el portón sigue con `ANIO` a secas a propósito: ahí el agujero no existe
 * porque `DINERO_EXPLICITO` corre ANTES». **Era cierto para los cuatro casos que
 * enumeraba y falso para el quinto, que no enumeró:** un monto PELADO no lleva
 * marca, así que `DINERO_EXPLICITO` no encaja y `ANIO` lo borraba igual. Medido
 * sobre este archivo, con el respaldo real (anticipo 8000, comprobado 6000):
 *
 *     "…te sobran 2000."  → cotejo []  y portón false   los DOS carriles ciegos
 *     "…te sobran 1950."  → ídem        (200 enteros, 1900-2099, contiguos)
 *     "…te sobran 3200."  → cotejo [3200] y portón true  fuera de la banda
 *
 * La única diferencia entre que la guardia atrape la cifra y que la selle como
 * respaldada era caer en la banda de los años. Arreglado invirtiendo el default
 * en LOS DOS carriles: se borra sólo con marca de AÑO
 * (`CONTEXTO_DE_ANIO_ANTES`/`_DESPUES`), nunca por omisión de marca de dinero.
 * El falso negativo de la cláusula sigue abierto y es SEG-32C9-C2.
 */
function sinAniosQueNoSeanMonto(texto: string): string {
  return texto.replace(ANIO, (anio: string, pos: number) => {
    const antes = texto.slice(0, pos);
    const despues = texto.slice(pos + anio.length);
    if (MARCA_DE_DINERO_ANTES.test(antes.slice(-2))) return anio;
    if (MARCA_DE_DINERO_DESPUES.test(despues)) return anio;
    // SEG/AG/TC-32C10-C1: se borra SÓLO con marca de año. Antes se borraba por
    // defecto, y el default es lo que decide el caso que nadie enumeró.
    if (CONTEXTO_DE_ANIO_ANTES.test(antes)) return ' ';
    if (CONTEXTO_DE_ANIO_DESPUES.test(despues)) return ' ';
    return anio; // ante la duda se CONSERVA: es la asimetría declarada arriba.
  });
}

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
  // SEG/AG/TC-32C10-C1: era `texto.replace(ANIO, ' ')` a secas, y por eso el
  // portón NO veía `Te sobran 2000 del anticipo.` mientras sí veía `3200`. Ahora
  // usa el MISMO criterio que el cotejo, que es lo que impide que los dos
  // carriles tengan agujeros distintos.
  const sinAnios = sinAniosQueNoSeanMonto(texto);
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
  return [...sinAniosQueNoSeanMonto(texto).matchAll(MONEY_G)].length === 0;
}

export function cifrasSinRespaldo(texto: string, resultados: unknown[]): number[] {
  const respaldo = numerosDe(resultados, []);
  const fuera: number[] = [];
  // Los años se quitan antes: aparecen en fechas y referencias a normas, y no
  // son cifras que el modelo tenga que justificar contra una tool.
  for (const m of sinAniosQueNoSeanMonto(texto).matchAll(MONEY_G)) {
    const crudo = m.slice(1).find((g) => g != null);
    if (!crudo) continue;
    const n = Number(crudo.replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (respaldo.some((r) => Math.abs(r - n) <= TOL)) continue;
    if (!fuera.includes(n)) fuera.push(n);
  }
  // AUDITORÍA 13, MEDIO: los cardinales en palabras también se cotejan — un
  // "ochocientos" que NO coincide con nada respaldado sale como cifra sin
  // respaldo (antes ni se extraía y pasaba en silencio).
  for (const n of cardinalesEnPalabras(texto)) {
    if (respaldo.some((r) => Math.abs(r - n) <= TOL)) continue;
    if (!fuera.includes(n)) fuera.push(n);
  }
  return fuera;
}

/**
 * Valor numérico de cada cardinal del vocabulario de CARDINAL_SUELTO.
 * AUDITORÍA 13, MEDIO: `cifrasSinRespaldo` extraía solo dígitos — un cardinal
 * en palabras dentro de una oración mixta ("te sobran ochocientos … y el tope
 * es 800") no se cotejaba: si NO coincidía con nada, pasaba en silencio.
 */
const VALOR_CARDINAL: Record<string, number> = {
  dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciséis: 16, dieciseis: 16, diecisiete: 17,
  dieciocho: 18, diecinueve: 19, veinte: 20, veintiún: 21, veintiuno: 21, veintidós: 22, veintidos: 22,
  veintitrés: 23, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiséis: 26, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600,
  setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
  mil: 1000,
  // AUDITORÍA 32 c8 (AG-32C8-C1 / TC-32C8-A1): `millón` faltaba, y sin él el
  // token se saltaba y salía sólo el multiplicando chico — «tres millones» → 3.
  'millón': 1_000_000, millon: 1_000_000, millones: 1_000_000,
};

/** Los cardinales del texto, convertidos a número. Compuestos simples se
 *  suman por aproximación ("treinta y dos" → 30+2=32) salvo `mil`, que
 *  MULTIPLICA cuando va después de un valor menor ("ochocientos mil" → 800,000;
 *  "mil ochocientos" → 1,800). `millón` sigue la MISMA regla una escala arriba
 *  ("tres millones" → 3,000,000; "mil millones" → 1,000,000,000). Sin parseador
 *  completo es mejor verificar de más: un compuesto mal sumado cae a 'fuera', y
 *  'fuera' es el lado seguro. Ver AUDITORÍA 32 c7 y c8 en el cuerpo. */
export function cardinalesEnPalabras(texto: string): number[] {
  const out: number[] = [];
  const tokens = texto.toLowerCase().match(/[a-záéíóúñ]+/g) ?? [];
  let i = 0;
  while (i < tokens.length) {
    const v = VALOR_CARDINAL[tokens[i]];
    if (v === undefined) { i++; continue; }
    // Compuesto simple: "treinta y dos", "doscientos cincuenta", "mil ochocientos".
    let suma = v;
    let j = i + 1;
    let siguiente = tokens[j];
    while (j < tokens.length && (siguiente === 'y' || VALOR_CARDINAL[siguiente] !== undefined)) {
      if (siguiente === 'y') { j++; siguiente = tokens[j]; continue; }
      const vj = VALOR_CARDINAL[siguiente];
      // AUDITORÍA 32 c7 (ARQ/AG/TC/REN-32C7): `mil` es un MULTIPLICADOR cuando
      // va DESPUÉS de un valor menor que mil, y un sumando cuando va antes.
      // Las tres ramas del ternario anterior eran todas sumas —sólo reordenaban
      // los addendos, así que daban el mismo número— y por eso "ochocientos mil"
      // valía 800+1000 = 1800 en vez de 800,000.
      //
      // Fallaba en LAS DOS direcciones. ABIERTA, que es la cara: un respaldo real
      // de $1,800 aprobaba el texto "un millón ochocientos mil pesos" — un error
      // de 1000x con el sello de la guardia, y `5aeda80` (la c5) acababa de
      // exponer este parser a la frontera del panel al extender la guardia para
      // que leyera letras. CERRADA pero costosa: "doce mil pesos" con 12,000
      // respaldado daba 1012 y salía como cifra sin respaldo, y el llamador paga
      // un segundo ciclo de modelo (`copiloto.ts:267`) o tira la pieza entera sin
      // reintento (`agentes/contenido.ts:194`, `agentes/faq.ts:264`).
      //
      // "mil ochocientos" sigue siendo 1800 (mil va primero, suma > 1000 → suma).
      //
      // AUDITORÍA 32 c8 (AG-32C8-C1, TC-32C8-A1): este bloque decía que `millón`
      // quedaba fuera del vocabulario A PROPÓSITO. Ese rótulo era falso en lo que
      // importa. Fuera del vocabulario, el token se SALTA y sale el multiplicando
      // chico — medido: "tres millones de pesos" → [3], "cien millones" → [100],
      // "un millón de pesos" → []. Un respaldo real que traiga un 3 aprobaba
      // "tres millones de pesos" con el sello de la guardia puesto: el mismo
      // error de 1000x de la c7, con la escala de arriba y por la puerta de al
      // lado. Con `millón` dentro, esos textos dan números que no empatan con
      // nada y caen a 'fuera', que es a donde tienen que caer.
      //
      // Lo que NO cambia y se dice para que nadie lo lea como promesa: el parser
      // sigue sin ser completo. "un millón ochocientos mil" da 1,001,800, no
      // 1,800,000 — y está bien, porque tampoco empata. El caso peligroso es el
      // que empata por accidente, no el que no empata.
      // AUDITORÍA 32 c8 (AG-32C8-C1 / TC-32C8-A1): la misma regla, una escala
      // arriba. `millón` multiplica cuando va DESPUÉS de un valor menor que un
      // millón, igual que `mil` con mil. Así «mil millones» da 1e9 y no 1000.
      suma = vj >= 1000 && suma < vj ? suma * vj : suma + vj;
      j++; siguiente = tokens[j];
    }
    out.push(suma);
    i = j;
  }
  return out;
}
