import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { armar, type TicketPorFacturar } from './pendientes';
import { enrutar } from './enrutar';
import { facturarConAgente, adaptadorDe } from './agente';

// ═══════════════════════════════════════════════════════════════════════════
// FACTURAR EN CUANTO LLEGA LA FOTO, NO AL CERRAR EL VIAJE.
//
// Decisión de Javier, y es mejor que esperar al cierre por dos razones que se
// refuerzan:
//
//   1. EL PLAZO. Las gasolineras dan 7-15 días. Entre que el viaje dura 2-3
//      días y la oficina liquida por quincena, un ticket del día 2 puede estar
//      vencido antes de que alguien lo mire. Facturando al llegar, el reloj de
//      caducidad nunca llega a correr.
//
//   2. EL PDF NO SE VUELVE FALSO. Si se factura después del cierre, la
//      liquidación que ya se entregó queda con una deducibilidad desactualizada
//      — y ese papel es justo el que el contralor archiva y le da a su contador.
//      Facturando antes, el PDF nace correcto y no hay que reemitir nada.
//
// ── POR QUÉ NO SE FACTURA TODO LO QUE LLEGA ──────────────────────────────
//
// Emitir un CFDI es IRREVERSIBLE: cancelarlo cuesta y, fuera de plazo, se le
// queda al cliente en su contabilidad. Un OCR que leyó $420 donde decía $4,200
// emitiría una factura equivocada por una foto borrosa.
//
// Por eso la máquina solo dispara cuando puede PROBAR lo que va a escribir:
// portal sin cuenta, todos los campos requeridos presentes, confianza alta, y
// —lo más fuerte— el monto salido de un CÓDIGO DE BARRAS y no de visión.
// Lo que no cumpla se acumula en la pantalla de "por facturar" para una
// persona. Es el mismo criterio de todo el repo: la máquina hace lo que puede
// demostrar.
// ═══════════════════════════════════════════════════════════════════════════

/** Debajo de esto no se factura solo: la lectura no es lo bastante segura. */
export const CONFIANZA_MINIMA_AUTOFACTURA = 0.9;

export type MotivoNoFactura =
  | 'sin_adaptador'      // el portal se reconoce pero nadie sabe operarlo aún
  | 'requiere_cuenta'    // lo tiene que hacer el encargado, con su sesión
  | 'incompleto'         // falta un dato que el portal exige
  | 'confianza_baja'     // la lectura no da para emitir un documento fiscal
  | 'ya_facturado';

export interface DecisionAutofactura {
  procede: boolean;
  motivo?: MotivoNoFactura;
  /** Para el log y la pantalla: qué faltó exactamente. */
  detalle?: string;
}

/**
 * ¿Se puede facturar este ticket solo, ahora?
 *
 * PURA a propósito: decidir y ejecutar son cosas distintas, y esta es la que hay
 * que poder probar exhaustivamente sin tocar un portal.
 */
