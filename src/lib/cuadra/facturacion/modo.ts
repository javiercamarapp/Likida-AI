import { logger } from '@/lib/logger';

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL MANDATO — auditoría 10, hallazgo ALTO, legal Y fiscal a la vez.
//
// `docs/auditoria-10/legal.md` y `docs/auditoria-10/fiscal.md` documentan, cada
// uno desde su rubro, EL MISMO hueco: no existe una cláusula que autorice al
// sistema a presentar el RFC y los datos fiscales de un cliente ante el portal
// de un tercero (CAPUFE, Enerser, OXXO Gas…) y apretar el botón que crea un
// CFDI real en su nombre — mientras `/terminos` dice hoy "Likida no timbra
// facturas". Los dos documentos usan la misma frase para el riesgo: el
// interruptor de esa actuación es "una variable de entorno de distancia" de la
// revisión legal, no una decisión que pase por ningún papel.
//
// REDACTAR ESA CLÁUSULA NO ES TRABAJO DE ESTE ARCHIVO. Es una decisión de
// Javier con su abogado, y este módulo no inventa ni un borrador de lenguaje
// legal. Lo que SÍ le toca al código es no dejar que `FACTURACION_MODO=emitir`
// tenga efecto silenciosamente mientras esa cláusula no exista.
//
// Por eso `emitir` necesita DOS variables puestas, no una:
//
//   · `FACTURACION_MODO=emitir`           — la decisión de encender el cron.
//   · `FACTURACION_MANDATO_ACEPTADO=si`   — la confirmación, puesta a mano el
//                                            mismo día que exista la cláusula,
//                                            de que ya se puede actuar así.
//
// Sin la segunda, un `emitir` se trata como `ensayo` — se llena el portal y no
// se toca el botón — y se grita en el log con `logger.error`. Así, quien active
// `FACTURACION_MODO=emitir` sin saber de este hallazgo se entera de inmediato
// por qué no está emitiendo, en vez de que falle en silencio o —peor— de que
// emita sin la cláusula que lo autoriza.
// ═══════════════════════════════════════════════════════════════════════════

/** El único valor que cuenta como "sí, ya existe la cláusula de mandato". */
export const MANDATO_ACEPTADO_VALOR = 'si';

/**
 * ¿Alguien puso a mano que la cláusula de mandato ya existe?
 *
 * El parámetro tiene como default la lectura DIRECTA de
 * `process.env.FACTURACION_MANDATO_ACEPTADO` —y no un objeto `env` genérico—
 * a propósito: `src/lib/observability/runbook.test.ts` vigila que toda
 * variable declarada en `.env.example` tenga, en algún archivo de `src/`, un
 * acceso literal a esa propiedad de `process.env`, para que un documento
 * nunca prometa una variable que nadie lee. Pasar el valor ya leído (en vez
 * de un objeto) deja ese literal en el código Y permite que las pruebas lo
 * sustituyan sin tocar `process.env` global.
 */
export function mandatoFiscalAceptado(
  valor: string | undefined = process.env.FACTURACION_MANDATO_ACEPTADO,
): boolean {
  return valor === MANDATO_ACEPTADO_VALOR;
}

/**
 * El modo que de verdad corre — no necesariamente el que se pidió.
 *
 * `ensayo` pasa siempre igual: nunca hace falta el mandato para NO emitir.
 * `emitir` solo pasa si el mandato está aceptado; si no, se degrada a `ensayo`
 * y se deja dicho por qué, con la fuente exacta del hallazgo, para que activar
 * `FACTURACION_MODO=emitir` sin conocer este candado se note en el log al
 * primer intento — no en una sala con un abogado, después de que el CFDI ya
 * existe ante el SAT.
 *
 * `mandatoAceptado` se resuelve leyendo el ambiente REAL en cada llamada — el
 * default es una expresión, no un valor fijado una vez, así que un cambio de
 * `FACTURACION_MANDATO_ACEPTADO` a media ejecución (o entre pruebas) se nota
 * en la siguiente llamada sin volver a importar nada.
 */
export function modoEfectivo(
  modoSolicitado: 'ensayo' | 'emitir',
  mandatoAceptado: boolean = mandatoFiscalAceptado(),
): 'ensayo' | 'emitir' {
  if (modoSolicitado !== 'emitir') return modoSolicitado;
  if (mandatoAceptado) return 'emitir';

  logger.error('autofactura.mandato_no_aceptado', {
    detalle:
      'FACTURACION_MODO=emitir ignorado: falta FACTURACION_MANDATO_ACEPTADO — ver docs/auditoria-10/legal.md',
  });
  return 'ensayo';
}
