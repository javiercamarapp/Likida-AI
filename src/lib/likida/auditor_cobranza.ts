import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
import { traerTodo, traerPorIds, conteo } from './pg';
// Los ladrillos del criterio se IMPORTAN, no se reimplementan: `aNumero` es lo
// que impide que un `ingreso_flete` sin capturar entre como $0, `sumarOCallar`
// lo que impide un total al que le faltó un renglón, y `resumirCobro` la ÚNICA
// definición de "facturado" y "cobrado" por viaje. Una segunda copia de
// cualquiera de los tres haría que esta pantalla y el libro del viaje dijeran
// cosas distintas del mismo dinero.
import {
  aNumero, sumarOCallar, diasEntre, contribucion, margenPct, resumirCobro,
  TOLERANCIA_CENTAVO, type FacturaDelViaje, type Cobro,
} from './libro_viaje';
// La resolución de tarifa YA EXISTE y es pura (`tarifaSugerida`, clientes.ts):
// vigencia, especificidad, ambigüedad y unidades. Reproducirla aquí —o en
// SQL— crearía dos verdades sobre qué precio rige, y el auditor acusaría
// discrepancias contra una tarifa que el cotizador no elegiría.
import { tarifaSugerida, type TarifaRow } from './clientes';
// El día del calendario MEXICANO de un timestamptz (el hito de descarga se
// sella de noche, y el día UTC lo corre al siguiente). Misma lección que
// documenta `diaMx` donde vive.
import { diaMx } from './facturacion_clientes';
// `round2` y `mxn` se IMPORTAN: hay una prueba en formato.test.ts que falla si
// aparece otra copia del formato de cifras.
import { round2, hoyMx, mxn } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// EL AUDITOR DE COBRANZA — el cruce pactado / entregado / facturado / cobrado.
//
// La ficha (§8.2 del mapa de agentes): antes de que una factura salga al
// cliente, cruzarla contra la tarifa pactada; detectar cobrar-de-menos, lo
// entregado que nadie facturó, y los POD faltantes que van a atorar el pago;
// presentar la lista al contralor. La corrección la firma el humano — este
// módulo PROPONE, jamás emite ni cancela un CFDI, ni toca la tarifa.
//
// ── LAS CUATRO PATAS DEL CRUCE, Y DE DÓNDE SALE CADA UNA ──────────────────
//
//   PACTADO   → `viaje.ingreso_flete` si está capturado (el precio negociado
//               de ESE viaje gana, mismo criterio que `admiteSugerencia`), y
//               si no, la tarifa del catálogo vía `tarifaSugerida`.
//   ENTREGADO → el POD subido (0047) o el hito de descarga sellado (0090).
//   FACTURADO → las facturas del viaje (directas + `factura_viaje`), con el
//               criterio de `resumirCobro`: viva ≠ borrador ≠ cancelada.
//   COBRADO   → los pagos, vía la vista `factura_saldo` (0049) — el saldo se
//               deriva, nunca se guarda.
//
// ── EL PACTADO SE COMPARA CONTRA EL SUBTOTAL, NO CONTRA EL TOTAL ───────────
//
// `ingreso_flete` y `tarifa.precio` son el precio del FLETE; el total de la
// factura es subtotal + IVA, y el IVA no es ingreso de la flota — se traslada
// al SAT. Comparar contra el total acusaría un "cobrado de más" del 16% en
// cada factura correcta, y ese ruido entierra las discrepancias reales.
//
// ── LO QUE ESTE MÓDULO NO REPITE ───────────────────────────────────────────
//
// "Liquidado y sin facturar" ya vive en `facturacion_clientes.ts` (la mesa).
// La cubeta de aquí es ANTERIOR y distinta: ENTREGADO sin facturar — el POD o
// el hito de descarga existen y la factura no. Es la señal más temprana del
// dinero dormido: la entrega ya ocurrió aunque nadie haya cerrado la
// liquidación todavía.
//
// ── FAIL-CLOSED EN TODAS LAS REGLAS ────────────────────────────────────────
//
// Sin tarifa no hay un pactado de $0: hay una cubeta que pide capturarla. Una
// factura que ampara varios viajes no se le atribuye a uno (sus importes
// saldrían N veces mejores): tiene cubeta propia que lo dice. Un subtotal que
// no se pudo leer no se compara. La misma regla de todo el producto: una
// cifra o es un conteo real de la base, o no se muestra.
//
// ── EL ESCALÓN SIGUIENTE, DICHO ────────────────────────────────────────────
//
// Esta v1 lee la ventana con `traerTodo`/`traerPorIds` (lanza en vez de
// truncar). La ventana por defecto (30 días, `VENTANA_AUDITOR_DIAS`) acota el
// volumen al ritmo de captura real; a 50k viajes/mes el techo de 100,000
// filas de `traerTodo` queda con margen. El día que la ventana necesite
// crecer, el camino es la RPC agregada (patrón 0152) — no quitarle el techo a
// la lectura.
// ═══════════════════════════════════════════════════════════════════════════

