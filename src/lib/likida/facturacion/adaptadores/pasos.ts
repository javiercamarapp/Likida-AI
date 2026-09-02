import { logger } from '@/lib/logger';
import { pantallaDeLogin } from '../vinculo_senales';
import type { InventarioPagina, PaginaConInventario, PaginaPortal } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// LOS PASOS DE OPERAR UN PORTAL, SUELTOS DEL PORTAL QUE SE OPERA.
//
// ── DE DÓNDE SALE ESTE ARCHIVO ────────────────────────────────────────────
//
// `playwright_base.ts` ya decía la frase correcta: «lo que cambia entre un
// portal y otro son los SELECTORES, no el procedimiento». Pero el
// procedimiento vivía DENTRO de una clase abstracta, en métodos privados, y
// eso lo hacía reusable solo por herencia y solo en el orden que la clase
// impone: llenar todos los campos → mirar el rechazo → apretar → esperar el
// UUID. Cualquier portal que necesite un paso de MÁS —entrar con la sesión de
// una persona, apretar «Buscar» antes de que aparezca el formulario fiscal,
// bajar el XML al final— tenía que sobrescribir `facturar()` entero. Y eso es
// exactamente lo que hizo CAPUFE: 1 282 líneas para un portal.
//
// Un segundo portal escrito así son otras N cientos de líneas. Cuatro son
// cuatro archivos que se parecen y que hay que arreglar cuatro veces cuando
// alguien encuentra un fallo en el procedimiento. Así que el procedimiento
// baja aquí, a funciones sueltas sobre `PaginaPortal`, y arriba quedan dos
// consumidores que NO se heredan entre sí:
//
//   · `AdaptadorPlaywrightBase` (`playwright_base.ts`), que las llama en el
//     orden fijo de siempre. Su comportamiento no cambia ni una coma — las
//     funciones de aquí salieron de sus métodos privados con los MENSAJES
//     LITERALES intactos, porque esos mensajes son el diagnóstico que alguien
//     lee a las tres de la mañana y ya están probados palabra por palabra.
//   · `AdaptadorDeclarativo` (`guion.ts`), que las compone según la ETAPA que
//     cada portal declare.
//
// ── POR QUÉ FUNCIONES Y NO MÁS MÉTODOS PROTEGIDOS ─────────────────────────
//
// Porque un paso que es método solo se puede probar heredando de la clase, y
// entonces la prueba prueba la clase. Sueltos, cada paso se prueba con una
// página doble de veinte líneas y sin adaptador de por medio: es lo que
// permite tener una prueba que diga «el paso de captcha aborta ANTES de
// escribir el primer carácter» sin montar un portal completo.
//
// ── LA REGLA QUE ATRAVIESA TODOS LOS PASOS ────────────────────────────────
//
// Un paso que no puede hacer su trabajo LANZA `FalloDePortal` con un mensaje
// ya escrito para una persona y con el selector literal dentro. Nunca devuelve
// un valor de relleno, nunca se traga la excepción, nunca sigue «a ver si
// funciona el siguiente». Un portal que cambió su HTML tiene que producir un
// error declarado y una captura, jamás un CFDI a medias: un comprobante
// fiscal mal hecho es un problema del CLIENTE ante el SAT, y no se deshace.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fallo con mensaje ya escrito para una persona. Se distingue del inesperado.
 *
 * Vivía en `playwright_base.ts` sin exportarse. Sube aquí porque ahora lo
 * lanzan pasos que dos adaptadores distintos comparten, y porque quien los
 * compone tiene que poder distinguir «el portal dijo que no» (mensaje bueno,
 * se enseña tal cual) de «reventó algo que no esperábamos» (mensaje técnico,
 * se envuelve).
 */
export class FalloDePortal extends Error {}

