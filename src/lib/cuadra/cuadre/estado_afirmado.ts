// ═══════════════════════════════════════════════════════════════════════════
// LA GUARDIA DE LAS AFIRMACIONES DE ESTADO.
//
// `guardiaCifras` impide que el modelo invente un NÚMERO. Nada impedía que
// inventara un HECHO, que es igual de caro y más difícil de notar:
//
//   "Ya quedó cerrada tu liquidación ✅. En un momento te llega el PDF."
//   → dinero? no · fundamento forzado? no · sale idéntico
//
// Con `toolCalls: []` el viaje sigue `abierto`, no hay liquidación, no hay PDF y
// nadie lo va a generar. El operador deja de mandar comprobantes y espera. En la
// sala del 6-ago: el chofer recibe "ya quedó" y el panel del contralor está
// vacío. Es el anclaje literal del "3 o menos" del rubro agéntico — la base dice
// una cosa y el usuario cree otra— y llevaba tres rondas abierto.
//
// POR QUÉ AHORA SÍ SE PUEDE, y antes se dejó abierto con razón escrita:
// la ronda 4 lo aplazó por no inventar "un backstop de madrugada". Esto no es un
// backstop ni una heurística sobre el mundo: el servidor YA SABE si cerró —lo
// tiene en `closed`, calculado desde las tool calls—. Lo único que faltaba era
// comparar la afirmación del modelo contra ese hecho. Cuando el hecho existe, la
// guardia no adivina: coteja.
//
// El detector es deliberadamente ESTRECHO. Un falso positivo aquí tacha un
// mensaje correcto y le dice al operador que espere cuando ya terminó; un falso
// negativo deja pasar una mentira que el cierre real desmiente en segundos. Se
// prefiere el segundo error, así que solo se marcan las formas que afirman el
// cierre COMO HECHO CONSUMADO.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formas en que un modelo dice, en español mexicano de WhatsApp, que la
 * liquidación YA está cerrada. Todas exigen tiempo pasado o estado consumado:
 * "voy a cerrar", "cuando cierre" o "¿la cierro?" NO afirman nada.
 */
//
// OJO CON `\b` DESPUÉS DE VOCAL ACENTUADA. En JavaScript `\w` es [A-Za-z0-9_],
// así que `ó` y `é` NO son caracteres de palabra y no hay frontera entre "cerré"
// y el espacio que le sigue: un `cerr[ée]\b` no casa NUNCA. La primera versión de
// estos patrones fallaba entera por eso, sobre las cinco frases que el auditor
// transcribió. En un producto escrito íntegramente en español es una trampa que
// va a volver: se usa `(?![\wáéíóúñ])` cuando hace falta cerrar la palabra.
//
// "YA" NO ES EL FENÓMENO, ES UN ADORNO. La primera versión exigía la palabra "ya"
// al arranque de cada patrón porque las cinco frases que el auditor transcribió
// para escribir estos patrones la llevaban las cinco — el detector se ajustó a la
// muestra, no al hecho gramatical. "Listo, quedó liquidado tu viaje" afirma un
// cierre consumado sin decir "ya", y pasaba intacta con `toolCalls: []`. Lo que
// de verdad distingue una afirmación ("cerré", "quedó cerrado") de lo que no lo es
// ("cierro", "voy a cerrar", "cierre") es el PRETÉRITO, no un adverbio opcional
// que puede o no estar. "ya" se deja como prefijo OPCIONAL, nunca requerido.
const AFIRMA_CIERRE: RegExp[] = [
  // "quedó cerrada", "ya está liquidado", "quedó lista tu liquidación"
  /\b(?:ya\s+)?(?:qued[óo]|est[áa]|dej[ée])[^.!?]{0,40}(?:cerrad|liquidad|list)/i,
  // "cerré", "ya te lo cerré", "la cerramos", "liquidé", "liquidó" — pretérito,
  // con o sin "ya". NO casa con "cierro"/"cierre" (presente/subjuntivo: raíz
  // "cier-", no "cerr-") ni con "cerrar" (infinitivo: termina en "-ar").
  /\b(?:ya\s+)?(?:te\s+|le\s+)?(?:lo\s+|la\s+)?(?:cerr|liquid)(?:é|ó|amos|aron)(?![\wáéíóúñ])/i,
  // "tu viaje está liquidado" / "tu liquidación ya está lista"
  /(?:viaje|liquidaci[óo]n)[^.!?]{0,30}(?:ya\s+)?est[áa][^.!?]{0,20}(?:cerrad|liquidad|list)/i,
  // "no tienes nada pendiente" — afirma el estado final por la puerta de atrás
  /\bno\s+tienes\s+nada\s+pendiente/i,
];