/** La ventana por defecto del auditor, en días. Acota el volumen (ver el
 *  encabezado) y es lo que la pantalla rotula: la cifra es DE LA VENTANA. */
export const VENTANA_AUDITOR_DIAS = 30;

/**
 * La ventana [hoy − días, hoy], en fechas de calendario. PURA: recibe el `hoy`
 * en vez de leer el reloj — la página le pasa `hoyMx()` y las pruebas lo
 * fijan. La resta se hace en UTC sobre la medianoche del string: un día del
 * calendario no tiene zona, y dársela lo correría (misma lección que
 * `diasEntre`).
 */
export function ventanaAuditor(hoy: string, dias: number = VENTANA_AUDITOR_DIAS): { desde: string; hasta: string } {
  const ms = Date.parse(`${hoy}T00:00:00Z`) - dias * 86_400_000;
  return { desde: new Date(ms).toISOString().slice(0, 10), hasta: hoy };
}

export type CubetaAuditor =
  /** Se facturó menos que lo pactado: cobrar-de-menos, el hallazgo central. */
  | 'facturado_menor'
  /** Se facturó más que lo pactado: también se dice — puede ser un accesorio
   *  legítimo sin desglosar o un error que el cliente va a rebotar. */
  | 'facturado_mayor'
  /** Hay evidencia de entrega (POD o hito de descarga) y ninguna factura viva:
   *  el dinero dormido. La señal más temprana, anterior a la liquidación. */
  | 'entregado_sin_facturar'
  /** Hay factura viva y el POD no está subido: el papel que el cliente va a
   *  exigir para pagar. */
  | 'facturado_sin_pod'
  /** El cliente abonó y quedó saldo: cobro a medias. */
  | 'cobrado_parcial'
  /** Ninguna tarifa aplica y el ingreso no está capturado: no hay contra qué
   *  auditar. Pide capturar, no afirma un cero. */
  | 'sin_tarifa'
  /** La tarifa aplica pero su unidad exige un dato del viaje que falta
   *  (km / toneladas): tampoco se inventa el monto. */
  | 'tarifa_sin_monto'
  /** Alguna factura ampara varios viajes: sus importes no son de éste y el
   *  cruce monetario no se afirma. */
  | 'factura_compartida';

/** Rótulo y ayuda de cada cubeta, EN EL ORDEN EN QUE SE PINTAN. Viven aquí
 *  para que digan lo mismo en cada pantalla que las muestre. */
export const CUBETAS_AUDITOR: ReadonlyArray<{ clave: CubetaAuditor; rotulo: string; ayuda: string }> = [
  { clave: 'facturado_menor', rotulo: 'Facturado de menos', ayuda: 'La factura suma menos que lo pactado con el cliente' },
  { clave: 'entregado_sin_facturar', rotulo: 'Entregado sin facturar', ayuda: 'Hay prueba de entrega y ninguna factura viva: dinero dormido' },
  { clave: 'facturado_sin_pod', rotulo: 'Facturado sin POD', ayuda: 'El cliente va a pedir la prueba de entrega para pagar' },
  { clave: 'cobrado_parcial', rotulo: 'Cobrado en parte', ayuda: 'Hubo abonos y queda saldo' },
  { clave: 'facturado_mayor', rotulo: 'Facturado de más', ayuda: 'La factura suma más que lo pactado: accesorio sin desglosar, o error' },
  { clave: 'sin_tarifa', rotulo: 'Sin tarifa capturada', ayuda: 'Ni ingreso capturado ni tarifa aplicable: captura una para poder auditar' },
  { clave: 'tarifa_sin_monto', rotulo: 'Tarifa sin monto', ayuda: 'La tarifa aplica pero le falta un dato del viaje (km o toneladas)' },
  { clave: 'factura_compartida', rotulo: 'Factura compartida', ayuda: 'Una factura ampara varios viajes: sus importes no se atribuyen a uno' },
];

/** Una factura del viaje CON su subtotal — lo que el cruce compara. El resto
 *  de campos son los de `FacturaDelViaje` para que `resumirCobro` la lea. */
export interface FacturaAuditada extends FacturaDelViaje {
  /** `factura_emitida.subtotal`. `null` = no se pudo leer; no se compara. */
  subtotal: number | null;
}

/** Lo que el motor necesita de UN viaje, ya leído. Separado de la consulta
 *  para que cada cubeta se pruebe sin base de datos. */