/** El texto de un error, venga como venga. */
export const textoDeError = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** ¿Esta página sabe describirse? Lo que exigen el captcha y el login. */
export function tieneInventario(p: PaginaPortal): p is PaginaConInventario {
  return typeof (p as PaginaConInventario).inventario === 'function';
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 0 · EL PRE-VUELO: TODOS LOS SELECTORES, DE GOLPE.
// ═══════════════════════════════════════════════════════════════════════════

/** Un selector que se va a usar, con el nombre que una persona reconoce. */
export interface SelectorAVerificar {
  /** «el campo "Folio"», «el botón de emitir». Va literal en el error. */
  que: string;
  /**
   * El selector, o VARIOS candidatos. Con varios, basta que UNO resuelva.
   *
   * Los candidatos existen porque un mapeo nuevo es una HIPÓTESIS hasta que
   * alguien corre el pre-vuelo contra el portal de verdad: se declaran las
   * dos o tres formas plausibles de nombrar el campo («el input cuyo label
   * dice Folio», «#folio») y el motor elige la que exista. Lo que NO se hace
   * es inventar una sola y jurar que es esa.
   */
  sel: string | readonly string[];
}

/** Qué candidato ganó, por selector pedido. Vacío = no se pudo verificar. */
export type SelectoresResueltos = ReadonlyMap<string, string>;

export interface ResultadoPreVuelo {
  /** `que` → el candidato que SÍ existe. */
  resueltos: SelectoresResueltos;
  /** Los `que` que no resolvió ningún candidato, ya redactados. */
  faltan: string[];
  /** `false` cuando la página no ofrece `existe()` y no se pudo comprobar nada. */
  seVerifico: boolean;
}

/**
 * Los selectores que se van a usar, verificados ANTES de escribir el primero.
 *
 * Reporta los que falten JUNTOS. Sin esto se descubre uno por corrida: se
 * arregla el primero, se vuelve a correr, aparece el segundo. Con un portal
 * que acaba de cambiar de plantilla eso son cinco vueltas contra un sitio
 * ajeno, que además es como se consigue que ese sitio te bloquee la IP.
 *
 * NO LANZA. Devuelve lo que vio, y quien compone decide si eso es un fallo
 * (un campo obligatorio que no está) o un dato (un botón opcional ausente).
 * Es la diferencia entre un paso y una política, y la política es de arriba.
 */
export async function preVuelo(
  pagina: PaginaPortal,
  revisar: readonly SelectorAVerificar[],
): Promise<ResultadoPreVuelo> {
  const existe = pagina.existe;
  // Sin `existe()` no se falla: se descubre al escribir, con el mismo mensaje.
  if (!existe) return { resueltos: new Map(), faltan: [], seVerifico: false };

  const resueltos = new Map<string, string>();
  const faltan: string[] = [];

  for (const r of revisar) {
    const candidatos = typeof r.sel === 'string' ? [r.sel] : r.sel;
    let gano: string | null = null;
    for (const c of candidatos) {
      // `existe` puede reventar por su propio tope de tiempo. Un candidato que
      // no se pudo comprobar NO es un candidato que exista: se pasa al
      // siguiente y, si ninguno resuelve, el selector se reporta como ausente.
      // Tragarse esto y darlo por bueno sería escribir a ciegas.
      try {
        if (await existe.call(pagina, c)) { gano = c; break; }
      } catch (e) {
        logger.warn('portal.prevuelo.candidato_ilegible', { que: r.que, sel: c, error: textoDeError(e) });
      }
    }
    if (gano) resueltos.set(r.que, gano);
    else faltan.push(`${r.que} → ${candidatos.map((c) => `\`${c}\``).join(' ni ')}`);
  }

  return { resueltos, faltan, seVerifico: true };
}

/**
 * El mensaje EXACTO que `playwright_base` lleva dando desde que existe.
 *
 * Se conserva palabra por palabra —y por eso es una función y no una plantilla
 * suelta en cada llamador— porque este texto es lo primero que lee quien tiene
 * que arreglar el mapeo, y su prueba lo compara literal.
 */
export function mensajeSelectoresIdos(portal: string, comercio: string, faltan: readonly string[]): string {
  return `${portal} ya no tiene estos selectores: ${faltan.join('; ')}. Hay que actualizar el mapeo de "${comercio}".`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 1 · EL CAPTCHA — SE DETECTA Y SE ABORTA. NO SE RESUELVE.
//
// LIKIDA NO RESUELVE NI RODEA CAPTCHAS. Ni con un servicio de terceros
// (2captcha, anti-captcha y equivalentes), ni con visión, ni «probando a ver».
// Las razones ya están asentadas en `piloto_vision.ts` y en `capufe.ts`, y se
// repiten aquí porque este es el sitio por el que van a pasar TODOS los
// portales nuevos:
//
//   1. UN CAPTCHA ES UN CONTROL DE ACCESO. Rodearlo es operar contra los
//      términos de servicio de un tercero.
//   2. LA CUENTA QUE SE BLOQUEA ES LA DEL CLIENTE, no la de Likida. Con ella
//      se le cae la facturación del mes entero. Treinta segundos ahorrados no
//      valen eso.
//
// LO QUE SÍ SE HACE: se para aquí, se devuelve `requiereCaptcha`, y al humano
// se le arma la pantalla con TODO prellenado para que lo resuelva en segundos.
// Ni siquiera se abre el cofre de credenciales: el captcha se ve ANTES de
// tocar nada, y una contraseña descifrada para un portal que no se va a poder
// operar es un secreto expuesto a cambio de nada.
//
// Y el orden importa: esto va ANTES de escribir el primer carácter. Un
// formulario a medio llenar detrás de un captcha no le sirve a nadie y sí deja
// rastro de robot en el portal.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lo que delata un CAPTCHA que BLOQUEA, no un script cargado.
 *
 * Es la MISMA lista que `capufe.ts` midió y razonó (`SELECTORES_CAPTCHA`), y
 * se declara aquí para que un portal nuevo la herede sin copiarla. Fuera de la
 * lista, a propósito: `.grecaptcha-badge` y `script[src*="recaptcha"]`, que los
 * trae cualquier sitio con reCAPTCHA v3 invisible —donde no hay nada que
 * resolver— y abortar por ellos convertiría al motor en uno que nunca factura.
 */
export const SELECTORES_CAPTCHA_COMUNES: readonly string[] = [
  'iframe[src*="recaptcha/api2/anchor"]',
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[title*="recaptcha" i]',
  '.g-recaptcha',
  '.h-captcha',
  'img[src*="captcha" i]',
  '[data-sitekey]',
];

/** El texto que delata un captcha cuando el DOM no lo enseña con clase propia. */
export const RE_CAPTCHA_TEXTO = /captcha|no soy un robot|verificaci[oó]n de seguridad|verify you are human/i;

/**
 * ¿Hay un CAPTCHA enfrente? Devuelve la PISTA que lo delató, o `null`.
 *
 * Devuelve la pista y no un booleano porque el mensaje que acaba en la
 * pantalla del contralor tiene que decir QUÉ se vio: «pidió captcha» a secas
 * es indistinguible de «el adaptador se rindió», y son cosas distintas.
 *
 * NO LANZA si la lectura falla: no poder leer el aviso del portal no es un
 * captcha. Tratarlo como tal sacaría de la cola automática a todo portal
 * lento, que es justo el error contrario al que este paso previene.
 */
export async function mirarCaptcha(
  pagina: PaginaPortal,
  selectores: readonly string[] = SELECTORES_CAPTCHA_COMUNES,
): Promise<string | null> {
  const existe = pagina.existe;
  if (existe) {
    for (const sel of selectores) {
      try {
        if (await existe.call(pagina, sel)) return `selector \`${sel}\``;
      } catch (e) {
        logger.warn('portal.captcha.selector_ilegible', { sel, error: textoDeError(e) });
      }
    }
  }

  if (tieneInventario(pagina)) {
    try {
      const inv = await pagina.inventario();
      if (inv.captcha.length > 0) return `el inventario de la página trae ${inv.captcha.join(', ')}`;
      if (RE_CAPTCHA_TEXTO.test(inv.texto)) return 'el texto de la página menciona un captcha';
    } catch (e) {
      logger.warn('portal.captcha.inventario_ilegible', { error: textoDeError(e) });
    }
  }

  return null;
}

