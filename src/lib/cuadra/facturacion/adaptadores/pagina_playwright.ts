import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright-core';
import { logger } from '@/lib/logger';
import type { FabricaDePagina, PaginaPortal } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// EL NAVEGADOR DE VERDAD. La pieza que le faltaba a todo lo demás.
//
// `playwright_base.ts` describe una página en cinco métodos y `capufe.ts` sabe
// operar el portal con ellos, pero hasta aquí NADIE implementaba esos cinco
// métodos con un navegador: la facturación automática era un contrato sin
// cuerpo. Esto es el cuerpo.
//
// Se implementan los cinco de `PaginaPortal` (`abrir`, `escribir`, `hacerClic`,
// `leerTexto`, `captura`), los dos opcionales de la base (`existe`, `cerrar`) y
// los tres que `PaginaCapufe` declara para sus desplegables con buscador
// (`seleccionar`, `opciones`, `valorSeleccionado`). Los tres últimos son
// OPCIONALES en el contrato y `capufe.ts` tiene camino sin ellos —pero es un
// camino peor: escribir en el buscador y confiar en que la lista filtró, en vez
// de `selectOption`, que emite `input` y `change` y se puede verificar.
//
// ── UN NAVEGADOR POR LOTE, NO POR TICKET ─────────────────────────────────
//
// Es la decisión de costo del producto (ver el encabezado del cron: ocho casetas
// son ~128 s de una en una contra ~48 s en una sola sesión). Conviene decir con
// precisión de dónde sale ese ahorro, porque no es de donde parece:
//
//   Medido en esta Mac, con la caché caliente: arrancar Chromium 69 ms, crear el
//   contexto 5 ms, cada pestaña ~30 ms. O sea que el ARRANQUE por sí solo cuesta
//   ~2 pestañas, no diez. En un contenedor frío es bastante más —hay que leer el
//   binario del disco de la función— pero eso NO está medido y no se va a
//   afirmar aquí.
//
//   Lo caro de verdad es la SESIÓN: navegar al portal, llenar los seis datos
//   fiscales y esperar a que sus dos catálogos lleguen por AJAX. Medido contra el
//   portal de prueba (`pagina_playwright.test.ts`), eso son ~1.2 s por sesión, y
//   se paga UNA vez por lote en vez de una por ticket.
//
// El diseño es el mismo con cualquiera de las dos cuentas; el que cambia es el
// número que se puede defender enfrente de alguien.
//
// Por eso hay DOS objetos y no uno:
//   · `SesionNavegador` — un Chromium y un contexto, vivos durante todo el lote.
//   · `PaginaPlaywright` — una pestaña. Su `cerrar()` cierra LA PESTAÑA y nada
//     más, porque la base llama a `cerrar()` en el `finally` de CADA ticket: si
//     ahí se cerrara el navegador, el segundo ticket del lote abriría uno nuevo
//     y la decisión de arriba se perdería sin que ninguna prueba se enterara.
//
// El navegador se cierra en `conNavegador()`, en un `finally`, pase lo que pase.
//
// ── TODO TIENE TECHO, Y ES EL CRITERIO DE `presupuesto.ts` ───────────────
//
// Mismo razonamiento que `TOPE_CONSULTA_MS`, con los números de este dominio:
// un tope se justifica como múltiplo de lo típico, se puede aflojar por entorno
// sin desplegar, y se impone en DOS capas —el `timeout` de Playwright, que
// cancela de verdad, y una carrera contra un temporizador como red de
// seguridad, porque el `timeout` solo cubre lo que Playwright controla y el
// cuelgue puede estar antes (DNS, TLS, el socket de CDP con un renderer muerto).
//
// La diferencia con `acotada()` es el final: allá agotar el tope entra por el
// mismo camino que un error de Postgres (`{data:null,error}`) porque así lo
// espera cada llamador. Aquí el contrato dice que `escribir` y `hacerClic`
// LANZAN cuando el selector no está, así que agotar el tope también lanza —con
// un mensaje que dice cuál operación fue y cuántos ms esperó.
// ═══════════════════════════════════════════════════════════════════════════

// ── LOS TOPES ─────────────────────────────────────────────────────────────
//
// El presupuesto de la invocación son los 300 s de `maxDuration` del cron, y en
// ellos caben ocho tickets (`TOPE_POR_CORRIDA`). O sea ~37 s por ticket, y de
// esos hay que pagar el arranque del navegador una vez por lote.

