import { DatoInvalido } from '@/lib/likida/errores';
import { round2 } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// DE QUÉ LADO DEL PRECIO ESTÁ EL IVA — el único sitio que lo decide.
//
// EL FALLO QUE ESTE ARCHIVO EXISTE PARA CERRAR. Había DOS lecturas del mismo
// número y nadie las había puesto una junto a la otra:
//
//   · `emitirMensualidad` guardaba `monto = plan.precio_mensual`, y la pantalla
//     del cliente le decía que transfiriera ESA cifra. Lectura implícita: el
//     precio ya trae el IVA.
//   · `timbrarMensualidad` recibía ese mismo número documentado como "Subtotal
//     SIN IVA" y lo mandaba a Facturapi con `tax_included: false`, que le suma
//     el 16% encima. Lectura implícita: el precio NO trae el IVA.
//
// Con un plan de $10,000 el cliente transfiere $10,000 y el CFDI sale por
// $11,600. Su contador concilia contra el estado de cuenta y no cuadra, y el
// CFDI ya existe ante el SAT: la única salida es cancelarlo.
//
// CUÁL DE LAS DOS LECTURAS ERA LA BUENA NO SE PUEDE SABER DESDE EL CÓDIGO —
// depende de cómo esté configurado el `unit_amount` del price en Stripe. Así
// que aquí no se elige un lado: se exige que alguien lo DECLARE, y mientras no
// esté declarado no se emite ni se timbra nada.
//
// POR QUÉ NEGARSE ES LA OPCIÓN BARATA. No emitir cuesta un mensaje en /admin y
// dos minutos de configuración. Emitir mal cuesta un CFDI real ante el SAT que
// hay que cancelar, y una cancelación fuera de plazo se le queda AL CLIENTE en
// su contabilidad. Es el mismo criterio que `exigirLlaveCoherente` en
// `facturapi.ts`: preferir no operar a operar en falso.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Tasa general de IVA. Vive aquí y no en tres archivos por la misma razón que
 * `mxn()` vive en `lib/formato.ts`: una tasa fiscal escrita dos veces se
 * divergirá en la ronda en que alguien toque una sola de las dos.
 *
 * No hay tasa fronteriza: Likida factura desde una sola plaza y el estímulo de
 * región fronteriza pide un aviso ante el SAT que no se ha presentado. Ponerla
 * "por si acaso" sería una cifra sin respaldo.
 */
export const TASA_IVA = 0.16;

/**
 * De qué lado del precio está el IVA.
 *
 * `null` NO es "no lleva IVA": es "nadie lo declaró". La diferencia es la razón
 * de ser de este módulo — un `false` por defecto convierte una pregunta abierta
 * en una respuesta inventada, y esa respuesta acaba timbrada.
 */
export type CriterioIva = boolean | null;

export interface DesgloseIva {
  /** Base gravable. Es lo que se le manda al PAC como precio del concepto. */
  subtotal: number;
  /** IVA trasladado. */
  iva: number;
  /** Lo que el cliente TRANSFIERE. Es lo que se le enseña en pantalla. */
  total: number;
}

/**
 * Qué decir en pantalla al lado de un precio. Corto a propósito: va pegado a la
 * cifra, no debajo.
 */
export function etiquetaIva(criterio: CriterioIva): string {
  if (criterio === true) return 'IVA incluido';
  if (criterio === false) return '+ IVA';
  return 'IVA sin declarar';
}

/** El mensaje que ve quien tiene que arreglarlo. Una sola redacción para las
 *  dos puertas (emitir y timbrar), porque la acción es la misma. */
export const FALTA_CRITERIO_IVA =
  'Este plan no declara si su precio INCLUYE el IVA o si el IVA va encima, así que no se sabe cuánto cobrar ni por ' +
  'cuánto timbrar. Se arregla en Stripe: ponle al price `tax_behavior` en «inclusive» (el precio ya trae el IVA) o ' +
  '«exclusive» (el IVA va aparte) y vuelve a guardar el price en Planes y precios. Emitir un CFDI por 16% de más es ' +
  'irreversible, así que no se emite a ciegas.';

/**
 * Parte un precio en subtotal + IVA, según el criterio declarado.
 *
 * LANZA cuando el criterio es `null`. No devuelve un desglose "provisional" ni
 * un `null` que el llamador pueda ignorar por accidente: las dos formas de
 * fallar suave terminan en un CFDI emitido por la cifra equivocada.
 *
 * EL REDONDEO SE CIERRA SOBRE EL TOTAL, no sobre las partes. Con IVA incluido,
 * $10,000 / 1.16 = $8,620.6896…: si se redondearan subtotal e IVA por separado
 * la suma podría no dar $10,000 y el CFDI cobraría un centavo distinto al
 * depósito. Se redondea el subtotal y el IVA se calcula como el resto, así el
 * invariante `subtotal + iva === total` se cumple por construcción — que es lo
 * que el CHECK `factura_saas_desglose_cuadra` (0065) verifica en la base.
 */
export function desglosarPrecio(precio: number, criterio: CriterioIva): DesgloseIva {
  if (!Number.isFinite(precio) || precio < 0) {
    throw new DatoInvalido('El precio del plan no es una cifra válida, así que no hay nada que cobrar.');
  }
  if (criterio === null || criterio === undefined) {
    throw new DatoInvalido(FALTA_CRITERIO_IVA);
  }

  if (criterio === true) {
    const total = round2(precio);
    const subtotal = round2(total / (1 + TASA_IVA));
    return { subtotal, iva: round2(total - subtotal), total };
  }

  const subtotal = round2(precio);
  const iva = round2(subtotal * TASA_IVA);
  return { subtotal, iva, total: round2(subtotal + iva) };
}

/**
 * ¿El desglose guardado sigue cuadrando con el total cobrado?
 *
 * Se comprueba ANTES de timbrar y no solo al emitir: la base ya lo garantiza
 * con un CHECK, pero el timbrado es irreversible y una fila escrita por otro
 * camino (una corrección a mano en Supabase, un import) no pasaría por el
 * código de esta carpeta. La tolerancia es de un centavo, la misma del CHECK.
 */
export function desgloseCuadra(total: number, subtotal: number, iva: number): boolean {
  // El `1e-9` NO es una segunda tolerancia de dinero — el centavo real sigue
  // siendo `0.01`. Es el margen contra el ruido de punto flotante: restar dos
  // números ya redondeados a centavos (p. ej. `10000.01 - 10000`) puede dar
  // `0.010000000000218...` en vez de `0.01` exacto, y un caso que la propia
  // migración 0065 documenta como tolerado ("un centavo de tolerancia por el
  // redondeo") se rechazaba por una diferencia de dos billonésimas de centavo.
  // Verificado con AUDITORÍA 10 · `iva.test.ts` (caso límite exacto a 1¢).
  return Math.abs(round2(total) - round2(subtotal + iva)) <= 0.01 + 1e-9;
}