/** El mensaje de captcha, uno para todos los portales. */
export function mensajeCaptcha(portal: string, cuando: string, pista: string): string {
  return `${portal} pidió CAPTCHA ${cuando} (${pista}): hay que facturarlo a mano. No se intentó resolverlo — rodear un CAPTCHA es operar contra los términos del portal y la cuenta que se bloquea es la del CLIENTE, no la de Likida. Esto NO es "no pude", es "no se puede": reintentar no va a cambiar nada, tiene que entrar una persona. Se le deja la pantalla con todo lo leído del ticket para que solo teclee lo que falta.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 2 · LA PUERTA — ¿SEGUIMOS DENTRO, O EL PORTAL PIDE ENTRAR?
//
// Likida NUNCA teclea una contraseña. El login lo hace una persona UNA vez
// desde el panel y de ahí sale el `storageState` que `sesion_portal.ts` guarda
// cifrado. Este paso solo MIRA si la puerta está abierta, y traduce lo que ve
// a quién tiene que actuar: el cliente (volver a vincular) o Likida (rehacer
// el mapeo). Esa clasificación ya vive en `vinculo_senales.ts` y no se
// reimplementa: se llama.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ¿El portal nos está enseñando su pantalla de entrar?
 *
 * `null` cuando seguimos dentro O cuando la página no sabe describirse — y las
 * dos cosas significan lo mismo para quien compone: no hay evidencia de login,
 * así que no se declara uno. Afirmar «pide entrar» porque no se pudo mirar
 * mandaría al contralor a re-vincular un portal que nunca lo pidió.
 */
export async function mirarLogin(
  pagina: PaginaPortal,
  senaDeAdentro?: string,
): Promise<{ visto: string | null; inventario: InventarioPagina | null }> {
  if (!tieneInventario(pagina)) return { visto: null, inventario: null };
  try {
    const inv = await pagina.inventario();
    return { visto: pantallaDeLogin(inv, senaDeAdentro), inventario: inv };
  } catch (e) {
    logger.warn('portal.login.inventario_ilegible', { error: textoDeError(e) });
    return { visto: null, inventario: null };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 3 · ESCRIBIR — Y EL FORMATO, QUE NO ES COSMÉTICO.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cómo se teclea un valor en ESTE portal.
 *
 * Existe porque el mismo dato se escribe distinto según el portal y ese ajuste
 * NO puede vivir en el extractor: el extractor lee el ticket una vez y el
 * valor viaja a `gasto`, mientras que la fecha «2026-08-27» hay que teclearla
 * como `27/08/2026` en un portal y como `2026-08-27` en el de al lado. Meter
 * eso en el extractor obligaría a leer el ticket una vez POR PORTAL.
 *
 *   · `texto`       — tal cual (default).
 *   · `mayusculas`  — para los campos que el portal valida en mayúsculas.
 *   · `monto`       — solo dígitos y UN punto decimal: `$ 1,234.50` → `1234.50`.
 *                     El símbolo y las comas rebotan en más de un portal.
 *   · `monto_entero`— la parte entera: los portales que piden «pesos» sin centavos.
 *   · `fecha_dmy`   — `2026-08-27` → `27/08/2026`.
 *   · `fecha_dmy_guion` — `2026-08-27` → `27-08-2026`.
 *   · `solo_digitos`— se quitan guiones y espacios de folios y referencias.
 */
export type FormatoCampo =
  | 'texto' | 'mayusculas' | 'monto' | 'monto_entero'
  | 'fecha_dmy' | 'fecha_dmy_guion' | 'solo_digitos';

const RE_FECHA_ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * El valor, listo para teclear. `null` cuando el formato NO se puede aplicar.
 *
 * `null` y no «el valor original» A PROPÓSITO. Si a `fecha_dmy` le llega algo
 * que no es una fecha ISO, escribir el original mete basura en un campo de un
 * documento fiscal y el portal la acepta o no según el día. Devolver `null`
 * obliga a quien compone a declarar el fallo, que es lo correcto: el dato que
 * se leyó del ticket no sirve para este portal y eso hay que decirlo, no
 * disimularlo.
 *
 * `null` de entrada sigue siendo `null` — nunca 0, nunca cadena vacía, nunca
 * `NaN`. Un monto que no se leyó no es un monto de cero pesos.
 */
export function aplicarFormato(valor: string | null, formato: FormatoCampo = 'texto'): string | null {
  if (valor === null) return null;
  const v = valor.trim();
  if (!v) return null;

  switch (formato) {
    case 'texto':
      return v;
    case 'mayusculas':
      return v.toUpperCase();
    case 'solo_digitos': {
      const d = v.replace(/\D+/g, '');
      return d || null;
    }
    case 'monto':
    case 'monto_entero': {
      // Se quita todo menos dígitos, punto y coma; después la coma de millares.
      const limpio = v.replace(/[^\d.,]/g, '').replace(/,(?=\d{3}\b)/g, '');
      // EL GUARDA QUE PARECE DE MÁS Y NO LO ES: sin él, `Number('')` es 0 —no
      // `NaN`— así que un monto ILEGIBLE («borroso», una cadena sin un solo
      // dígito) se escribía en el portal como `0.00`. Un monto que no se leyó
      // NO es un monto de cero pesos, y ponerlo en un documento fiscal es peor
      // que no poner nada: el CFDI sale mal y no se deshace.
      if (!/\d/.test(limpio)) return null;
      const n = Number(limpio.replace(/,/g, '.'));
      if (!Number.isFinite(n)) return null;
      return formato === 'monto_entero' ? String(Math.trunc(n)) : n.toFixed(2);
    }
    case 'fecha_dmy':
    case 'fecha_dmy_guion': {
      const m = RE_FECHA_ISO.exec(v);
      if (!m) return null;
      const sep = formato === 'fecha_dmy' ? '/' : '-';
      return `${m[3]}${sep}${m[2]}${sep}${m[1]}`;
    }
  }
}

export interface PasoEscribir {
  /** Selector ya RESUELTO (el candidato que el pre-vuelo confirmó). */
  selector: string;
  valor: string;
  /**
   * Cómo lo llama el portal, LITERAL y sin adornos («Folio», «RFC»). Es lo que
   * la persona va a buscar en pantalla, así que va entrecomillado en el error
   * y no envuelto en una frase: el texto de este mensaje está probado palabra
   * por palabra desde que existe `playwright_base`.
   */
  que: string;
  /** `escribir` (default) o `seleccionar` para un `<select>`. */
  como?: 'escribir' | 'seleccionar';
}

/** Una página que además sabe elegir en un desplegable. */
interface PaginaQueSelecciona extends PaginaPortal {
  seleccionar(selector: string, valor: string): Promise<void>;
}

const sabeSeleccionar = (p: PaginaPortal): p is PaginaQueSelecciona =>
  typeof (p as PaginaQueSelecciona).seleccionar === 'function';

/**
 * Teclea un valor y, si no se puede, dice QUÉ selector faltó y de qué portal.
 *
 * El mensaje conserva la forma que `playwright_base` ya usaba, con el portal y
 * el comercio dentro, porque lo que hace útil ese texto es que se puede leer
 * sin abrir el código: dice a qué sitio ir y qué archivo tocar.
 */
export async function escribirCampo(
  pagina: PaginaPortal,
  paso: PasoEscribir,
  contexto: { portal: string; comercio: string },
): Promise<void> {
  try {
    if (paso.como === 'seleccionar') {
      if (!sabeSeleccionar(pagina)) {
        throw new Error('esta página no sabe elegir en un desplegable (`seleccionar` no está implementado)');
      }
      await pagina.seleccionar(paso.selector, paso.valor);
      return;
    }
    await pagina.escribir(paso.selector, paso.valor);
  } catch (e) {
    throw new FalloDePortal(
      `No se pudo llenar "${paso.que}" en ${contexto.portal}: el selector \`${paso.selector}\` ya no está en la página (${textoDeError(e)}). Hay que actualizar el mapeo de "${contexto.comercio}".`,
    );
  }
}

