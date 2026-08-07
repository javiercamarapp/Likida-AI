import { logger } from '@/lib/logger';
import type { CampoListo } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// EL AGENTE QUE ENTRA AL PORTAL Y FACTURA.
//
// Solo para los portales que NO piden cuenta —26 de los 37 del registro—. Los
// otros 11 van por mensaje al encargado, que es quien tiene la sesión.
//
// ── DOS MODOS, Y NO ES CEREMONIA ─────────────────────────────────────────
//
// `ensayo`  → navega, llena TODOS los campos, captura la pantalla y SE DETIENE
//             antes del botón de emitir. Devuelve qué habría enviado.
// `emitir`  → hace lo mismo y aprieta.
//
// Existe porque apretar ese botón CREA UN CFDI REAL ante el SAT y no se
// deshace: cancelar uno fuera de plazo se le queda al cliente en su
// contabilidad. Un selector equivocado en modo emitir factura el ticket con el
// monto de otro campo; en modo ensayo eso se ve en la captura y no cuesta nada.
//
// El default es `ensayo` A PROPÓSITO. Quien quiera emitir tiene que pedirlo.
//
// ── POR QUÉ NO HAY UN MODELO AQUÍ ────────────────────────────────────────
//
// Un agente de visión mirando la pantalla costaría ~$0.08 por factura con
// Sonnet. A 21 facturas por viaje son $1.76 — SIETE VECES el costo de todo lo
// demás junto ($0.24). No hace falta un modelo para escribir un folio que ya
// está en la base: hace falta un selector. La visión queda como respaldo para
// cuando el selector falle, y ahí con el modelo barato, no con el caro.
// ═══════════════════════════════════════════════════════════════════════════

export type ModoAgente = 'ensayo' | 'emitir';

export interface ResultadoAgente {
  modo: ModoAgente;
  ok: boolean;
  /** Qué se habría escrito en cada campo del portal. */
  capturado: Record<string, string>;
  /** Solo en `emitir` y solo si salió: el UUID del CFDI que se generó. */
  cfdiUuid?: string;
  /** Ruta del XML descargado, si lo hubo. */
  xmlRuta?: string;
  /** Por qué no se pudo. Se enseña tal cual: dice qué arreglar. */
  error?: string;
  /** Captura de la pantalla final, para poder MIRAR qué pasó. */
  captura?: string;
  /**
   * El portal pidió CAPTCHA. NO es "no pude", es "no se puede".
   *
   * Vive en el resultado GENÉRICO —y no solo en el del adaptador que lo
   * detecta— porque quien tiene que actuar es el que enruta, y ese no sabe de
   * qué portal viene el resultado. Ver `pideCaptcha()`.
   */
  requiereCaptcha?: boolean;
  /**
   * SE APRETÓ EMITIR Y NO SE PUDO CONFIRMAR EL UUID. El CFDI puede existir.
   *
   * Es la señal más cara del archivo. Sin ella, el ticket vuelve a la cola y en
   * la corrida siguiente se emite un SEGUNDO CFDI por el mismo consumo — que es
   * el daño que ni el ensayo ni el `ok:false` alcanzan a evitar, porque desde
   * fuera un "no se confirmó" se ve idéntico a un "no se emitió".
   */
  emisionSinConfirmar?: boolean;
}

/**
 * ¿El resultado dice "no se puede" en vez de "no pude"?
 *
 * Lo que separa reintentar para siempre de avisarle a una persona. Es una
 * función y no una lectura suelta del campo para que exista UN solo sitio donde
 * se decide qué cuenta como bloqueo permanente, el día que haya un segundo.
 */
export function pideCaptcha(r: Pick<ResultadoAgente, 'requiereCaptcha'>): boolean {
  return r.requiereCaptcha === true;
}

/**
 * Lo que un adaptador de portal tiene que saber hacer.
 *
 * UN ADAPTADOR POR PORTAL, no uno genérico. Se intentó pensar en un llenador
 * universal por nombre de campo y no sobrevive al primer portal real: los
 * `name` de los inputs no se parecen entre cadenas, la mitad valida por JS al
 * salir del campo, y varios parten la captura en dos pantallas.
 */