/**
 * NAVEGAR. Incluye DNS, TLS y el HTML.
 *
 * 20 s contra los ~1-3 s que tarda un portal sano: ~7×. El default de Playwright
 * son 30 s y no cabe: dos portales caídos se comen 60 de los 300 s del cron sin
 * haber tecleado nada. Por debajo de ~15 s se empieza a cortar a portales
 * gubernamentales lentos de verdad, que es justo la clase de portal que esto
 * opera.
 */
export const TOPE_NAVEGAR_MS = Number(process.env.CUADRA_TOPE_NAVEGAR_MS) || 20_000;

/**
 * ESCRIBIR, HACER CLIC, ELEGIR EN UN DESPLEGABLE.
 *
 * 8 s, el mismo número que `TOPE_CONSULTA_MS` y por el mismo argumento: una
 * acción sobre un elemento que ya está en la página cuesta ~50-300 ms, así que
 * son ~26× lo típico y ninguna acción sana lo toca. El default de Playwright
 * (30 s) multiplicado por las ~12 acciones de una sesión de ocho casetas serían
 * 360 s de peor caso: más que la invocación entera.
 *
 * OJO: este tope NO es "cuánto tarda el portal en responder al clic". Es cuánto
 * se espera a que el ELEMENTO esté accionable. Lo que pase después del clic se
 * espera leyendo, con `TOPE_LECTURA_MS`.
 */
export const TOPE_ACCION_MS = Number(process.env.CUADRA_TOPE_ACCION_MS) || 8_000;

/**
 * LEER TEXTO. Es el tope más delicado de los cinco y conviene entender por qué.
 *
 * `buscarFila()` de `capufe.ts` recorre la tabla de "CÓDIGOS AGREGADOS" y PARA
 * cuando `leerTexto` devuelve `null`. O sea que cada búsqueda de fila paga UNA
 * espera completa de este tope: la de la fila que ya no existe. Con ocho
 * códigos son ocho esperas.
 *
 * Y no se puede bajar a cero: la fila aparece por AJAX después del clic en
 * "Validar Código", así que leer demasiado pronto devolvería `null` y ese `null`
 * se lee como "CAPUFE lo rechazó". Falla CERRADO (no se emite), pero manda a
 * revisar a mano un ticket que estaba bien.
 *
 * 3 s: 8 × 3 s = 24 s del peor caso de una corrida de 300 s, y le da al portal
 * diez veces el tiempo que tarda un XHR sano en pintar una fila.
 */
export const TOPE_LECTURA_MS = Number(process.env.CUADRA_TOPE_LECTURA_MS) || 3_000;

/** Captura de pantalla. Una página larga con imágenes tarda ~0.5-2 s. */
export const TOPE_CAPTURA_MS = Number(process.env.CUADRA_TOPE_CAPTURA_MS) || 10_000;

/** Arrancar Chromium. En frío, dentro de un contenedor, ~1-3 s. */
export const TOPE_LANZAR_MS = Number(process.env.CUADRA_TOPE_LANZAR_MS) || 30_000;

/**
 * Cerrar. Corto A PROPÓSITO: para cuando esto corre, el CFDI ya se emitió o ya
 * no, así que esperar aquí no cambia ningún resultado, solo gasta invocación.
 */
export const TOPE_CERRAR_MS = Number(process.env.CUADRA_TOPE_CERRAR_MS) || 5_000;

/** Margen sobre el tope antes de que dispare la red de seguridad. Igual que en `presupuesto.ts`. */
const GRACIA_TOPE_MS = 1_500;

export interface TopesPagina {
  navegar: number;
  accion: number;
  lectura: number;
  captura: number;
  cerrar: number;
}

export const TOPES_POR_DEFECTO: TopesPagina = {
  navegar: TOPE_NAVEGAR_MS,
  accion: TOPE_ACCION_MS,
  lectura: TOPE_LECTURA_MS,
  captura: TOPE_CAPTURA_MS,
  cerrar: TOPE_CERRAR_MS,
};

/**
 * LAS BANDERAS DE CHROMIUM EN UN CONTENEDOR.
 *
 * Esto no corre en la Mac de nadie: corre en Vercel Fluid Compute, o sea en un
 * contenedor Linux sin GPU, sin /dev/shm de tamaño decente y sin los permisos
 * que el sandbox de Chromium necesita. Cada bandera está aquí por un fallo
 * concreto, no por copiar una lista de un blog:
 */
