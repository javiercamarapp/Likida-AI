import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL ERROR QUE SE LE ENSEÑA A QUIEN LLENÓ EL FORMULARIO.
//
// VIVE APARTE DE `administracion.ts` POR PESO, no por estética. Estaba allá, y
// `saas/suscripcion.ts` lo importaba para un `throw`: eso metía en el bundle
// del webhook de Stripe todo lo que `administracion.ts` arrastra —el motor de
// cuadre, el parser de CFDI con su import dinámico, el cliente de Meta— en una
// ruta que solo necesita hablar con Postgres. Dos clases y una función no
// deberían costar eso.
// ═══════════════════════════════════════════════════════════════════════════

/** Error de captura: el mensaje es para enseñárselo a quien llenó el formulario. */
export class DatoInvalido extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'DatoInvalido';
  }
}

/**
 * El abono de ESA propuesta del portal de pago ya estaba registrado.
 *
 * No es un error de captura ni una falla: es la restricción de la 0237
 * (`pago_recibido_propuesta_unica`) haciendo su trabajo cuando dos sesiones
 * concilian la misma propuesta a la vez. `registrarPago` la lanza al ver el
 * 23505 y `conciliarPropuesta` la usa para colgarse del abono que YA existe en
 * vez de crear un segundo — que es el dinero duplicado de `c7-5`.
 *
 * VIVE AQUÍ y no en `facturacion_escritura.ts` por la misma razón que
 * `DatoInvalido` vive aquí y no en `administracion.ts`: quien necesita
 * reconocer esta clase (hoy `portal_pago_escritura.ts`, mañana cualquier otro)
 * no tiene por qué arrastrar el módulo entero de facturación —con `intake/cfdi`
 * y su cadena de `sharp`/`zxing-wasm`— para hacer un `instanceof`. Una clase de
 * cuatro líneas no debería costar eso.
 *
 * NO se enseña verbatim: `mensajeParaPantalla` la trata como cualquier otra
 * excepción, porque quien la vea en pantalla no tiene nada que corregir.
 */
export class AbonoYaRegistrado extends Error {
  constructor(public readonly propuestaId: string) {
    super(`El abono de la propuesta ${propuestaId} ya estaba registrado.`);
    this.name = 'AbonoYaRegistrado';
  }
}

/**
 * Traduce una excepción al texto que ve quien llenó el formulario.
 *
 * `DatoInvalido` se enseña VERBATIM: su mensaje se escribió para esto y es lo
 * único que le dice a la persona QUÉ corregir. Cambiarlo por un "revisa los
 * datos" genérico destruiría el valor de las funciones que lo lanzan — la de
 * teléfonos existe para poder decir "ese número ya está en OTRA flota", no para
 * negarse en abstracto.
 *
 * Cualquier otra excepción NO se enseña tal cual: trae el mensaje de Postgres o
 * de Stripe, que no significa nada para un dueño de flota y sí describe la
 * forma del esquema. Pero tampoco se calla —eso dejaría a alguien creyendo que
 * el alta se hizo—: se loguea completo y en pantalla se dice qué operación
 * falló y que no fue culpa de lo capturado, que es la diferencia que decide si
 * vuelve a intentarlo o corrige algo que estaba bien.
 */
export function mensajeParaPantalla(e: unknown, operacion: string): string {
  if (e instanceof DatoInvalido) return e.message;
  logger.error('administracion.falla', {
    operacion,
    err: e instanceof Error ? e.message : String(e),
  });
  return `No se pudo ${operacion}, y no es por lo que capturaste: es una falla del sistema y quedó registrada. Vuelve a intentarlo; si se repite, avísale a Likida.`;
}