export interface AdaptadorPortal {
  /** Clave del comercio en el registro (`comercios.ts`). */
  comercio: string;
  /** Contra qué URL corre. */
  portal: string;
  /**
   * Llena y —según el modo— envía.
   *
   * Recibe los campos YA resueltos por `pendientes.ts`: el adaptador no vuelve a
   * mirar el ticket ni adivina nada, solo sabe dónde va cada valor en SU portal.
   */
  facturar(campos: CampoListo[], modo: ModoAgente): Promise<ResultadoAgente>;
  /**
   * OPCIONAL: N tickets en UNA sesión. Ver el bloque "EL LOTE" de abajo.
   *
   * Un portal que no lo implemente no se rompe ni se queda atrás: quien llama
   * usa SIEMPRE `facturarLoteConAgente`, y ahí el lote de un adaptador sin este
   * método se resuelve llamando a `facturar` una vez por ticket — exactamente lo
   * que se hacía antes, con el mismo resultado y sin que el llamador sepa cuál
   * de los dos caminos tomó.
   */
  facturarLote?(tickets: TicketDeLote[], modo: ModoAgente): Promise<ResultadoLoteAgente>;
}

// ═══════════════════════════════════════════════════════════════════════════
// EL LOTE: N TICKETS, UNA SESIÓN, Y A VECES UN SOLO CFDI.
//
// ── DE DÓNDE SALE ────────────────────────────────────────────────────────
//
// CAPUFE no es "un formulario, un CFDI": se capturan los datos fiscales UNA
// vez, se validan N códigos contra la misma pantalla y al final se emite UNA
// factura con todos. Ocho casetas de un viaje son UNA sesión, no ocho. Medido
// en `pagina_playwright.ts`: la sesión (navegar, seis datos fiscales, dos
// catálogos por AJAX) cuesta ~1.2 s y se pagaba una vez POR TICKET. Y el costo
// de tiempo es el menor de los dos: ocho sesiones idénticas seguidas contra el
// mismo portal se parecen, desde el lado del portal, a un robot.
//
// ── POR QUÉ NO SE EXTENDIÓ `facturar()` Y YA ─────────────────────────────
//
// Porque `CampoListo[]` describe UN ticket y no tiene dónde decir de qué gasto
// salió cada valor. Sin eso, el resultado de ocho códigos no se puede repartir
// entre ocho gastos, que es justo lo que hay que escribir en la base. `facturar`
// se queda igual —los adaptadores de un ticket no cambian ni una línea— y el
// lote entra por un método NUEVO y OPCIONAL.
//
// ── LA PARTE QUE IMPORTA: EL UUID VIVE POR GASTO, NO POR LOTE ────────────
//
// `ResultadoLoteAgente` NO tiene un `cfdiUuid`. Lo tiene cada entrada de
// `porGasto`, y varias pueden traer EL MISMO. Esa forma es la que hace que los
// dos caminos sean el mismo para quien escribe en la base:
//
//   · portal de un ticket  → N entradas con N uuid distintos,
//   · portal de lote       → N entradas con UN uuid repetido.
//
// Un `cfdiUuid` a nivel de lote habría obligado al llamador a preguntar "¿este
// adaptador emite una factura o N?" antes de guardar nada — o sea a saber de
// CAPUFE. Con esto no lo pregunta nunca: lee `porGasto` y escribe lo que diga.
// ═══════════════════════════════════════════════════════════════════════════

/** Un ticket dentro de un lote: de qué gasto salió y sus campos ya resueltos. */
export interface TicketDeLote {
  /** La fila de `gasto` a la que se le va a escribir el resultado. */
  gastoId: string;
  campos: CampoListo[];
}

/** Qué le pasó a UN gasto dentro del lote. */
export interface ResultadoPorGasto {
  gastoId: string;
  /**
   * Quedó DENTRO de la factura. En `ensayo` significa "habría quedado": el
   * portal lo aceptó y el botón de emitir no se tocó.
   */
  incluido: boolean;
  /**
   * El CFDI que ampara ESTE gasto. Varios gastos pueden compartirlo — es una
   * factura de varias casetas, no varias facturas.
   */
  cfdiUuid?: string;
  /** Por qué no entró, o qué hay que mirar aunque haya entrado. */
  motivo?: string;
}

