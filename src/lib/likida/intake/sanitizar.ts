// Saneamiento de texto NO CONFIABLE (folios, productos, estación leídos por OCR o
// del XML de un emisor). Un ticket/CFDI malicioso puede traer instrucciones en
// esos campos que luego viajan al contexto del agente. Se neutralizan con cap de
// longitud + charset acotado ANTES de guardar/pasar al LLM. Puro, sin deps.

/** Folio: solo alfanumérico y separadores comunes; cap 40. Un folio real
 *  (7318052, 0006060206, 006A, DS-8801) sobrevive intacto; una carga de inyección
 *  se recorta y se le quitan espacios/comillas/saltos. */
export function sanitizarFolio(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const limpio = s.replace(/[^A-Za-z0-9/.\-]/g, '').slice(0, 40);
  return limpio || undefined;
}

/** Texto libre no confiable (producto, estación): sin saltos/control, sin
 *  marcadores de delimitador (< > ` ), espacios colapsados, cap de longitud. */
export function sanitizarTexto(s: string | null | undefined, maxLen = 80): string | undefined {
  if (!s) return undefined;
  const limpio = s
    .replace(/[\x00-\x1f\x7f]/g, ' ') // control chars / saltos
    .replace(/[<>`]/g, '')                   // marcadores de delimitador
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return limpio || undefined;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATOS SENSIBLES COLADOS POR EL TICKET
//
// `sanitizarTexto` es defensa contra INYECCIÓN: corta y quita delimitadores.
// No mira el contenido, y no fue escrita para eso. El campo `producto` sí trae
// contenido: un operador que compra su medicamento en el camino y lo mete a
// gastos produce "METFORMINA 850MG 30 TABS" — un dato de SALUD del titular
// (art. 2 fr. VI), escrito en `gasto.ocr_extra`.
//
// Por qué no basta con "es poco probable": el art. 8 párrafo segundo prohíbe
// crear bases con datos sensibles sin justificación, y el consentimiento para
// sensibles tiene que ser expreso Y POR ESCRITO con firma o mecanismo de
// autenticación — que por este canal no existe en ninguna forma. Además el
// art. 59 fr. IV permite incrementar la sanción "hasta por dos veces" cuando
// hay sensibles de por medio: es el único renglón del rubro que la duplica.
// docs/conocimiento/11-datos-personales.md §8.6 lo pide por escrito:
// "Filtro de datos sensibles colados […] Detecta y excluye."
//
// LÍMITE QUE HAY QUE TENER PRESENTE: esto reduce lo que se PERSISTE, no lo que
// se remite. La foto entera ya viajó al modelo de visión antes de llegar aquí,
// y una imagen no se puede enmascarar de antemano. El §8.6 pide ambas cosas;
// este filtro cubre una.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Señales de que lo comprado dice algo sobre la salud, la vida sexual o las
 * creencias del titular. Se calibró a favor de la COBERTURA, no de la
 * precisión, porque los dos errores no cuestan lo mismo: un falso positivo
 * pierde una etiqueta de pantalla, un falso negativo escribe un dato sensible
 * en la base.
 *
 * Ese cálculo se sostiene porque `producto` solo se usa para etiquetar
 * combustible (`etiquetaConcepto`, cuadre/engine.ts): en un ticket de farmacia
 * el campo no alimenta ninguna cifra ni ninguna decisión.
 *
 * LO QUE ESTA LISTA NO CUBRE, dicho para que nadie la lea como el catálogo
 * completo del art. 2 fr. VI: las opiniones políticas, el origen racial o
 * étnico y la información genética no tienen un camino real hasta el campo
 * `producto` de un comprobante de carretera, así que no se simulan reglas para
 * ellos. Y tampoco cubre lo que llega por OTRO campo: el nombre de una farmacia
 * viaja en `emisor`, que pasa por `sanitizarTexto` porque `identificarComercio`
 * lo necesita para decidir si el gasto se puede facturar.
 */
const SENSIBLE: RegExp[] = [
  // Formas farmacéuticas.
  //
  // La frontera IZQUIERDA es `(^|[^a-z])` y no `\b`, y ahí estaba el hueco: un
  // ticket de farmacia imprime la presentación PEGADA a la cantidad —"30TABS",
  // "20CAPS", "C/10TAB"—, y entre un dígito y una letra no hay `\b` porque los
  // dos son caracteres de palabra. "VITACILINA 10TAB" se guardaba entero.
  // La frontera DERECHA sigue siendo `\b` a fuerza, y es la que protege el
  // catálogo real: sin ella "cap" casa dentro de CAPUFE y "tab" dentro de
  // TABASCO. Cambiar la izquierda no toca esa defensa.
  /(^|[^a-z])(tab|tabs|tableta|tabletas|cap|caps|capsula|capsulas|gragea|grageas|jarabe|suspension|ampolleta|ampolletas|ampula|ampulas|inyectable|inyeccion|supositorio|supositorios|ovulo|ovulos|nebulizacion|inhalador)\b/,
  // Dosis. mg/mcg/UI son unidades de medicamento; ml, g y kg NO se incluyen
  // porque un refresco de 600 ML y un kilo de abarrotes darían falso positivo.
  /\b\d+(\.\d+)?\s*(mg|mcg|ui)\b/,
  // Contexto de salud impreso en el propio ticket.
  /\b(farmacia|farmacias|medicamento|medicamentos|medicina|medicinas|receta|antibiotico|analgesico|antigripal|insulina|jeringa|jeringas|glucometro|glucosa|venda|vendas|gasa|gasas|curacion|consultorio|radiografia|ultrasonido|dentista|optica|oftalmico|oftalmica|hospital)\b/,
  /\b(laboratorio|analisis) clinic/,
  /\bconsulta medic/,
  // Vida sexual y salud reproductiva — art. 2 fr. VI las lista igual que salud.
  /\b(preservativo|preservativos|condon|condones|anticonceptivo|anticonceptivos)\b/,
  /\bprueba de embarazo\b/,
  // Creencias religiosas. El art. 2 fr. VI las pone en el mismo renglón que la
  // salud (11-datos-personales.md:129) y §8.6 nombra este camino exacto: "un
  // ticket de farmacia revela salud; UNO DE COMIDA, POSIBLEMENTE CREENCIAS".
  // Por eso van las dos marcas alimentarias, que es como una creencia llega de
  // verdad a un gasto de viaje, y no una lista devocional larga que nunca
  // aparecería en un comprobante de carretera.
  /\b(kosher|halal)\b/,
  /\b(diezmo|limosna|parroquia|templo|iglesia|biblia)\b/,
];

/**
 * Saneamiento de `producto`: lo mismo que `sanitizarTexto` y además EXCLUYE el
 * valor completo cuando revela salud, vida sexual o creencias.
 *
 * Se descarta entero y no se sustituye por una marca del estilo
 * "[dato de salud omitido]": esa marca sigue siendo una inferencia de salud
 * sobre el titular, guardada en la base y visible para su patrón. Guardar la
 * etiqueta del dato sensible es guardar el dato sensible.
 */
export function sanitizarProducto(s: string | null | undefined): string | undefined {
  const limpio = sanitizarTexto(s);
  if (!limpio) return undefined;
  const normalizado = limpio
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // sin acentos: "CÁPSULA" y "INYECCIÓN"
    .toLowerCase();
  return SENSIBLE.some((r) => r.test(normalizado)) ? undefined : limpio;
}
