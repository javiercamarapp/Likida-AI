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
