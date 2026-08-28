import { logger } from '@/lib/logger';
import type {
  AdaptadorPortal, ModoAgente, ResultadoAgente,
  ResultadoLoteAgente, ResultadoPorGasto, TicketDeLote,
} from '../agente';
import { esRfcValido, rfcChecksumOk } from '../../intake/cfdi';
import type { ClaveCampo } from '../comercios';
import type { CampoListo } from '../pendientes';
import { clasificarFallo, type ClaseDeFallo } from '../vinculo_senales';
import type { FabricaDePagina, PaginaPortal } from './playwright_base';
import { ESPERA_UUID_MS, INTERVALO_UUID_MS } from './playwright_base';
import {
  aplicarFormato, capturaSegura, clic, descargarXml, escribirCampo, esperarTexto,
  FalloDePortal, leerRechazo, mensajeCaptcha, mensajeSelectoresIdos, mirarCaptcha,
  mirarLogin, preVuelo, SELECTORES_CAPTCHA_COMUNES, textoDeError,
  type FormatoCampo, type SelectorAVerificar,
} from './pasos';

// ═══════════════════════════════════════════════════════════════════════════
// UN PORTAL NUEVO ES UNA TABLA DE SELECTORES, NO UN ARCHIVO.
//
// ── EL PROBLEMA QUE ESTE ARCHIVO EXISTE PARA CERRAR ───────────────────────
//
// El catálogo (`comercios.ts`) tiene 37 comercios. Adaptadores escritos había
// UNO: CAPUFE, 1 282 líneas. El resto salía con el encargado —una persona
// entrando al portal, tecleando el RFC y bajando el CFDI a mano—, que es el
// segundo trabajo más caro de una flota después de la liquidación.
//
// Escribir 36 CAPUFEs no es un plan: son 36 archivos con el mismo
// procedimiento copiado, y el día que alguien encuentre un fallo en el
// procedimiento hay que arreglarlo 36 veces. Lo que cambia de un portal a otro
// no es QUÉ se hace, es DÓNDE: qué selector es el folio, cuál el botón de
// buscar, dónde aparece el UUID. Eso es una tabla.
//
// Aquí está el motor que lee esa tabla. Los pasos que ejecuta viven en
// `pasos.ts` y son los mismos que usa `AdaptadorPlaywrightBase`; lo que este
// archivo aporta es el ORDEN y las POLÍTICAS: cuándo se aborta, qué bandera
// lleva cada aborto, y qué NO se hace nunca.
//
// ── LAS CUATRO POLÍTICAS, Y NINGUNA ES NEGOCIABLE ─────────────────────────
//
// 1. UN GUION SIN VERIFICAR NO EMITE. NUNCA.
//
//    Los selectores de CAPUFE se midieron contra el portal real el 5-ago-2026
//    con un arnés que solo lee (`pruebas-manuales/capufe-prevuelo.prueba.ts`),
//    y su propio comentario marca uno por uno cuáles resolvieron y cuáles
//    siguen siendo apuestas. Un guion escrito sin esa visita es una HIPÓTESIS
//    entera, por buena que sea la corazonada.
//
//    Apretar «emitir» con una hipótesis crea un CFDI REAL ante el SAT que no
//    se deshace: si un selector estaba corrido, el comprobante sale con el
//    dato de otro campo y cancelarlo fuera de plazo se le queda al cliente en
//    su contabilidad. Así que `verificado: null` significa: se ensaya —se
//    llena, se captura, y el pre-vuelo dice selector por selector qué existe y
//    qué no—, y en `emitir` se devuelve un fallo declarado que manda a correr
//    el arnés. NO es una advertencia en un comentario: está en el código y no
//    hay bandera que la salte.
//
// 2. CAPTCHA = PERSONA, Y SE MIRA ANTES DE ESCRIBIR NADA.
//
//    Likida no resuelve ni rodea captchas —ni con 2captcha ni equivalentes—:
//    rodearlos es operar contra los términos del portal y la cuenta que se
//    bloquea es LA DEL CLIENTE. El porqué entero está en `pasos.ts`, donde se
//    aplica. Aquí lo que importa es el ORDEN: se mira antes del primer
//    carácter, porque un formulario a medio llenar detrás de un captcha no le
//    sirve a nadie y sí deja rastro de robot.
//
// 3. UN PORTAL QUE CAMBIÓ SU HTML PRODUCE UN ERROR CON CAPTURA, NO UN «LISTO».
//
//    El pre-vuelo comprueba TODOS los selectores antes de tocar el primero y
//    los reporta JUNTOS. Si falta alguno y la sesión sigue viva, el fallo sale
//    con `portalCambio: true` — que es la bandera cuyo dueño es LIKIDA, no el
//    cliente: no hay nada que re-vincular, hay que rehacer la tabla. Mandar al
//    contralor a hacer un login que ya funciona deja el problema igual para la
//    corrida siguiente.
//
// 4. EL CFDI SE BAJA, NO SE FABRICA. `descargarXml` aprieta el botón del
//    portal y se queda con lo que el portal entregue. Nada de componer un XML
//    con lo que se capturó: eso es un delito fiscal del cliente.
//
// ── EL RELOJ (PR #152) ────────────────────────────────────────────────────
//
// `facturarLote` recibe `venceEn` y lo consulta ANTES de cada ticket. Los que
// se quedan sin turno se reportan por su nombre, con `incluido: false` y un
// motivo que dice que NO se intentaron. El runner de producción murió mudo dos
// veces por motores que iteraban sin mirar el reloj: una invocación que se
// corta a la mitad deja tickets marcados como intentados sin haberlo sido.
// ═══════════════════════════════════════════════════════════════════════════