export interface ViajeParaAuditar {
  id: string;
  folio: string | null;
  clienteId: string | null;
  /** Nombre resuelto para pantalla. `null` = viaje sin cliente asignado. */
  cliente: string | null;
  origen: string | null;
  destino: string | null;
  /** `viaje.fecha_inicio` (date). Contra ella se juzga la vigencia de tarifa. */
  fechaInicio: string | null;
  /** Crudo a propósito: `aNumero` es quien decide si hay dato. */
  ingresoFlete: unknown;
  kmRecorridos: number | null;
  /** `pod.estado = 'subido'` (0047). Pendiente o rechazado NO es entregado. */
  podSubido: boolean;
  /** El hito "estoy descargando" (0090), timestamptz. */
  descargaEn: string | null;
  /** `null` = sin liquidación. Distinto de una con total 0 (medido). */
  liquidacion: { totalComprobado: unknown } | null;
  facturas: ReadonlyArray<FacturaAuditada>;
}

/** De dónde salió el pactado — la nota lo cita, porque no pesa igual un precio
 *  tecleado en el viaje que uno resuelto del catálogo. */
export interface Pactado {
  monto: number;
  origen: 'capturado' | 'tarifa';
  /** Por qué ese monto, en palabras de pantalla. */
  porque: string;
}

/** El pactado del viaje, o el motivo exacto por el que no lo hay. */
export type ResultadoPactado =
  | { pactado: Pactado; motivo: null; falta: null }
  | { pactado: null; motivo: 'sin_tarifa' | 'tarifa_sin_monto'; falta: 'km' | 'toneladas' | null };

/**
 * Resuelve el pactado del viaje. El precio CAPTURADO gana sobre el catálogo —
 * mismo criterio que `admiteSugerencia` (ingreso_viaje.ts): sobreescribir un
 * monto tecleado con el de la lista borraría justo lo que distingue al viaje,
 * el precio negociado. Un 0 tecleado es un pactado de $0 (la cortesía), no un
 * hueco.
 *
 * La vigencia de la tarifa se juzga contra `fecha_inicio`; si el viaje no la
 * tiene, contra `hoy` — es el único día que se tiene, y la nota de la
 * sugerencia ya dice qué tarifa ganó para que el contralor la verifique.
 */
export function resolverPactado(v: ViajeParaAuditar, tarifas: readonly TarifaRow[], hoy: string): ResultadoPactado {
  const capturado = aNumero(v.ingresoFlete);
  if (capturado !== null) {
    return {
      pactado: { monto: round2(capturado), origen: 'capturado', porque: 'Ingreso capturado en el viaje' },
      motivo: null,
      falta: null,
    };
  }
  const s = tarifaSugerida(tarifas, {
    clienteId: v.clienteId,
    origen: v.origen,
    destino: v.destino,
    km: v.kmRecorridos,
    fecha: v.fechaInicio ?? hoy,
  });
  if (s === null) return { pactado: null, motivo: 'sin_tarifa', falta: null };
  if (s.monto === null) return { pactado: null, motivo: 'tarifa_sin_monto', falta: s.falta };
  return {
    pactado: {
      monto: s.monto,
      origen: 'tarifa',
      // `ambigua` se arrastra a la nota: el catálogo tiene dos verdades y el
      // contralor tiene que saberlo antes de reclamar una diferencia.
      porque: s.ambigua ? `${s.porque} — ojo: hay otra tarifa igual de específica con otro precio` : s.porque,
    },
    motivo: null,
    falta: null,
  };
}

/** Un hallazgo de la cola: la regla que disparó, el dinero en juego (o `null`
 *  cuando no se puede cifrar sin inventar) y la nota citable. */
export interface HallazgoAuditor {
  viajeId: string;
  folio: string;
  ruta: string | null;
  cliente: string | null;
  cubeta: CubetaAuditor;
  /** El monto en juego de ESA regla. `null` = no se puede cifrar con lo capturado. */
  monto: number | null;
  /** La nota citable: qué se cruzó, contra qué, y qué acción pide. */
  nota: string;
}

/** El margen REAL del viaje: pactado contra gastos liquidados. Es el argumento
 *  del modelo de margen fijo — se mide, no se promete. */
export interface MargenViaje {
  /** El pactado (capturado o tarifa). `null` = no se pudo resolver. */
  pactado: number | null;
  /** `liquidacion.total_comprobado`. `null` = sin liquidación, NO cero. */
  comprobado: number | null;
  margen: number | null;
  margenPct: number | null;
  /** Qué falta para poder medirlo. `null` = no falta nada. */
  falta: string | null;
}

export interface AuditoriaViaje {
  viajeId: string;
  /** Con respaldo `id.slice(0, 8)`: un renglón sin encabezado no se puede
   *  citar por teléfono (mismo criterio que `armarRenglon`). */
  folio: string;
  ruta: string | null;
  cliente: string | null;
  pactado: Pactado | null;
  cobro: Cobro;
  margen: MargenViaje;
  hallazgos: HallazgoAuditor[];
}

/**
 * Audita UN viaje: corre las reglas y devuelve sus hallazgos con nota citable.
 * PURA: el catálogo y el `hoy` entran por parámetro — cada cubeta se prueba
 * sin base y sin reloj.
 */
