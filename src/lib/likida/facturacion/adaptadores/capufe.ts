import { logger } from '@/lib/logger';
import { round2 } from '@/lib/formato';
import { esRfcValido, rfcChecksumOk } from '@/lib/likida/intake/cfdi';
import {
  AdaptadorPlaywrightBase,
  type MapeoPortal,
  type OpcionesAdaptador,
  type PaginaPortal,
} from './playwright_base';
import {
  registrarAdaptador,
  type ModoAgente,
  type ResultadoAgente,
  type ResultadoLoteAgente,
  type ResultadoPorGasto,
  type TicketDeLote,
} from '../agente';
import type { CampoListo } from '../pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// CAPUFE — EL PRIMER PORTAL REAL. Casetas de peaje federales.
//
// Es el que más rinde de los 37 del registro: TODO viaje de carga cruza
// casetas, es un portal NACIONAL único (no uno por cadena) y no pide cuenta.
// Un viaje trae ocho o diez tickets de caseta; hoy los captura una persona.
//
// ── LA URL NO ES LA DEL REGISTRO ──────────────────────────────────────────
//
// `comercios.ts` guarda la raíz `/Capufe/`, que es un LOGIN con usuario y
// contraseña. La facturación SIN registro vive en `/Capufe/facturacionrapida`
// y hay que entrar directo. Si el adaptador arrancara por la raíz se quedaría
// en una pantalla de sesión y el diagnóstico sería "el selector #rfc no
// existe", que manda a arreglar el mapeo cuando lo que está mal es la puerta.
//
// ── POR QUÉ ESTE ADAPTADOR TIENE UN MÉTODO PROPIO PARA VARIOS CÓDIGOS ─────
//
// El flujo de CAPUFE no es "un formulario, un CFDI". Es:
//
//   a) se capturan los datos fiscales UNA vez,
//   b) se escribe un código y se aprieta "Validar Código",
//   c) el portal lo agrega a la tabla "CÓDIGOS AGREGADOS" (Código | Plaza de
//      cobro | Fecha | Costo) —o lo rechaza—,
//   d) se repite (b) por cada ticket,
//   e) al final se emite UNA factura con todos.
//
// Ocho casetas de un viaje son UNA sesión de navegador, no ocho: abrir
// Chromium y llenar los datos fiscales es lo caro; teclear un campo más no
// cuesta nada. De ahí `facturarVarios()`. `facturar()` —la interfaz de un
// ticket— existe igual y delega en él con un solo código, para que el agente
// genérico (`facturarConAgente`) siga funcionando sin saber nada de esto.
//
// Eso obliga a SOBRESCRIBIR `facturar` de la base: su recorrido llena los
// campos y va derecho al botón de emitir, y aquí entre medias hay un botón
// por ticket y una tabla que leer. Lo que sí se hereda —y es la parte que
// importa— es el contrato (`PaginaPortal`, `MapeoPortal`, la fábrica de
// páginas) y las reglas: `ensayo` por default, `=== 'emitir'` para emitir,
// y ni un reintento después de apretar.
//
// ── #cb1 NO SON TÉRMINOS Y CONDICIONES ────────────────────────────────────
//
// Es "Complemento para la facturación de partidos políticos". Un adaptador
// que marque checkboxes a ciegas —el reflejo de "acepto los términos"— emite
// un CFDI con un complemento que no aplica a una flota de carga. Aquí no está
// prohibido por comentario: `clicSeguro()` LANZA si alguien le pasa ese
// selector, así que no hay camino de código que lo marque.
//
// ── LOS DOS <select> ──────────────────────────────────────────────────────
//
// Llegan VACÍOS (una sola opción) y se pueblan por AJAX, y cada uno viene
// precedido de un `<input type=text>` sin `name`: el patrón de desplegable con
// buscador. Dos consecuencias:
//
//   · No se elige hasta que la opción EXISTE. Se pregunta por las opciones en
//     un bucle acotado, no se duerme un número mágico de milisegundos: un
//     `sleep(2000)` falla el día que la red va lenta y desperdicia dos
//     segundos por sesión el resto de los días.
//   · No se asigna `.value` a ciegas. Con ese patrón el `<select>` suele estar
//     oculto detrás del control pintado por el framework, y escribirle el
//     valor no actualiza lo que se ve ni dispara su handler: el formulario se
//     manda con el régimen anterior. Se usa `seleccionar()` —que en Playwright
//     es `selectOption`, y ese sí emite `input` y `change`— y si la página no
//     lo ofrece se cae al buscador (escribir el texto y elegir de la lista).
//     Al final SE VERIFICA qué quedó seleccionado; si no es lo que se pidió,
//     se falla en vez de emitir con otro régimen.
//
// ── CAPTCHA: SE DETECTA Y SE ABORTA. NO SE RESUELVE. ──────────────────────
//
// El sitio carga un script de reCAPTCHA. En la pantalla del formulario no se
// vio widget (parece v3 invisible, o herencia del login), pero eso puede
// cambiar por sesión y por IP. Aquí NO se intenta resolver, evadir ni
// automatizar nada de eso — está prohibido y tampoco funcionaría.
//
// Lo que sí se hace es distinguir dos cosas que el producto necesita separar:
//   "no pude"     → reintentar más tarde tiene sentido.
//   "no se puede" → NO sirve reintentar nunca; hay que avisarle a una persona.
// Un reintento eterno contra un CAPTCHA es una cola que crece sola y un
// ticket que caduca mientras tanto.
//
// ── EL COSTO LO DICE EL PORTAL, NO NOSOTROS ───────────────────────────────
//
// Al validar, CAPUFE devuelve la plaza, la fecha y el COSTO de ese cruce. Ese
// costo es la fuente de verdad; el del OCR es una lectura. Si no coinciden es
// un HALLAZGO —el código puede ser de otro ticket— y por default NO se emite:
// un CFDI equivocado ante el SAT no se deshace, y el ensayo enseña la
// diferencia sin costar nada.
// ═══════════════════════════════════════════════════════════════════════════

/** La única URL que factura sin cuenta. La raíz `/Capufe/` es el login. */
export const URL_CAPUFE_SIN_REGISTRO = 'https://facturacioncapufe.com.mx/Capufe/facturacionrapida';

/** El portal lo dice en el campo: "Código de 18 caracteres". */
export const LARGO_CODIGO = 18;

/** La frase que el producto puede buscar para saber que aquí entra una persona. */
export const MENSAJE_CAPTCHA = 'este portal pide CAPTCHA, hay que facturarlo a mano';

/** Centavo. Por debajo de esto no hay discrepancia, hay coma flotante. */
const TOLERANCIA_PESOS = 0.01;

/**
 * LAS COLUMNAS DE "CÓDIGOS AGREGADOS" SE LEEN DEL ENCABEZADO, NO SE SUPONEN.
 *
 * Esto empezó siendo `Código=1, Plaza=2, Fecha=3, Costo=4`, tomado del texto
 * del portal. El pre-vuelo contra la página real (5-ago-2026,
 * `pruebas-manuales/capufe-prevuelo.prueba.ts`) midió otra cosa:
 *
 *     1=(vacía) | 2=Código | 3=Plaza de cobro | 4=Fecha | 5=Costo
 *
 * Hay una PRIMERA COLUMNA SIN TÍTULO —el hueco que PrimeNG deja para su botón
 * de quitar la fila—, así que las cuatro posiciones estaban corridas una.
 * Con eso, `buscarFila` habría comparado el código contra una celda vacía: NINGÚN
 * código habría casado nunca, todos se habrían reportado "CAPUFE no lo puso en
 * CÓDIGOS AGREGADOS", y no se habría emitido una sola factura. Falla cerrado,
 * pero falla siempre.
 *
 * Cambiar los números a 2-3-4-5 sería sustituir una suposición por otra. Se lee
 * el `<thead>`, que es la única fuente que se corrige sola si el portal agrega,
 * quita o reordena una columna.
 */
const COL_POR_DEFECTO = { codigo: 1, plaza: 2, fecha: 3, costo: 4 } as const;

/** Hasta dónde se busca encabezado. Cinco columnas hoy; el margen es por si crece. */
const MAX_COLUMNAS = 12;