/** Los datos fiscales de la flota. Constantes por lote; no salen del ticket. */
export type DatoReceptor = 'rfc' | 'nombre' | 'codigoPostal' | 'regimenFiscal' | 'usoCfdi' | 'correo';

export type ReceptorDeGuion = Readonly<Record<DatoReceptor, string>>;

/** Dónde va UN dato en ESTE portal, y cómo se teclea. */
export interface CampoGuion {
  /**
   * El selector, o VARIOS candidatos en orden de preferencia.
   *
   * Varios candidatos NO es indecisión: es cómo se escribe una hipótesis sin
   * mentir. Mientras el guion no esté verificado, declarar `['#folio',
   * 'input[name="folio"]']` dice la verdad —«creemos que es una de estas»— y
   * el pre-vuelo elige la que exista y reporta las dos si no existe ninguna.
   * Declarar una sola y jurar que es esa sería inventar un hecho.
   */
  selector: string | readonly string[];
  /** `escribir` (default) o `seleccionar` para un `<select>`. */
  como?: 'escribir' | 'seleccionar';
  /** Cómo se transforma el valor antes de teclearlo. Ver `aplicarFormato`. */
  formato?: FormatoCampo;
}

/**
 * LA PRUEBA DE QUE ESTA TABLA SE MIDIÓ CONTRA EL PORTAL DE VERDAD.
 *
 * No es documentación: es lo que habilita `emitir`. Se llena SOLO después de
 * correr el arnés de pre-vuelo, pegando aquí lo que reportó. Rellenarlo de
 * memoria es exactamente el fraude que la política 1 impide.
 */
export interface VerificacionDeGuion {
  /** AAAA-MM-DD de la visita que lo midió. */
  fecha: string;
  /** Qué arnés lo midió, para poder volver a correrlo. */
  arnes: string;
  /** Los `que` que resolvieron ese día, tal como los reportó el arnés. */
  resueltos: readonly string[];
}

/** El paso de BUSCAR el consumo antes de que aparezca el formulario fiscal. */
export interface BusquedaDeGuion {
  boton: string | readonly string[];
  /** Cómo lo llama el portal. Va literal en el error. */
  que: string;
  /**
   * Qué tiene que APARECER para saber que la búsqueda encontró algo. Sin esto
   * no se puede distinguir «el ticket no existe» de «la página tarda», y las
   * dos cosas se arreglan en sitios distintos.
   */
  esperar?: string;
  /** Dónde escribe el portal su «no encontramos ese ticket», si lo tiene. */
  sinResultados?: string;
}

/**
 * TODO UN PORTAL. Agregar uno es escribir una de estas y registrarla.
 *
 * Va todo junto —campos, receptor, botones, UUID, error y XML— por lo mismo
 * que `MapeoPortal` lo hacía: cuando un portal se rediseña se cambian todos a
 * la vez, y tenerlos repartidos es cómo se queda uno viejo sin que nadie lo
 * note.
 */
export interface GuionPortal {
  /** Clave del comercio en `comercios.ts`. */
  comercio: string;
  /** URL contra la que corre. */
  portal: string;
  /** `null` = NO se ha medido contra el portal real. Entonces NO emite. */
  verificado: VerificacionDeGuion | null;
  /**
   * Este portal exige que una persona haya iniciado sesión.
   *
   * Cuando es `true` y la pantalla resulta ser la de entrar, el resultado sale
   * con `requiereVinculacion` (o `sesionCaducada` si HABÍA sesión) en vez de
   * con un error de selector. Likida no teclea contraseñas: el login lo hace
   * el contralor UNA vez y la sesión queda guardada cifrada.
   */
  requiereSesion?: boolean;
  /** Qué existe SOLO estando adentro. Ver `pantallaDeLogin`. */
  senaDeAdentro?: string;
  /** Dónde va cada dato del TICKET. */
  campos: Partial<Record<ClaveCampo, CampoGuion>>;
  /** Dónde van los datos fiscales de la FLOTA, si el portal los pide. */
  receptor?: Partial<Record<DatoReceptor, CampoGuion>>;
  /** El paso de buscar, si el portal lo tiene separado del de emitir. */
  buscar?: BusquedaDeGuion;
  /**
   * El botón que EMITE. Obligatorio aunque el ensayo no lo apriete: el ensayo
   * existe para probar el camino de emitir MENOS el clic, y un ensayo que pasa
   * con un botón que ya no existe da confianza falsa sobre lo único que no se
   * puede deshacer.
   */
  botonEmitir: string | readonly string[];
  /** Dónde queda el UUID una vez emitido, si el portal lo enseña. */
  uuid?: string;
  /** Dónde escribe el portal su propio mensaje de rechazo, si lo tiene. */
  error?: string;
  /** El botón que baja el XML del CFDI ya emitido, si el portal lo ofrece. */
  xml?: { boton: string | readonly string[] };
  /** Selectores de captcha PROPIOS de este portal, además de los comunes. */
  captcha?: readonly string[];
}

