import { logger } from '@/lib/logger';
import { trMensajes, type ClaveMensaje, type Variables } from '@/lib/i18n/mensajes_tr';

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
  /**
   * `mensaje` es SIEMPRE el texto en español (lo que ven las pruebas, los logs y quien no tiene idioma). Si el error nació de una
   * clave del diccionario `mensajes` (`datoInvalido()`), trae además `clave` y `vars` para decirlo en el idioma de quien lo lee.
   */
  constructor(mensaje: string, public readonly clave?: ClaveMensaje, public readonly vars?: Variables) {
    super(mensaje);
    this.name = 'DatoInvalido';
  }
}

/**
 * Una ETIQUETA de campo («El subtotal», «el origen») para meterla como variable de un `DatoInvalido`: el texto se arma en español
 * al lanzar el error (`mensaje` no cambia) y la etiqueta viaja como clave, así que al mostrarlo en otro idioma sale la etiqueta
 * traducida y no el español pegado dentro de una frase en inglés. Es solo una marca; se resuelve en `resolverEtiquetas`.
 */
export function etiqueta(clave: ClaveMensaje): string {
  return `\u2983${clave}\u2984`;
}
const MARCA_ETIQUETA = /\u2983([A-Za-z0-9_.]+)\u2984/g;
function resolverEtiquetas(vars: Variables | undefined, idioma?: unknown): Variables | undefined {
  if (!vars) return vars;
  const tr = trMensajes(idioma);
  const fuera: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(vars)) {
    fuera[k] = typeof v === 'string' ? v.replace(MARCA_ETIQUETA, (_m, c: string) => tr.t(c as ClaveMensaje)) : v;
  }
  return fuera;
}

/** Un `DatoInvalido` hecho de una clave: el texto en español sale del diccionario y la clave viaja para traducirlo al mostrarlo. */
export function datoInvalido(clave: ClaveMensaje, vars?: Variables): DatoInvalido {
  return new DatoInvalido(trMensajes('es').t(clave, resolverEtiquetas(vars, 'es')), clave, vars);
}

/** El texto de un `DatoInvalido` en el idioma pedido; sin clave (los miles de sitios aún por migrar) es su mensaje en español. */
export function textoDeDato(e: DatoInvalido, idioma?: unknown): string {
  return e.clave ? trMensajes(idioma).t(e.clave, resolverEtiquetas(e.vars, idioma)) : e.message;
}

/** El operador existe pero está de baja (A37-A1-liquidaciones-12): distinto de «no existe» aunque se muestre igual al capturista. */
export class OperadorDeBaja extends DatoInvalido {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'OperadorDeBaja';
  }
}

/**
 * Los datos del operador no identifican a UNO solo: apuntan a más de uno, o `id`, `telefono` y `numeroEmpleado` apuntan a
 * choferes distintos (CT-A12-09). Es distinto de «no existe»: dar de alta a quien ya está duplicado empeora el problema.
 */
export class OperadorAmbiguo extends DatoInvalido {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'OperadorAmbiguo';
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
export function mensajeParaPantalla(e: unknown, operacion: string, idioma?: unknown): string {
  if (e instanceof DatoInvalido) return textoDeDato(e, idioma);
  logger.error('administracion.falla', {
    operacion,
    err: e instanceof Error ? e.message : String(e),
  });
  // `operacion` es una frase en español escrita por quien llama: en otro idioma no se puede insertar sin mezclar idiomas, así
  // que ahí se dice la versión genérica. En español, exactamente lo de siempre.
  const tr = trMensajes(idioma);
  return tr.idioma === 'es' ? tr.t('err.sistema', { operacion }) : tr.t('err.sistema.generico');
}