export function auditarViaje(v: ViajeParaAuditar, tarifas: readonly TarifaRow[], hoy: string): AuditoriaViaje {
  const cobro = resumirCobro(v.facturas, hoy);
  const ruta = v.origen && v.destino ? `${v.origen} → ${v.destino}` : v.origen ?? v.destino ?? null;
  const folio = v.folio ?? v.id.slice(0, 8);
  const hallazgos: HallazgoAuditor[] = [];
  const anotar = (cubeta: CubetaAuditor, monto: number | null, nota: string) => {
    hallazgos.push({ viajeId: v.id, folio, ruta, cliente: v.cliente, cubeta, monto, nota });
  };

  const vivas = v.facturas.filter((f) => f.estatus !== 'borrador' && f.estatus !== 'cancelada');
  const borradores = v.facturas.filter((f) => f.estatus === 'borrador');
  const entregado = v.podSubido || v.descargaEn !== null;
  const evidenciaEntrega = v.podSubido
    ? (v.descargaEn !== null ? 'el POD está subido y el hito de descarga sellado' : 'el POD está subido')
    : 'el hito de descarga está sellado';

  const r = resolverPactado(v, tarifas, hoy);

  // ── Sin pactado no hay cruce, y se dice UNA vez ──────────────────────────
  // La cubeta solo se emite cuando el cruce se NECESITABA: hay algo facturado
  // que comparar, o algo entregado cuyo monto proponer. Un viaje sin tarifa y
  // sin actividad todavía no le pide nada a nadie, y llenar la cola con él
  // enterraría los hallazgos con dinero enfrente.
  const cruceNecesario = vivas.length > 0 || borradores.length > 0 || entregado;
  if (r.pactado === null && cruceNecesario) {
    if (r.motivo === 'sin_tarifa') {
      anotar('sin_tarifa', null,
        'Ni el viaje tiene ingreso capturado ni hay tarifa aplicable en el catálogo: no hay contra qué auditar lo facturado. Captura la tarifa del cliente (o el ingreso del viaje) y este cruce se enciende solo.');
    } else {
      anotar('tarifa_sin_monto', null,
        r.falta === 'km'
          ? 'La tarifa aplicable cobra por kilómetro y el viaje no tiene los kilómetros capturados: sin ellos no se puede poner monto al pactado.'
          : 'La tarifa aplicable cobra por tonelada y el tonelaje no se captura en el viaje: sin él no se puede poner monto al pactado.');
    }
  }

  // ── Facturado vs pactado ─────────────────────────────────────────────────
  if (cobro.importesCompartidos) {
    // Una factura que ampara varios viajes pintaría sus importes completos en
    // este renglón (N veces mejores de lo que son). No se compara: se dice.
    anotar('factura_compartida', null,
      'Una factura de este viaje ampara varios viajes: sus importes no se pueden atribuir a uno solo, y el cruce contra lo pactado no se afirma. Revísala por factura, no por viaje.');
  } else if (r.pactado !== null) {
    // El borrador TAMBIÉN se audita — es el momento de la ficha: "antes de que
    // una factura salga al cliente". Corregir un borrador es gratis; corregir
    // una emitida es una refacturación.
    const base = vivas.length > 0 ? vivas : borradores;
    const enBorrador = vivas.length === 0 && borradores.length > 0;
    const subtotal = sumarOCallar(base.map((f) => f.subtotal));
    // Un subtotal que no se pudo leer no se compara: acusar una diferencia
    // sobre un dato ilegible es el error que este módulo no comete.
    if (base.length > 0 && subtotal !== null) {
      const diferencia = round2(subtotal - r.pactado.monto);
      const cierre = enBorrador
        ? 'Está en borrador: corrígelo antes de timbrar.'
        : 'Propón la corrección al contralor — la refacturación la firma el humano, este auditor no emite ni cancela CFDI.';
      if (diferencia < -TOLERANCIA_CENTAVO) {
        anotar('facturado_menor', round2(-diferencia),
          `Se ${enBorrador ? 'capturó en borrador' : 'facturó'} ${mxn(subtotal)} (subtotal, sin IVA) y lo pactado es ${mxn(r.pactado.monto)} (${r.pactado.porque.toLowerCase()}): faltan ${mxn(-diferencia)}. ${cierre}`);
      } else if (diferencia > TOLERANCIA_CENTAVO) {
        anotar('facturado_mayor', diferencia,
          `Se ${enBorrador ? 'capturó en borrador' : 'facturó'} ${mxn(subtotal)} (subtotal, sin IVA) y lo pactado es ${mxn(r.pactado.monto)} (${r.pactado.porque.toLowerCase()}): hay ${mxn(diferencia)} de más. Si es un accesorio (maniobra, estadía), desglósalo; si no, ${enBorrador ? 'corrige el borrador' : 'el cliente lo va a rebotar'}.`);
      }
    }
  }

  // ── Entregado sin facturar — el dinero dormido ───────────────────────────
  if (entregado && vivas.length === 0) {
    // Los días dormido se cuentan desde el día MEXICANO de la descarga. Con
    // solo POD no hay fecha confiable del evento y no se inventa.
    const dias = diasEntre(diaMx(v.descargaEn), hoy);
    const cuanto = dias !== null && dias > 0
      ? (dias === 1 ? ' desde ayer' : ` desde hace ${dias} días`)
      : '';
    const monto = r.pactado?.monto ?? null;
    const conBorrador = borradores.length > 0
      ? ' Hay un borrador empezado: termínalo y tímbralo.'
      : '';
    anotar('entregado_sin_facturar', monto,
      `La entrega ya ocurrió (${evidenciaEntrega})${cuanto} y no hay factura viva.${monto !== null ? ` Lo pactado es ${mxn(monto)} (${r.pactado!.porque.toLowerCase()}): eso es lo que está dormido.` : ' Sin pactado resoluble no se cifra cuánto — pero el viaje ya se entregó y nadie le ha pedido el dinero al cliente.'}${conBorrador}`);
  }

  // ── Facturado sin POD ────────────────────────────────────────────────────
  if (vivas.length > 0 && !v.podSubido) {
    // El dinero en juego es el SALDO (lo que va a atorarse), no el total: lo
    // ya pagado no se atora.
    const monto = cobro.saldo;
    anotar('facturado_sin_pod', monto,
      `Hay factura viva y el POD no está subido${v.descargaEn !== null ? ' (el hito de descarga sí está sellado: llegó, pero falta el papel)' : ''}. El cliente va a pedir la prueba de entrega para pagar${monto !== null && monto > TOLERANCIA_CENTAVO ? `: ${mxn(monto)} de saldo dependen de ese papel` : ''}. Pídesela al operador.`);
  }

  // ── Cobrado parcial ──────────────────────────────────────────────────────
  if (cobro.estadoCobro === 'parcial') {
    const vencidaDesde = cobro.diasVencida !== null
      ? ` y la más atrasada lleva ${cobro.diasVencida === 1 ? '1 día vencida' : `${cobro.diasVencida} días vencida`}`
      : '';
    anotar('cobrado_parcial', cobro.saldo,
      `El cliente abonó ${cobro.totalCobrado !== null ? mxn(cobro.totalCobrado) : 'una parte'} y quedan ${cobro.saldo !== null ? mxn(cobro.saldo) : 'un saldo'} por cobrar${vencidaDesde}. Un pago parcial sin seguimiento se vuelve el saldo que nadie reclama.`);
  }

  // ── Margen real — el argumento del margen fijo ───────────────────────────
  const pactadoMonto = r.pactado?.monto ?? null;
  const comprobado = v.liquidacion === null ? null : aNumero(v.liquidacion.totalComprobado);
  const margen = contribucion(pactadoMonto, comprobado);
  const faltaMargen =
    pactadoMonto === null && comprobado === null
      ? 'Faltan las dos mitades: el pactado (ingreso o tarifa) y la liquidación del viaje.'
      : pactadoMonto === null
        ? 'Falta el pactado: captura el ingreso del viaje o la tarifa del cliente.'
        : comprobado === null
          ? 'Falta cerrar la liquidación: sin ella no se sabe cuánto se gastó, y no se supone cero.'
          : null;

  return {
    viajeId: v.id,
    folio,
    ruta,
    cliente: v.cliente,
    pactado: r.pactado,
    cobro,
    margen: {
      pactado: pactadoMonto,
      comprobado,
      margen,
      margenPct: margenPct(pactadoMonto, margen),
      falta: faltaMargen,
    },
    hallazgos,
  };
}