/**
 * Formas en que afirma haber ENVIADO el PDF o haberlo hecho llegar al contralor.
 * Se separa del cierre porque el PDF puede fallar con la liquidación cerrada de
 * verdad, y ahí el texto correcto es otro. Mismo defecto que `AFIRMA_CIERRE`
 * antes del arreglo: "ya" era obligatorio y no debería serlo — es el pretérito
 * de mandar/enviar/reenviar el que afirma el hecho, con o sin ese adverbio.
 */
const AFIRMA_ENVIO: RegExp[] = [
  /\b(?:ya\s+)?(?:te\s+|le\s+)?(?:lo\s+|la\s+)?(?:mand|envi|reenvi)(?:é|ó|amos|aron)(?![\wáéíóúñ])/i,
  /\bte\s+(?:lo|la)\s+(?:acabo\s+de\s+)?(?:mandar|enviar)(?![\wáéíóúñ])/i,
];

export interface EstadoReal {
  /** El servidor cerró la liquidación en este turno. */
  cerro: boolean;
  /**
   * El servidor mandó el documento en este turno.
   *
   * `'pendiente'` NO es un adorno: es el estado en el que esta guardia corre
   * SIEMPRE en producción. El texto se manda (`say`) antes de intentar el PDF,
   * así que en el punto de la llamada el envío no ha ocurrido *todavía* y no se
   * puede saber si ocurrirá. La primera versión pasaba `false` ahí, y `false`
   * significa "no va a pasar": cualquier pretérito del modelo —"ya te envié tu
   * liquidación", que el prompt nunca prohibió— se leía como mentira. Como la
   * guardia solo reescribe el texto y no toca `closed`, el PDF se mandaba igual:
   * el operador recibía "Todavía no he cerrado tu liquidación" y acto seguido el
   * PDF de su liquidación cerrada. La guardia contra contradicciones produciendo
   * una, en el camino más transitado que existe.
   *
   * Con `'pendiente'` no se desmiente nada, y no hace falta: si el PDF falla, el
   * `catch` de `processor.ts` ya le dice la verdad ("no pude generarte el PDF").
   * Un tiempo verbal impreciso que se vuelve cierto en dos segundos es un
   * problema mucho menor que un mensaje que se contradice a sí mismo.
   */
  entrego: boolean | 'pendiente';
}

export interface ResultadoEstado {
  reply: string;
  forzado: boolean;
  /** Qué se desmintió. Para el log, no para el operador. */
  motivos: string[];
}

/**
 * ¿Una oración AFIRMA un hecho consumado según `patrones`?
 *
 * AUDITORÍA 12, MEDIO: el detector corría sobre el reply ENTERO y marcaba
 * negaciones ciertas ("tu liquidación NO quedó cerrada todavía, faltan tus
 * fotos"), preguntas ("¿Ya quedó cerrada?") y futuro ("Mañana cerramos tu
 * liquidación") — el comentario del archivo decía que el detector era
 * "deliberadamente estrecho" y no lo era: un falso positivo tacha un mensaje
 * CORRECTO y tira la información que el operador necesita (p. ej. "faltan tus
 * fotos"). Ahora:
 *  - se evalúa ORACIÓN por oración (no el reply completo);
 *  - una oración interrogativa (¿) se salta;
 *  - una negación pegada al verbo ("no quedó cerrada") se salta — el "no
 *    tienes nada pendiente" del patrón 4 no lleva negación antes del verbo,
 *    así que sigue afirmando;
 *  - "cerramos/liquidamos" (la terminación -amos, pretérito O presente/futuro)
 *    solo afirma si la oración NO trae marcador de futuro (mañana, cuando…).
 */