export interface ResultadoLoteAgente {
  modo: ModoAgente;
  /**
   * Entró algo. Se DERIVA de `porGasto` y no lo declara el adaptador: un
   * `ok: true` con cero gastos incluidos es la clase de verde que este repo
   * paga caro.
   */
  ok: boolean;
  /** Uno por ticket de ENTRADA, sin faltar ninguno. Lo garantiza `completar()`. */
  porGasto: ResultadoPorGasto[];
  /** Los datos fiscales que se escribieron en el portal, una vez por sesión. */
  capturado: Record<string, string>;
  /** La pantalla, para poder MIRAR qué se habría enviado. */
  captura?: string;
  requiereCaptcha?: boolean;
  emisionSinConfirmar?: boolean;
  error?: string;
  /** Salió bien pero hay algo que mirar (rechazos parciales, costos ilegibles). */
  aviso?: string;
}

/**
 * Corre el agente sobre UN LOTE de tickets del mismo portal y la misma flota.
 *
 * Es el único camino que debe usar quien factura: decide solo si el adaptador
 * sabe hacer lotes o hay que llamarlo ticket por ticket, y devuelve la misma
 * forma en los dos casos.
 *
 * FALLA CERRADO en lo que puede escribir en la base: `completar()` se queda
 * SOLO con los gastos que se mandaron, y a los que el adaptador no reportó los
 * da por NO incluidos. Un adaptador que devolviera un gastoId inventado —o que
 * olvidara uno— no puede hacer que se escriba un UUID sobre una fila que nadie
 * mandó al portal.
 */
export async function facturarLoteConAgente(args: {
  tenantId: string;
  comercio: string;
  tickets: TicketDeLote[];
  modo?: ModoAgente;
}): Promise<ResultadoLoteAgente> {
  const modo: ModoAgente = args.modo ?? 'ensayo';
  const a = adaptadorDe(args.tenantId, args.comercio);

  if (!a) {
    return completar(
      { modo, porGasto: [], capturado: {}, error: `Todavía no hay adaptador para "${args.comercio}" en esta flota. Ese portal se factura a mano hasta que lo haya.` },
      args.tickets,
      modo,
    );
  }
  if (args.tickets.length === 0) {
    return completar({ modo, porGasto: [], capturado: {}, error: 'No se recibió ningún ticket para el lote. No se abrió el portal.' }, [], modo);
  }

  try {
    const bruto = a.facturarLote
      ? await a.facturarLote(args.tickets, modo)
      : await unoPorUno(args.tenantId, args.comercio, args.tickets, modo);
    logger.info('agente.facturacion.lote', {
      tenant: args.tenantId, comercio: args.comercio, modo,
      tickets: args.tickets.length, enLote: Boolean(a.facturarLote),
    });
    return completar(bruto, args.tickets, modo);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('agente.facturacion.lote.fallo', { tenant: args.tenantId, comercio: args.comercio, modo, error });
    // NO se reintenta, por lo mismo de siempre: en `emitir` un reintento tras un
    // fallo ambiguo es cómo se acaba con dos CFDI por el mismo consumo.
    return completar({ modo, porGasto: [], capturado: {}, error }, args.tickets, modo);
  }
}

/**
 * El lote de un adaptador que solo sabe de a uno. UNA sesión por ticket, que es
 * lo que ese portal necesita de todas formas.
 *
 * Pasa por `facturarConAgente` y no por `a.facturar` directo para que las reglas
 * de un ticket —campos requeridos vacíos, el error tal cual— vivan en UN sitio.
 */
async function unoPorUno(
  tenantId: string,
  comercio: string,
  tickets: TicketDeLote[],
  modo: ModoAgente,
): Promise<Omit<ResultadoLoteAgente, 'ok'>> {
  const porGasto: ResultadoPorGasto[] = [];
  let capturado: Record<string, string> = {};
  let captura: string | undefined;
  let requiereCaptcha = false;
  let emisionSinConfirmar = false;
  const errores: string[] = [];

  for (const t of tickets) {
    const r = await facturarConAgente({ tenantId, comercio, campos: t.campos, modo });
    // El último que llegó a escribir algo es el que se enseña: son sesiones
    // distintas, así que no hay una pantalla del lote que valga por todas.
    if (Object.keys(r.capturado).length > 0) capturado = r.capturado;
    if (r.captura) captura = r.captura;
    if (pideCaptcha(r)) requiereCaptcha = true;
    if (r.emisionSinConfirmar) emisionSinConfirmar = true;
    if (r.error) errores.push(`${t.gastoId}: ${r.error}`);

    porGasto.push({
      gastoId: t.gastoId,
      // En `emitir` un ok sin UUID no es una factura: es un portal que no la
      // confirmó, y escribirle un uuid vacío al gasto sería peor que no escribir.
      incluido: r.ok && (modo === 'ensayo' || Boolean(r.cfdiUuid)),
      ...(r.cfdiUuid ? { cfdiUuid: r.cfdiUuid } : {}),
      ...(r.error ? { motivo: r.error } : {}),
    });
  }

  return {
    modo, porGasto, capturado, captura,
    ...(requiereCaptcha ? { requiereCaptcha } : {}),
    ...(emisionSinConfirmar ? { emisionSinConfirmar } : {}),
    ...(errores.length > 0 ? { error: errores.join(' · ') } : {}),
  };
}