export interface OpcionesGuion {
  guion: GuionPortal;
  receptor: ReceptorDeGuion;
  abrirPagina: FabricaDePagina;
  /** `true` cuando el lote arrancó con una sesión guardada de este portal. */
  arrancoConSesion?: boolean;
  /**
   * `Date.now()` a partir del cual el LOTE deja de tomar tickets nuevos.
   * Ver el bloque del reloj arriba. `undefined` = sin tope (pruebas).
   */
  venceEn?: number;
  /**
   * Cuánto tiene que quedar de presupuesto para EMPEZAR un ticket más.
   *
   * No basta con «todavía no vence»: un ticket que arranca con 200 ms por
   * delante muere a media captura, y en `emitir` esa muerte es AMBIGUA —¿se
   * fue el formulario antes de reventar?—, que es como se acaba con dos CFDI
   * por el mismo consumo. El default reserva la espera del UUID completa
   * (`ESPERA_UUID_MS`) más un respiro, porque ese es el tramo que un ticket en
   * `emitir` no puede dejar a medias.
   */
  margenTicketMs?: number;
  esperaUuidMs?: number;
  intervaloMs?: number;
  dormir?: (ms: number) => Promise<void>;
  ahora?: () => number;
  /** Tope para la descarga del XML. */
  esperaXmlMs?: number;
}

/** El respiro por encima de la espera del UUID. Ver `margenTicketMs`. */
export const RESPIRO_TICKET_MS = 5_000;

/** Lo que hace falta para empezar un ticket más, por modo. */
export const margenPorDefecto = (modo: ModoAgente, esperaUuidMs: number): number =>
  modo === 'emitir' ? esperaUuidMs + RESPIRO_TICKET_MS : RESPIRO_TICKET_MS;

/** El motivo con el que sale un ticket al que no le tocó turno. */
export const SIN_TURNO =
  'no se intentó: se acabó el presupuesto de tiempo de esta corrida antes de llegar a este ticket. NO se abrió el portal y NO se marcó nada — se recoge entero en la corrida siguiente.';

/**
 * QUÉ LE FALTA A ESTA FLOTA PARA PODER FACTURAR EN ESTE PORTAL.
 *
 * Se revisa SOLO lo que el guion declara, y esa es la diferencia con
 * `revisarReceptor` de CAPUFE, que exige los seis datos fiscales siempre.
 * Exigirlos todos aquí dejaría fuera a una flota que no tiene capturado el
 * régimen por un portal que ni se lo pide — o sea, mandaría un ticket con el
 * encargado por un dato que nadie iba a teclear. El comentario de `TABLA` en
 * `registro.ts` ya lo anticipaba: «no todos los portales piden los mismos
 * datos».
 *
 * Devuelve frases, no códigos: esto acaba en la pantalla del contralor.
 */
export function revisarDatosDeGuion(g: GuionPortal, r: Partial<ReceptorDeGuion>): string[] {
  const malos: string[] = [];
  const pide = (d: DatoReceptor) => g.receptor?.[d] !== undefined;
  const v = (d: DatoReceptor) => (r[d] ?? '').trim();

  if (pide('rfc')) {
    const rfc = v('rfc').toUpperCase();
    if (!esRfcValido(rfc)) malos.push(`el RFC "${r.rfc}" no tiene forma de RFC`);
    else if (!rfcChecksumOk(rfc)) malos.push(`el RFC "${rfc}" no pasa el dígito verificador`);
  }
  if (pide('nombre') && v('nombre').length < 3) malos.push('falta el nombre o razón social');
  if (pide('codigoPostal') && !/^\d{5}$/.test(v('codigoPostal'))) malos.push(`el código postal "${r.codigoPostal}" no son 5 dígitos`);
  if (pide('regimenFiscal') && !/^\d{3}$/.test(v('regimenFiscal'))) malos.push(`el régimen fiscal "${r.regimenFiscal}" no es una clave del SAT de 3 dígitos`);
  if (pide('usoCfdi') && !/^[A-Z]{1,2}\d{2}$/.test(v('usoCfdi').toUpperCase())) malos.push(`el uso de CFDI "${r.usoCfdi}" no es una clave del SAT`);
  // Sin correo válido el portal emite y no manda el CFDI a ningún lado, y el
  // ensayo pasaría igual: es de los datos que solo duelen en producción.
  if (pide('correo') && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v('correo'))) {
    malos.push(`el correo "${r.correo}" no tiene forma de correo, y ahí es donde el portal manda el CFDI`);
  }

  return malos;
}