// ── El resumen y la cola ───────────────────────────────────────────────────

export interface MargenAgregado {
  /** Sumas SOLO de los viajes con las dos mitades medidas. */
  pactado: number;
  comprobado: number;
  margen: number;
  /** `null` cuando no hay pactado medido: un % sobre 0 es división por cero. */
  margenPct: number | null;
  /** Cuántos viajes de la ventana tienen las dos mitades. */
  viajesMedidos: number;
  /** Cuántos NO — el tamaño del hueco, para que la cifra de arriba se lea
   *  como lo que es: el margen de lo MEDIDO, no de la flota. */
  viajesSinDato: number;
}

export interface ResumenAuditor {
  viajesAuditados: number;
  /** Conteo de hallazgos por cubeta. Las ocho claves siempre presentes. */
  porCubeta: Record<CubetaAuditor, number>;
  /** Suma de lo pactado en `entregado_sin_facturar` con monto conocido. */
  dineroDormido: number;
  /** Entregados sin facturar SIN monto resoluble: no entran a la suma y se
   *  dicen — el piso conocido no es la cifra completa. */
  dormidosSinMonto: number;
  /** Suma de las brechas de `facturado_menor`: el cobrar-de-menos cifrado. */
  brechaFacturadoDeMenos: number;
  margen: MargenAgregado;
}

