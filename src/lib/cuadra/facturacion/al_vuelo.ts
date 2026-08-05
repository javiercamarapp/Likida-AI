import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { llegoTarde, violaIndice } from '@/lib/cuadra/pg_errores';
import { armar, type TicketPorFacturar } from './pendientes';
import { enrutar } from './enrutar';
import { modoEfectivo } from './modo';
import {
  facturarConAgente,
  facturarLoteConAgente,
  adaptadorDe,
  pideCaptcha,
  type ResultadoPorGasto,
  type TicketDeLote,
} from './agente';

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

// ═══════════════════════════════════════════════════════════════════════════
// EL CANDADO DEL MANDATO (auditoría 10, legal + fiscal, hallazgo ALTO).
//
// `args.modo` puede pedir 'emitir', pero lo que de verdad llega al agente pasa
// SIEMPRE por `modoEfectivo()` (`./modo.ts`): sin
// `FACTURACION_MANDATO_ACEPTADO=si` puesto a mano, un `emitir` se trata como
// `ensayo` y se grita en el log. Ver `modo.ts` para el porqué completo — en
// corto: todavía no existe la cláusula que autorice al sistema a presentar el
// RFC del cliente ante el portal de un tercero en su nombre, y esto evita que
// `FACTURACION_MODO=emitir` la atropelle por accidente, "una variable de
// entorno de distancia" de la revisión legal que falta.
// ═══════════════════════════════════════════════════════════════════════════

/** Debajo de esto no se factura solo: la lectura no es lo bastante segura. */
export const CONFIANZA_MINIMA_AUTOFACTURA = 0.9;