/** El motivo con el que un guion sin medir se niega a emitir. */
export function motivoSinVerificar(g: GuionPortal): string {
  return `El mapeo de "${g.comercio}" NO se ha medido contra ${g.portal}: sus selectores son una hipótesis, no un hecho. Emitir con una hipótesis crea un CFDI real ante el SAT que puede salir con el dato de otro campo, y eso no se deshace. Se puede ENSAYAR (llena, captura y no aprieta); para emitir hay que correr antes el arnés de pre-vuelo y anotar aquí lo que resolvió.`;
}

/**
 * UNA ESCRITURA RESUELTA: qué valor va en qué selector y con qué nombre.
 *
 * Los TRES nombres no son redundancia, cada uno tiene su sitio y mezclarlos
 * produce mensajes rotos:
 *   · `llave`    — la clave del campo (`folio`, `rfc`). Es la que indexa
 *                  `capturado`, porque dos campos pueden llamarse igual en
 *                  pantalla y uno pisaría al otro sin que nadie lo viera.
 *   · `etiqueta` — cómo lo llama el portal, literal («Folio»). Va entre
 *                  comillas en el error de escritura, que es el texto que
 *                  `playwright_base` lleva dando desde que existe.
 *   · `frase`    — la misma etiqueta envuelta («el campo "Folio"»), que es lo
 *                  que el pre-vuelo enumera cuando faltan varios selectores.
 */
interface Escritura {
  llave: string;
  etiqueta: string;
  frase: string;
  selector: string | readonly string[];
  valor: string;
  como?: 'escribir' | 'seleccionar';
}

/**
 * El primer candidato declarado, para cuando el pre-vuelo no pudo elegir.
 *
 * Pasa cuando la página no ofrece `existe()` (una doble en pruebas, un motor
 * futuro). Se toma el primero y NO se falla: si tampoco está, el paso de
 * escribir revienta diciendo cuál era, que es el mismo camino de antes.
 */
const primerCandidato = (s: string | readonly string[]): string => (typeof s === 'string' ? s : s[0]);

// ═══════════════════════════════════════════════════════════════════════════

export class AdaptadorDeclarativo implements AdaptadorPortal {
  readonly comercio: string;
  readonly portal: string;

  private readonly g: GuionPortal;
  private readonly receptor: ReceptorDeGuion;
  private readonly abrirPagina: FabricaDePagina;
  private readonly arrancoConSesion: boolean;
  private readonly venceEn: number | undefined;
  private readonly margenTicketMs: number | undefined;
  private readonly esperaUuidMs: number;
  private readonly intervaloMs: number;
  private readonly esperaXmlMs: number | undefined;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly ahora: () => number;

  constructor(op: OpcionesGuion) {
    this.g = op.guion;
    this.comercio = op.guion.comercio;
    this.portal = op.guion.portal;
    this.receptor = op.receptor;
    this.abrirPagina = op.abrirPagina;
    this.arrancoConSesion = op.arrancoConSesion === true;
    this.venceEn = op.venceEn;
    this.margenTicketMs = op.margenTicketMs;
    this.esperaUuidMs = Math.max(1, op.esperaUuidMs ?? ESPERA_UUID_MS);
    this.intervaloMs = Math.max(1, op.intervaloMs ?? INTERVALO_UUID_MS);
    this.esperaXmlMs = op.esperaXmlMs;
    this.dormir = op.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.ahora = op.ahora ?? (() => Date.now());
  }

  /**
   * `modo` va opcional a propósito: esto también se llama desde una ruta de API
   * con un cuerpo JSON, donde el tipo no protege nada. Cualquier cosa que no
   * sea exactamente `'emitir'` es ensayo. Normaliza con `=== 'emitir'` y no al
   * revés para que un `undefined` caiga siempre del lado que no cuesta.
   */
  async facturar(campos: CampoListo[], modo?: ModoAgente): Promise<ResultadoAgente> {
    return this.unTicket(campos, modo === 'emitir' ? 'emitir' : 'ensayo');
  }