function cubetasAuditorEnCero(): Record<CubetaAuditor, number> {
  return {
    facturado_menor: 0, facturado_mayor: 0, entregado_sin_facturar: 0,
    facturado_sin_pod: 0, cobrado_parcial: 0, sin_tarifa: 0,
    tarifa_sin_monto: 0, factura_compartida: 0,
  };
}

/** Agrega las auditorías de la ventana. PURA. */
export function resumirAuditoria(viajes: ReadonlyArray<AuditoriaViaje>): ResumenAuditor {
  const porCubeta = cubetasAuditorEnCero();
  let dineroDormido = 0, dormidosSinMonto = 0, brecha = 0;
  let pactado = 0, comprobado = 0, medidos = 0, sinDato = 0;

  for (const v of viajes) {
    for (const h of v.hallazgos) {
      porCubeta[h.cubeta]++;
      if (h.cubeta === 'entregado_sin_facturar') {
        if (h.monto === null) dormidosSinMonto++;
        else dineroDormido += h.monto;
      }
      if (h.cubeta === 'facturado_menor' && h.monto !== null) brecha += h.monto;
    }
    if (v.margen.pactado !== null && v.margen.comprobado !== null) {
      pactado += v.margen.pactado;
      comprobado += v.margen.comprobado;
      medidos++;
    } else {
      sinDato++;
    }
  }

  const margenTotal = round2(pactado - comprobado);
  return {
    viajesAuditados: viajes.length,
    porCubeta,
    dineroDormido: round2(dineroDormido),
    dormidosSinMonto,
    brechaFacturadoDeMenos: round2(brecha),
    margen: {
      pactado: round2(pactado),
      comprobado: round2(comprobado),
      margen: margenTotal,
      margenPct: pactado > 0 ? round2((margenTotal / pactado) * 100) : null,
      viajesMedidos: medidos,
      viajesSinDato: sinDato,
    },
  };
}

/**
 * La cola del contralor: todos los hallazgos, el dinero más grande arriba.
 * Un hallazgo sin monto va después de los cifrados —no se le inventa uno para
 * ordenarlo— y el folio desempata para que la cola no cambie de orden entre
 * dos cargas de la misma página.
 */