export const BANDERAS_CONTENEDOR: readonly string[] = [
  // /dev/shm en un contenedor suele ser de 64 MB. Chromium lo usa de memoria
  // compartida entre procesos y cuando se llena el renderer MUERE — sin excepción
  // de Playwright, sin log: la página simplemente deja de responder y se agota el
  // tope. Con esta bandera usa /tmp, que es más lento y no se llena.
  '--disable-dev-shm-usage',
  // El sandbox de Chromium necesita user namespaces o un binario setuid, y una
  // función serverless no da ninguno de los dos: sin esto el proceso no arranca.
  // Es una concesión de seguridad REAL y por eso vale decir a qué se expone: a
  // que un portal comprometido escape del renderer al contenedor de la función.
  // Se acepta porque las URLs no las elige un usuario (salen de `comercios.ts`),
  // el contenedor muere con la invocación y no hay alternativa en este entorno.
  '--no-sandbox',
  '--disable-setuid-sandbox',
  // No hay GPU. Sin esto Chromium intenta inicializarla, falla y reintenta.
  '--disable-gpu',
  // Una pestaña headless "no visible" entra en throttling: `setTimeout` se
  // recorta a una vez por minuto y el polling con el que el portal pinta sus
  // catálogos por AJAX se congela. Eso se vería como "el desplegable siguió
  // vacío" — un diagnóstico que manda a revisar el portal cuando el problema
  // era nuestro.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  // Nada de lo que traen aporta a un formulario y todo cuesta arranque y RAM.
  '--disable-extensions',
  '--mute-audio',
  // Las barras de scroll salen en la captura y tapan la última columna.
  '--hide-scrollbars',
];

/** Ruta al binario de Chromium cuando no está donde Playwright lo busca. */
const CHROMIUM_DEL_ENTORNO = process.env.CUADRA_CHROMIUM_PATH || undefined;

/**
 * Tamaño máximo del data-uri de una captura, en caracteres de base64.
 *
 * ~700 KB. Por encima, la captura deja de ser evidencia y pasa a ser un
 * problema: viaja dentro de `ResultadoAgente.captura`, que termina en un JSON de
 * respuesta y puede acabar en una columna o en un log. Cuando se pasa, se
 * reintenta SOLO el visible y con menos calidad, y se dice en el log.
 */
const MAX_CAPTURA_B64 = 950_000;

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Techo duro para una operación del navegador.
 *
 * Dos capas, igual que `acotada()`: el `timeout` que ya lleva la llamada de
 * Playwright —que CANCELA de verdad— y esta carrera como red de seguridad, para
 * el cuelgue que Playwright no ve (DNS, TLS, un renderer muerto que deja el
 * socket de CDP abierto). Sin la segunda, un cuelgue ahí se lleva la invocación
 * entera y el rastro es que nunca pasó nada.
 */
async function acotar<T>(hacer: () => Promise<T>, topeMs: number, que: string): Promise<T> {
  const p = hacer();
  // Si gana la red de seguridad, `p` puede rechazar DESPUÉS y sin nadie
  // escuchando: en Node eso es un `unhandledRejection`, que en producción tumba
  // el proceso entero y aquí se llevaría por delante el resto del lote.
  p.catch(() => {});

  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => {
          logger.error('portal.tope_agotado', { operacion: que, topeMs });
          rechazar(new Error(`${que}: sin respuesta en ${topeMs + GRACIA_TOPE_MS} ms (tope de ${que})`));
        }, topeMs + GRACIA_TOPE_MS);
      }),
    ]);
  } finally {
    clearTimeout(temporizador);
  }
}