/** Cómo se llama cada columna en el portal. Por subcadena y sin acentos ni caja. */
const NOMBRE_DE_COLUMNA: Array<[keyof typeof COL_POR_DEFECTO, RegExp]> = [
  ['codigo', /codigo/],
  ['plaza', /plaza/],
  ['fecha', /fecha/],
  ['costo', /costo|importe|monto|total/],
];

/** Sin acentos y en minúsculas, para comparar encabezados sin depender de cómo los escriban. */
const plano = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export interface SelectoresCapufe {
  rfc: string;
  nombre: string;
  codigoPostal: string;
  regimenFiscal: string;
  usoCfdi: string;
  correo: string;
  codigo: string;
  /** El checkbox que NUNCA se marca. Está aquí para poder prohibirlo por nombre. */
  complementoPartidos: string;
  buscadorRegimen: string;
  buscadorUso: string;
  botonValidar: string;
  botonEmitir: string;
  tabla: string;
  error: string;
  uuid: string;
  /** Un CAPTCHA visible. Ver `SELECTORES_CAPTCHA`. */
  captcha: string[];
  /** Cómo se llama a una opción del desplegable con buscador, ya filtrado. */
  opcionDelBuscador: (valor: string) => string;
}

/**
 * MEDIDO CONTRA EL PORTAL REAL EL 5-AGO-2026, uno por uno, sin escribir nada.
 *
 * El arnés que lo midió es `pruebas-manuales/capufe-prevuelo.prueba.ts` y su
 * reporte queda en `pruebas-manuales/ensayo/<fecha>/capufe-prevuelo.txt`. Vale
 * la pena volver a correrlo antes de cada temporada de facturación: es una
 * visita de lectura y cuesta dos segundos.
 *
 * RESUELVEN EN LA PÁGINA EN BLANCO (9):
 *   #rfc · #nombre · #domicilioFiscalReceptor (maxlength=5) · #correo ·
 *   #codigo · #cb1 · los dos `select[name="receptor.…"]` ·
 *   `button:has-text("Validar Código")` · `table:has-text("Plaza de cobro")`
 *   Todos casan UNA sola vez: ninguno es ambiguo.
 *
 * NO RESUELVEN, Y CADA UNO POR SU RAZÓN:
 *
 *   · `botonEmitir` — NO EXISTE hasta que hay filas en "CÓDIGOS AGREGADOS".
 *     Con la página en blanco los únicos botones son "Aviso de Privacidad",
 *     "Validar Código" y "Activar cámara escanear QR". Buscando en los `.js`
 *     del propio portal (2.5 MB de plantillas compiladas) aparecen las
 *     etiquetas "Facturar conceptos" y "Facturar", así que
 *     `button:has-text("Facturar")` debería casar por subcadena cuando el
 *     botón se pinte — pero eso NO está verificado en el DOM y no se puede
 *     verificar sin agregar un código real. Es la apuesta que queda viva.
 *
 *   · `buscadorRegimen` / `buscadorUso` — los dos `<select>` NO tienen ningún
 *     hermano previo: el patrón de "desplegable con buscador" no está en esta
 *     página. No es un problema: son el camino de RESPALDO, y
 *     `PaginaPlaywright` ofrece `seleccionar()` (`selectOption`), que es el
 *     bueno. Se dejan por si el portal los reintroduce.
 *
 *   · `error` — se descubrió por accidente y de la mejor manera: al bloquear el
 *     POST de autenticación de invitado, el portal pintó SU cuadro de error
 *     real, y no es ninguno de los que había aquí. Es el growl de PrimeNG:
 *     `.p-growl-message-error`, dentro de `.p-growl-item`. Se conservan los
 *     tres de antes porque no estorban y el portal podría usarlos en otra
 *     pantalla; se ponen los de PrimeNG PRIMERO.
 *
 *   · `uuid` — imposible de verificar sin emitir un CFDI de verdad, que es
 *     justo lo que este arnés no hace. Sigue siendo una apuesta, y es la que
 *     hay que mirar en la PRIMERA emisión real.
 *
 * Se eligen selectores por TEXTO y por estructura, no por clases del framework:
 * el texto ("Validar Código", "Plaza de cobro") es lo que el portal enseña y lo
 * que menos cambia. La excepción es el cuadro de error, donde la clase de
 * PrimeNG es lo único que hay.
 *
 * Todo esto se puede sobrescribir con `OpcionesCapufe.selectores` sin tocar una
 * línea de lógica.
 */
export const SELECTORES_CAPUFE: SelectoresCapufe = {
  rfc: '#rfc',
  nombre: '#nombre',
  codigoPostal: '#domicilioFiscalReceptor',
  regimenFiscal: 'select[name="receptor.regimenFiscalReceptor"]',
  usoCfdi: 'select[name="receptor.usoCfdi"]',
  correo: '#correo',
  codigo: '#codigo',
  complementoPartidos: '#cb1',
  // CSS no sabe mirar hacia atrás; el buscador estaría ANTES del select.
  // Playwright sí, por xpath. Hoy NO resuelve —esos `<select>` no tienen
  // hermano previo—, y es el camino de respaldo: ver el bloque de arriba.
  buscadorRegimen: 'xpath=//select[@name="receptor.regimenFiscalReceptor"]/preceding-sibling::input[1]',
  buscadorUso: 'xpath=//select[@name="receptor.usoCfdi"]/preceding-sibling::input[1]',
  botonValidar: 'button:has-text("Validar Código")',
  botonEmitir: 'button:has-text("Facturar")',
  // Por el encabezado, no por un id que no vi: es la tabla que trae esa columna.
  tabla: 'table:has-text("Plaza de cobro")',
  // PrimeNG primero: es lo que el portal pintó de verdad cuando falló una
  // petición suya (medido el 5-ago). Los otros tres se quedan de red.
  error: '.p-growl-message-error, .p-growl-item, .alert-danger, .ui-messages-error, .invalid-feedback',
  uuid: '.uuid',
  captcha: [],
  opcionDelBuscador: (valor: string) => `[role="option"]:has-text("${valor}")`,
};

/**
 * Lo que delata un CAPTCHA que BLOQUEA, no un script cargado.
 *
 * Deliberadamente FUERA de la lista: `.grecaptcha-badge` y
 * `script[src*="recaptcha"]`. Los trae cualquier sitio con reCAPTCHA v3
 * invisible —incluido este— y abortar por ellos convertiría al adaptador en un
 * "no se puede" permanente: nunca facturaría nada y nadie sabría por qué.
 * Aquí están los que solo aparecen cuando hay algo que un humano debe resolver:
 * el iframe del "No soy un robot" (anchor), el del reto de imágenes (bframe),
 * el contenedor que renderiza v2, y los captcha de imagen caseros.
 */
export const SELECTORES_CAPTCHA: string[] = [
  'iframe[src*="recaptcha/api2/anchor"]',
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[title*="recaptcha" i]',
  '.g-recaptcha',
  '.h-captcha',
  'img[src*="captcha" i]',
];

/** Cuando el portal lo dice con palabras (v3 bloquea por puntaje, sin widget). */
const RE_CAPTCHA_TEXTO = /captcha|no soy un robot|verificaci[oó]n de seguridad|verify you are human/i;

/**
 * Lo que el CFDI 4.0 exige del receptor y CAPUFE pide en pantalla.
 *
 * NO sale del ticket: sale de la flota (`tenant`), y se captura una vez. Por
 * eso viaja en las opciones del adaptador y no en `CampoListo[]`.
 */
export interface DatosReceptorCapufe {
  rfc: string;
  /** Razón social TAL CUAL la Constancia de Situación Fiscal. Ver `saas/fiscal.ts`. */
  nombre: string;
  /** Domicilio fiscal del receptor: 5 dígitos (el input trae maxlength=5). */
  codigoPostal: string;
  /** Clave del catálogo `c_RegimenFiscal` del SAT: '601', '612', '626'… */
  regimenFiscal: string;
  /** Clave de `c_UsoCFDI`: 'G03' para gastos en general. */
  usoCfdi: string;
  correo: string;
}