/** Un clic con el mismo trato: falla con el selector dentro. */
export async function clic(
  pagina: PaginaPortal,
  selector: string,
  que: string,
  contexto: { portal: string; comercio: string },
): Promise<void> {
  try {
    await pagina.hacerClic(selector);
  } catch (e) {
    throw new FalloDePortal(
      `No se pudo apretar ${que} en ${contexto.portal}: el selector \`${selector}\` ya no está en la página (${textoDeError(e)}). Hay que actualizar el mapeo de "${contexto.comercio}".`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 4 · LO QUE EL PORTAL CONTESTA — RECHAZOS, ESPERAS Y CAPTURAS.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que el portal dice de lo capturado. Vacío o ausente = no dijo nada. */
export async function leerRechazo(pagina: PaginaPortal, selector: string | undefined): Promise<string | null> {
  if (!selector) return null;
  try {
    const t = await pagina.leerTexto(selector);
    return t && t.trim() ? t.trim() : null;
  } catch {
    // Que no se pueda leer el cuadro de error NO es un rechazo. Tratarlo como
    // tal convertiría cada portal sin cuadro de error en un fallo permanente.
    return null;
  }
}

/** Una captura que falla no puede tumbar un intento: es evidencia, no paso. */
export async function capturaSegura(pagina: PaginaPortal, comercio: string): Promise<string | undefined> {
  try {
    return await pagina.captura();
  } catch (e) {
    logger.warn('agente.portal.captura_fallo', { comercio, error: textoDeError(e) });
    return undefined;
  }
}

export interface OpcionesEspera {
  /** TOPE por tiempo. En producción lo caro es cada lectura, no la pausa. */
  topeMs: number;
  /** Cada cuánto se vuelve a mirar. */
  intervaloMs: number;
  dormir: (ms: number) => Promise<void>;
  ahora: () => number;
}

/**
 * SONDEA un selector hasta que traiga texto. No una lectura y ya.
 *
 * Es el paso del UUID, generalizado: el portal manda el comprobante a timbrar
 * a un PAC y pinta el resultado cuando vuelve, así que leer una vez justo tras
 * el clic no encuentra nada. El modo de fallo peor no es esperar poco: es el
 * portal que PRE-PINTA el contenedor vacío (`<span class="uuid"></span>`), con
 * lo que `leerTexto` devuelve `''`, `''` es falsy, y una emisión EXITOSA se
 * reporta como «puede que el CFDI ya exista» — que manda a revisar a mano algo
 * que salió bien e invita a reintentar una emisión que ya ocurrió.
 *
 * Por eso devuelve además `aparecio`: distingue «el contenedor no está» (mirar
 * el mapeo) de «está y sigue vacío» (mirar el portal). Con un solo texto, la
 * mitad de las veces se busca en el sitio equivocado.
 *
 * DOS TOPES, por vueltas y por tiempo. El de vueltas es para la prueba, donde
 * `dormir` no duerme; el de tiempo para producción, donde cada `leerTexto`
 * contra un selector ausente paga su propio tope (3 s por default) y contando
 * solo vueltas el sondeo duraría vueltas × 3 s.
 */
export async function esperarTexto(
  pagina: PaginaPortal,
  selector: string,
  op: OpcionesEspera,
): Promise<{ valor: string | null; aparecio: boolean }> {
  const limite = op.ahora() + op.topeMs;
  const vueltas = Math.max(1, Math.ceil(op.topeMs / op.intervaloMs));
  let aparecio = false;

  for (let i = 0; i < vueltas; i++) {
    const bruto = await pagina.leerTexto(selector);
    if (bruto !== null) {
      aparecio = true;
      const v = bruto.trim();
      if (v) return { valor: v, aparecio: true };
    }
    if (i === vueltas - 1 || op.ahora() >= limite) break;
    await op.dormir(op.intervaloMs);
  }

  return { valor: null, aparecio };
}

// ═══════════════════════════════════════════════════════════════════════════
// PASO 5 · BAJAR EL XML.
//
// EL CFDI SE BAJA, NO SE FABRICA. Esta es la regla de la casa escrita como
// código: lo único que este paso sabe hacer es apretar el botón de descarga
// del portal y quedarse con lo que el portal entregue. No compone XML, no
// rellena huecos, no «reconstruye» un comprobante a partir de lo que se
// capturó. Un CFDI fabricado es un delito fiscal DEL CLIENTE.
//
// Y por eso falla ruidosamente: un portal que no entregó archivo devuelve un
// fallo declarado, no una ruta vacía que río abajo se leería como «ya está».
// ═══════════════════════════════════════════════════════════════════════════

/** Una página que sabe recoger la descarga que dispara un clic. */
export interface PaginaQueDescarga extends PaginaPortal {
  /** Aprieta y devuelve la RUTA local del archivo que el portal entregó. */
  descargar(selector: string, topeMs?: number): Promise<string>;
}

export const sabeDescargar = (p: PaginaPortal): p is PaginaQueDescarga =>
  typeof (p as PaginaQueDescarga).descargar === 'function';

/**
 * Baja el XML del CFDI que el portal acaba de emitir.
 *
 * `null` cuando la plataforma no sabe descargar (una página doble en pruebas,
 * un entorno sin disco) — eso NO es un fallo del portal y no puede tumbar una
 * emisión que ya ocurrió: el CFDI existe y el UUID ya se confirmó. Se dice en
 * el log y se sigue. Lo que sí es fallo, y lanza, es que el botón esté y la
 * descarga no llegue.
 */
export async function descargarXml(
  pagina: PaginaPortal,
  selector: string,
  contexto: { portal: string; comercio: string; topeMs?: number },
): Promise<string | null> {
  if (!sabeDescargar(pagina)) {
    logger.warn('portal.xml.sin_descarga', { comercio: contexto.comercio });
    return null;
  }
  try {
    const ruta = await pagina.descargar(selector, contexto.topeMs);
    if (!ruta) throw new Error('la descarga terminó sin ruta de archivo');
    return ruta;
  } catch (e) {
    throw new FalloDePortal(
      `${contexto.portal} emitió el CFDI pero no entregó el XML al apretar \`${selector}\` (${textoDeError(e)}). El comprobante EXISTE: hay que bajarlo del portal a mano — no se reintenta la emisión, que lo duplicaría.`,
    );
  }
}