function afirmaHechoConsumado(reply: string, patrones: RegExp[]): boolean {
  const PREGUNTA = /[¿?]/;  // el "?" final también — en WhatsApp mexicano el ¿ se cae
  const NEGACION = /\b(?:no|nunca|jamás|tampoco)\b/i;
  const FUTURO = /\b(?:mañana|cuando|después|en\s+cuanto|pronto|luego|al\s+rato|apenas)\b/i;
  // El patrón 4 ("no tienes nada pendiente") ES una negación que afirma el
  // cierre: se exime del salto por negación.
  const AFIRMA_NEGANDO = /\bno\s+tienes\s+nada\s+pendiente/i;
  for (const oracion of reply.split(/(?<=[.!?])\s+|\n/)) {
    if (!oracion.trim()) continue;
    if (PREGUNTA.test(oracion)) continue;
    for (const r of patrones) {
      const m = r.exec(oracion);
      if (!m) continue;
      // AUDITORÍA 13, MEDIO (regresión del fix de la 12): el salto por negación
      // era de ORACIÓN ENTERA — "Ya quedó cerrada tu liquidación, NO te
      // preocupes" pasaba intacta con cerro:false, porque cualquier "no" en
      // cualquier posición saltaba la oración. La promesa del fix era "negación
      // PEGADA AL VERBO": se salta solo cuando el "no" está en la ventana del
      // verbo — antes del match ("no quedó cerrada") o justo tras el sujeto
      // ("viaje NO está liquidado", donde el verbo viene después del sujeto y
      // el match arranca en el sujeto). Un "no" accesorio a +25 caracteres del
      // verbo no cuenta.
      const ventana = oracion.slice(Math.max(0, m.index - 25), Math.min(oracion.length, m.index + 18));
      if (NEGACION.test(ventana) && !AFIRMA_NEGANDO.test(oracion)) continue;
      // -amos: "cerramos" es pretérito o presente/futuro según el contexto.
      if (/amos(?!\w)/i.test(m[0]) && FUTURO.test(oracion)) continue;
      return true;
    }
  }
  return false;
}

/**
 * Sustituye el texto cuando afirma un estado que NO ocurrió.
 *
 * No tacha la frase ni la parchea: cuando el modelo afirma un hecho falso, el
 * resto del mensaje tampoco es de fiar —está construido sobre esa premisa—, así
 * que se reemplaza entero por lo único que se sabe cierto. Es el mismo criterio
 * que `guardiaCifras` aplica a las cifras.
 */
export function guardiaEstado(reply: string, real: EstadoReal): ResultadoEstado {
  const motivos: string[] = [];
  if (!real.cerro && afirmaHechoConsumado(reply, AFIRMA_CIERRE)) motivos.push('cierre_no_ocurrido');
  // `=== false` y no `!real.entrego`: `'pendiente'` es truthy, pero apoyarse en
  // eso dejaría el caso correcto dependiendo de una casualidad del lenguaje.
  if (real.entrego === false && afirmaHechoConsumado(reply, AFIRMA_ENVIO)) motivos.push('envio_no_ocurrido');
  if (motivos.length === 0) return { reply, forzado: false, motivos: [] };

  // EL TEXTO TIENE QUE CORRESPONDER AL MOTIVO. Había uno solo para los dos, así
  // que desmentir un envío negaba además el cierre — mentira en la dirección
  // contraria, y sobre el hecho que más le importa al operador.
  const reemplazo = real.cerro
    ? 'Tu liquidación ya quedó cerrada ✅, pero todavía no te he mandado el PDF. Si no te llega en un momento, pídeselo a tu contralor: él ya la tiene en el panel. 🙏'
    : 'Todavía no he cerrado tu liquidación. Cuando ya no te falte ningún comprobante, escribe *listo* y la cierro. 🚛';

  return {
    reply: reemplazo,
    forzado: true,
    motivos,
  };
}