/** Un ticket de caseta por facturar. */
export interface TicketCapufe {
  /** El código de 18 caracteres impreso en el comprobante. */
  codigo: string;
  /**
   * Lo que el OCR leyó del papel, si lo leyó. Sirve para COTEJAR contra lo que
   * devuelva el portal, que es quien manda. `null` = no hay contra qué cotejar,
   * y eso se dice; no se asume que cuadra.
   */
  montoEsperado?: number | null;
  /** De qué gasto salió, para poder nombrarlo cuando el portal lo rechaza. */
  gastoId?: string;
}

export type EstadoCodigo =
  /** El portal lo puso en "CÓDIGOS AGREGADOS". */
  | 'agregado'
  /** El portal no lo aceptó. NO se reintenta. */
  | 'rechazado'
  /** Venía repetido en el mismo lote: mandarlo dos veces lo cobraría dos veces. */
  | 'duplicado'
  /** La sesión se cayó antes de llegar a él. */
  | 'no_intentado';

export interface ResultadoCodigo {
  codigo: string;
  estado: EstadoCodigo;
  gastoId?: string;
  /** Lo que devolvió el portal en su fila. */
  plaza?: string;
  fecha?: string;
  /** El COSTO del portal. La cifra buena. `undefined` = no se pudo leer. */
  costoPortal?: number;
  /** Lo que traíamos del OCR. */
  montoEsperado?: number;
  /** El portal y el OCR no cuadran. Hallazgo, no ruido. */
  discrepanciaDeMonto?: boolean;
  /** Se agregó pero su costo no se pudo leer: no hay con qué cotejar. */
  costoIlegible?: boolean;
  /** Por qué no se agregó, con las palabras del portal cuando las dio. */
  motivo?: string;
}

export interface ResultadoLoteCapufe extends ResultadoAgente {
  codigos: ResultadoCodigo[];
  /**
   * El portal pidió CAPTCHA. NO es "no pude": es "no se puede". Quien lea esto
   * tiene que mandarlo a una persona, no a la cola de reintentos.
   */
  requiereCaptcha: boolean;
  /**
   * Suma de los costos que devolvió el portal. `null` cuando alguno no se pudo
   * leer: una suma incompleta que se ve completa es peor que no dar la suma.
   */
  totalPortal: number | null;
  /** Los que el portal cobró distinto a lo que decía el papel. */
  discrepancias: ResultadoCodigo[];
  /** Salió bien pero hay algo que mirar (rechazos parciales, costos ilegibles). */
  aviso?: string;
}

/**
 * Lo que un `<select>` necesita y `PaginaPortal` no tiene.
 *
 * Todo OPCIONAL: la base define cinco métodos y este adaptador no puede
 * obligar a los demás a crecer. Sin `seleccionar` se usa el buscador; sin
 * `opciones` no se puede saber si el AJAX ya llegó y se dice en el log.
 */
export interface PaginaCapufe extends PaginaPortal {
  /** Elige por `value` disparando los eventos del framework (`selectOption`). */
  seleccionar?(selector: string, valor: string): Promise<void>;
  /** Los `value` que el `<select>` tiene HOY. Vacío = el AJAX no ha llegado. */
  opciones?(selector: string): Promise<string[]>;
  /** Qué quedó seleccionado. Para verificar en vez de suponer. */
  valorSeleccionado?(selector: string): Promise<string | null>;
}

export interface OpcionesCapufe extends OpcionesAdaptador {
  /** Los datos fiscales de la flota. Se capturan una vez por sesión. */
  receptor: DatosReceptorCapufe;
  /** Corrige cualquier selector que en campo resulte distinto. */
  selectores?: Partial<SelectoresCapufe>;
  /**
   * TOPE de espera a que el AJAX pueble un `<select>`. No es una pausa.
   *
   * Va APARTE de `esperaUuidMs` (que hereda de `OpcionesAdaptador`) porque miden
   * cosas distintas: aquí se espera un catálogo del portal, allá a que el PAC
   * timbre. Comparten `intervaloMs`, `dormir` y `ahora`, que son el reloj.
   */
  esperaMaxMs?: number;
  /**
   * Emitir aunque el costo del portal no cuadre con el del OCR. Default: NO.
   * Se deja la puerta porque un contralor con el papel enfrente puede saber que
   * la diferencia es legítima; el default es no emitir porque el agente no.
   */
  emitirAunConDiscrepancia?: boolean;
  /** Cuántas filas se recorren buscando un código en la tabla. */
  maxFilasTabla?: number;
}

/** Fallo con mensaje ya escrito para una persona. */
class FalloDePortal extends Error {}
/** El portal pidió CAPTCHA. Se separa porque el producto actúa distinto. */
class FalloCaptcha extends Error {}

const texto = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Convierte lo que el portal imprime en la columna Costo a un número.
 *
 * Devuelve `null` en vez de `0` cuando no entiende lo que leyó. Un cero se
 * suma sin quejarse y deja un total que se ve bien y está mal; un `null`
 * obliga a decir "esto no se pudo leer", que es la verdad.
 */
export function parsearCosto(bruto: string | null | undefined): number | null {
  if (!bruto) return null;
  const limpio = bruto.replace(/[^\d.,-]/g, '').trim();
  if (!limpio || !/\d/.test(limpio)) return null;

  let n: string;
  if (limpio.includes(',') && limpio.includes('.')) {
    // "1,234.50" — la coma es de millares. El orden inverso ("1.234,50") no lo
    // usa este portal; si apareciera, el último separador manda.
    n = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '');
  } else if (/,\d{2}$/.test(limpio)) {
    n = limpio.replace(/\./g, '').replace(',', '.');
  } else {
    n = limpio.replace(/,/g, '');
  }

  const v = Number(n);
  return Number.isFinite(v) ? round2(v) : null;
}

export class AdaptadorCapufe extends AdaptadorPlaywrightBase {
  readonly comercio = 'capufe';
  readonly portal = URL_CAPUFE_SIN_REGISTRO;

  private readonly receptor: DatosReceptorCapufe;
  private readonly sel: SelectoresCapufe;
  /** Vueltas de espera al AJAX de los `<select>`. El del UUID lo lleva la base. */
  private readonly vueltas: number;
  private readonly emitirAunConDiscrepancia: boolean;
  private readonly maxFilasTabla: number;
  /** Posición de cada columna, leída del encabezado UNA vez por sesión. */
  private columnas: Record<keyof typeof COL_POR_DEFECTO, number> | null = null;

  constructor(op: OpcionesCapufe) {
    // `intervaloMs`, `dormir`, `ahora` y `esperaUuidMs` los guarda la base
    // —protegidos— y este adaptador los reusa para su propio sondeo de
    // desplegables. Duplicarlos aquí sería tener dos relojes que se pueden
    // desajustar: la prueba inyectaría uno y el código usaría el otro.
    super(op);
    this.receptor = op.receptor;
    this.sel = { ...SELECTORES_CAPUFE, captcha: SELECTORES_CAPTCHA, ...op.selectores };
    this.vueltas = Math.max(1, Math.ceil((op.esperaMaxMs ?? 10_000) / this.intervaloMs));
    this.emitirAunConDiscrepancia = op.emitirAunConDiscrepancia === true;
    this.maxFilasTabla = Math.max(1, op.maxFilasTabla ?? 60);

    // La base sabe reintentar en ensayo; aquí no se usa, y callarlo sería
    // prometer un comportamiento que no existe. Un reintento en CAPUFE
    // significa volver a agregar los códigos que YA entraron: el resultado por
    // código ya distingue lo que pasó con cada uno, que es mejor.
    if ((op.reintentosEnEnsayo ?? 0) > 0) {
      logger.warn('capufe.reintentos_ignorados', { reintentosEnEnsayo: op.reintentosEnEnsayo });
    }
  }

  mapeoDeCampos(): MapeoPortal {
    return {
      campos: { codigo: this.sel.codigo },
      botonEmitir: this.sel.botonEmitir,
      uuid: this.sel.uuid,
      error: this.sel.error,
    };
  }