  /**
   * N tickets del mismo portal en el MISMO navegador, mirando el reloj.
   *
   * El navegador ya viene abierto (lo abre `conNavegador` por flota) y
   * `abrirPagina` da una pestaña nueva: eso es lo que convierte ocho sesiones
   * en una. Lo que este método agrega sobre iterar a pelo es el RELOJ, y decir
   * a quién no le tocó.
   */
  async facturarLote(tickets: TicketDeLote[], modo?: ModoAgente): Promise<ResultadoLoteAgente> {
    const m: ModoAgente = modo === 'emitir' ? 'emitir' : 'ensayo';
    const margen = this.margenTicketMs ?? margenPorDefecto(m, this.esperaUuidMs);

    const porGasto: ResultadoPorGasto[] = [];
    let capturado: Record<string, string> = {};
    let captura: string | undefined;
    let requiereCaptcha = false;
    let emisionSinConfirmar = false;
    let requiereVinculacion = false;
    let sesionCaducada = false;
    let portalCambio = false;
    const errores: string[] = [];
    const sinTurno: string[] = [];

    for (const t of tickets) {
      // ── EL RELOJ, ANTES DE ABRIR LA PESTAÑA ────────────────────────────
      // Se pregunta si cabe UN ticket más, no si el presupuesto ya venció:
      // arrancar con 200 ms por delante es morir a media emisión, y esa
      // muerte es ambigua. Lo que no se intenta NO se marca.
      if (this.venceEn !== undefined && this.ahora() + margen >= this.venceEn) {
        sinTurno.push(t.gastoId);
        porGasto.push({ gastoId: t.gastoId, incluido: false, motivo: SIN_TURNO });
        continue;
      }

      const r = await this.unTicket(t.campos, m);

      // El último que llegó a escribir algo es el que se enseña: son pestañas
      // distintas, así que no hay UNA pantalla del lote que valga por todas.
      if (Object.keys(r.capturado).length > 0) capturado = r.capturado;
      if (r.captura) captura = r.captura;
      // Un solo ticket que se topó con el muro basta para que el LOTE lo
      // declare: el muro es del portal, no del ticket, y los que vengan detrás
      // en esta misma sesión se van a topar con lo mismo.
      if (r.requiereCaptcha) requiereCaptcha = true;
      if (r.emisionSinConfirmar) emisionSinConfirmar = true;
      if (r.requiereVinculacion) requiereVinculacion = true;
      if (r.sesionCaducada) sesionCaducada = true;
      if (r.portalCambio) portalCambio = true;
      if (r.error) errores.push(`${t.gastoId}: ${r.error}`);

      porGasto.push({
        gastoId: t.gastoId,
        // En `emitir` un ok sin UUID no es una factura: es un portal que no la
        // confirmó, y escribirle un uuid vacío al gasto sería peor que no
        // escribir nada.
        incluido: r.ok && (m === 'ensayo' || Boolean(r.cfdiUuid)),
        ...(r.cfdiUuid ? { cfdiUuid: r.cfdiUuid } : {}),
        ...(r.error ? { motivo: r.error } : {}),
      });

      // Un muro que para al portal entero para al lote: seguir intentando
      // contra un captcha o una sesión muerta gasta el presupuesto de los que
      // sí podrían salir en la corrida siguiente, y ante el portal se parece a
      // un robot insistiendo. Los que faltan salen como «sin turno», que es la
      // verdad: no se intentaron.
      if (r.requiereCaptcha || r.requiereVinculacion || r.sesionCaducada) {
        for (const resto of tickets.slice(porGasto.length)) {
          sinTurno.push(resto.gastoId);
          porGasto.push({
            gastoId: resto.gastoId,
            incluido: false,
            motivo: `no se intentó: el portal se paró en un ticket anterior de este mismo lote (${r.requiereCaptcha ? 'CAPTCHA' : 'pide iniciar sesión'}) y los siguientes se toparían con lo mismo.`,
          });
        }
        break;
      }
    }

    if (sinTurno.length > 0) {
      logger.warn('portal.guion.sin_turno', {
        comercio: this.comercio, modo: m, sinTurno: sinTurno.length, de: tickets.length,
      });
    }

    return {
      modo: m,
      // `ok` lo vuelve a derivar `completar()` en `agente.ts`; se declara aquí
      // por el tipo y con el mismo criterio, nunca «true porque no reventó».
      ok: porGasto.some((p) => p.incluido),
      porGasto,
      capturado,
      captura,
      ...(requiereCaptcha ? { requiereCaptcha } : {}),
      ...(emisionSinConfirmar ? { emisionSinConfirmar } : {}),
      ...(requiereVinculacion ? { requiereVinculacion } : {}),
      ...(sesionCaducada ? { sesionCaducada } : {}),
      ...(portalCambio ? { portalCambio } : {}),
      ...(errores.length > 0 ? { error: errores.join(' · ') } : {}),
      ...(sinTurno.length > 0
        ? { aviso: `${sinTurno.length} de ${tickets.length} tickets se quedaron sin turno en esta corrida y NO se intentaron: ${sinTurno.join(', ')}.` }
        : {}),
    };
  }

  // ── UN TICKET, DE PRINCIPIO A FIN ────────────────────────────────────────

  private fallo(modo: ModoAgente, error: string, extra: Partial<ResultadoAgente> = {}): ResultadoAgente {
    return { modo, ok: false, capturado: {}, ...extra, error };
  }