export function decidirAutofactura(
  t: TicketPorFacturar,
  confianzaOcr: number | null,
  tieneAdaptador: boolean,
): DecisionAutofactura {
  const ruta = enrutar(t);

  if (ruta.via === 'mensaje') {
    return { procede: false, motivo: 'requiere_cuenta', detalle: t.comercio?.nombre };
  }
  if (ruta.via === 'incompleto') {
    return { procede: false, motivo: 'incompleto', detalle: ruta.falta.join('; ') };
  }
  if (!tieneAdaptador) {
    return { procede: false, motivo: 'sin_adaptador', detalle: t.comercio?.clave };
  }

  // La confianza es del OCR, no del portal. Lo que NO es un número se trata como
  // ausencia, nunca como confianza alta.
  //
  // AQUÍ HUBO UN AGUJERO QUE EMITÍA FACTURAS REALES. La comprobación era
  // `confianzaOcr === null || confianzaOcr < 0.9`, y con `NaN` las DOS dan
  // `false` —`NaN === null` es false y `NaN < 0.9` también—, así que caía por
  // abajo a `procede: true`. No era teórico: el llamador hace
  // `Number(data.ocr_confianza)`, que devuelve `NaN` con una columna vacía o con
  // texto. Un comprobante del que no sabíamos NADA autorizaba timbrar un CFDI
  // irreversible ante el SAT.
  //
  // `Number.isFinite` cierra los tres casos de una vez (null, undefined, NaN) y
  // no se puede volver a abrir por un lado: no hay valor no-numérico que lo pase.
  if (!Number.isFinite(confianzaOcr as number)) {
    return { procede: false, motivo: 'confianza_baja', detalle: 'sin confianza registrada' };
  }
  const confianza = confianzaOcr as number;
  if (confianza < CONFIANZA_MINIMA_AUTOFACTURA) {
    return {
      procede: false,
      motivo: 'confianza_baja',
      // Tres decimales, no dos: `(0.899).toFixed(2)` imprime "0.90", o sea el
      // rechazo declaraba una confianza IGUAL al mínimo aceptable y la pantalla
      // de "por facturar" quedaba contradiciéndose sola.
      detalle: `confianza ${confianza.toFixed(3)}`,
    };
  }

  return { procede: true };
}

export interface ResultadoAutofactura {
  intentado: boolean;
  facturado: boolean;
  cfdiUuid?: string;
  motivo?: MotivoNoFactura;
  detalle?: string;
}

/**
 * Intenta facturar un gasto recién asentado.
 *
 * BEST-EFFORT A PROPÓSITO, y esto importa: lo llama el procesador de fotos, que
 * corre dentro del presupuesto del webhook de WhatsApp. Si la facturación falla
 * —portal caído, selector cambiado, red— el GASTO YA ESTÁ GUARDADO y el chofer
 * ya recibió su acuse. Tirar el mensaje entero porque un portal no contestó
 * sería cambiar un problema de oficina por uno de operación.
 *
 * Lo que no se pudo facturar aparece en la pantalla de "por facturar" con su
 * plazo. Nada se pierde en silencio.
 */
