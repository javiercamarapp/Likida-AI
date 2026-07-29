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
const AFIRMA_CIERRE: RegExp[] = [
  // "ya quedó cerrada", "ya está liquidado", "ya quedó lista tu liquidación"
  /\bya\s+(?:qued[óo]|est[áa]|dej[ée])[^.!?]{0,40}(?:cerrad|liquidad|list)/i,
  // "ya cerré", "ya te lo cerré", "ya la cerramos"
  /\bya\s+(?:te\s+)?(?:lo\s+|la\s+)?(?:cerr[ée]|cerramos|liquid[ée])(?![\wáéíóúñ])/i,
  // "tu viaje ya está liquidado" / "tu liquidación ya está lista"
  /(?:viaje|liquidaci[óo]n)[^.!?]{0,30}ya\s+est[áa][^.!?]{0,20}(?:cerrad|liquidad|list)/i,
  // "no tienes nada pendiente" — afirma el estado final por la puerta de atrás
  /\bno\s+tienes\s+nada\s+pendiente/i,
];

/**
 * Formas en que afirma haber ENVIADO el PDF o haberlo hecho llegar al contralor.
 * Se separa del cierre porque el PDF puede fallar con la liquidación cerrada de
 * verdad, y ahí el texto correcto es otro.
 */
const AFIRMA_ENVIO: RegExp[] = [
  /\bya\s+(?:te\s+|le\s+)?(?:lo\s+|la\s+)?(?:mand[ée]|envi[ée]|reenvi[ée])(?![\wáéíóúñ])/i,
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
 * Sustituye el texto cuando afirma un estado que NO ocurrió.
 *
 * No tacha la frase ni la parchea: cuando el modelo afirma un hecho falso, el
 * resto del mensaje tampoco es de fiar —está construido sobre esa premisa—, así
 * que se reemplaza entero por lo único que se sabe cierto. Es el mismo criterio
 * que `guardiaCifras` aplica a las cifras.
 */
export function guardiaEstado(reply: string, real: EstadoReal): ResultadoEstado {
  const motivos: string[] = [];
  if (!real.cerro && AFIRMA_CIERRE.some((r) => r.test(reply))) motivos.push('cierre_no_ocurrido');
  // `=== false` y no `!real.entrego`: `'pendiente'` es truthy, pero apoyarse en
  // eso dejaría el caso correcto dependiendo de una casualidad del lenguaje.
  if (real.entrego === false && AFIRMA_ENVIO.some((r) => r.test(reply))) motivos.push('envio_no_ocurrido');
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