  private async unTicket(campos: CampoListo[], modo: ModoAgente): Promise<ResultadoAgente> {
    // ── Todo lo que se puede rechazar SIN abrir el navegador ──────────────
    // Abrir Chromium para llenar un formulario con huecos cuesta segundos y
    // termina en el mismo error, pero con un portal a medio llenar de por
    // medio y una visita más en el registro del sitio ajeno.
    const vacios = campos.filter((c) => c.requerido && !c.valor);
    if (vacios.length > 0) {
      return this.fallo(modo, `Faltan datos que ${this.comercio} exige: ${vacios.map((c) => c.etiqueta).join(', ')}. No se abrió el portal.`);
    }

    if (!this.g.botonEmitir || (Array.isArray(this.g.botonEmitir) && this.g.botonEmitir.length === 0)) {
      return this.fallo(modo, `El guion de "${this.comercio}" no declara el botón de emitir. Sin él ni el ensayo prueba nada.`);
    }

    const sinSelector = campos.filter((c) => c.requerido && !this.g.campos[c.clave]);
    if (sinSelector.length > 0) {
      return this.fallo(modo, `El guion de "${this.comercio}" no sabe dónde van estos campos que el portal exige: ${sinSelector.map((c) => `${c.etiqueta} (${c.clave})`).join(', ')}. Falta agregarlos a la tabla.`);
    }

    // ── LA POLÍTICA 1, ANTES DE GASTAR UN NAVEGADOR ───────────────────────
    // Un guion sin medir no emite, y decirlo aquí —no después de llenar el
    // formulario— evita dejar un formulario cargado en un portal ajeno para
    // nada.
    if (modo === 'emitir' && this.g.verificado === null) {
      return this.fallo(modo, motivoSinVerificar(this.g));
    }

    // ── Los valores, ya formateados para ESTE portal ──────────────────────
    const aEscribir: Escritura[] = [];

    for (const [dato, campo] of Object.entries(this.g.receptor ?? {}) as Array<[DatoReceptor, CampoGuion]>) {
      const crudo = this.receptor[dato];
      const valor = aplicarFormato(crudo ?? null, campo.formato);
      if (valor === null) {
        // Un dato fiscal de la flota que no se puede escribir NO se omite: el
        // portal lo pide porque va en el CFDI, y emitir sin él sale mal o sale
        // a nombre de nadie. Se dice cuál falta y se para.
        return this.fallo(modo, `Los datos fiscales de esta flota no sirven para facturar en ${this.comercio}: falta "${dato}" (el guion lo declara como campo del portal). No se abrió el portal.`);
      }
      aEscribir.push({
        llave: dato, etiqueta: dato, frase: `el dato fiscal "${dato}"`,
        selector: campo.selector, valor, como: campo.como,
      });
    }

    for (const c of campos) {
      const campo = this.g.campos[c.clave];
      // Sin valor no se escribe nada: los requeridos ya se filtraron arriba, y
      // rellenar un opcional vacío sería inventar un dato en un documento
      // fiscal.
      if (!c.valor) continue;
      if (!campo) {
        // Sin selector y opcional se omite —el portal no lo pide— pero se deja
        // dicho en el log para que se note que la tabla está corta.
        logger.warn('agente.portal.campo_sin_selector', { comercio: this.comercio, clave: c.clave });
        continue;
      }
      const valor = aplicarFormato(c.valor, campo.formato);
      if (valor === null) {
        return this.fallo(modo, `El valor de "${c.etiqueta}" leído del ticket ("${c.valor}") no se puede escribir como ${campo.formato ?? 'texto'} en ${this.portal}. No se inventa un valor de relleno: hay que corregir el dato del gasto o el formato del guion.`);
      }
      aEscribir.push({
        llave: c.clave, etiqueta: c.etiqueta, frase: `el campo "${c.etiqueta}"`,
        selector: campo.selector, valor, como: campo.como,
      });
    }

    return this.enElPortal(aEscribir, modo);
  }