  /**
   * La interfaz de un ticket. Delega en `facturarVarios` con uno solo.
   *
   * `modo` va opcional por el mismo motivo que en la base: esto se llama desde
   * una ruta de API con un cuerpo JSON, donde el tipo no protege nada.
   */
  async facturar(campos: CampoListo[], modo?: ModoAgente): Promise<ResultadoLoteCapufe> {
    const m: ModoAgente = modo === 'emitir' ? 'emitir' : 'ensayo';

    const vacios = campos.filter((c) => c.requerido && !c.valor);
    if (vacios.length > 0) {
      return this.falloSinAbrir(m, `Faltan datos que CAPUFE exige: ${vacios.map((c) => c.etiqueta).join(', ')}. No se abrió el portal.`);
    }

    const campoCodigo = campos.find((c) => c.clave === 'codigo' && c.valor);
    if (!campoCodigo?.valor) {
      return this.falloSinAbrir(m, `Este ticket no trae el código de ${LARGO_CODIGO} caracteres que pide CAPUFE. Sin él no hay nada que validar.`);
    }

    const bruto = campos.find((c) => c.clave === 'monto' && c.valor)?.valor;
    const monto = bruto === undefined || bruto === null ? NaN : Number(bruto);

    return this.facturarVarios(
      [{ codigo: campoCodigo.valor, montoEsperado: Number.isFinite(monto) ? monto : null }],
      m,
    );
  }

  /**
   * EL LOTE, en el contrato genérico de `agente.ts`.
   *
   * Es la traducción entre dos vocabularios y nada más: el genérico habla
   * `CampoListo[]` y gastos, CAPUFE habla códigos de 18 caracteres. Toda la
   * lógica —una sesión, un botón por código, la tabla que se lee, el CAPTCHA que
   * aborta, la discrepancia que no emite— sigue viviendo en `facturarVarios`.
   *
   * EL UUID SE REPARTE SOLO ENTRE LOS QUE ENTRARON. Un código que el portal
   * rechazó no está en esa factura: escribirle el UUID sería marcar como
   * facturado un consumo que nadie facturó, y ese es el error que después nadie
   * encuentra porque la fila se ve igual de completa que las buenas.
   */
  async facturarLote(tickets: TicketDeLote[], modo?: ModoAgente): Promise<ResultadoLoteAgente> {
    const m: ModoAgente = modo === 'emitir' ? 'emitir' : 'ensayo';

    // Lo que se puede rechazar sin gastar un lugar en la sesión, se rechaza
    // aquí: mismo criterio que `facturar()` para un ticket suelto.
    const previos = new Map<string, string>();
    const paraElPortal: TicketCapufe[] = [];

    for (const t of tickets) {
      const vacios = t.campos.filter((c) => c.requerido && !c.valor);
      if (vacios.length > 0) {
        previos.set(t.gastoId, `Faltan datos que CAPUFE exige: ${vacios.map((c) => c.etiqueta).join(', ')}. No se mandó al portal.`);
        continue;
      }
      const codigo = t.campos.find((c) => c.clave === 'codigo' && c.valor)?.valor;
      if (!codigo) {
        previos.set(t.gastoId, `Este ticket no trae el código de ${LARGO_CODIGO} caracteres que pide CAPUFE. Sin él no hay nada que validar.`);
        continue;
      }
      const bruto = t.campos.find((c) => c.clave === 'monto' && c.valor)?.valor;
      const monto = bruto === undefined || bruto === null ? NaN : Number(bruto);
      paraElPortal.push({
        codigo,
        montoEsperado: Number.isFinite(monto) ? monto : null,
        gastoId: t.gastoId,
      });
    }

    const lote = paraElPortal.length > 0
      ? await this.facturarVarios(paraElPortal, m)
      : this.falloSinAbrir(m, `Ninguno de los ${tickets.length} tickets trae lo que CAPUFE pide. No se abrió el portal.`);

    // El UUID solo existe cuando se emitió Y el portal lo confirmó. En `ensayo`
    // no hay ninguno y eso NO es un fallo: es el modo haciendo su trabajo.
    const uuid = lote.ok ? lote.cfdiUuid : undefined;
    const porCodigo = new Map<string, ResultadoCodigo>();
    for (const r of lote.codigos) if (r.gastoId) porCodigo.set(r.gastoId, r);

    const porGasto: ResultadoPorGasto[] = tickets.map((t): ResultadoPorGasto => {
      const antes = previos.get(t.gastoId);
      if (antes) return { gastoId: t.gastoId, incluido: false, motivo: antes };

      const r = porCodigo.get(t.gastoId);
      if (!r) {
        return {
          gastoId: t.gastoId,
          incluido: false,
          motivo: lote.error ?? 'La sesión de CAPUFE terminó sin decir qué pasó con este código.',
        };
      }
      const entro = r.estado === 'agregado';
      return {
        gastoId: t.gastoId,
        incluido: entro && (m === 'ensayo' || Boolean(uuid)),
        ...(entro && uuid ? { cfdiUuid: uuid } : {}),
        ...(r.motivo ? { motivo: r.motivo } : {}),
      };
    });

    return {
      modo: m,
      // `ok` lo deriva `agente.ts` de los incluidos; aquí se declara para
      // cumplir el tipo y se recalcula allá.
      ok: lote.ok,
      porGasto,
      capturado: lote.capturado,
      captura: lote.captura,
      ...(lote.requiereCaptcha ? { requiereCaptcha: true } : {}),
      ...(lote.emisionSinConfirmar ? { emisionSinConfirmar: true } : {}),
      ...(lote.error ? { error: lote.error } : {}),
      ...(lote.aviso ? { aviso: lote.aviso } : {}),
    };
  }