/**
 * Reconcilia lo que devolvió el adaptador contra lo que se le mandó.
 *
 * Tres cosas, y las tres son de fallar cerrado:
 *  1. Cada ticket de entrada aparece EXACTAMENTE una vez en la salida.
 *  2. Un gastoId que no se mandó se descarta —con log—, aunque venga con uuid.
 *  3. `ok` se deriva de los incluidos, no lo declara el adaptador.
 */
function completar(
  bruto: Omit<ResultadoLoteAgente, 'ok'>,
  tickets: TicketDeLote[],
  modo: ModoAgente,
): ResultadoLoteAgente {
  const pedidos = new Set(tickets.map((t) => t.gastoId));
  const porId = new Map<string, ResultadoPorGasto>();
  const colados: string[] = [];

  for (const p of bruto.porGasto) {
    if (!pedidos.has(p.gastoId)) { colados.push(p.gastoId); continue; }
    // El PRIMERO manda: un adaptador que reporte dos veces el mismo gasto no
    // puede mejorar su propio veredicto en la segunda pasada.
    if (!porId.has(p.gastoId)) porId.set(p.gastoId, p);
  }
  if (colados.length > 0) {
    logger.error('agente.lote.gasto_ajeno', { colados: colados.join(','), pedidos: tickets.length });
  }

  const porGasto = tickets.map((t) =>
    porId.get(t.gastoId) ?? {
      gastoId: t.gastoId,
      incluido: false,
      motivo: bruto.error
        ? `No se llegó a intentar en el portal: ${bruto.error}`
        : 'El adaptador no dijo qué pasó con este ticket, así que se cuenta como no facturado.',
    },
  );

  return { ...bruto, modo, porGasto, ok: porGasto.some((p) => p.incluido) };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL REGISTRO VA POR FLOTA, Y ESO NO ES UNA PRECAUCIÓN: ES EL ARREGLO.
//
// Aquí hubo un `Map<string, AdaptadorPortal>` con la clave `comercio` a secas,
// a nivel de MÓDULO. En una función serverless caliente el módulo sobrevive
// entre invocaciones, así que ese `Map` era UNO para todo el proceso y el
// proceso atiende a varias flotas seguidas.
//
// La secuencia era exacta: la flota A registra su adaptador de CAPUFE —que
// lleva DENTRO sus datos fiscales, porque el portal pide RFC, razón social,
// régimen, CP y uso una vez por sesión—; termina su lote; llega un ticket de la
// flota B; `adaptadorDe('capufe')` devuelve el de A; y se emite un CFDI con el
// RFC de A por un gasto de B. Un CFDI no se deshace: cancelarlo fuera de plazo
// se le queda al cliente en su contabilidad, y el propio portal lo advierte en
// rojo en su página.
//
// Ahora el tenant va EN LA CLAVE. Dos niveles de `Map` y no una llave compuesta
// (`${tenant}|${comercio}`) a propósito: una llave compuesta depende de que
// ningún identificador traiga el separador, y el día que lo traiga las dos
// flotas vuelven a compartir cajón sin que nada avise.
//
// LAS FIRMAS PIDEN EL `tenantId` PRIMERO Y SIN DEFAULT. Quien lo olvide no
// obtiene el adaptador de otro: no compila. Y quien pase una cadena vacía
// —`undefined` colado por un `as`, un id que no se leyó— tampoco cae en un
// cajón compartido: se lanza. Ver `exigirTenantId`.
// ═══════════════════════════════════════════════════════════════════════════

/** flota → comercio → adaptador. */
const ADAPTADORES = new Map<string, Map<string, AdaptadorPortal>>();

/**
 * El `tenantId` con el que se abre el cajón, o un error que dice por qué no.
 *
 * LANZA en vez de caer a un cajón por default. Un cajón compartido —la cadena
 * vacía, `'desconocido'`, lo que sea— es literalmente el bug que este archivo
 * acaba de cerrar: dos flotas volverían a leerse el adaptador la una a la otra.
 * Un error que sube es ruidoso; un CFDI con el RFC de otra empresa es
 * irreversible.
 */
function exigirTenantId(tenantId: string, quien: string): string {
  const t = typeof tenantId === 'string' ? tenantId.trim() : '';
  if (!t) {
    throw new Error(
      `${quien}: falta el tenantId. El registro de adaptadores va POR FLOTA porque el adaptador lleva dentro los datos fiscales con los que se timbra; sin tenantId no hay dónde guardarlo ni a quién devolvérselo, y un cajón compartido emitiría el CFDI de una flota con el RFC de otra.`,
    );
  }
  return t;
}

/**
 * Registra el adaptador de un portal PARA ESA FLOTA. Sin registro, ese portal
 * va por mensaje al encargado.
 */
export function registrarAdaptador(tenantId: string, a: AdaptadorPortal): void {
  const t = exigirTenantId(tenantId, 'registrarAdaptador');
  const porComercio = ADAPTADORES.get(t) ?? new Map<string, AdaptadorPortal>();
  porComercio.set(a.comercio, a);
  ADAPTADORES.set(t, porComercio);
}

export function adaptadorDe(tenantId: string, comercio: string): AdaptadorPortal | null {
  const t = exigirTenantId(tenantId, 'adaptadorDe');
  return ADAPTADORES.get(t)?.get(comercio) ?? null;
}

/** Qué portales sabe operar el agente hoy PARA ESA FLOTA. */
export function portalesAutomatizados(tenantId: string): string[] {
  const t = exigirTenantId(tenantId, 'portalesAutomatizados');
  return [...(ADAPTADORES.get(t)?.keys() ?? [])];
}

/**
 * Saca a esa flota del registro entera.
 *
 * Existe por la memoria: con el tenant en la clave, un proceso caliente que
 * atiende a cien flotas acumula cien cajones que nadie vuelve a mirar. Quien
 * cierra un lote (`conPortales`) tiene además su propia forma de dejar el
 * registro inservible con un mensaje mejor que "no hay adaptador" — ver
 * `adaptadores/registro.ts`.
 */
export function olvidarAdaptadores(tenantId: string): void {
  ADAPTADORES.delete(exigirTenantId(tenantId, 'olvidarAdaptadores'));
}

/**
 * Corre el agente sobre un ticket.
 *
 * FALLA CERRADO EN LOS TRES PUNTOS QUE IMPORTAN:
 *  1. Sin adaptador para ese portal, no se improvisa: se dice que no está.
 *  2. Un campo requerido vacío no se manda — el portal lo rechaza igual y el
 *     reintento cuesta lo mismo.
 *  3. Si el adaptador revienta, se devuelve el error tal cual. Nada de
 *     reintentar solo: en `emitir` un reintento a ciegas puede duplicar el CFDI.
 */
export async function facturarConAgente(args: {
  /**
   * De qué flota es el ticket. OBLIGATORIO: es lo que decide con QUÉ DATOS
   * FISCALES se llena el portal, o sea de qué empresa sale el CFDI.
   */
  tenantId: string;
  comercio: string;
  campos: CampoListo[];
  modo?: ModoAgente;
}): Promise<ResultadoAgente> {
  const modo: ModoAgente = args.modo ?? 'ensayo';
  const a = adaptadorDe(args.tenantId, args.comercio);

  if (!a) {
    return {
      modo, ok: false, capturado: {},
      error: `Todavía no hay adaptador para "${args.comercio}" en esta flota. Ese portal se factura a mano hasta que lo haya.`,
    };
  }

  const vacios = args.campos.filter((c) => c.requerido && !c.valor);
  if (vacios.length > 0) {
    return {
      modo, ok: false, capturado: {},
      error: `Faltan datos que el portal exige: ${vacios.map((c) => c.etiqueta).join(', ')}.`,
    };
  }

  try {
    const r = await a.facturar(args.campos, modo);
    logger.info('agente.facturacion', { tenant: args.tenantId, comercio: args.comercio, modo, ok: r.ok });
    return r;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('agente.facturacion.fallo', { tenant: args.tenantId, comercio: args.comercio, modo, error });
    // NO se reintenta. En `emitir`, un reintento a ciegas después de un fallo
    // ambiguo —¿se envió antes de reventar?— es la forma de acabar con dos CFDI
    // por el mismo ticket.
    return { modo, ok: false, capturado: {}, error };
  }
}