export interface OpcionesPagina {
  /** Topes propios. Se mezclan con los de arriba; lo que no se pase, se hereda. */
  topes?: Partial<TopesPagina>;
  /**
   * Dónde escribir las capturas. Si se pasa, `captura()` devuelve la RUTA en vez
   * del data-uri —que es lo que uno quiere en la Mac, para poder MIRAR el .jpg—.
   * En Vercel el único directorio escribible es `/tmp` y no sobrevive a la
   * invocación, así que ahí el default (data-uri) es el que sirve.
   */
  directorioCapturas?: string;
  /** Calidad del JPEG. 55 pesa ~5× menos que un PNG y se lee igual de bien. */
  calidadCaptura?: number;
  /** Captura de la página COMPLETA (default) o solo lo visible. */
  capturaCompleta?: boolean;
  /**
   * Escribir tecleando en vez de con `fill`. Más lento y más frágil; existe
   * porque algún buscador que filtra por `keydown` no reacciona a `fill`.
   */
  escribirTecleando?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUÉ FORMATOS DE SELECTOR SE ADMITEN
//
// Todo lo que resuelve el motor de locators de Playwright, que es el que usa
// `page.locator()`. Lo que `capufe.ts` necesita, verificado contra un portal de
// prueba en `pagina_playwright.test.ts` (no de memoria):
//
//   · CSS a secas:          `#rfc`, `select[name="receptor.usoCfdi"]`
//   · CSS con lista:        `.alert-danger, .ui-messages-error`
//   · `:has-text()`:        `button:has-text("Validar Código")` — extensión de
//                           Playwright, casa por SUBCADENA y sin distinguir
//                           mayúsculas. Vale en cualquier posición, incluso
//                           seguida de descendientes:
//                           `table:has-text("Plaza de cobro") tbody tr:nth-child(1) td:nth-child(2)`
//   · `xpath=`:             `xpath=//select[@name="…"]/preceding-sibling::input[1]`
//                           — el único que sabe mirar hacia ATRÁS, que es lo que
//                           el buscador del desplegable exige.
//   · `//…` sin prefijo:    Playwright lo detecta como XPath solo. Se admite,
//                           pero el mapeo de CAPUFE usa el prefijo explícito.
//   · `text=`, `role=`, `id=` y demás motores de Playwright: funcionan porque no
//     se toca el selector, se pasa tal cual. No están probados aquí.
//
// LO QUE NO SE HACE: modo estricto. `page.locator(sel)` lanza si el selector
// casa con más de un elemento, y los del adaptador casan de más a propósito
// —una lista separada por comas para el cuadro de error, un `:has-text` que casa
// con la tabla Y con su contenedor—. Se toma el PRIMERO en orden de documento y
// se deja un `warn` cuando hay más de uno: fallar ahí convertiría un selector
// impreciso en una sesión muerta, y callarlo dejaría al adaptador escribiendo en
// un campo que nadie eligió.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Una pestaña de Chromium, hablando el contrato de `PaginaPortal`.
 *
 * Implementa además los tres métodos de `PaginaCapufe` (`seleccionar`,
 * `opciones`, `valorSeleccionado`). No se importa ese tipo A PROPÓSITO: haría
 * que la implementación genérica dependiera de un adaptador concreto. La
 * compatibilidad se verifica en la prueba con una asignación de tipo, que falla
 * en `tsc` si alguna firma se separa.
 */
export class PaginaPlaywright implements PaginaPortal {
  private readonly topes: TopesPagina;
  private cerrada = false;

  constructor(private readonly page: Page, private readonly op: OpcionesPagina = {}) {
    this.topes = { ...TOPES_POR_DEFECTO, ...op.topes };
  }

  /** La pestaña, para lo que este contrato no cubre. Úsese poco. */
  get pagina(): Page {
    return this.page;
  }