  /**
   * TODOS los códigos de un viaje en UNA sesión, y una sola factura al final.
   *
   * Un código rechazado NO tumba el lote ni se reintenta: se anota con lo que
   * el portal dijo y se sigue con el siguiente. Lo que sí tumba el lote es que
   * el portal cambie de forma (un selector que ya no está) o que pida CAPTCHA:
   * ahí seguir sería teclear a ciegas.
   */
  async facturarVarios(tickets: TicketCapufe[], modo?: ModoAgente): Promise<ResultadoLoteCapufe> {
    const m: ModoAgente = modo === 'emitir' ? 'emitir' : 'ensayo';

    // ── Todo lo que se puede rechazar SIN navegador, se rechaza aquí.
    const problemas = revisarReceptor(this.receptor);
    if (problemas.length > 0) {
      return this.falloSinAbrir(m, `Los datos fiscales de la flota no sirven para facturar en CAPUFE: ${problemas.join('; ')}. No se abrió el portal.`);
    }
    if (tickets.length === 0) {
      return this.falloSinAbrir(m, 'No se recibió ningún código de caseta. No se abrió el portal.');
    }

    // El largo lo declara el propio portal ("Código de 18 caracteres"), así que
    // se puede saber antes de gastar un navegador. Y se marca UNO por uno: un
    // código mal leído no invalida los otros siete del viaje.
    const vistos = new Set<string>();
    const resultados: ResultadoCodigo[] = [];
    const porIntentar: Array<{ codigo: string; r: ResultadoCodigo }> = [];

    for (const t of tickets) {
      const codigo = (t.codigo ?? '').trim();
      const r: ResultadoCodigo = { codigo, estado: 'no_intentado', gastoId: t.gastoId };
      if (typeof t.montoEsperado === 'number' && Number.isFinite(t.montoEsperado)) {
        r.montoEsperado = round2(t.montoEsperado);
      }
      resultados.push(r);

      if (codigo.length !== LARGO_CODIGO) {
        r.estado = 'rechazado';
        r.motivo = `El código tiene ${codigo.length} caracteres y CAPUFE pide ${LARGO_CODIGO}. Está mal leído del ticket; no se mandó al portal.`;
        continue;
      }
      // Comparado en mayúsculas: el portal imprime el código como quiere, y una
      // diferencia de caja no es un código distinto.
      const llave = codigo.toUpperCase();
      if (vistos.has(llave)) {
        r.estado = 'duplicado';
        r.motivo = 'Ese código ya venía en este lote. Agregarlo dos veces lo cobraría dos veces en la misma factura.';
        continue;
      }
      vistos.add(llave);
      porIntentar.push({ codigo, r });
    }

    if (porIntentar.length === 0) {
      return this.falloSinAbrir(m, `Ninguno de los ${tickets.length} códigos se puede mandar a CAPUFE. No se abrió el portal.`, { codigos: resultados });
    }

    return this.sesion(porIntentar, resultados, m);
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LA SESIÓN
  // ═════════════════════════════════════════════════════════════════════════

  private async sesion(
    porIntentar: Array<{ codigo: string; r: ResultadoCodigo }>,
    resultados: ResultadoCodigo[],
    modo: ModoAgente,
  ): Promise<ResultadoLoteCapufe> {
    let pagina: PaginaCapufe | undefined;
    let captura: string | undefined;
    let seApreto = false;
    // Lo que se alcanzó a escribir EN EL PORTAL. Se devuelve aunque el intento
    // falle: dice en qué campo se rompió, que es la mitad del diagnóstico.
    const capturado: Record<string, string> = {};

    try {
      pagina = (await this.abrirPagina()) as PaginaCapufe;
      await pagina.abrir(this.portal);

      // Antes que nada: si hay CAPTCHA, no se teclea ni un carácter.
      await this.abortarSiCaptcha(pagina, 'al abrir el portal');
      await this.preVuelo(pagina);

      await this.llenarReceptor(pagina, capturado);

      for (const { codigo, r } of porIntentar) {
        await this.agregarCodigo(pagina, codigo, r);
      }

      captura = await this.tomarCaptura(pagina);

      const agregados = resultados.filter((r) => r.estado === 'agregado');
      const discrepancias = agregados.filter((r) => r.discrepanciaDeMonto);
      const base = this.resumen(modo, resultados, capturado, captura);

      if (modo === 'ensayo') {
        // AQUÍ SE DETIENE. Datos fiscales puestos, códigos agregados, captura
        // tomada y el botón de emitir MIRADO PERO SIN TOCAR — que es lo único
        // que hace que un ensayo "ok" signifique algo sobre la emisión.
        if (agregados.length === 0) {
          return { ...base, ok: false, error: `Ninguno de los ${porIntentar.length} códigos entró a "CÓDIGOS AGREGADOS" en CAPUFE. ${this.detalleRechazos(resultados)}` };
        }
        if (!(await this.hayBotonDeEmitir(pagina))) {
          return { ...base, ok: false, error: this.faltaElBoton(agregados.length) };
        }
        return { ...base, ok: true };
      }

      if (agregados.length === 0) {
        return { ...base, ok: false, error: `No se aprieta emitir: ningún código entró a "CÓDIGOS AGREGADOS". ${this.detalleRechazos(resultados)}` };
      }

      // ANTES de marcar que se apretó: si el botón no está, no se apretó nada y
      // decir lo contrario mandaría a revisar un CFDI que no existe.
      if (!(await this.hayBotonDeEmitir(pagina))) {
        return { ...base, ok: false, error: this.faltaElBoton(agregados.length) };
      }

      if (discrepancias.length > 0 && !this.emitirAunConDiscrepancia) {
        return {
          ...base,
          ok: false,
          error: `NO SE EMITIÓ: el costo que devolvió CAPUFE no cuadra con el del ticket en ${discrepancias.length} de ${agregados.length} códigos (${discrepancias.map((d) => `${d.codigo}: portal ${d.costoPortal} vs ticket ${d.montoEsperado}`).join('; ')}). El portal es la fuente de verdad, así que la diferencia significa que el código puede ser de otro ticket. Un CFDI equivocado ante el SAT no se deshace: revísalo y, si la diferencia es legítima, vuelve a correr con \`emitirAunConDiscrepancia\`.`,
        };
      }

      // Marcado ANTES del clic: si `hacerClic` revienta no se sabe si el
      // formulario alcanzó a irse. Fallar cerrado aquí es asumir que sí.
      seApreto = true;
      await this.clicSeguro(pagina, this.sel.botonEmitir);

      captura = (await this.tomarCaptura(pagina)) ?? captura;
      await this.abortarSiCaptcha(pagina, 'después de apretar emitir');

      const rechazoPost = await this.leerAviso(pagina);
      const { uuid, aparecio } = await this.esperarUuid(pagina, this.sel.uuid);
      const fin = this.resumen(modo, resultados, capturado, captura);

      if (!uuid) {
        // Se separan los dos fracasos porque se arreglan distinto, y confundirlos
        // manda a la persona equivocada:
        //   · nunca apareció  → o el portal no llegó a la pantalla de resultado
        //     (se revisa el portal), o `.uuid` ya no es el selector (se arregla
        //     el mapeo).
        //   · apareció vacío  → el contenedor está pintado y sigue sin folio: el
        //     timbrado no había vuelto en el tope, o el portal lo enseña en otro
        //     lado. Revisar el mapeo aquí es perder el tiempo.
        const porQue = aparecio
          ? `el contenedor del UUID (\`${this.sel.uuid}\`) apareció y siguió VACÍO tras ~${this.esperaUuidMs} ms: puede que el timbrado no hubiera vuelto todavía, o que el portal enseñe el folio en otro lado`
          : `el contenedor del UUID (\`${this.sel.uuid}\`) no apareció en ~${this.esperaUuidMs} ms: o el portal no llegó a su pantalla de resultado, o ese selector ya no es el bueno`;
        return {
          ...fin,
          ok: false,
          // La bandera, no solo el texto: quien recoge esto tiene que sacar
          // estos gastos de la cola automática, y no puede hacerlo leyendo prosa.
          emisionSinConfirmar: true,
          error: `Se apretó emitir en CAPUFE y no se pudo confirmar el UUID — ${porQue}${rechazoPost ? ` (el portal dice: "${rechazoPost}")` : ''}. PUEDE QUE EL CFDI YA EXISTA: revisar el portal antes de volver a intentar — un segundo intento lo duplicaría, y esta factura trae ${resultados.filter((r) => r.estado === 'agregado').length} casetas.`,
        };
      }

      return { ...fin, ok: true, cfdiUuid: uuid };
    } catch (e) {
      const parcial = this.resumen(modo, resultados, capturado, captura);

      if (e instanceof FalloCaptcha) {
        logger.warn('capufe.captcha', { modo, seApreto });
        return { ...parcial, ok: false, requiereCaptcha: true, error: e.message };
      }

      const detalle = e instanceof FalloDePortal ? e.message : `Falló ${this.portal}: ${texto(e)}`;
      logger.error('agente.portal.fallo', { comercio: this.comercio, modo, seApreto });
      return {
        ...parcial,
        ok: false,
        ...(seApreto ? { emisionSinConfirmar: true } : {}),
        error: seApreto
          ? `SE APRETÓ EMITIR y después falló. ${detalle} PUEDE QUE EL CFDI YA EXISTA: revisar el portal antes de volver a intentar.`
          : detalle,
      };
    } finally {
      if (pagina?.cerrar) {
        try {
          await pagina.cerrar();
        } catch (e) {
          logger.warn('agente.portal.cerrar_fallo', { comercio: this.comercio, error: texto(e) });
        }
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // LOS PASOS
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Los selectores que se van a usar, verificados de golpe ANTES de escribir.
   *
   * EL BOTÓN DE EMITIR YA NO ESTÁ EN ESTA LISTA, y es un cambio con evidencia
   * detrás. Estaba aquí por el criterio de la base —"es el único selector cuyo
   * fallo, sin esto, solo se descubre emitiendo"—, que es correcto en un portal
   * de un solo formulario. CAPUFE no es eso: el pre-vuelo real del 5-ago-2026
   * midió que con la página en blanco los ÚNICOS botones son "Aviso de
   * Privacidad", "Validar Código" y "Activar cámara escanear QR". El de emitir
   * no existe hasta que hay algo en "CÓDIGOS AGREGADOS".
   *
   * O sea que revisarlo aquí no protegía de nada: abortaba SIEMPRE, en la
   * primera línea, con "el portal ya no tiene el botón de emitir". La
   * comprobación no se pierde, se mueve a donde el botón sí debe existir
   * (`hayBotonDeEmitir`): al final del ensayo y justo antes del clic. Sigue sin
   * hacer falta emitir para descubrir que el selector se movió.
   *
   * Tampoco incluye la tabla ni el cuadro de error, que legítimamente no
   * existen con el formulario en blanco.
   */
  private async preVuelo(pagina: PaginaCapufe): Promise<void> {
    const existe = pagina.existe;
    if (!existe) return; // Sin pre-vuelo se descubre al escribir, con el mismo mensaje.

    const revisar: Array<[string, string]> = [
      ['el RFC', this.sel.rfc],
      ['el nombre o razón social', this.sel.nombre],
      ['el código postal', this.sel.codigoPostal],
      ['el régimen fiscal', this.sel.regimenFiscal],
      ['el uso del CFDI', this.sel.usoCfdi],
      ['el correo', this.sel.correo],
      ['el código del ticket', this.sel.codigo],
      ['el botón "Validar Código"', this.sel.botonValidar],
    ];

    const faltan: string[] = [];
    for (const [que, sel] of revisar) {
      if (!(await existe.call(pagina, sel))) faltan.push(`${que} → \`${sel}\``);
    }
    if (faltan.length > 0) {
      throw new FalloDePortal(`${this.portal} ya no tiene estos selectores: ${faltan.join('; ')}. Hay que actualizar el mapeo de "capufe".`);
    }
  }

  /**
   * Los datos fiscales, UNA vez por sesión.
   *
   * El RFC va PRIMERO a propósito: en portales así el catálogo de regímenes se
   * suele pedir por AJAX en cuanto hay RFC, y elegir antes sería esperar a que
   * se pueble algo que nadie pidió.
   *
   * `#cb1` no aparece por ningún lado, y no puede aparecer: el único camino
   * para hacer clic es `clicSeguro`, que lo prohíbe por nombre.
   */
  private async llenarReceptor(pagina: PaginaCapufe, capturado: Record<string, string>): Promise<void> {
    const r = this.receptor;
    const escribir = async (sel: string, valor: string, que: string, clave: string) => {
      await this.escribir(pagina, sel, valor, que);
      capturado[clave] = valor;
    };

    await escribir(this.sel.rfc, r.rfc.trim().toUpperCase(), 'RFC', 'rfc');
    await escribir(this.sel.nombre, r.nombre.trim(), 'Nombre o Razón Social', 'nombre');
    await escribir(this.sel.codigoPostal, r.codigoPostal.trim(), 'Código postal', 'codigoPostal');
    await escribir(this.sel.correo, r.correo.trim(), 'Correo electrónico', 'correo');

    await this.elegirEnDesplegable(pagina, this.sel.regimenFiscal, this.sel.buscadorRegimen, r.regimenFiscal.trim(), 'Régimen Fiscal');
    capturado.regimenFiscal = r.regimenFiscal.trim();
    await this.elegirEnDesplegable(pagina, this.sel.usoCfdi, this.sel.buscadorUso, r.usoCfdi.trim(), 'Uso del CFDI');
    capturado.usoCfdi = r.usoCfdi.trim();
  }

  /**
   * Un código: se escribe, se valida y se comprueba que el portal lo agregó.
   *
   * No se cree que entró porque el clic no reventó: se BUSCA en la tabla. Un
   * portal que rechaza en silencio y un portal que acepta se ven igual desde
   * fuera, y la diferencia es una factura a la que le faltan tres casetas.
   */
  private async agregarCodigo(pagina: PaginaCapufe, codigo: string, r: ResultadoCodigo): Promise<void> {
    await this.escribir(pagina, this.sel.codigo, codigo, 'Código del ticket');
    await this.clicSeguro(pagina, this.sel.botonValidar);
    // El reto suele salir al primer POST, no al cargar.
    await this.abortarSiCaptcha(pagina, 'al validar un código');

    const fila = await this.buscarFila(pagina, codigo);
    if (!fila) {
      const aviso = await this.leerAviso(pagina);
      r.estado = 'rechazado';
      r.motivo = aviso
        ? `CAPUFE lo rechazó: "${aviso}".`
        : 'CAPUFE no lo puso en "CÓDIGOS AGREGADOS" y no dijo por qué. No se reintenta a ciegas: hay que mirarlo con el ticket enfrente.';
      // Y NO se vuelve a mandar. Un código que el portal rechazó lo va a
      // rechazar igual en el segundo intento; lo que cambia es que el portal
      // empieza a vernos como un robot.
      logger.info('capufe.codigo_rechazado', { motivo: r.motivo });
      return;
    }

    r.estado = 'agregado';
    if (fila.plaza) r.plaza = fila.plaza;
    if (fila.fecha) r.fecha = fila.fecha;

    const costo = parsearCosto(fila.costoBruto);
    if (costo === null) {
      r.costoIlegible = true;
      r.motivo = `Se agregó, pero su COSTO no se pudo leer (el portal imprimió "${fila.costoBruto ?? ''}"). No hay con qué cotejar contra el ticket.`;
      return;
    }

    r.costoPortal = costo;
    if (r.montoEsperado !== undefined && Math.abs(round2(costo - r.montoEsperado)) > TOLERANCIA_PESOS) {
      r.discrepanciaDeMonto = true;
      r.motivo = `El ticket decía ${r.montoEsperado} y CAPUFE cobra ${costo}. Manda el portal: o el OCR leyó mal el monto, o ese código es de otro cruce.`;
    }
  }

  /**
   * La fila de "CÓDIGOS AGREGADOS" que corresponde a este código.
   *
   * Se recorre por posición hasta que la primera celda deja de existir
   * (`leerTexto` devuelve `null` cuando el selector no resuelve), en vez de
   * suponer que el último agregado es el último renglón: el portal puede
   * ordenar por fecha o por plaza y ahí se estaría leyendo el costo de otro.
   */
  private async buscarFila(
    pagina: PaginaCapufe,
    codigo: string,
  ): Promise<{ plaza: string | null; fecha: string | null; costoBruto: string | null } | null> {
    const col = await this.columnasDeLaTabla(pagina);
    const buscado = codigo.trim().toUpperCase();
    for (let i = 1; i <= this.maxFilasTabla; i++) {
      const celda = await pagina.leerTexto(this.celda(i, col.codigo));
      if (celda === null) return null; // se acabaron las filas
      if (celda.trim().toUpperCase() !== buscado) continue;
      return {
        plaza: (await pagina.leerTexto(this.celda(i, col.plaza)))?.trim() ?? null,
        fecha: (await pagina.leerTexto(this.celda(i, col.fecha)))?.trim() ?? null,
        costoBruto: (await pagina.leerTexto(this.celda(i, col.costo)))?.trim() ?? null,
      };
    }
    return null;
  }

  /**
   * En qué posición está cada columna, PREGUNTÁNDOSELO AL ENCABEZADO.
   *
   * Se resuelve una vez por sesión y se guarda: son cuatro o cinco lecturas, y
   * repetirlas por cada uno de los ocho códigos sería pagarlas cuarenta veces.
   *
   * Si la tabla no expone `<thead>` —ninguna página de prueba lo hace, y algún
   * portal podría no tenerlo— se usan las posiciones por defecto y SE DICE en
   * el log. Y si el encabezado está pero le falta un nombre, se avisa y se
   * conserva el default de ESA columna: mejor eso que abortar un lote entero
   * porque alguien renombró "Costo" a "Importe".
   */
  private async columnasDeLaTabla(pagina: PaginaCapufe): Promise<Record<keyof typeof COL_POR_DEFECTO, number>> {
    if (this.columnas) return this.columnas;

    const encabezados: string[] = [];
    for (let i = 1; i <= MAX_COLUMNAS; i++) {
      const t = await pagina.leerTexto(`${this.sel.tabla} thead th:nth-child(${i})`);
      if (t === null) break; // se acabaron las columnas
      encabezados.push(plano(t));
    }

    const col = { ...COL_POR_DEFECTO } as Record<keyof typeof COL_POR_DEFECTO, number>;
    if (encabezados.length === 0) {
      logger.warn('capufe.tabla_sin_encabezado', { tabla: this.sel.tabla });
      this.columnas = col;
      return col;
    }

    const faltan: string[] = [];
    for (const [clave, re] of NOMBRE_DE_COLUMNA) {
      const i = encabezados.findIndex((h) => re.test(h));
      if (i === -1) faltan.push(clave);
      else col[clave] = i + 1;
    }
    if (faltan.length > 0) logger.warn('capufe.columna_sin_encabezado', { faltan, encabezados });
    logger.info('capufe.columnas', { ...col, encabezados });

    this.columnas = col;
    return col;
  }

  private celda(fila: number, columna: number): string {
    return `${this.sel.tabla} tbody tr:nth-child(${fila}) td:nth-child(${columna})`;
  }

  /**
   * Elegir en un desplegable que llega vacío y trae buscador.
   *
   * Tres pasos, y ninguno se salta:
   *  1. ESPERAR a que la opción exista. Preguntando, no durmiendo.
   *  2. ELEGIR con `seleccionar()` (en Playwright, `selectOption`: emite
   *     `input` y `change`, que es lo que el framework escucha). Si la página
   *     no lo ofrece, se escribe en el buscador y se elige de la lista. Lo que
   *     NO se hace nunca es asignar `.value` y dar por hecho que prendió.
   *  3. VERIFICAR qué quedó. Si no se puede verificar se dice en el log; si se
   *     puede y no cuadra, se falla: emitir con otro régimen fiscal es un CFDI
   *     que el receptor no puede deducir.
   */
  private async elegirEnDesplegable(
    pagina: PaginaCapufe,
    selector: string,
    buscador: string,
    valor: string,
    que: string,
  ): Promise<void> {
    await this.esperarOpcion(pagina, selector, valor, que);

    if (pagina.seleccionar) {
      try {
        await pagina.seleccionar(selector, valor);
      } catch (e) {
        throw new FalloDePortal(`No se pudo elegir "${valor}" en ${que} de CAPUFE: ${texto(e)}.`);
      }
    } else {
      // El camino del buscador: se teclea la clave (el portal muestra
      // "601 - General de Ley…", así que filtra) y se elige de la lista.
      try {
        await pagina.escribir(buscador, valor);
        await this.clicSeguro(pagina, this.sel.opcionDelBuscador(valor));
      } catch (e) {
        throw new FalloDePortal(`No se pudo elegir "${valor}" en ${que} de CAPUFE por el buscador (\`${buscador}\`): ${texto(e)}. La página no ofrece \`seleccionar()\`, que es el camino bueno.`);
      }
    }

    const quedo = await this.leerSeleccionado(pagina, selector, valor);
    if (quedo === null) {
      logger.warn('capufe.desplegable_sin_verificar', { que, valor });
      return;
    }
    if (quedo !== valor) {
      throw new FalloDePortal(`Se eligió "${valor}" en ${que} de CAPUFE y quedó "${quedo}". Es el desplegable con buscador: escribirle el valor no siempre prende el control. No se sigue — un CFDI con otro ${que.toLowerCase()} no lo puede deducir el receptor.`);
    }
  }

  /**
   * Espera a que el `<select>` traiga la opción. Preguntando, no durmiendo.
   *
   * Los dos fracasos se cuentan distinto porque se arreglan distinto: un select
   * que sigue VACÍO es el AJAX del portal que no respondió (se reintenta luego);
   * uno POBLADO sin nuestra clave es un dato fiscal que este portal no ofrece
   * (no sirve reintentar, hay que corregir el dato de la flota).
   */
  private async esperarOpcion(pagina: PaginaCapufe, selector: string, valor: string, que: string): Promise<void> {
    let ultimas: string[] | null = null;

    for (let i = 0; i < this.vueltas; i++) {
      const { hay, lista } = await this.mirarOpciones(pagina, selector, valor);
      if (hay) return;
      ultimas = lista;
      if (i < this.vueltas - 1) await this.dormir(this.intervaloMs);
    }

    const espera = this.vueltas * this.intervaloMs;
    if (!ultimas || ultimas.filter((o) => o !== '').length <= 1) {
      throw new FalloDePortal(`El desplegable de ${que} en CAPUFE siguió vacío tras ${this.vueltas} revisiones (~${espera} ms): sus opciones se cargan por AJAX y el portal no las mandó. No se llenó nada más.`);
    }
    throw new FalloDePortal(`CAPUFE no ofrece "${valor}" en ${que}. Lo que ofrece: ${ultimas.filter(Boolean).join(', ')}. El dato fiscal de la flota está mal o este portal no lo admite; reintentar no lo va a cambiar.`);
  }

  private async mirarOpciones(
    pagina: PaginaCapufe,
    selector: string,
    valor: string,
  ): Promise<{ hay: boolean; lista: string[] | null }> {
    if (pagina.opciones) {
      const lista = await pagina.opciones(selector);
      return { hay: lista.includes(valor), lista };
    }
    if (pagina.existe) {
      return { hay: await pagina.existe.call(pagina, `${selector} option[value="${valor}"]`), lista: null };
    }
    // Sin forma de observar el select no se puede esperar a nada. Se intenta y
    // el paso de verificación dirá si prendió.
    logger.warn('capufe.select_sin_observar', { selector });
    return { hay: true, lista: null };
  }

  private async leerSeleccionado(pagina: PaginaCapufe, selector: string, valor: string): Promise<string | null> {
    if (pagina.valorSeleccionado) return await pagina.valorSeleccionado(selector);
    if (pagina.existe) {
      // `:checked` sobre la `<option>`: es lo único que se puede preguntar con
      // los cinco métodos de la base, y funciona aunque el framework pinte su
      // propio control encima mientras mantenga el `<select>` sincronizado.
      return (await pagina.existe.call(pagina, `${selector} option[value="${valor}"]:checked`)) ? valor : '';
    }
    return null;
  }

  /**
   * ¿Está el botón de emitir? Se pregunta CUANDO DEBE ESTAR: con los códigos ya
   * en la tabla, no con el formulario en blanco (ver `preVuelo`).
   *
   * Sin `existe()` se devuelve `true` y que hable el clic: el contrato de la
   * base solo exige cinco métodos, y negarse a emitir porque la página no
   * ofrece un método OPCIONAL sería inventar un requisito.
   */
  private async hayBotonDeEmitir(pagina: PaginaCapufe): Promise<boolean> {
    const existe = pagina.existe;
    if (!existe) return true;
    return await existe.call(pagina, this.sel.botonEmitir);
  }

  private faltaElBoton(agregados: number): string {
    return `Los ${agregados} código(s) SÍ entraron a "CÓDIGOS AGREGADOS", pero el botón de emitir (\`${this.sel.botonEmitir}\`) no está en la página. No se apretó nada. En CAPUFE ese botón solo aparece cuando la tabla tiene filas, así que o el portal no lo pintó todavía, o cambió su texto y hay que corregir \`botonEmitir\` en el mapeo (se puede sin tocar lógica, con \`OpcionesCapufe.selectores\`).`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // CANDADOS
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * El único camino para hacer clic, y por eso el checkbox de partidos
   * políticos NO SE PUEDE marcar.
   *
   * `#cb1` parece el "acepto términos" de cualquier portal y es
   * "Complemento para la facturación de partidos políticos". Marcarlo emite un
   * CFDI con un complemento que no aplica a una flota de carga — y eso llega al
   * SAT. La prohibición vive aquí, en código, porque un comentario que diga "no
   * marcar checkboxes" no sobrevive al primer adaptador que copie este archivo.
   */
  private async clicSeguro(pagina: PaginaPortal, selector: string): Promise<void> {
    if (selector === this.sel.complementoPartidos) {
      throw new FalloDePortal(`\`${selector}\` es "Complemento para la facturación de partidos políticos", NO los términos y condiciones. Ese checkbox no se marca nunca en CAPUFE: emitiría un CFDI con un complemento que no aplica.`);
    }
    await pagina.hacerClic(selector);
  }

  /**
   * ¿Hay un CAPTCHA enfrente? Entonces se para aquí.
   *
   * NO se intenta resolver, evadir ni automatizar: está prohibido y además no
   * funcionaría. Lo que se hace es decirlo con una frase que el producto pueda
   * reconocer, para que esto salga de la cola de reintentos y entre a la de una
   * persona.
   */
  private async abortarSiCaptcha(pagina: PaginaCapufe, cuando: string): Promise<void> {
    const existe = pagina.existe;
    if (existe) {
      for (const sel of this.sel.captcha) {
        if (await existe.call(pagina, sel)) {
          throw new FalloCaptcha(this.mensajeCaptcha(cuando, `apareció \`${sel}\``));
        }
      }
    }
    const aviso = await this.leerAviso(pagina);
    if (aviso && RE_CAPTCHA_TEXTO.test(aviso)) {
      throw new FalloCaptcha(this.mensajeCaptcha(cuando, `el portal dice: "${aviso}"`));
    }
  }

  private mensajeCaptcha(cuando: string, pista: string): string {
    return `CAPUFE pidió CAPTCHA ${cuando} (${pista}): ${MENSAJE_CAPTCHA}. No se intentó resolverlo — automatizar un CAPTCHA está prohibido y tampoco funcionaría. Esto NO es "no pude", es "no se puede": reintentar no va a cambiar nada, tiene que entrar una persona.`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AUXILIARES
  // ═════════════════════════════════════════════════════════════════════════

  private async escribir(pagina: PaginaPortal, selector: string, valor: string, que: string): Promise<void> {
    try {
      await pagina.escribir(selector, valor);
    } catch (e) {
      throw new FalloDePortal(`No se pudo llenar "${que}" en ${this.portal}: el selector \`${selector}\` ya no está en la página (${texto(e)}). Hay que actualizar el mapeo de "capufe".`);
    }
  }

  /** Lo que el portal dice del último paso. Que no se pueda leer NO es un rechazo. */
  private async leerAviso(pagina: PaginaPortal): Promise<string | null> {
    try {
      const t = await pagina.leerTexto(this.sel.error);
      return t && t.trim() ? t.trim() : null;
    } catch {
      return null;
    }
  }

  /** Una captura que falla no puede tumbar un intento: es evidencia, no paso. */
  private async tomarCaptura(pagina: PaginaPortal): Promise<string | undefined> {
    try {
      return await pagina.captura();
    } catch (e) {
      logger.warn('agente.portal.captura_fallo', { comercio: this.comercio, error: texto(e) });
      return undefined;
    }
  }

  private detalleRechazos(resultados: ResultadoCodigo[]): string {
    const malos = resultados.filter((r) => r.estado !== 'agregado');
    if (malos.length === 0) return '';
    return malos.map((r) => `${r.codigo || '(vacío)'}: ${r.motivo ?? 'sin motivo'}`).join(' · ');
  }

  /**
   * El armazón del resultado, con las cifras que se pueden sostener.
   *
   * `totalPortal` es `null` en cuanto UN costo no se pudo leer. Una suma
   * incompleta que se ve completa es exactamente lo que el contralor cruza
   * contra su PDF y no cuadra.
   */
  private resumen(
    modo: ModoAgente,
    resultados: ResultadoCodigo[],
    capturado: Record<string, string>,
    captura?: string,
  ): ResultadoLoteCapufe {
    const agregados = resultados.filter((r) => r.estado === 'agregado');
    const ilegibles = agregados.filter((r) => r.costoIlegible);
    const discrepancias = agregados.filter((r) => r.discrepanciaDeMonto);
    const rechazados = resultados.filter((r) => r.estado === 'rechazado' || r.estado === 'duplicado');

    const avisos: string[] = [];
    if (rechazados.length > 0) avisos.push(`${rechazados.length} código(s) no entraron: ${this.detalleRechazos(resultados)}`);
    if (ilegibles.length > 0) avisos.push(`${ilegibles.length} código(s) se agregaron sin poder leer su costo, así que el total del portal no se puede sumar.`);
    if (discrepancias.length > 0) avisos.push(`${discrepancias.length} código(s) traen un costo distinto al del ticket: ${discrepancias.map((d) => `${d.codigo} (portal ${d.costoPortal}, ticket ${d.montoEsperado})`).join('; ')}.`);

    return {
      modo,
      ok: false,
      capturado: { ...capturado },
      captura,
      codigos: resultados,
      requiereCaptcha: false,
      totalPortal: ilegibles.length > 0 ? null : round2(agregados.reduce((s, r) => s + (r.costoPortal ?? 0), 0)),
      discrepancias,
      ...(avisos.length > 0 ? { aviso: avisos.join(' ') } : {}),
    };
  }

  private falloSinAbrir(modo: ModoAgente, error: string, extra: Partial<ResultadoLoteCapufe> = {}): ResultadoLoteCapufe {
    return {
      modo, ok: false, capturado: {}, codigos: [], requiereCaptcha: false,
      totalPortal: null, discrepancias: [], ...extra, error,
    };
  }
}

/**
 * Los datos fiscales, revisados ANTES de gastar un navegador.
 *
 * El RÉGIMEN Y EL USO no se validan contra el catálogo de `saas/fiscal.ts`: ese
 * está acotado a los cinco regímenes con los que Likida factura SU suscripción,
 * y una flota puede tener otro perfectamente legal (606, 620…). Rechazarlo aquí
 * sería inventar una regla que el SAT no tiene. Se revisa la FORMA, y la
 * autoridad sobre las claves es el propio desplegable del portal: si no ofrece
 * la clave, `esperarOpcion` lo dice con esas palabras.
 */
export function revisarReceptor(r: DatosReceptorCapufe): string[] {
  const malos: string[] = [];
  const rfc = (r.rfc ?? '').trim().toUpperCase();

  if (!esRfcValido(rfc)) malos.push(`el RFC "${r.rfc}" no tiene forma de RFC`);
  else if (!rfcChecksumOk(rfc)) malos.push(`el RFC "${rfc}" no pasa el dígito verificador`);

  if ((r.nombre ?? '').trim().length < 3) malos.push('falta el nombre o razón social');
  if (!/^\d{5}$/.test((r.codigoPostal ?? '').trim())) malos.push(`el código postal "${r.codigoPostal}" no son 5 dígitos`);
  if (!/^\d{3}$/.test((r.regimenFiscal ?? '').trim())) malos.push(`el régimen fiscal "${r.regimenFiscal}" no es una clave del SAT de 3 dígitos`);
  if (!/^[A-Z]{1,2}\d{2}$/.test((r.usoCfdi ?? '').trim().toUpperCase())) malos.push(`el uso de CFDI "${r.usoCfdi}" no es una clave del SAT`);
  // Sin correo válido el portal no manda el CFDI a ningún lado y el ensayo
  // pasaría igual: es de los datos que solo duelen en producción.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((r.correo ?? '').trim())) malos.push(`el correo "${r.correo}" no es una dirección válida`);

  return malos;
}

/**
 * ¿El resultado dice "no se puede" en vez de "no pude"?
 *
 * VIVE EN `agente.ts` Y AQUÍ SOLO SE REEXPORTA. Nació en este archivo porque
 * este portal fue el primero en detectar un CAPTCHA, pero quien tiene que
 * ACTUAR es el que enruta —`al_vuelo.ts`, el cron— y ese no debe importar un
 * adaptador concreto para preguntar algo que ya es parte del contrato genérico
 * (`ResultadoAgente.requiereCaptcha`). El nombre se conserva aquí para que nada
 * de lo que ya lo importaba tenga que cambiar.
 */
export { pideCaptcha } from '../agente';

/**
 * Construye el adaptador y lo deja registrado PARA ESA FLOTA.
 *
 * No se registra al importar el módulo: el registro necesita una fábrica de
 * páginas y los datos fiscales de la flota, que no existen en tiempo de import.
 * Un `registrarAdaptador()` de nivel de módulo obligaría a inventar ambos.
 *
 * EL `tenantId` VA APARTE DEL RECEPTOR, y no por gusto. El receptor es lo que
 * se teclea EN EL PORTAL —los cinco datos del CFDI 4.0 más el correo—; el
 * tenantId es un identificador interno nuestro. Un objeto que lleva de todo es
 * cómo un uuid de nuestra base acaba impreso en un documento fiscal.
 */
export function registrarCapufe(tenantId: string, op: OpcionesCapufe): AdaptadorCapufe {
  const a = new AdaptadorCapufe(op);
  registrarAdaptador(tenantId, a);
  return a;
}