  private async enElPortal(
    aEscribir: readonly Escritura[],
    modo: ModoAgente,
  ): Promise<ResultadoAgente> {
    const contexto = { portal: this.portal, comercio: this.comercio };
    // Se devuelve lo escrito HASTA DONDE SE LLEGÓ aunque el intento falle: dice
    // en qué campo se rompió, que es la mitad del diagnóstico.
    const capturado: Record<string, string> = {};
    let pagina: PaginaPortal | undefined;
    let captura: string | undefined;
    // Cuando esto es `true` el CFDI PUEDE existir ya, y eso cambia por completo
    // qué se le puede decir al operador.
    let seApreto = false;

    try {
      pagina = await this.abrirPagina();
      await pagina.abrir(this.portal);

      // ── 1. EL CAPTCHA, ANTES DEL PRIMER CARÁCTER ───────────────────────
      const pista = await mirarCaptcha(pagina, [...(this.g.captcha ?? []), ...SELECTORES_CAPTCHA_COMUNES]);
      if (pista) {
        logger.warn('portal.guion.captcha', { comercio: this.comercio, modo });
        return this.fallo(modo, mensajeCaptcha(this.portal, 'al abrir el formulario', pista), {
          requiereCaptcha: true,
          captura: await capturaSegura(pagina, this.comercio),
        });
      }

      // ── 2. LA PUERTA ───────────────────────────────────────────────────
      if (this.g.requiereSesion) {
        const { visto } = await mirarLogin(pagina, this.g.senaDeAdentro);
        const fallo = clasificarFallo({ loginVisto: visto, arrancoConSesion: this.arrancoConSesion });
        if (fallo) return this.porVinculo(modo, fallo.clase, fallo.evidencia, fallo.queHacer, await capturaSegura(pagina, this.comercio));
      }

      // ── 3. EL PRE-VUELO: TODOS LOS SELECTORES, JUNTOS ──────────────────
      const revisar: SelectorAVerificar[] = aEscribir.map((e) => ({ que: e.frase, sel: e.selector }));
      if (this.g.buscar) revisar.push({ que: this.g.buscar.que, sel: this.g.buscar.boton });
      // El botón de emitir entra A PROPÓSITO aunque el ensayo no lo apriete: es
      // el único selector cuyo fallo no se puede probar de otra forma sin
      // emitir. Quedan fuera el del UUID y el del cuadro de error, que
      // legítimamente no existen todavía con el formulario en blanco.
      revisar.push({ que: 'el botón de emitir', sel: this.g.botonEmitir });

      const vuelo = await preVuelo(pagina, revisar);
      if (vuelo.faltan.length > 0) {
        // LA SESIÓN ESTÁ VIVA Y EL FORMULARIO CAMBIÓ: el dueño del arreglo es
        // Likida. `portalCambio` existe separado de `requiereVinculacion` justo
        // para no mandar al cliente a repetir un login que funciona.
        return this.fallo(modo, `${mensajeSelectoresIdos(this.portal, this.comercio, vuelo.faltan)} La sesión sigue viva: esto NO se arregla volviendo a entrar, lo corrige Likida rehaciendo la tabla del guion.`, {
          portalCambio: true,
          captura: await capturaSegura(pagina, this.comercio),
        });
      }

      // ── 4. LLENAR ──────────────────────────────────────────────────────
      for (const e of aEscribir) {
        // El candidato que el pre-vuelo confirmó; si no hubo pre-vuelo (página
        // sin `existe`), el primero declarado — y si ese no está, `escribirCampo`
        // falla diciendo cuál era.
        const selector = vuelo.resueltos.get(e.frase) ?? primerCandidato(e.selector);
        await escribirCampo(pagina, { selector, valor: e.valor, que: e.etiqueta, como: e.como }, contexto);
        // La llave es la CLAVE, no la etiqueta: dos campos pueden llamarse igual
        // en pantalla y uno pisaría al otro sin que nadie lo viera.
        capturado[e.llave] = e.valor;
      }

      // ── 5. BUSCAR EL CONSUMO, SI ESTE PORTAL LO PIDE APARTE ────────────
      if (this.g.buscar) {
        const sel = vuelo.resueltos.get(this.g.buscar.que) ?? primerCandidato(this.g.buscar.boton);
        await clic(pagina, sel, this.g.buscar.que, contexto);

        if (this.g.buscar.esperar) {
          const { valor, aparecio } = await esperarTexto(pagina, this.g.buscar.esperar, this.espera());
          if (!valor) {
            const sin = await leerRechazo(pagina, this.g.buscar.sinResultados);
            throw new FalloDePortal(
              sin
                ? `${this.portal} no encontró el ticket: "${sin}". Los datos que se le dieron salieron del ticket tal como se leyeron; hay que revisarlos antes de reintentar.`
                : `Se apretó ${this.g.buscar.que} en ${this.portal} y el resultado (\`${this.g.buscar.esperar}\`) ${aparecio ? `apareció y siguió VACÍO tras ~${this.esperaUuidMs} ms` : `no apareció en ~${this.esperaUuidMs} ms`}. O el ticket no está en el portal, o la tabla del guion está vieja.`,
            );
          }
        }
      }

      // La captura se toma ANTES de mirar si el portal se quejó, para que el
      // rechazo venga con la pantalla que lo produjo: sin ella el mensaje del
      // portal se lee sin saber qué había en los campos.
      captura = await capturaSegura(pagina, this.comercio);

      // Muchos portales validan al salir del campo. Si ya se quejaron, se para
      // aquí: en `emitir` esto es lo que separa un rechazo limpio de un CFDI
      // mal hecho.
      const rechazo = await leerRechazo(pagina, this.g.error);
      if (rechazo) throw new FalloDePortal(`${this.portal} rechazó lo capturado: "${rechazo}".`);

      if (modo === 'ensayo') {
        // AQUÍ SE DETIENE. El formulario queda lleno, la captura tomada y el
        // botón sin tocar.
        return { modo, ok: true, capturado, captura };
      }

      // ── 6. EMITIR ──────────────────────────────────────────────────────
      // `seApreto` se marca ANTES del clic, no después: si `hacerClic` revienta
      // no se sabe si el formulario alcanzó a irse. Fallar cerrado aquí es
      // asumir que sí.
      seApreto = true;
      const selEmitir = vuelo.resueltos.get('el botón de emitir') ?? primerCandidato(this.g.botonEmitir);
      await pagina.hacerClic(selEmitir);

      captura = (await capturaSegura(pagina, this.comercio)) ?? captura;

      const rechazoPost = await leerRechazo(pagina, this.g.error);
      const { valor: uuid, aparecio } = this.g.uuid
        ? await esperarTexto(pagina, this.g.uuid, this.espera())
        : { valor: null, aparecio: false };

      if (!uuid) {
        // NO se vuelve a intentar y se dice por qué. El CFDI puede existir: lo
        // barato es que una persona lo mire en el portal; lo caro es un segundo
        // CFDI que después hay que cancelar.
        const porQue = !this.g.uuid
          ? 'el guion no declara dónde vive el UUID en este portal'
          : aparecio
            ? `el contenedor del UUID (\`${this.g.uuid}\`) apareció y siguió VACÍO tras ~${this.esperaUuidMs} ms`
            : `el contenedor del UUID (\`${this.g.uuid}\`) no apareció en ~${this.esperaUuidMs} ms`;
        return this.fallo(modo, `Se apretó emitir en ${this.portal} y no se pudo confirmar el UUID — ${porQue}${rechazoPost ? ` (el portal dice: "${rechazoPost}")` : ''}. PUEDE QUE EL CFDI YA EXISTA: revisar el portal antes de volver a intentar — un segundo intento lo duplicaría.`, { capturado, captura, emisionSinConfirmar: true });
      }

      // ── 7. BAJAR EL XML. Se baja, no se fabrica ────────────────────────
      let xmlRuta: string | undefined;
      if (this.g.xml) {
        const selXml = primerCandidato(this.g.xml.boton);
        const ruta = await descargarXml(pagina, selXml, { ...contexto, topeMs: this.esperaXmlMs });
        if (ruta) xmlRuta = ruta;
      }

      return { modo, ok: true, capturado, captura, cfdiUuid: uuid, ...(xmlRuta ? { xmlRuta } : {}) };
    } catch (e) {
      const detalle = e instanceof FalloDePortal ? e.message : `Falló ${this.portal}: ${textoDeError(e)}`;
      const error = seApreto
        ? `SE APRETÓ EMITIR y después falló. ${detalle} PUEDE QUE EL CFDI YA EXISTA: revisar el portal antes de volver a intentar.`
        : detalle;
      logger.error('portal.guion.fallo', { comercio: this.comercio, modo, seApreto });
      // `emisionSinConfirmar` es lo que impide que el reintento de la corrida
      // siguiente emita un SEGUNDO CFDI por el mismo consumo: aquí no se sabe
      // si el formulario alcanzó a irse, y esa duda tiene que viajar como
      // bandera, no como una frase dentro del error.
      return this.fallo(modo, error, { capturado, captura, ...(seApreto ? { emisionSinConfirmar: true } : {}) });
    } finally {
      if (pagina?.cerrar) {
        try {
          await pagina.cerrar();
        } catch (e) {
          // Cerrar la pestaña no puede cambiar el resultado: para cuando esto
          // corre, el CFDI ya se emitió o ya no.
          logger.warn('agente.portal.cerrar_fallo', { comercio: this.comercio, error: textoDeError(e) });
        }
      }
    }
  }

  private espera() {
    return {
      topeMs: this.esperaUuidMs,
      intervaloMs: this.intervaloMs,
      dormir: this.dormir,
      ahora: this.ahora,
    };
  }

  /**
   * El fallo que espera a una PERSONA, con la bandera que dice a cuál.
   *
   * `sesion_caducada` y `requiere_vinculacion` mandan a la misma acción
   * (vincular) pero no al mismo mensaje: «se te venció la sesión» y «nunca has
   * vinculado este portal» llevan al contralor a sitios distintos del panel.
   * `portal_cambio` no llega aquí: ese no lo arregla el cliente.
   */
  private porVinculo(
    modo: ModoAgente,
    clase: ClaseDeFallo,
    evidencia: string,
    queHacer: string,
    captura: string | undefined,
  ): ResultadoAgente {
    logger.warn('portal.guion.vinculo', { comercio: this.comercio, modo, clase });
    return this.fallo(modo, `${this.portal}: ${evidencia}. ${queHacer}`, {
      captura,
      ...(clase === 'sesion_caducada'
        ? { requiereVinculacion: true, sesionCaducada: true }
        : clase === 'requiere_vinculacion'
          ? { requiereVinculacion: true }
          : { portalCambio: true }),
    });
  }
}