  async abrir(url: string): Promise<void> {
    await acotar(async () => {
      // `domcontentloaded` y no `load`: un pixel de analítica que no responde no
      // puede impedir que se llene un formulario que ya está en pantalla.
      const r = await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: this.topes.navegar });

      // Un 4xx/5xx NO lanza en Playwright: `goto` resuelve con la página de error
      // del portal. Sin esto, "el portal está caído" se diagnosticaría como "el
      // selector #rfc ya no existe", que manda a arreglar el mapeo cuando lo que
      // hay que hacer es esperar.
      if (r && !r.ok()) {
        throw new Error(`${url} respondió ${r.status()} ${r.statusText()}`);
      }

      // El `load` se espera, pero sin poder tumbar la sesión: lo que importa es
      // que el DOM esté, y muchos portales dejan peticiones abiertas para siempre.
      try {
        await this.page.waitForLoadState('load', { timeout: this.topes.navegar });
      } catch {
        logger.warn('portal.load_incompleto', { url });
      }
    }, this.topes.navegar, 'navegar');
  }

  /**
   * Llenar un campo, con los eventos que el portal escucha.
   *
   * `fill()` y no `element.value = x`: asignar `.value` cambia lo que se ve y NO
   * dispara nada, así que el portal manda el formulario con el valor anterior —
   * el fallo que no se nota hasta que llega el CFDI.
   *
   * PERO `fill()` NO BASTA, y esto está MEDIDO, no supuesto. Playwright 1.62
   * contra un input de texto con oyentes de los cinco eventos produce:
   *
   *     focus · input                    ← lo que emite `fill`
   *     change                           ← solo cuando el campo pierde el foco
   *
   * O sea que el ÚLTIMO campo que se llena antes de un clic puede no emitir
   * `change` nunca. Y en CAPUFE eso no es un detalle: el catálogo de regímenes
   * se pide por AJAX al cambiar el RFC. Si ese AJAX cuelga de `onchange`, sin
   * este `dispatchEvent` el `<select>` se quedaría vacío para siempre y el
   * diagnóstico sería "el portal no mandó sus opciones" — culpando al portal de
   * algo que no hicimos nosotros.
   *
   * El costo de emitirlo a mano es un `change` DUPLICADO cuando además hay blur
   * (medido: `focus input change change blur`). Un `change` de más repite una
   * carga de catálogo; uno de menos deja el formulario a medio llenar. Se elige
   * el de más.
   */
  async escribir(selector: string, valor: string): Promise<void> {
    const loc = await this.uno(selector, 'escribir');
    await acotar(async () => {
      if (this.op.escribirTecleando) {
        await loc.fill('', { timeout: this.topes.accion });
        await loc.pressSequentially(valor, { timeout: this.topes.accion });
      } else {
        await loc.fill(valor, { timeout: this.topes.accion });
      }
      await loc.dispatchEvent('change');
    }, this.topes.accion, `escribir en \`${selector}\``);
  }

  async hacerClic(selector: string): Promise<void> {
    const loc = await this.uno(selector, 'hacerClic');
    await acotar(() => loc.click({ timeout: this.topes.accion }), this.topes.accion, `hacer clic en \`${selector}\``);
  }

  /**
   * `null` cuando el selector no está. NUNCA lanza — lo dice el contrato, y de
   * él depende que la ausencia del cuadro de error no se lea como un fallo.
   *
   * Cuidado con lo que este `null` significa río abajo: `buscarFila()` de
   * `capufe.ts` lo lee como "se acabaron las filas". O sea que un tope agotado
   * aquí se convierte en "el portal no agregó el código" → NO se emite y se
   * manda a revisar. Falla cerrado, que es el lado bueno del error, pero
   * conviene saber que un portal lento produce rechazos que no lo son.
   */
  async leerTexto(selector: string): Promise<string | null> {
    try {
      const loc = this.page.locator(selector).first();
      // `textContent` espera a que el nodo esté adjunto, que es justo lo que hace
      // falta para una fila que llega por AJAX. Devuelve '' si existe y está
      // vacío: esa diferencia con `null` la usa el adaptador y no se aplana.
      return await acotar(
        () => loc.textContent({ timeout: this.topes.lectura }),
        this.topes.lectura,
        `leer \`${selector}\``,
      );
    } catch {
      return null;
    }
  }

  /**
   * La pantalla, para poder MIRAR qué se llenó.
   *
   * Es lo único que hace que el modo `ensayo` sirva de algo: sin captura, un
   * ensayo "ok" solo dice que ningún selector reventó, no que el RFC haya
   * quedado en el campo del RFC.
   *
   * JPEG y no PNG: la captura de una página de formulario en PNG pesa ~1.5 MB y
   * en base64 son ~2 MB dentro de un JSON de respuesta. En JPEG de calidad 55
   * son ~120 KB y se lee exactamente igual — lo que se busca aquí es leer texto
   * en un formulario, no comparar píxeles.
   */
  async captura(): Promise<string> {
    const calidad = this.op.calidadCaptura ?? 55;
    const completa = this.op.capturaCompleta ?? true;

    const tirar = (fullPage: boolean, quality: number) =>
      acotar(
        () => this.page.screenshot({ type: 'jpeg', quality, fullPage, timeout: this.topes.captura }),
        this.topes.captura,
        'captura',
      );

    let buf = await tirar(completa, calidad);

    if (this.op.directorioCapturas) {
      const ruta = join(this.op.directorioCapturas, `portal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
      await writeFile(ruta, buf);
      return ruta;
    }

    let b64 = buf.toString('base64');
    if (b64.length > MAX_CAPTURA_B64) {
      // Una captura que no se puede guardar ni mandar no es evidencia. Se baja a
      // lo visible y a calidad 40, y se DICE: el que la mire tiene que saber que
      // está viendo menos página de la que había.
      logger.warn('portal.captura_recortada', { bytesB64: b64.length, max: MAX_CAPTURA_B64 });
      buf = await tirar(false, 40);
      b64 = buf.toString('base64');
    }
    return `data:image/jpeg;base64,${b64}`;
  }

  /**
   * ¿Está el selector en la página? NO ESPERA, y esa es una decisión.
   *
   * `abortarSiCaptcha()` de `capufe.ts` pregunta por SEIS selectores de captcha
   * antes de cada código, y en el caso bueno los seis están AUSENTES. Si esto
   * esperara —digamos 3 s por selector— serían 18 s por código y ~150 s por lote
   * gastados en confirmar que no hay captcha. Con `count()` la respuesta es
   * inmediata y el costo es ~1 ms.
   *
   * Lo que paga esa decisión es `abrir()`, que espera al `load` antes de que
   * nadie pregunte nada. Un portal que pinte su formulario DESPUÉS del `load`
   * (SPA con render diferido) haría que el pre-vuelo reportara todo ausente; el
   * día que aparezca uno así, la respuesta es esperar en `abrir()` por un
   * selector ancla suyo, no volver lento a `existe`.
   */
  async existe(selector: string): Promise<boolean> {
    try {
      return (await acotar(() => this.page.locator(selector).count(), this.topes.lectura, `contar \`${selector}\``)) > 0;
    } catch (e) {
      // Un selector con sintaxis mala llega aquí. Devolver `false` es lo correcto:
      // el pre-vuelo lo va a nombrar en la lista de los que faltan.
      logger.warn('portal.existe_fallo', { selector, error: texto(e) });
      return false;
    }
  }

  /**
   * Elegir en un `<select>`, disparando los eventos del framework.
   *
   * `selectOption` emite `input` y `change`. Lanza si el `value` no está entre
   * las opciones —y eso es lo que se quiere: un régimen fiscal que el portal no
   * ofrece tiene que reventar aquí y no acabar en un CFDI que el receptor no
   * puede deducir.
   */
  async seleccionar(selector: string, valor: string): Promise<void> {
    const loc = await this.uno(selector, 'seleccionar');
    await acotar(
      () => loc.selectOption(valor, { timeout: this.topes.accion }),
      this.topes.accion,
      `elegir "${valor}" en \`${selector}\``,
    );
  }

  /**
   * Los `value` que el `<select>` tiene HOY.
   *
   * Devuelve `[]` —no lanza— cuando el selector no resuelve, porque así lo lee
   * `esperarOpcion()`: lista vacía = el AJAX todavía no llegó, y vuelve a
   * preguntar. El caso "el portal cambió y ese select ya no existe" NO se queda
   * escondido detrás de este `[]`: lo caza antes el pre-vuelo, que sí distingue.
   */
  async opciones(selector: string): Promise<string[]> {
    const loc = this.page.locator(selector).first();
    try {
      // `count()` primero, y sin esperar: esto se llama en bucle (~40 vueltas
      // esperando al AJAX) y una espera por vuelta multiplicaría el tope por 40.
      if ((await acotar(() => loc.count(), this.topes.lectura, `contar \`${selector}\``)) === 0) return [];
      return await acotar(
        () => loc.evaluate((el) => (el instanceof HTMLSelectElement ? Array.from(el.options).map((o) => o.value) : [])),
        this.topes.lectura,
        `leer opciones de \`${selector}\``,
      );
    } catch (e) {
      logger.warn('portal.opciones_fallo', { selector, error: texto(e) });
      return [];
    }
  }

  /**
   * Qué quedó seleccionado. `null` = no se pudo saber (y el adaptador lo dice en
   * el log en vez de suponer que quedó bien).
   */
  async valorSeleccionado(selector: string): Promise<string | null> {
    const loc = this.page.locator(selector).first();
    try {
      if ((await acotar(() => loc.count(), this.topes.lectura, `contar \`${selector}\``)) === 0) return null;
      return await acotar(
        () => loc.evaluate((el) => (el instanceof HTMLSelectElement ? el.value : el.getAttribute('value'))),
        this.topes.lectura,
        `leer lo elegido en \`${selector}\``,
      );
    } catch (e) {
      logger.warn('portal.valor_seleccionado_fallo', { selector, error: texto(e) });
      return null;
    }
  }

  /**
   * Cierra LA PESTAÑA. No el navegador — ver el encabezado del archivo.
   *
   * Idempotente y nunca lanza: la base lo llama en un `finally` y para entonces
   * el resultado del ticket ya está decidido.
   */
  async cerrar(): Promise<void> {
    if (this.cerrada) return;
    this.cerrada = true;
    try {
      await acotar(() => this.page.close(), this.topes.cerrar, 'cerrar la pestaña');
    } catch (e) {
      logger.warn('portal.cerrar_pestana_fallo', { error: texto(e) });
    }
  }

  /**
   * El locator con el que se actúa, siempre el PRIMERO, con aviso si hay más.
   *
   * El aviso no es cosmético: `.alert-danger, .ui-messages-error` casa con varios
   * a propósito, pero un `#rfc` que de pronto casa con dos significa que el
   * portal duplicó el formulario (pestañas, un modal abierto) y se está
   * escribiendo en el que no se ve.
   */
  private async uno(selector: string, operacion: string): Promise<Locator> {
    const loc = this.page.locator(selector);
    try {
      const n = await acotar(() => loc.count(), this.topes.lectura, `contar \`${selector}\``);
      if (n > 1) logger.warn('portal.selector_ambiguo', { selector, casan: n, operacion });
    } catch {
      // Contar es diagnóstico, no paso: si falla, que falle la acción y con su
      // propio mensaje, que es el que dice qué selector hay que arreglar.
    }
    return loc.first();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EL NAVEGADOR DEL LOTE
// ═══════════════════════════════════════════════════════════════════════════

export interface OpcionesNavegador {
  /**
   * Ruta al binario. En la Mac y en CI, Playwright lo encuentra solo en su
   * caché. En Vercel hay que decírselo (ver el final del archivo).
   */
  executablePath?: string;
  /** Banderas. Por default las de contenedor; se agregan, no se reemplazan. */
  banderasExtra?: readonly string[];
  /**
   * HEADLESS SIEMPRE. La opción existe para poder mirar el navegador desde la
   * Mac mientras se depura un portal nuevo, y para nada más: con `false` en
   * Vercel no hay servidor gráfico y Chromium no arranca.
   */
  headless?: boolean;
  /** Lo que se le pasa a cada pestaña. */
  pagina?: OpcionesPagina;
  /** Cómo se ve el navegador ante el portal. */
  userAgent?: string;
  viewport?: { width: number; height: number };
  /** Inyectable para poder probar el arranque sin arrancar nada. */
  lanzar?: (op: Parameters<typeof chromium.launch>[0]) => Promise<Browser>;
}

/**
 * Un Chromium y un contexto, vivos durante todo el lote.
 *
 * UN CONTEXTO, NO UNO POR PESTAÑA: el contexto es lo que guarda cookies y
 * sesión, y para CAPUFE eso es deseable —el portal reconoce la misma sesión
 * entre códigos—. Cuesta una advertencia: un lote es de UNA flota, y si algún
 * día un lote mezclara flotas habría que abrir un contexto por flota, o el
 * portal podría recordar el RFC del anterior.
 */
export class SesionNavegador {
  private cerrada = false;
  private readonly vivas = new Set<PaginaPlaywright>();

  private constructor(
    private readonly navegador: Browser,
    private readonly contexto: BrowserContext,
    private readonly op: OpcionesNavegador,
  ) {}

  static async abrir(op: OpcionesNavegador = {}): Promise<SesionNavegador> {
    const lanzar = op.lanzar ?? ((o) => chromium.launch(o));
    const navegador = await acotar(
      () =>
        lanzar({
          // El default es `true`, pero se escribe: es la diferencia entre correr
          // y no correr en el contenedor, y no debe depender de un default ajeno.
          headless: op.headless ?? true,
          args: [...BANDERAS_CONTENEDOR, ...(op.banderasExtra ?? [])],
          // Redundante con `--no-sandbox`, y aun así se pone: Playwright lo
          // consulta por su cuenta para decidir cómo arranca el proceso.
          chromiumSandbox: false,
          executablePath: op.executablePath ?? CHROMIUM_DEL_ENTORNO,
          timeout: TOPE_LANZAR_MS,
        }),
      TOPE_LANZAR_MS,
      'arrancar Chromium',
    );

    try {
      const contexto = await navegador.newContext({
        // Alto de sobra: la tabla de "CÓDIGOS AGREGADOS" crece con cada caseta y
        // una captura de 800 px de alto la deja fuera justo cuando importa.
        viewport: op.viewport ?? { width: 1366, height: 1400 },
        userAgent: op.userAgent,
        locale: 'es-MX',
        timezoneId: 'America/Mexico_City',
        // Un portal de facturación no necesita nada de esto y cada permiso es
        // una razón más para que el navegador pida algo y se quede esperando.
        permissions: [],
      });
      return new SesionNavegador(navegador, contexto, op);
    } catch (e) {
      // Si el contexto no se pudo crear, el navegador YA está arrancado: sin este
      // cierre queda un Chromium huérfano por cada intento fallido.
      await navegador.close().catch(() => {});
      throw e;
    }
  }

  /**
   * La fábrica que espera `AdaptadorPlaywrightBase`. Cada llamada es una pestaña
   * NUEVA sobre el MISMO navegador: eso es la decisión de costo del producto.
   *
   * Devuelve el tipo concreto —no `FabricaDePagina` a secas— y sigue siendo
   * asignable a él: así quien la use directamente conserva `seleccionar`,
   * `opciones` y `valorSeleccionado` sin un cast.
   *
   * @param opPagina  topes y opciones de captura para las pestañas de ESTE lote.
   *                  Un portal lento puede necesitar otros topes sin cambiar los
   *                  de todos los demás.
   */
  fabrica(opPagina?: OpcionesPagina): () => Promise<PaginaPlaywright> {
    return async () => {
      if (this.cerrada) {
        throw new Error('La sesión de navegador ya se cerró: no se pueden abrir más pestañas.');
      }
      const page = await this.contexto.newPage();
      const pagina = new PaginaPlaywright(page, opPagina ?? this.op.pagina);
      this.vivas.add(pagina);
      // Una pestaña que se cierra sola (el portal hace `window.close()`, o el
      // renderer muere) tiene que salir del conteo, o `paginasVivas` mentiría.
      page.once('close', () => this.vivas.delete(pagina));
      return pagina;
    };
  }

  /** ¿Sigue vivo el proceso de Chromium? */
  get conectado(): boolean {
    return !this.cerrada && this.navegador.isConnected();
  }

  /** Pestañas abiertas que nadie ha cerrado. En un lote sano, 0 entre tickets. */
  get paginasVivas(): number {
    return this.vivas.size;
  }

  /**
   * Cierra todo. Idempotente y NUNCA lanza.
   *
   * Se cierra el CONTEXTO antes que el navegador: cerrar el navegador a secas
   * deja a Playwright esperando a que los renderers terminen, y con una página
   * colgada eso puede tardar. Cada paso va acotado por lo mismo de siempre —para
   * cuando esto corre, el resultado del lote ya está decidido y esperar aquí solo
   * gasta invocación.
   */
  async cerrar(): Promise<void> {
    if (this.cerrada) return;
    this.cerrada = true;

    for (const p of [...this.vivas]) await p.cerrar();
    this.vivas.clear();

    try {
      await acotar(() => this.contexto.close(), TOPE_CERRAR_MS, 'cerrar el contexto');
    } catch (e) {
      logger.warn('portal.cerrar_contexto_fallo', { error: texto(e) });
    }
    try {
      await acotar(() => this.navegador.close(), TOPE_CERRAR_MS, 'cerrar el navegador');
    } catch (e) {
      // Si `close()` no vuelve, el proceso sigue vivo hasta que muera el de Node.
      // Playwright registra sus propios manejadores de SIGINT/SIGTERM y de
      // `exit`, así que no queda huérfano más allá de esta invocación — pero se
      // deja dicho, porque en una Lambda caliente eso es RAM que no vuelve.
      logger.error('portal.cerrar_navegador_fallo', { error: texto(e) });
    }
  }
}

/**
 * UN LOTE. Abre el navegador, corre el trabajo y lo cierra pase lo que pase.
 *
 * Esta es la forma de usar todo lo de arriba, y el `finally` es la razón de que
 * exista: un `throw` a media sesión —un selector movido, un CAPTCHA, un tope
 * agotado— dejaría si no un Chromium vivo por cada corrida del cron, y eso en
 * una función serverless caliente es la memoria acabándose sin que nadie
 * entienda por qué.
 *
 * `fn` recibe la fábrica —que es lo único que necesita `AdaptadorPlaywrightBase`—
 * y la sesión, para poder preguntarle cosas (`conectado`, `paginasVivas`).
 */
export async function conNavegador<T>(
  fn: (abrirPagina: FabricaDePagina, sesion: SesionNavegador) => Promise<T>,
  op: OpcionesNavegador = {},
): Promise<T> {
  const inicio = Date.now();
  const sesion = await SesionNavegador.abrir(op);
  try {
    return await fn(sesion.fabrica(), sesion);
  } finally {
    const paginasSueltas = sesion.paginasVivas;
    await sesion.cerrar();
    logger.info('portal.lote_cerrado', { ms: Date.now() - inicio, paginasSueltas });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE FALTA PARA QUE ESTO CORRA EN VERCEL
//
// `playwright-core` NO trae el binario de Chromium: lo baja `npx playwright
// install chromium` a la caché de la máquina, y esa caché no existe en el
// contenedor de la función. Hoy, tal cual, `chromium.launch()` en Vercel falla
// con "Executable doesn't exist".
//
// Los dos caminos, y ninguno es una línea de código:
//
//   1. Un Chromium empaquetado para serverless (`@sparticuz/chromium` o
//      `playwright-aws-lambda`): se pone su `executablePath` en
//      `CUADRA_CHROMIUM_PATH` o en `OpcionesNavegador.executablePath`. Pesa
//      ~50 MB comprimido y entra de sobra en los 5 GB que admite Fluid Compute.
//   2. Un navegador REMOTO (Browserless, Browserbase): se cambia `chromium.launch`
//      por `chromium.connectOverCDP(url)`. Es lo que hay que hacer el día que el
//      portal empiece a bloquear la IP de Vercel, porque también da IP de salida
//      distinta.
//
// El resto del archivo no cambia con ninguno de los dos: lo único que se toca es
// cómo se consigue el `Browser` en `SesionNavegador.abrir`.
// ═══════════════════════════════════════════════════════════════════════════