export function ordenarCola(viajes: ReadonlyArray<AuditoriaViaje>): HallazgoAuditor[] {
  return viajes.flatMap((v) => v.hallazgos).sort((a, b) => {
    if ((a.monto === null) !== (b.monto === null)) return a.monto === null ? 1 : -1;
    if (a.monto !== null && b.monto !== null && a.monto !== b.monto) return b.monto - a.monto;
    return a.folio.localeCompare(b.folio, 'es') || a.cubeta.localeCompare(b.cubeta);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE CON BASE DE DATOS.
// ═══════════════════════════════════════════════════════════════════════════

export interface AuditoriaCobranza {
  resumen: ResumenAuditor;
  /** Todos los hallazgos de la ventana, ya ordenados (`ordenarCola`). La
   *  pantalla recorta la lista y dice el total; la cifra nunca se recorta. */
  cola: HallazgoAuditor[];
  /** La ventana auditada, dicha: la cifra es DE la ventana, no del histórico. */
  desde: string;
  hasta: string;
  hoy: string;
  /** Viajes SIN fecha de inicio: quedan fuera de cualquier ventana y se
   *  declaran en vez de desaparecer en silencio. */
  viajesSinFecha: number;
}

/**
 * El cruce completo de la ventana. LANZA ante error de base — un auditor a
 * medias diría "no hay discrepancias" de viajes que sí las tienen, y ese
 * silencio es exactamente lo que el contralor no debe recibir. La página lo
 * envuelve en su `try/catch` y pinta el error dicho.
 *
 * `hoy` entra por parámetro (hora de México por default) para fijarlo en
 * pruebas sin congelar el reloj — mismo criterio que `getFacturacionClientes`.
 */
export async function getAuditoriaCobranza(
  tenantId: string,
  opciones: { desde: string; hasta: string; hoy?: string },
): Promise<AuditoriaCobranza> {
  const hoy = opciones.hoy ?? hoyMx();
  const admin = supabaseAdmin();

  // La ventana filtra por `fecha_inicio`; los NULL no pasan el `gte` y se
  // CUENTAN aparte para decirlos, no para fingir que no existen.
  const [viajesCrudos, sinFecha, tarifasCrudas] = await Promise.all([
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('viaje')
        .select('id, folio, cliente_id, origen, destino, fecha_inicio, ingreso_flete, km_recorridos, descarga_en', conteo(d))
        .eq('tenant_id', tenantId)
        .gte('fecha_inicio', opciones.desde)
        .lte('fecha_inicio', opciones.hasta)
        .order('id').range(d, h), 'auditorCobranza.viajes'),
      'auditorCobranza.viajes',
    ),
    acotada(
      admin.from('viaje').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).is('fecha_inicio', null),
      'auditorCobranza.sinFecha',
    ),
    // El catálogo de tarifas: chico por naturaleza (se captura a mano), pero
    // completo — `traerTodo` demuestra que no se recortó. Mismo criterio y
    // mismas columnas que `getPanelClientes`.
    traerTodo<Record<string, unknown>>(
      (d, h) => acotada(admin.from('tarifa')
        .select('id, cliente_id, origen, destino, modo, precio, moneda, vigente_desde, vigente_hasta, activa, creada_en', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h), 'auditorCobranza.tarifa'),
      'auditorCobranza.tarifa',
    ),
  ]);
  if (sinFecha.error) throw new Error(`auditorCobranza.sinFecha: ${sinFecha.error.message}`);
  // Un conteo que no llegó NO es un conteo de cero.
  if (sinFecha.count == null) throw new Error('auditorCobranza.sinFecha: PostgREST no devolvió el conteo');

  const viajeIds = viajesCrudos.map((v) => v.id as string);

  // `traerPorIds` en todos los `.in()` por viaje: más de mil ids se recortan a
  // 1,000 en silencio (ver pg.ts), y un POD o una factura que se cae del lote
  // fabricaría un "entregado sin facturar" o un "facturado sin POD" FALSOS.
  // Con la lista vacía, `traerPorIds` no consulta nada y devuelve [].
  const [pods, liqs, directas, ligas, clientesCrudos] = await Promise.all([
      traerPorIds<{ viaje_id: unknown; estado: unknown }>(
        viajeIds,
        (tanda) => acotada(admin.from('pod').select('viaje_id, estado')
          .eq('tenant_id', tenantId).in('viaje_id', tanda), 'auditorCobranza.pod'),
        'auditorCobranza.pod',
      ),
      traerPorIds<{ viaje_id: unknown; total_comprobado: unknown }>(
        viajeIds,
        (tanda) => acotada(admin.from('liquidacion').select('viaje_id, total_comprobado')
          .eq('tenant_id', tenantId).in('viaje_id', tanda), 'auditorCobranza.liquidacion'),
        'auditorCobranza.liquidacion',
      ),
      traerPorIds<Record<string, unknown>>(
        viajeIds,
        (tanda) => acotada(admin.from('factura_emitida')
          .select('id, folio, fecha, estatus, subtotal, total, viaje_id')
          .eq('tenant_id', tenantId).in('viaje_id', tanda), 'auditorCobranza.factura_directa'),
        'auditorCobranza.factura_directa',
      ),
      // `factura_viaje` NO tiene `tenant_id` (hereda el de su factura, 0049):
      // aquí solo se recogen pares; el filtro por flota se aplica al leer
      // `factura_emitida`, que sí lo tiene.
      traerPorIds<{ factura_id: unknown; viaje_id: unknown }>(
        viajeIds,
        (tanda) => acotada(admin.from('factura_viaje').select('factura_id, viaje_id')
          .in('viaje_id', tanda), 'auditorCobranza.factura_viaje'),
        'auditorCobranza.factura_viaje',
      ),
      traerPorIds<{ id: unknown; nombre: unknown }>(
        [...new Set(viajesCrudos.map((v) => v.cliente_id as string | null).filter((c): c is string => !!c))],
        (tanda) => acotada(admin.from('cliente').select('id, nombre')
          .eq('tenant_id', tenantId).in('id', tanda), 'auditorCobranza.cliente'),
        'auditorCobranza.cliente',
      ),
  ]);

  // Las facturas: las directas + las ligadas por `factura_viaje`.
  const facturaBase = new Map<string, Record<string, unknown>>();
  for (const f of directas) facturaBase.set(f.id as string, f);
  const idsLigados = [...new Set(ligas.map((l) => l.factura_id as string))].filter((id) => !facturaBase.has(id));
  if (idsLigados.length > 0) {
    const extra = await traerPorIds<Record<string, unknown>>(
      idsLigados,
      (tanda) => acotada(admin.from('factura_emitida')
        .select('id, folio, fecha, estatus, subtotal, total, viaje_id')
        .eq('tenant_id', tenantId).in('id', tanda), 'auditorCobranza.factura_ligada'),
      'auditorCobranza.factura_ligada',
    );
    for (const f of extra) facturaBase.set(f.id as string, f);
  }

  const facturaIds = [...facturaBase.keys()];
  const [saldos, cobertura] = await Promise.all([
      // El saldo NO es una columna: se deriva de los pagos (0049). Leerlo de
      // la vista es lo que impide que esta cola y la cartera digan cosas
      // distintas del mismo dinero.
      traerPorIds<{ factura_id: unknown; pagado: unknown; saldo: unknown; vence_en: unknown }>(
        facturaIds,
        (tanda) => acotada(admin.from('factura_saldo').select('factura_id, pagado, saldo, vence_en')
          .eq('tenant_id', tenantId).in('factura_id', tanda), 'auditorCobranza.factura_saldo'),
        'auditorCobranza.factura_saldo',
      ),
      // Cuántos viajes ampara cada factura — mismo criterio que
      // `getLibroViaje`: con más de uno, sus importes no se atribuyen.
      traerPorIds<{ factura_id: unknown; viaje_id: unknown }>(
        facturaIds,
        (tanda) => acotada(admin.from('factura_viaje').select('factura_id, viaje_id')
          .in('factura_id', tanda), 'auditorCobranza.cobertura'),
        'auditorCobranza.cobertura',
      ),
  ]);

  const saldoPorFactura = new Map(saldos.map((s) => [s.factura_id as string, s]));
  const viajesPorFactura = new Map<string, Set<string>>();
  for (const c of cobertura) {
    const set = viajesPorFactura.get(c.factura_id as string) ?? new Set<string>();
    set.add(c.viaje_id as string);
    viajesPorFactura.set(c.factura_id as string, set);
  }

  const facturaAuditada = (id: string): FacturaAuditada => {
    const f = facturaBase.get(id)!;
    const s = saldoPorFactura.get(id);
    return {
      id,
      folio: (f.folio as string) ?? null,
      fecha: (f.fecha as string) ?? null,
      estatus: String(f.estatus),
      total: aNumero(f.total),
      subtotal: aNumero(f.subtotal),
      // Sin fila en la vista el saldo es DESCONOCIDO, no 0 ni el total.
      pagado: s ? aNumero(s.pagado) : null,
      saldo: s ? aNumero(s.saldo) : null,
      venceEn: s ? ((s.vence_en as string) ?? null) : null,
      amparaVarios: (viajesPorFactura.get(id)?.size ?? 0) > 1,
    };
  };

  const facturasPorViaje = new Map<string, string[]>();
  const ligar = (viajeId: string, facturaId: string) => {
    const lista = facturasPorViaje.get(viajeId) ?? [];
    if (!lista.includes(facturaId)) lista.push(facturaId);
    facturasPorViaje.set(viajeId, lista);
  };
  for (const [id, f] of facturaBase) {
    if (f.viaje_id) ligar(f.viaje_id as string, id);
  }
  for (const l of ligas) ligar(l.viaje_id as string, l.factura_id as string);

  const podSubidoPorViaje = new Set(
    pods.filter((p) => String(p.estado) === 'subido').map((p) => p.viaje_id as string),
  );
  // `liquidacion_viaje_uidx` (0005) garantiza UNA por viaje; el mapa lo asume.
  const liqPorViaje = new Map(liqs.map((l) => [l.viaje_id as string, l]));
  const nombreCliente = new Map(clientesCrudos.map((c) => [c.id as string, String(c.nombre)]));

  const tarifas: TarifaRow[] = tarifasCrudas.map((t) => ({
    id: t.id as string,
    clienteId: (t.cliente_id as string) ?? null,
    clienteNombre: null,
    origen: (t.origen as string) ?? null,
    destino: (t.destino as string) ?? null,
    modo: t.modo as TarifaRow['modo'],
    precio: Number(t.precio),
    moneda: String(t.moneda),
    vigenteDesde: String(t.vigente_desde),
    vigenteHasta: (t.vigente_hasta as string) ?? null,
    activa: Boolean(t.activa),
    creadaEn: String(t.creada_en),
  }));

  const auditorias = viajesCrudos.map((v) => {
    const id = v.id as string;
    const liq = liqPorViaje.get(id);
    return auditarViaje({
      id,
      folio: (v.folio as string) ?? null,
      clienteId: (v.cliente_id as string) ?? null,
      cliente: v.cliente_id ? nombreCliente.get(v.cliente_id as string) ?? null : null,
      origen: (v.origen as string) ?? null,
      destino: (v.destino as string) ?? null,
      fechaInicio: (v.fecha_inicio as string) ?? null,
      ingresoFlete: v.ingreso_flete,
      kmRecorridos: v.km_recorridos == null ? null : Number(v.km_recorridos),
      podSubido: podSubidoPorViaje.has(id),
      descargaEn: (v.descarga_en as string) ?? null,
      liquidacion: liq ? { totalComprobado: liq.total_comprobado } : null,
      facturas: (facturasPorViaje.get(id) ?? []).map(facturaAuditada),
    }, tarifas, hoy);
  });

  return {
    resumen: resumirAuditoria(auditorias),
    cola: ordenarCola(auditorias),
    desde: opciones.desde,
    hasta: opciones.hasta,
    hoy,
    viajesSinFecha: sinFecha.count,
  };
}
