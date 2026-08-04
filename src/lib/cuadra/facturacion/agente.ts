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

const ADAPTADORES = new Map<string, AdaptadorPortal>();

/** Registra el adaptador de un portal. Sin registro, ese portal va por mensaje. */
export function registrarAdaptador(a: AdaptadorPortal): void {
  ADAPTADORES.set(a.comercio, a);
}

export function adaptadorDe(comercio: string): AdaptadorPortal | null {
  return ADAPTADORES.get(comercio) ?? null;
}

/** Cuántos portales sabe operar el agente hoy. */
export function portalesAutomatizados(): string[] {
  return [...ADAPTADORES.keys()];
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
  comercio: string;
  campos: CampoListo[];
  modo?: ModoAgente;
}): Promise<ResultadoAgente> {
  const modo: ModoAgente = args.modo ?? 'ensayo';
  const a = adaptadorDe(args.comercio);

  if (!a) {
    return {
      modo, ok: false, capturado: {},
      error: `Todavía no hay adaptador para "${args.comercio}". Ese portal se factura a mano hasta que lo haya.`,
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
    logger.info('agente.facturacion', { comercio: args.comercio, modo, ok: r.ok });
    return r;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error('agente.facturacion.fallo', { comercio: args.comercio, modo, error });
    // NO se reintenta. En `emitir`, un reintento a ciegas después de un fallo
    // ambiguo —¿se envió antes de reventar?— es la forma de acabar con dos CFDI
    // por el mismo ticket.
    return { modo, ok: false, capturado: {}, error };
  }
}