export type MotivoNoFactura =
  | 'sin_adaptador'      // el portal se reconoce pero nadie sabe operarlo aún
  | 'requiere_cuenta'    // lo tiene que hacer el encargado, con su sesión
  | 'incompleto'         // falta un dato que el portal exige
  | 'confianza_baja'     // la lectura no da para emitir un documento fiscal
  | 'bloqueado'          // la máquina se rindió a propósito: entra una persona
  | 'ya_facturado'
  | 'ya_en_proceso';     // otra corrida lo tomó primero y su claim sigue vivo

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
    // Un ticket BLOQUEADO también sale por aquí —`enrutar` lo manda con una
    // persona— pero se declara con su propio motivo. Confundirlo con
    // "requiere_cuenta" diría que el portal pide sesión, y lo que pasó es que la
    // máquina lo intentó y se topó con un muro: son dos arreglos distintos.
    return ruta.motivo === 'bloqueado'
      ? { procede: false, motivo: 'bloqueado', detalle: ruta.detalle }
      : { procede: false, motivo: 'requiere_cuenta', detalle: t.comercio?.nombre };
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
  /**
   * QUÉ SE HABRÍA ESCRITO EN EL PORTAL. Lo único que hace que el modo `ensayo`
   * sirva de algo.
   *
   * El default del cron es `ensayo`, así que el camino que corre todos los días
   * NUNCA devuelve un uuid. Sin esto, la corrida entera se resumía en "ensayo:
   * se llenó el portal" — una frase que no distingue un formulario bien llenado
   * de uno con el RFC en el campo del correo.
   */
  capturado?: Record<string, string>;
  /** La pantalla del portal: ruta en disco, o data-uri. Ver `OpcionesPagina`. */
  captura?: string;
  /** Se sacó de la cola automática, con el motivo que se guardó en la fila. */
  bloqueado?: string;
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
    .select(COLUMNAS)
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

  // EL CLAIM VA AQUÍ, ANTES DE DECIDIR, Y SE PONE PROCEDA O NO.
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
  // revienta —y `facturarConAgente` puede lanzar— el claim ya está puesto, así
  // que un portal caído no vuelve a acaparar el lote entero en la corrida
  // siguiente.
  //
  // Y ADEMÁS ES LA CARRERA: el `if (data.cfdi_uuid)` de arriba es una lectura en
  // memoria y no protege de nada contra otra corrida simultánea. Quien no gane
  // el claim se va sin abrir el navegador.
  if (!(await reclamarIntento(admin, args.gastoId, args.tenantId, args.ahora))) {
    logger.info('autofactura.ya_en_proceso', { gastoId: args.gastoId });
    return { intentado: false, facturado: false, motivo: 'ya_en_proceso' };
  }

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
    modo: modoEfectivo(args.modo ?? 'ensayo'),
  });

  // Un CAPTCHA, o un emitir que no se pudo confirmar, NO se reintentan: salen de
  // la cola automática y entran al camino de una persona. Va antes de los dos
  // returns de abajo porque los dos casos llegan con `ok:false`, y ahí "vuelve a
  // intentarlo la hora que viene" es la respuesta equivocada de las dos maneras:
  // contra un CAPTCHA no cambia nada, y tras un emitir sin confirmar duplica el
  // CFDI.
  const bloqueo = motivoDeBloqueo(r);
  if (bloqueo) {
    const guardado = await bloquear(admin, args.gastoId, args.tenantId, bloqueo, args.ahora);
    return {
      intentado: true, facturado: false, motivo: 'bloqueado',
      detalle: r.error, bloqueado: guardado, capturado: r.capturado, captura: r.captura,
    };
  }

  if (!r.ok) {
    logger.warn('autofactura.fallo', { gastoId: args.gastoId, error: r.error });
    return { intentado: true, facturado: false, detalle: r.error, capturado: r.capturado, captura: r.captura };
  }
  // UN ENSAYO EXITOSO NO ES UN FALLO — y por eso este `return` va DESPUÉS del de
  // arriba y no antes: en `ensayo` el agente llena el portal y se detiene, así
  // que devuelve `ok:true` SIN `cfdiUuid`. Con la condición al revés
  // (`!r.ok || !r.cfdiUuid`) el camino normal caía al log de fallos con
  // `error: undefined`, y quien fuera a averiguar "por qué no se factura nada"
  // encontraba fallos que no ocurrieron.
  if (!r.cfdiUuid) {
    logger.info('autofactura.ensayo', { gastoId: args.gastoId, capturado: Object.keys(r.capturado).length });
    return {
      intentado: true, facturado: false,
      detalle: 'ensayo: se llenó el portal y no se emitió',
      capturado: r.capturado, captura: r.captura,
    };
  }

  // El CFDI YA EXISTE en el portal. Si guardarlo falla, se loguea fuerte y se
  // devuelve como facturado igual: perder el UUID en nuestra base es un
  // problema de registro; volver a facturar es un problema fiscal del cliente.
  const guardado = await escribirUuid(admin, args.tenantId, args.gastoId, r.cfdiUuid, 1, args.ahora);

  logger.info('autofactura.ok', { gastoId: args.gastoId, uuid: r.cfdiUuid });
  return {
    intentado: true, facturado: true, cfdiUuid: r.cfdiUuid,
    capturado: r.capturado, captura: r.captura,
    ...(guardado ? { bloqueado: guardado } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL LOTE: TODOS LOS TICKETS DE UN PORTAL Y UNA FLOTA, EN UNA SESIÓN.
//
// Es el mismo procedimiento de `facturarAlVuelo` —releer, sellar, decidir,
// facturar, guardar— con dos diferencias que no son cosméticas:
//
//   1. LA SESIÓN SE PAGA UNA VEZ. Ocho casetas eran ocho sesiones idénticas
//      contra el mismo portal: ~1.2 s cada una en llenar los datos fiscales, y
//      —lo que de verdad importa— ocho veces el patrón que hace que un portal
//      empiece a pedir CAPTCHA.
//   2. UN UUID PUEDE CAER SOBRE VARIOS GASTOS. CAPUFE emite UNA factura con
//      todos los códigos, así que las ocho filas comparten `cfdi_uuid` y se
//      distinguen por `cfdi_orden` (mig. 0065). Ver `escribirUuid`.
//
// LO QUE NO CAMBIA: la decisión sigue siendo POR GASTO. Un ticket de confianza
// baja no entra al lote aunque sus siete hermanos sí; el portal solo ve los que
// pasaron el filtro. Mezclar eso sería facturar una lectura que nadie validó
// por ir en el mismo viaje que otras siete que sí.
// ═══════════════════════════════════════════════════════════════════════════

export interface ResultadoLoteAutofactura {
  /** Uno por gasto pedido, en el mismo orden. */
  porGasto: Array<ResultadoAutofactura & { gastoId: string }>;
  /** Cuántos gastos quedaron con CFDI. */
  facturados: number;
  /** Los que salieron de la cola automática en ESTA corrida, con su motivo. */
  bloqueados: Array<{ gastoId: string; motivo: string }>;
  /** El UUID de la factura del lote, cuando el portal emitió una sola. */
  cfdiUuid?: string;
  /** La pantalla del portal. Una por sesión, no una por ticket. */
  captura?: string;
  capturado?: Record<string, string>;
  error?: string;
  aviso?: string;
}

export async function facturarLoteAlVuelo(args: {
  tenantId: string;
  comercio: string;
  gastoIds: string[];
  modo?: 'ensayo' | 'emitir';
  hoy?: string;
  ahora?: string;
}): Promise<ResultadoLoteAutofactura> {
  const admin = supabaseAdmin();
  const hoy = args.hoy ?? new Date().toISOString().slice(0, 10);
  const porGasto: Array<ResultadoAutofactura & { gastoId: string }> = [];
  const bloqueados: Array<{ gastoId: string; motivo: string }> = [];

  if (args.gastoIds.length === 0) return { porGasto: [], facturados: 0, bloqueados: [] };

  const { data, error } = await admin
    .from('gasto')
    .select(COLUMNAS)
    .eq('tenant_id', args.tenantId)
    .in('id', args.gastoIds);

  if (error) {
    // NO se sella nada: la base no contestó, así que no se sabe siquiera si
    // estas filas existen. Sellar aquí empujaría al final de la cola algo que
    // quizá está perfectamente listo para facturarse.
    logger.error('autofactura.lote.sin_leer', { tenant: args.tenantId, err: error.message });
    return {
      porGasto: args.gastoIds.map((gastoId) => ({ gastoId, intentado: false, facturado: false, detalle: error.message })),
      facturados: 0, bloqueados: [], error: error.message,
    };
  }

  type Fila = Parameters<typeof armar>[0] & { ocr_confianza: number | null };
  const filas = new Map<string, Fila>();
  for (const f of (data ?? []) as Fila[]) filas.set(f.id, f);

  // ── El claim, para TODOS los que se pudieron leer y no están facturados.
  // Va en UN update y ANTES de decidir nada, por lo mismo que en el camino de
  // uno: si el portal revienta a media sesión, los que no se alcanzaron a
  // intentar ya no acaparan el lote de la corrida siguiente.
  //
  // `ganados` es el lote REAL de esta corrida. Lo que no esté ahí lo tomó otro
  // proceso y no se toca: el portal se abre una sola vez por ticket.
  const aSellar = [...filas.values()].filter((f) => !f.cfdi_uuid).map((f) => f.id);
  const ganados = await reclamarIntentos(admin, aSellar, args.tenantId, args.ahora);

  const tickets: TicketDeLote[] = [];
  const ticketPorGasto = new Map<string, TicketPorFacturar>();

  for (const gastoId of args.gastoIds) {
    const f = filas.get(gastoId);
    if (!f) {
      porGasto.push({ gastoId, intentado: false, facturado: false, detalle: 'no existe en esta flota' });
      continue;
    }
    if (f.cfdi_uuid) {
      porGasto.push({ gastoId, intentado: false, facturado: false, motivo: 'ya_facturado' });
      continue;
    }
    if (!ganados.has(gastoId)) {
      // Otra corrida lo tomó entre la lectura del lote y el claim.
      logger.info('autofactura.ya_en_proceso', { gastoId });
      porGasto.push({ gastoId, intentado: false, facturado: false, motivo: 'ya_en_proceso' });
      continue;
    }

    const t = armar(f, hoy);
    ticketPorGasto.set(gastoId, t);
    const decision = decidirAutofactura(
      t,
      f.ocr_confianza === null ? null : Number(f.ocr_confianza),
      t.comercio ? adaptadorDe(args.tenantId, t.comercio.clave) !== null : false,
    );

    if (!decision.procede) {
      logger.info('autofactura.no_procede', { gastoId, motivo: decision.motivo });
      porGasto.push({ gastoId, intentado: false, facturado: false, motivo: decision.motivo, detalle: decision.detalle });
      continue;
    }
    // El comercio del ticket TIENE que ser el del lote. Si no lo es, este gasto
    // se mandaría al portal equivocado con los campos de otro: se descarta y se
    // grita, porque significa que quien armó el lote y `armar()` no coinciden.
    if (t.comercio?.clave !== args.comercio) {
      logger.error('autofactura.lote.comercio_ajeno', { gastoId, esperado: args.comercio, trae: t.comercio?.clave });
      porGasto.push({ gastoId, intentado: false, facturado: false, detalle: `este gasto es de "${t.comercio?.clave ?? 'sin portal'}" y el lote es de "${args.comercio}"` });
      continue;
    }
    tickets.push({ gastoId, campos: t.campos });
  }

  if (tickets.length === 0) return { porGasto, facturados: 0, bloqueados };

  const r = await facturarLoteConAgente({
    tenantId: args.tenantId,
    comercio: args.comercio,
    tickets,
    modo: modoEfectivo(args.modo ?? 'ensayo'),
  });

  // ── El reparto del UUID. `cfdi_orden` va 1..N EN EL ORDEN EN QUE ENTRARON al
  // portal, que es el único orden que nos consta (ver mig. 0065).
  const ordenPorUuid = new Map<string, number>();
  const bloqueoDelLote = motivoDeBloqueo(r);

  for (const p of r.porGasto) {
    const propio = await guardarUno(admin, args, p, r.error, ordenPorUuid, bloqueoDelLote);
    porGasto.push({ gastoId: p.gastoId, ...propio });
    if (propio.bloqueado) bloqueados.push({ gastoId: p.gastoId, motivo: propio.bloqueado });
  }

  logger.info('autofactura.lote', {
    tenant: args.tenantId, comercio: args.comercio, modo: r.modo,
    pedidos: args.gastoIds.length, alPortal: tickets.length,
    facturados: porGasto.filter((x) => x.facturado).length, bloqueados: bloqueados.length,
  });

  return {
    porGasto,
    facturados: porGasto.filter((x) => x.facturado).length,
    bloqueados,
    cfdiUuid: r.porGasto.find((p) => p.cfdiUuid)?.cfdiUuid,
    captura: r.captura,
    capturado: r.capturado,
    ...(r.error ? { error: r.error } : {}),
    ...(r.aviso ? { aviso: r.aviso } : {}),
  };
}

/** Lo que le pasa a UN gasto después de que el portal contestó. */
async function guardarUno(
  admin: ReturnType<typeof supabaseAdmin>,
  args: { tenantId: string; ahora?: string },
  p: ResultadoPorGasto,
  errorDelLote: string | undefined,
  ordenPorUuid: Map<string, number>,
  bloqueoDelLote: string | null,
): Promise<ResultadoAutofactura> {
  // El bloqueo es DEL LOTE: un CAPTCHA no le pasó a un código, le pasó a la
  // sesión, y una emisión sin confirmar deja en duda a todos los que iban en esa
  // factura. Sacar solo a uno dejaría a los otros siete volviendo cada hora
  // contra el mismo muro —o, peor, emitiendo un segundo CFDI de lo mismo.
  if (bloqueoDelLote) {
    const guardado = await bloquear(admin, p.gastoId, args.tenantId, bloqueoDelLote, args.ahora);
    return { intentado: true, facturado: false, motivo: 'bloqueado', detalle: p.motivo ?? errorDelLote, bloqueado: guardado };
  }

  if (!p.incluido || !p.cfdiUuid) {
    return {
      intentado: true, facturado: false,
      detalle: p.motivo ?? errorDelLote ?? (p.incluido ? 'ensayo: entró al portal y no se emitió' : 'no entró a la factura'),
    };
  }

  const orden = (ordenPorUuid.get(p.cfdiUuid) ?? 0) + 1;
  ordenPorUuid.set(p.cfdiUuid, orden);
  const guardado = await escribirUuid(admin, args.tenantId, p.gastoId, p.cfdiUuid, orden, args.ahora);

  return {
    intentado: true, facturado: true, cfdiUuid: p.cfdiUuid,
    ...(p.motivo ? { detalle: p.motivo } : {}),
    ...(guardado ? { bloqueado: guardado } : {}),
  };
}

/**
 * Escribe el folio del CFDI sobre un gasto. Devuelve el motivo de bloqueo si NO
 * se pudo, y `null` si quedó guardado.
 *
 * EL CFDI YA EXISTE cuando esto corre. Por eso un fallo aquí no se traga ni se
 * reintenta: se saca al gasto de la cola automática. Un gasto facturado en el
 * portal y sin `cfdi_uuid` en nuestra base vuelve a salir elegido la hora
 * siguiente, y entonces se emite un SEGUNDO CFDI por el mismo consumo — que es
 * dinero real que alguien tiene que cancelar y, fuera de plazo, ya no puede.
 *
 * Los dos fallos que de verdad pasan:
 *  · `CU001` — el viaje ya se liquidó (mig. 0037): la base no deja pegarle el
 *    folio a un gasto cuya liquidación ya se imprimió.
 *  · `23505` en `uq_gasto_cfdi_uuid` — ese (uuid, orden) ya está puesto: o se
 *    reintentó un lote que ya se guardó, o llegó por otro camino.
 */
async function escribirUuid(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  gastoId: string,
  uuid: string,
  orden: number,
  ahora?: string,
): Promise<string | null> {
  const { error } = await admin
    .from('gasto')
    .update({ cfdi_uuid: uuid, cfdi_orden: orden })
    .eq('id', gastoId)
    // Acotado por tenant además de por id, aunque quien llama ya probó que la
    // fila es de esta flota. Cuesta nada y cierra el camino de que un `gastoId`
    // que venga de fuera escriba un UUID en la fila de otra empresa.
    .eq('tenant_id', tenantId);

  if (!error) return null;

  logger.error('autofactura.uuid_sin_guardar', { gastoId, uuid, orden, err: error.message });
  const porQue = llegoTarde(error)
    ? `el CFDI ${uuid} YA SE EMITIÓ en el portal y no se pudo guardar aquí: el viaje ya está liquidado y su PDF ya salió, así que la base no deja tocarle el folio (CU001). Hay que pegárselo a mano y reemitir la liquidación`
    : violaIndice(error, 'uq_gasto_cfdi_uuid')
      ? `el CFDI ${uuid} YA SE EMITIÓ y otro gasto de esta flota ya lo tiene con el mismo orden (${orden}). Revisar cuál de los dos es el bueno antes de tocar nada`
      : `el CFDI ${uuid} YA SE EMITIÓ en el portal y no se pudo guardar aquí (${error.message}). Hay que pegárselo a mano`;

  const guardado = await bloquear(admin, gastoId, tenantId, porQue, ahora);
  return guardado;
}

/**
 * Saca un gasto de la cola automática, con el motivo por escrito.
 *
 * NO lo esconde: sigue saliendo en `getPorFacturar` —o sea en la pantalla de
 * "por facturar"— y `enrutar()` lo manda con una persona. Lo único que cambia es
 * que el cron deja de elegirlo (`gasto_por_facturar_idx` lo excluye) y que
 * `decidirAutofactura` lo rechaza aunque alguien lo vuelva a mandar a mano.
 *
 * Devuelve SIEMPRE el motivo, aunque el guardado falle: quien llama tiene que
 * poder decirlo en su reporte. Si no se pudo guardar se dice en el log, porque
 * la consecuencia —el ticket vuelve a la cola la hora que viene— es exactamente
 * lo que esto existe para evitar.
 */
async function bloquear(
  admin: ReturnType<typeof supabaseAdmin>,
  gastoId: string,
  tenantId: string,
  motivo: string,
  ahora?: string,
): Promise<string> {
  const { error } = await admin
    .from('gasto')
    .update({
      autofactura_bloqueada_en: ahora ?? new Date().toISOString(),
      // Acotado: es una columna de texto que acaba en un mensaje de WhatsApp y
      // en la pantalla del contralor, no un volcado de error.
      autofactura_bloqueo: motivo.slice(0, 500),
    })
    .eq('id', gastoId)
    .eq('tenant_id', tenantId);

  if (error) logger.error('autofactura.bloqueo_sin_guardar', { gastoId, motivo, err: error.message });
  else logger.warn('autofactura.bloqueado', { gastoId, motivo });

  return motivo;
}

/**
 * ¿Este resultado hay que sacarlo de la cola automática? Y con qué palabras.
 *
 * Los dos casos son "no se puede", no "no pude", y por eso se leen de BANDERAS y
 * no del texto del error: un mensaje se reescribe y el que lo reescriba no tiene
 * por qué saber que alguien lo estaba interpretando.
 */
function motivoDeBloqueo(r: { requiereCaptcha?: boolean; emisionSinConfirmar?: boolean; error?: string }): string | null {
  if (pideCaptcha(r)) {
    return `el portal pidió CAPTCHA, así que lo tiene que facturar una persona. Reintentarlo no lo va a cambiar${r.error ? ` — ${r.error}` : ''}`;
  }
  if (r.emisionSinConfirmar) {
    return `SE APRETÓ EMITIR Y NO SE PUDO CONFIRMAR EL FOLIO: puede que el CFDI ya exista. Hay que mirarlo en el portal antes de volver a intentar — un segundo intento lo duplicaría${r.error ? ` — ${r.error}` : ''}`;
  }
  return null;
}

/** Lo que las dos rutas leen de `gasto`. Una sola lista: dos se desincronizan. */
const COLUMNAS =
  'id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, ocr_extra, ocr_confianza, autofactura_bloqueada_en, autofactura_bloqueo';

/**
 * CUÁNTO DURA UN CLAIM antes de que se pueda volver a tomar el ticket.
 *
 * Tiene que ser MUY mayor que la sesión de portal más lenta (10-60 s) para que
 * dos corridas simultáneas no se pisen, y MUY menor que el periodo del cron
 * (una hora, `vercel.json`) para que un proceso que muere a media sesión no deje
 * el ticket congelado más de una vuelta. Diez minutos cumple las dos con margen.
 */
const CLAIM_MINUTOS = 10;

/**
 * Toma el ticket para ESTA corrida. Devuelve `true` solo si lo ganó.
 *
 * ANTES ERA UN SELLO, Y EL SELLO NO ERA UNA CARRERA. El candado contra el doble
 * CFDI era `if (data.cfdi_uuid)` en memoria, y entre esa lectura y la escritura
 * del UUID hay una sesión de navegador de 10-60 s. Vercel Cron entrega
 * at-least-once, así que dos corridas solapadas leían las dos `cfdi_uuid IS
 * NULL`, las dos sellaban, las dos manejaban el portal y las dos emitían: DOS
 * CFDI del mismo ticket, con el SAT ya enterado. Hoy lo tapa que el modo por
 * defecto es `ensayo` — o sea que el defecto se estrena justo el día que se
 * pone en `emitir`, que es el día que importa.
 *
 * Ahora la carrera la decide Postgres. El UPDATE es condicional y devuelve
 * filas: la condición incluye `autofactura_intentada_en` viejo o nulo, que es
 * justo la columna que el propio UPDATE pisa, así que el primero en llegar deja
 * a los demás sin filas que actualizar. Si no devuelve, otro proceso lo tomó.
 *
 * Se conserva el efecto que la 0063 buscaba —ordenar la cola para que los
 * gastos que no proceden no acaparen el lote— porque el claim se toma ANTES de
 * decidir y se queda puesto proceda o no.
 */
async function reclamarIntentos(
  admin: ReturnType<typeof supabaseAdmin>,
  gastoIds: string[],
  tenantId: string,
  ahora?: string,
): Promise<Set<string>> {
  if (gastoIds.length === 0) return new Set();
  // Se normaliza a la forma `…Z`: un `+00:00` dentro de un filtro `or` de
  // PostgREST viaja en la query string, y ahí el `+` se lee como espacio.
  const t = new Date(ahora ?? Date.now()).toISOString();
  const vencido = new Date(Date.parse(t) - CLAIM_MINUTOS * 60_000).toISOString();

  const { data, error } = await admin
    .from('gasto')
    .update({ autofactura_intentada_en: t })
    .in('id', gastoIds)
    .eq('tenant_id', tenantId)
    // Las dos condiciones que ya decidían si valía la pena tocarlo, ahora
    // dentro de la carrera y no antes de ella.
    .is('cfdi_uuid', null)
    .is('autofactura_bloqueada_en', null)
    .or(`autofactura_intentada_en.is.null,autofactura_intentada_en.lt.${vencido}`)
    .select('id');

  if (error) {
    // Se falla CERRADO: sin claim confirmado no se toca el portal. Antes un
    // fallo aquí solo dejaba un `warn` y el intento seguía — que es exactamente
    // como se emite el segundo CFDI.
    logger.warn('autofactura.claim_sin_guardar', { gastoId: gastoIds.join(','), err: error.message });
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { id: string }).id));
}

/** El claim de un solo gasto. */
async function reclamarIntento(
  admin: ReturnType<typeof supabaseAdmin>,
  gastoId: string,
  tenantId: string,
  ahora?: string,
): Promise<boolean> {
  return (await reclamarIntentos(admin, [gastoId], tenantId, ahora)).has(gastoId);
}