export async function facturarAlVuelo(args: {
  gastoId: string;
  tenantId: string;
  /** En 'ensayo' llena el portal y NO emite. El default es deliberado. */
  modo?: 'ensayo' | 'emitir';
  hoy?: string;
  /** Reloj inyectable para el sello del intento. La prueba no depende del suyo. */
  ahora?: string;
}): Promise<ResultadoAutofactura> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('gasto')
    .select('id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra, ocr_confianza')
    .eq('id', args.gastoId)
    .eq('tenant_id', args.tenantId)
    .maybeSingle();

  if (error || !data) {
    // No se marca nada: o la fila no es de esta flota, o la base no contestó.
    // Sellar un intento sobre un gasto que no se pudo leer sería empujar al
    // final de la cola algo que quizá ni existe.
    return { intentado: false, facturado: false, detalle: error?.message ?? 'no existe' };
  }
  if (data.cfdi_uuid) {
    return { intentado: false, facturado: false, motivo: 'ya_facturado' };
  }

  // EL SELLO VA AQUÍ, ANTES DE DECIDIR, Y SE PONE PROCEDA O NO.
  //
  // `gasto.autofactura_intentada_en` entró en la 0063 para exactamente esto: la
  // cola del cron ordena por `autofactura_intentada_en nulls first, created_at`
  // y toma ocho. Sin escribirla, los ocho gastos más viejos que NO proceden
  // —portal con cuenta, confianza baja, un campo que falta— salen elegidos en
  // cada corrida, para siempre, y los que sí se pueden facturar nunca entran al
  // lote. La cola se bloquea a sí misma y desde fuera se ve como un cron que
  // corre cada hora y no factura nada.
  //
  // Va ANTES de la decisión y no después del portal a propósito: si el portal
  // revienta —y `facturarConAgente` puede lanzar— el sello ya está puesto, así
  // que un portal caído no vuelve a acaparar el lote entero en la corrida
  // siguiente.
  await marcarIntento(admin, args.gastoId, args.tenantId, args.ahora);

  const hoy = args.hoy ?? new Date().toISOString().slice(0, 10);
  const t = armar(data as Parameters<typeof armar>[0], hoy);
  const decision = decidirAutofactura(
    t,
    data.ocr_confianza === null ? null : Number(data.ocr_confianza),
    // El registro va POR FLOTA: preguntar por el comercio a secas devolvía el
    // adaptador de quien hubiera facturado antes en esta misma instancia, con
    // SUS datos fiscales dentro.
    t.comercio ? adaptadorDe(args.tenantId, t.comercio.clave) !== null : false,
  );

  if (!decision.procede) {
    logger.info('autofactura.no_procede', { gastoId: args.gastoId, motivo: decision.motivo });
    return { intentado: false, facturado: false, motivo: decision.motivo, detalle: decision.detalle };
  }

  const r = await facturarConAgente({
    tenantId: args.tenantId,
    comercio: t.comercio!.clave,
    campos: t.campos,
    modo: args.modo ?? 'ensayo',
  });

  // UN ENSAYO EXITOSO NO ES UN FALLO. En `ensayo` el agente llena el portal y se
  // detiene antes de emitir, así que devuelve `ok: true` SIN `cfdiUuid` — y como
  // ensayo es el modo POR DEFECTO, la condición `!r.ok || !r.cfdiUuid` mandaba
  // al log de fallos el camino normal, con `error: undefined`. Quien fuera a
  // averiguar "por qué no se factura nada" encontraba fallos que no ocurrieron.
  if (r.ok && !r.cfdiUuid) {
    logger.info('autofactura.ensayo', { gastoId: args.gastoId, capturado: Object.keys(r.capturado).length });
    return { intentado: true, facturado: false, detalle: 'ensayo: se llenó el portal y no se emitió' };
  }
  if (!r.ok) {
    logger.warn('autofactura.fallo', { gastoId: args.gastoId, error: r.error });
    return { intentado: true, facturado: false, detalle: r.error };
  }

  // El CFDI YA EXISTE en el portal. Si guardarlo falla, se loguea fuerte y se
  // devuelve como facturado igual: perder el UUID en nuestra base es un
  // problema de registro; volver a facturar es un problema fiscal del cliente.
  const { error: errGuardar } = await admin
    .from('gasto')
    .update({ cfdi_uuid: r.cfdiUuid })
    .eq('id', args.gastoId)
    // Acotado por tenant además de por id, aunque el `select` de arriba ya probó
    // que la fila es de esta flota. Cuesta nada y cierra el camino de que un
    // `gastoId` que venga de fuera escriba un UUID en la fila de otra empresa.
    .eq('tenant_id', args.tenantId);
  if (errGuardar) {
    logger.error('autofactura.uuid_sin_guardar', { gastoId: args.gastoId, uuid: r.cfdiUuid, err: errGuardar.message });
  }

  logger.info('autofactura.ok', { gastoId: args.gastoId, uuid: r.cfdiUuid });
  return { intentado: true, facturado: true, cfdiUuid: r.cfdiUuid };
}

/**
 * Sella que este gasto YA SE INTENTÓ, proceda o no.
 *
 * Un fallo aquí NO tumba el intento: el sello ordena la cola, no autoriza nada.
 * Lo que sí hace es dejar rastro, porque la consecuencia de perderlo es lenta y
 * silenciosa —la cola se vuelve a atorar con los mismos ocho— y sin este `warn`
 * se diagnosticaría como "el cron no factura" en vez de "el sello no se guarda".
 */
async function marcarIntento(
  admin: ReturnType<typeof supabaseAdmin>,
  gastoId: string,
  tenantId: string,
  ahora?: string,
): Promise<void> {
  const { error } = await admin
    .from('gasto')
    .update({ autofactura_intentada_en: ahora ?? new Date().toISOString() })
    .eq('id', gastoId)
    .eq('tenant_id', tenantId);

  if (error) {
    logger.warn('autofactura.sello_sin_guardar', { gastoId, err: error.message });
  }
}
