// ═══════════════════════════════════════════════════════════════════════════
// LO FISCAL DEL GASTO — el módulo que alimenta el panel del CONTADOR.
//
// QUIÉN ES EL LECTOR. El contador DE LA FLOTA que nos compra el servicio, no
// el de Likida. Esa flota no tiene "clientes" en este producto: tiene VIAJES y
// los comprobantes que sus operadores mandan por WhatsApp. Por eso aquí no hay
// una sola consulta a `cliente`, `factura_emitida` ni `pago_recibido`: existen
// en el esquema (0048/0049) y son de otra parte del producto. El trabajo que
// Likida automatiza —y el único del que puede hablar con cifras— es el del
// gasto que entra por el teléfono.
//
// LA REGLA QUE GOBIERNA CADA FUNCIÓN DE ESTE ARCHIVO: nunca inventar una
// cifra. El contador va a cruzar esto contra su papel de trabajo. Donde el
// dato no exista se devuelve `null` y se dice qué falta — nunca un cero, que
// se lee como medición.
//
// Consecuencia concreta y la más importante del archivo: EL IVA DE UN GASTO
// SIN CFDI NO SE ESTIMA. Multiplicar el total por 0.16 daría una cifra
// preciosa y falsa —el total puede traer propina, IEPS, conceptos exentos o
// tasa 0—, y es justo la columna que el contador teclea en su declaración. Se
// reporta el MONTO en juego y se dice que el IVA no se puede afirmar sin el
// comprobante.
//
// LAS REGLAS DE DEDUCIBILIDAD SON LAS MISMAS QUE LAS DEL MOTOR. `engine.ts`
// ya las evalúa por viaje al liquidar; aquí se evalúan por COMPROBANTE y a lo
// largo de un periodo fiscal, que es como las mira el contador. Las citas
// apuntan a las mismas fichas verificadas de `normas/`. Lo que el motor
// resuelve y esto NO intenta resolver está listado en `LIMITES` al final.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { exigir, traerTodo, conteo } from './pg';
import { round2 } from '@/lib/formato';
import { armar as armarPorFacturar } from './facturacion/pendientes';
import { evaluarTope15, type ResultadoTope15 } from './periodo/combustible';

// ── La fila de `gasto` leída con ojos de contador ──────────────────────────

/**
 * Un comprobante con los campos que deciden su suerte fiscal.
 *
 * Todo lo opcional es `null` y no `undefined` a propósito: `null` es lo que
 * devuelve PostgREST cuando la columna está vacía, y la diferencia entre "no
 * lo sabemos" y "vale cero" es la que este módulo entero existe para no
 * borrar.
 */
export interface GastoFiscal {
  id: string;
  viajeId: string;
  concepto: string;
  monto: number;
  fecha: string | null;
  folio: string | null;
  rfcEmisor: string | null;
  cfdiUuid: string | null;
  /** `true` = el QR del CFDI se leyó y se pudo parsear (`intake/ocr.ts`). */
  cfdiValido: boolean | null;
  /** Respuesta del servicio de consulta del SAT: vigente | cancelado | … */
  estadoSat: string | null;
  /** `true` = emisor en la lista definitiva del 69-B. */
  efos: boolean | null;
  /** El SAT devolvió un código EFOS no concluyente: no se afirma nada. */
  efosRevisar: boolean | null;
  /** c_FormaPago del SAT. '01' es efectivo. */
  formaPago: string | null;
  subTotal: number | null;
  ivaTraslado: number | null;
  iepsTraslado: number | null;
  claveProdServ: string | null;
  tipoComprobante: string | null;
  xmlVerificado: boolean | null;
  ocrConfianza: number | null;
  /** Contexto que el contador pide para poder ir a buscar el papel. */
  viajeFolio: string | null;
  operadorNombre: string | null;
  /**
   * ¿Ya no se puede pedir la factura? Lo calcula `getGastosFiscales` con el
   * plazo real del comercio (`facturacion/caducidad.ts`).
   *
   * `null` = no se sabe (sin fecha de ticket confiable, o comercio no
   * reconocido). NO es `false`: decirle "todavía te da tiempo" a alguien
   * sobre un ticket cuyo plazo no conocemos es la mentira cara.
   */
  plazoVencido: boolean | null;
}

// ── Periodo ────────────────────────────────────────────────────────────────

export type ClavePeriodo = 'mes' | 'mes_anterior' | 'ejercicio' | 'todo';

export interface Periodo {
  clave: ClavePeriodo;
  /** ISO `YYYY-MM-DD` inclusive. `null` en 'todo'. */
  desde: string | null;
  /** ISO `YYYY-MM-DD` inclusive. `null` en 'todo'. */
  hasta: string | null;
  /** Lo que se imprime en pantalla. Tiene que describir el filtro REAL. */
  etiqueta: string;
}

const CLAVES: ClavePeriodo[] = ['mes', 'mes_anterior', 'ejercicio', 'todo'];

/** El periodo que se asume sin `?p=` en la URL. */
export const PERIODO_POR_DEFECTO: ClavePeriodo = 'ejercicio';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function ultimoDia(anio: number, mes0: number): string {
  const d = new Date(Date.UTC(anio, mes0 + 1, 0));
  return d.toISOString().slice(0, 10);
}

function primerDia(anio: number, mes0: number): string {
  return `${anio}-${String(mes0 + 1).padStart(2, '0')}-01`;
}

/**
 * Traduce `?p=` a un rango de fechas cerrado, con su rótulo.
 *
 * `hoy` se inyecta por la misma razón que en `calcularCaducidad`: una prueba
 * de periodos no puede depender del reloj de la máquina que la corre.
 *
 * El rótulo se construye AQUÍ, junto al rango, y no en la página. Cuando eran
 * dos cosas separadas el encabezado decía "del periodo" sobre una consulta sin
 * filtro — el hallazgo que `corteVentana` en `analytics.ts` ya documentó.
 */
export function resolverPeriodo(crudo: string | undefined, hoy: string): Periodo {
  const clave: ClavePeriodo = CLAVES.includes(crudo as ClavePeriodo)
    ? (crudo as ClavePeriodo)
    : PERIODO_POR_DEFECTO;

  const [a, m] = hoy.split('-').map(Number);
  const anio = a;
  const mes0 = m - 1;

  if (clave === 'todo') {
    return { clave, desde: null, hasta: null, etiqueta: 'Todo el histórico' };
  }
  if (clave === 'ejercicio') {
    return {
      clave,
      desde: `${anio}-01-01`,
      hasta: `${anio}-12-31`,
      etiqueta: `Ejercicio ${anio}`,
    };
  }
  const refAnio = clave === 'mes_anterior' && mes0 === 0 ? anio - 1 : anio;
  const refMes = clave === 'mes_anterior' ? (mes0 === 0 ? 11 : mes0 - 1) : mes0;
  return {
    clave,
    desde: primerDia(refAnio, refMes),
    hasta: ultimoDia(refAnio, refMes),
    etiqueta: `${MESES[refMes]} ${refAnio}`,
  };
}

/**
 * El periodo INMEDIATAMENTE anterior al dado, para el comparativo.
 *
 * `null` cuando la comparación no tiene sentido ('todo' no tiene un "antes").
 * Devolver un rango vacío en su lugar produciría un −100% que se leería como
 * una caída medida.
 */
export function periodoAnterior(p: Periodo): Periodo | null {
  if (p.clave === 'todo' || !p.desde) return null;
  const [a, m] = p.desde.split('-').map(Number);
  if (p.clave === 'ejercicio') {
    return {
      clave: 'ejercicio',
      desde: `${a - 1}-01-01`,
      hasta: `${a - 1}-12-31`,
      etiqueta: `Ejercicio ${a - 1}`,
    };
  }
  const mes0 = m - 1;
  const anteriorAnio = mes0 === 0 ? a - 1 : a;
  const anteriorMes = mes0 === 0 ? 11 : mes0 - 1;
  return {
    clave: p.clave,
    desde: primerDia(anteriorAnio, anteriorMes),
    hasta: ultimoDia(anteriorAnio, anteriorMes),
    etiqueta: `${MESES[anteriorMes]} ${anteriorAnio}`,
  };
}

// ── Opciones fiscales (salen de la config del tenant, nunca hardcodeadas) ──

export interface OpcionesFiscales {
  /** LISR 27-III: tope de un gasto NO combustible pagado en efectivo. */
  efectivoTopeMxn: number;
  /** c_ClaveProdServ que cuentan como combustible (RFA 2026 regla 2.9). */
  clavesCombustible: string[];
  /** c_ClaveProdServ con estímulo de IEPS: SOLO diésel (LIF 2026 20-A-IV). */
  clavesDieselIeps: string[];
  /** RFA 2026 regla 2.9: ¿la flota califica a la facilidad del 15%?
   *  true = declaró dedicación exclusiva + régimen; false = declaró que NO;
   *  undefined = sin declarar. AUDITORÍA 14, ALTO: sin esto el panel ofrecía
   *  la válvula a flotas que el motor declara no elegibles. */
  elegible15?: boolean;
}

// ── Deducibilidad por comprobante ──────────────────────────────────────────

export type CausaPerdida =
  /** El comercio ya no acepta facturar: la deducción ya no se recupera. */
  | 'plazo_vencido'
  /** El emisor canceló el CFDI. */
  | 'cfdi_cancelado'
  /** Emisor en la lista definitiva del 69-B. */
  | 'efos'
  /** El SAT devolvió un código EFOS no concluyente. */
  | 'efos_indeterminado'
  /** Efectivo sobre el tope, gasto NO combustible (LISR 27-III). */
  | 'efectivo_sobre_tope'
  /** Combustible en efectivo: cuenta contra el 15% (RFA 2026 regla 2.9). */
  | 'combustible_efectivo'
  /** La flota no califica a la facilidad del 15% (RFA 2.9) — no deducible. */
  | 'efectivo_no_elegible'
  /** Sin CFDI pero el plazo del comercio sigue abierto. */
  | 'sin_cfdi';

export type Gravedad =
  /** El dinero ya no se recupera. */
  | 'perdida'
  /** Depende de algo que todavía puede moverse (el 15%, una aclaración). */
  | 'en_riesgo'
  /** Con una gestión se recupera: pedir la factura antes de que venza. */
  | 'recuperable';

export interface Causa {
  causa: CausaPerdida;
  gravedad: Gravedad;
  titulo: string;
  /** La ficha de `normas/` que la sostiene. Sin ficha no se afirma. */
  norma: string;
  detalle: string;
}

const TITULOS: Record<CausaPerdida, Omit<Causa, 'causa'>> = {
  plazo_vencido: {
    gravedad: 'perdida',
    titulo: 'Plazo de facturación vencido',
    norma: 'LISR 27-III',
    detalle: 'El comercio ya no acepta timbrarlo. Sin CFDI no ampara deducción y el IVA no se acredita.',
  },
  cfdi_cancelado: {
    gravedad: 'perdida',
    titulo: 'CFDI cancelado',
    norma: 'CFF 29-A',
    detalle: 'Un comprobante cancelado no ampara la deducción. Hay que pedirle al emisor uno de reemplazo.',
  },
  efos: {
    gravedad: 'perdida',
    titulo: 'Emisor en lista EFOS (69-B)',
    norma: 'CFF 69-B',
    detalle: 'Publicado en la lista definitiva: la operación se presume inexistente y el comprobante no produce efecto fiscal.',
  },
  efos_indeterminado: {
    gravedad: 'en_riesgo',
    titulo: 'Emisor con señal EFOS no concluyente',
    norma: 'CFF 69-B',
    detalle: 'El SAT no respondió de forma concluyente. No se afirma que sea EFOS; se marca para que alguien lo revise.',
  },
  efectivo_sobre_tope: {
    gravedad: 'perdida',
    titulo: 'Pagado en efectivo sobre el tope',
    norma: 'LISR 27-III',
    detalle: 'Gasto no-combustible pagado en efectivo por encima del tope: no es deducible aunque tenga CFDI.',
  },
  combustible_efectivo: {
    gravedad: 'en_riesgo',
    titulo: 'Combustible pagado en efectivo',
    norma: 'RFA 2026 regla 2.9',
    detalle: 'Cuenta contra el 15% del combustible del ejercicio. Dentro del 15% sigue siendo deducible; el excedente no. No acredita IEPS en ningún caso.',
  },
  efectivo_no_elegible: {
    gravedad: 'perdida',
    titulo: 'Combustible en efectivo sin facilidad',
    norma: 'LISR 27-III / RFA 2026 regla 2.9',
    detalle: 'La flota no califica a la facilidad del 15% (dedicación exclusiva o régimen no declarados), así que el efectivo en combustible no es deducible aunque tenga CFDI.',
  },
  sin_cfdi: {
    gravedad: 'recuperable',
    titulo: 'Sin CFDI todavía',
    norma: 'LISR 27-III',
    detalle: 'El ticket todavía se puede timbrar. Es deducción pendiente, no perdida — mientras no venza el plazo del comercio.',
  },
};

/** ¿El comprobante es de combustible, para la regla del 15%? */
export function esCombustible(g: GastoFiscal, o: OpcionesFiscales): boolean {
  return g.concepto === 'diesel' || o.clavesCombustible.includes(g.claveProdServ ?? '');
}

/** ¿Trae el estímulo de IEPS? Solo diésel — la gasolina NO (LIF 20-A-IV). */
export function esDieselConIeps(g: GastoFiscal, o: OpcionesFiscales): boolean {
  return o.clavesDieselIeps.includes(g.claveProdServ ?? '');
}

/**
 * TODAS las causas que aplican a un comprobante, de la más grave a la menos.
 *
 * Un mismo gasto puede tener varias (sin CFDI *y* pagado en efectivo sobre el
 * tope). Se devuelven todas porque el contador necesita las dos para saber
 * qué gestionar, pero el dinero se cuenta UNA sola vez — de eso se encarga
 * `resumirPerdidas` con la dominante.
 *
 * `sin_cfdi` y `plazo_vencido` son excluyentes: son el mismo hecho en dos
 * momentos. Emitir las dos duplicaría la fila en la pantalla.
 */
export function causasDe(g: GastoFiscal, o: OpcionesFiscales): Causa[] {
  const out: Causa[] = [];
  const push = (c: CausaPerdida) => out.push({ causa: c, ...TITULOS[c] });

  if (g.efos === true) push('efos');
  else if (g.efosRevisar === true) push('efos_indeterminado');

  if (g.estadoSat === 'cancelado') push('cfdi_cancelado');

  if (!g.cfdiUuid) {
    // `plazoVencido === null` es "no se sabe": se trata como recuperable —el
    // camino que le pide a alguien que lo revise— en vez de darlo por perdido.
    if (g.plazoVencido === true) push('plazo_vencido');
    else push('sin_cfdi');
  }

  // El medio de pago solo se juzga cuando se conoce. Un gasto sin `forma_pago`
  // NO se cuenta como efectivo: suponerlo inflaría el numerador contra la
  // flota (mismo criterio que `getAcumuladoCombustible` en repo.ts).
  if (g.formaPago === '01') {
    if (esCombustible(g, o)) {
      // AUDITORÍA 14-15, ALTO: mismo estándar que el motor — pero SIN DECLARAR
      // (elegible15 undefined) NO es "deducción perdida": el motor lo mantiene
      // "por confirmar" y el panel debe decir lo mismo (en_riesgo), no perdido.
      if (o.elegible15 === false) push('efectivo_no_elegible');
      else push('combustible_efectivo');
    } else if (g.monto > o.efectivoTopeMxn) push('efectivo_sobre_tope');
  }

  return out;
}

/**
 * La causa por la que este comprobante se contabiliza — una sola, para que la
 * suma por causa siga cuadrando con el total.
 *
 * El orden es por GRAVEDAD DEL DINERO, no por el orden en que se detectan:
 * primero lo que ya no se recupera, luego lo que está en riesgo, al final lo
 * que basta con gestionar.
 */
const ORDEN: CausaPerdida[] = [
  'efos', 'cfdi_cancelado', 'plazo_vencido', 'efectivo_sobre_tope',
  'efos_indeterminado', 'combustible_efectivo', 'sin_cfdi',
];

export function causaDominante(g: GastoFiscal, o: OpcionesFiscales): Causa | null {
  const cs = causasDe(g, o);
  if (!cs.length) return null;
  for (const clave of ORDEN) {
    const hit = cs.find((c) => c.causa === clave);
    if (hit) return hit;
  }
  return cs[0];
}

export interface FilaPerdida {
  gasto: GastoFiscal;
  dominante: Causa;
  /** Todas las causas, para que la fila las pueda enseñar juntas. */
  causas: Causa[];
}

export interface ResumenPerdidas {
  /** Cuánto dinero de gasto está tocado por alguna causa. */
  montoTotal: number;
  /** Lo que ya no se recupera. */
  montoPerdido: number;
  /** Lo que depende de algo que todavía se puede mover. */
  montoEnRiesgo: number;
  /** Lo que se recupera pidiendo la factura. */
  montoRecuperable: number;
  /**
   * IVA que se puede AFIRMAR que se pierde: solo el de comprobantes que SÍ
   * traen el desglose. Nunca una estimación del 16% sobre un total.
   */
  ivaPerdidoDocumentado: number;
  /** Cuántos comprobantes tocados no traen desglose de IVA que citar. */
  sinDesgloseDeIva: number;
  porCausa: Array<{ causa: CausaPerdida; titulo: string; gravedad: Gravedad; norma: string; detalle: string; n: number; monto: number }>;
  /** Ordenadas por monto descendente: lo que más pesa, arriba. */
  filas: FilaPerdida[];
  /** Comprobantes que no se pudieron juzgar por falta de `forma_pago`. */
  sinFormaPago: number;
  /** Comprobantes sin `fecha`: quedan fuera de cualquier corte por periodo. */
  sinFecha: number;
}

export function resumirPerdidas(gastos: GastoFiscal[], o: OpcionesFiscales): ResumenPerdidas {
  const filas: FilaPerdida[] = [];
  for (const g of gastos) {
    const causas = causasDe(g, o);
    if (!causas.length) continue;
    const dominante = causaDominante(g, o)!;
    filas.push({ gasto: g, dominante, causas });
  }
  filas.sort((a, b) => b.gasto.monto - a.gasto.monto);

  const porCausaMapa = new Map<CausaPerdida, { n: number; monto: number }>();
  let montoPerdido = 0, montoEnRiesgo = 0, montoRecuperable = 0;
  let ivaPerdidoDocumentado = 0, sinDesgloseDeIva = 0;

  for (const f of filas) {
    const prev = porCausaMapa.get(f.dominante.causa) ?? { n: 0, monto: 0 };
    porCausaMapa.set(f.dominante.causa, { n: prev.n + 1, monto: prev.monto + f.gasto.monto });
    if (f.dominante.gravedad === 'perdida') montoPerdido += f.gasto.monto;
    else if (f.dominante.gravedad === 'en_riesgo') montoEnRiesgo += f.gasto.monto;
    else montoRecuperable += f.gasto.monto;

    // EL IVA SOLO SE SUMA SI EL COMPROBANTE LO DESGLOSA. Estimarlo al 16%
    // sobre el total daría una cifra que el contador teclea en su declaración
    // y que no está en ningún papel.
    if (f.gasto.ivaTraslado !== null && f.gasto.ivaTraslado > 0) ivaPerdidoDocumentado += f.gasto.ivaTraslado;
    else sinDesgloseDeIva += 1;
  }

  const porCausa = ORDEN
    .filter((c) => porCausaMapa.has(c))
    .map((c) => ({
      causa: c,
      titulo: TITULOS[c].titulo,
      gravedad: TITULOS[c].gravedad,
      norma: TITULOS[c].norma,
      detalle: TITULOS[c].detalle,
      n: porCausaMapa.get(c)!.n,
      monto: round2(porCausaMapa.get(c)!.monto),
    }))
    .sort((a, b) => b.monto - a.monto);

  return {
    montoTotal: round2(montoPerdido + montoEnRiesgo + montoRecuperable),
    montoPerdido: round2(montoPerdido),
    montoEnRiesgo: round2(montoEnRiesgo),
    montoRecuperable: round2(montoRecuperable),
    ivaPerdidoDocumentado: round2(ivaPerdidoDocumentado),
    sinDesgloseDeIva,
    porCausa,
    filas,
    sinFormaPago: gastos.filter((g) => !g.formaPago).length,
    sinFecha: gastos.filter((g) => !g.fecha).length,
  };
}

// ── El panel fiscal: IVA, IEPS, deducible / no deducible ───────────────────

export interface ResumenFiscal {
  /** Comprobantes leídos en el periodo. */
  n: number;
  /** Suma de `monto` — lo que salió de la caja, no la base gravable. */
  gastoTotal: number;
  /** Cuántos traen CFDI amarrado. */
  conCfdi: number;
  /** Cuántos NO traen CFDI. */
  sinCfdi: number;
  /**
   * IVA acreditable que se puede DOCUMENTAR: `iva_traslado` de comprobantes
   * con CFDI vigente, emisor limpio y gasto deducible (LIVA 5).
   */
  ivaAcreditable: number;
  /** IVA desglosado que NO se acredita, con el motivo ya contado en perdidas. */
  ivaNoAcreditable: number;
  /**
   * Comprobantes CON CFDI pero SIN desglose de IVA leído. Su IVA existe en el
   * papel; aquí no se puede afirmar porque no se recibió el XML.
   */
  conCfdiSinDesglose: number;
  /** IEPS trasladado en CFDI de diésel con pago electrónico. */
  iepsDieselDocumentado: number;
  /** Base (SubTotal) de casetas — el 50% del estímulo se calcula sobre esto. */
  subTotalCasetas: number;
  /** Casetas sin `sub_total` leído: su base no se puede afirmar. */
  casetasSinSubTotal: number;
  /**
   * Comprobantes con CFDI que NUNCA se validaron contra el SAT
   * (`estado_sat` nulo). No es "inválido": es "no comprobado".
   */
  porValidar: number;
  /** Con CFDI y respuesta del SAT `vigente`. */
  vigentes: number;
  /** Con CFDI y respuesta del SAT `cancelado`. */
  cancelados: number;
}

/**
 * ¿Este comprobante puede sostener el acreditamiento de su IVA?
 *
 * LIVA 5 pide, entre otros requisitos, que el gasto sea deducible para ISR y
 * que el impuesto esté trasladado EXPRESAMENTE y por separado. Se evalúa lo
 * que las columnas permiten evaluar: hay CFDI, no está cancelado, el emisor no
 * está en la lista definitiva del 69-B, y el gasto no cae en el efectivo sobre
 * tope. Lo que las columnas NO permiten evaluar (que sea estrictamente
 * indispensable) no se afirma ni se niega — es juicio del contador.
 */
function ivaSostenible(g: GastoFiscal, o: OpcionesFiscales): boolean {
  if (!g.cfdiUuid) return false;
  if (g.estadoSat === 'cancelado') return false;
  if (g.estadoSat === 'pendiente' || g.estadoSat === 'no_encontrado') return false;
  if (g.efos === true) return false;
  if (g.formaPago === '01' && !esCombustible(g, o) && g.monto > o.efectivoTopeMxn) return false;
  // AUDITORÍA 14, ALTO: el combustible en EFECTIVO no acredita IVA — la
  // facilidad del 15% (RFA 2.9) solo salva la deducción de ISR, y el motor ya
  // lo niega (SIN_ACREDITAMIENTO). El panel afirmaba IVA sobre esos CFDIs.
  if (g.formaPago === '01' && esCombustible(g, o)) return false;
  return true;
}

export function resumirFiscal(gastos: GastoFiscal[], o: OpcionesFiscales): ResumenFiscal {
  let gastoTotal = 0, ivaAcreditable = 0, ivaNoAcreditable = 0;
  let iepsDieselDocumentado = 0, subTotalCasetas = 0;
  let conCfdi = 0, conCfdiSinDesglose = 0, casetasSinSubTotal = 0;
  let porValidar = 0, vigentes = 0, cancelados = 0;

  for (const g of gastos) {
    gastoTotal += g.monto;
    if (g.cfdiUuid) {
      conCfdi += 1;
      if (g.estadoSat === 'vigente') vigentes += 1;
      else if (g.estadoSat === 'cancelado') cancelados += 1;
      else porValidar += 1;
      if (g.ivaTraslado === null) conCfdiSinDesglose += 1;
    }
    if (g.ivaTraslado !== null && g.ivaTraslado > 0) {
      if (ivaSostenible(g, o)) ivaAcreditable += g.ivaTraslado;
      else ivaNoAcreditable += g.ivaTraslado;
    }
    // El IEPS del diésel exige pago electrónico y NO tiene la válvula del 15%
    // que la RFA 2.9 concede para ISR: la facilidad salva la deducción, no el
    // acreditamiento (LIF 2026 20-A, 4º párrafo).
    if (esDieselConIeps(g, o) && g.iepsTraslado !== null && g.formaPago && g.formaPago !== '01') {
      iepsDieselDocumentado += g.iepsTraslado;
    }
    if (g.concepto === 'caseta') {
      if (g.subTotal !== null) subTotalCasetas += g.subTotal;
      else casetasSinSubTotal += 1;
    }
  }

  return {
    n: gastos.length,
    gastoTotal: round2(gastoTotal),
    conCfdi,
    sinCfdi: gastos.length - conCfdi,
    ivaAcreditable: round2(ivaAcreditable),
    ivaNoAcreditable: round2(ivaNoAcreditable),
    conCfdiSinDesglose,
    iepsDieselDocumentado: round2(iepsDieselDocumentado),
    subTotalCasetas: round2(subTotalCasetas),
    casetasSinSubTotal,
    porValidar,
    vigentes,
    cancelados,
  };
}

// ── Combustible y casetas, con ojos fiscales ───────────────────────────────

export interface ResumenCombustible {
  concepto: 'diesel' | 'caseta';
  n: number;
  monto: number;
  conCfdi: number;
  montoConCfdi: number;
  sinCfdi: number;
  montoSinCfdi: number;
  /**
   * % del MONTO pagado con medio electrónico (todo lo que no es '01').
   *
   * `null` cuando no hay un solo comprobante con `forma_pago` conocida: un 0%
   * ahí se leería como "todo se paga en efectivo", que es una acusación.
   */
  pctElectronico: number | null;
  /** Monto cuya forma de pago no se conoce — el denominador que falta. */
  montoSinFormaPago: number;
}

export function resumirCombustibleCasetas(gastos: GastoFiscal[]): ResumenCombustible[] {
  return (['diesel', 'caseta'] as const).map((concepto) => {
    const filas = gastos.filter((g) => g.concepto === concepto);
    const conCfdi = filas.filter((g) => g.cfdiUuid);
    const sinCfdi = filas.filter((g) => !g.cfdiUuid);
    const conFormaPago = filas.filter((g) => g.formaPago);
    const baseConocida = conFormaPago.reduce((s, g) => s + g.monto, 0);
    const electronico = conFormaPago.filter((g) => g.formaPago !== '01').reduce((s, g) => s + g.monto, 0);
    return {
      concepto,
      n: filas.length,
      monto: round2(filas.reduce((s, g) => s + g.monto, 0)),
      conCfdi: conCfdi.length,
      montoConCfdi: round2(conCfdi.reduce((s, g) => s + g.monto, 0)),
      sinCfdi: sinCfdi.length,
      montoSinCfdi: round2(sinCfdi.reduce((s, g) => s + g.monto, 0)),
      pctElectronico: baseConocida > 0 ? Math.round((electronico / baseConocida) * 100) : null,
      montoSinFormaPago: round2(filas.filter((g) => !g.formaPago).reduce((s, g) => s + g.monto, 0)),
    };
  });
}

/** El 15% de la RFA 2026 regla 2.9, calculado sobre los gastos ya leídos. */
export function tope15DeGastos(gastos: GastoFiscal[], o: OpcionesFiscales): ResultadoTope15 {
  let efectivo = 0, totalCombustible = 0;
  for (const g of gastos) {
    if (!esCombustible(g, o)) continue;
    if (!(g.monto > 0)) continue;
    totalCombustible += g.monto;
    if (g.formaPago === '01') efectivo += g.monto;
  }
  return evaluarTope15({ efectivo, totalCombustible });
}

// ── Retenciones ────────────────────────────────────────────────────────────

export interface DiagnosticoRetencion {
  /** Siempre `false` hoy. Ver `motivo`. */
  calculable: boolean;
  /** Los campos que harían falta, con nombre exacto. */
  camposFaltantes: string[];
  motivo: string;
  /**
   * Comprobantes que PARECEN servicio de autotransporte subcontratado — el
   * único caso en que la flota es quien retiene. Es una señal para el
   * contador, no un cálculo: sin el nodo de retenciones no hay cifra.
   */
  candidatos: number;
  montoCandidatos: number;
}

/**
 * La retención del 4% de IVA por autotransporte terrestre de carga.
 *
 * QUIÉN RETIENE A QUIÉN. Cuando la flota CONTRATA a un tercero (un fletero,
 * un permisionario) para mover carga, la flota es persona moral que recibe un
 * servicio de autotransporte terrestre de bienes: está obligada a RETENER el
 * IVA correspondiente y enterarlo. Ese es el único lado que este panel podría
 * ver, porque `gasto` es lo que la flota RECIBE de sus proveedores. El otro
 * lado —lo que los clientes de la flota le retienen a ELLA— vive en los CFDI
 * que la flota emite, y eso no es parte de este panel.
 *
 * POR QUÉ NO SE PUEDE CALCULAR HOY, con nombre y apellido:
 *
 *   1. `gasto` no tiene columna de retenciones. Sus 31 columnas incluyen
 *      `iva_traslado` e `ieps_traslado` (impuestos TRASLADADOS) y ninguna de
 *      retenidos.
 *   2. `intake/cfdi_xml.ts` parsea `cfdi:Impuestos/cfdi:Traslados/cfdi:Traslado`
 *      y solo eso: el nodo `cfdi:Retenciones/cfdi:Retencion` con
 *      `Impuesto="002"` —donde vive el importe retenido— no se lee. Aunque el
 *      XML del proveedor lo traiga, hoy se descarta al importarlo.
 *
 * Calcularlo como `sub_total * 0.04` sería inventarlo: la retención efectiva
 * la fija el CFDI del proveedor, puede no existir (si el proveedor es persona
 * moral no aplica la retención), y una cifra así entra directo a una
 * declaración mensual.
 */
export function diagnosticoRetencion(gastos: GastoFiscal[]): DiagnosticoRetencion {
  // `flete` es el concepto con el que el intake etiqueta el pago a un tercero
  // que mueve carga. Es la mejor señal disponible, y se declara como señal.
  const candidatos = gastos.filter((g) => g.concepto === 'flete');
  return {
    calculable: false,
    camposFaltantes: [
      'gasto.iva_retenido (columna inexistente)',
      'intake/cfdi_xml.ts: nodo cfdi:Impuestos/cfdi:Retenciones/cfdi:Retencion[@Impuesto="002"]',
    ],
    motivo:
      'El importe retenido vive en el nodo de Retenciones del CFDI del proveedor. Ese nodo no se parsea al importar el XML y no hay columna donde guardarlo, así que no existe en la base. Derivarlo como 4% del subtotal sería inventar la cifra: la retención la fija el comprobante y no siempre aplica.',
    candidatos: candidatos.length,
    montoCandidatos: round2(candidatos.reduce((s, g) => s + g.monto, 0)),
  };
}

// ── Lectura de la base ─────────────────────────────────────────────────────

interface FilaCruda {
  id: unknown; viaje_id: unknown; concepto: unknown; monto: unknown; fecha: unknown;
  folio: unknown; rfc_emisor: unknown; cfdi_uuid: unknown; cfdi_valido: unknown;
  estado_sat: unknown; efos: unknown; efos_revisar: unknown; forma_pago: unknown;
  sub_total: unknown; iva_traslado: unknown; ieps_traslado: unknown;
  clave_prod_serv: unknown; tipo_comprobante: unknown; xml_verificado: unknown;
  ocr_confianza: unknown; ocr_extra: unknown;
}

// UNA SOLA CADENA LITERAL, sin concatenar. `postgrest-js` tipa el resultado
// PARSEANDO el texto del `select` en tiempo de tipos: partirlo con `+` lo
// convierte en un `string` cualquiera y el builder degrada a
// `GenericStringError[]`, que ya no encaja con `traerTodo`. Se ve feo en una
// línea y es lo que hace que el tipo de la fila siga siendo comprobable.
const COLUMNAS = 'id, viaje_id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, cfdi_valido, estado_sat, efos, efos_revisar, forma_pago, sub_total, iva_traslado, ieps_traslado, clave_prod_serv, tipo_comprobante, xml_verificado, ocr_confianza, ocr_extra';

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean | null => (v === null || v === undefined ? null : Boolean(v));

/**
 * Los comprobantes del tenant en un periodo, con su contexto de viaje.
 *
 * ── POR QUÉ SE FILTRA POR `fecha` Y NO POR `created_at` ────────────────────
 * `fecha` es la del COMPROBANTE, que es la que decide en qué periodo cae para
 * el SAT. `created_at` es cuándo el operador mandó la foto — un ticket del 30
 * de julio subido el 2 de agosto es del periodo de julio para el contador y de
 * agosto para el sistema. El corte de un contador se hace con la primera.
 *
 * Los comprobantes SIN `fecha` quedan fuera de cualquier corte por periodo, y
 * eso se cuenta y se dice (`sinFecha` en el resumen) en vez de meterlos
 * calladamente en el mes actual.
 *
 * Paginado con `traerTodo`: PostgREST recorta a 1,000 filas EN SILENCIO, y una
 * lista de deducciones perdidas recortada es exactamente la que hace creer al
 * contador que ya revisó todo.
 */
export async function getGastosFiscales(
  tenantId: string,
  periodo: Periodo,
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<GastoFiscal[]> {
  // `conteo(desde)` pide el `count: 'exact'` SOLO en la primera página: viene en
  // la misma respuesta, así que saber cuántas filas hay de verdad no cuesta un
  // viaje de red extra, y es lo que le permite a `traerTodo` DEMOSTRAR que trajo
  // todo. Sin él la lectura sigue siendo correcta pero paga una página vacía de
  // más, y una pantalla fiscal no debería pagar por no pedir la prueba.
  const filas = await traerTodo<FilaCruda>(
    (desde, hasta) => {
      let q = supabaseAdmin().from('gasto').select(COLUMNAS, conteo(desde)).eq('tenant_id', tenantId);
      if (periodo.desde) q = q.gte('fecha', periodo.desde);
      if (periodo.hasta) q = q.lte('fecha', periodo.hasta);
      return q.order('id').range(desde, hasta);
    },
    'getGastosFiscales',
  );

  // El contexto del viaje va en una segunda consulta y no en un join anidado:
  // el `select` con relación de PostgREST no pagina el lado embebido, así que
  // en una flota grande el join silenciosamente devuelve menos de lo que hay.
  const viajeIds = Array.from(new Set(filas.map((f) => f.viaje_id as string).filter(Boolean)));
  const contexto = new Map<string, { folio: string | null; operador: string | null }>();
  if (viajeIds.length) {
    const res = await supabaseAdmin()
      .from('viaje')
      .select('id, folio, operador:operador_id(nombre)')
      .eq('tenant_id', tenantId)
      .in('id', viajeIds);
    for (const v of exigir(res, 'getGastosFiscales.viaje') ?? []) {
      const op = v.operador as { nombre?: string } | Array<{ nombre?: string }> | null;
      const nombre = Array.isArray(op) ? (op[0]?.nombre ?? null) : (op?.nombre ?? null);
      contexto.set(v.id as string, { folio: (v.folio as string) || null, operador: nombre });
    }
  }

  return filas.map((f) => {
    const ctx = contexto.get(f.viaje_id as string);
    const cfdiUuid = (f.cfdi_uuid as string) || null;
    // El plazo solo se calcula donde importa: un gasto YA facturado no caduca.
    // `armar` identifica el comercio real y usa SU plazo, no uno inventado.
    let plazoVencido: boolean | null = null;
    if (!cfdiUuid) {
      const c = armarPorFacturar(
        {
          id: f.id as string,
          concepto: (f.concepto as string) ?? 'otro',
          monto: Number(f.monto ?? 0),
          fecha: (f.fecha as string) || null,
          folio: (f.folio as string) || null,
          rfc_emisor: (f.rfc_emisor as string) || null,
          cfdi_uuid: null,
          ocr_extra: (f.ocr_extra as Record<string, unknown>) ?? null,
        },
        hoy,
      ).caducidad;
      plazoVencido = c.desconocido ? null : c.vencido;
    }
    return {
      id: f.id as string,
      viajeId: (f.viaje_id as string) ?? '',
      concepto: (f.concepto as string) ?? 'otro',
      monto: Number(f.monto ?? 0),
      fecha: (f.fecha as string) || null,
      folio: (f.folio as string) || null,
      rfcEmisor: (f.rfc_emisor as string) || null,
      cfdiUuid,
      cfdiValido: bool(f.cfdi_valido),
      estadoSat: (f.estado_sat as string) || null,
      efos: bool(f.efos),
      efosRevisar: bool(f.efos_revisar),
      formaPago: (f.forma_pago as string) || null,
      subTotal: num(f.sub_total),
      ivaTraslado: num(f.iva_traslado),
      iepsTraslado: num(f.ieps_traslado),
      claveProdServ: (f.clave_prod_serv as string) || null,
      tipoComprobante: (f.tipo_comprobante as string) || null,
      xmlVerificado: bool(f.xml_verificado),
      ocrConfianza: num(f.ocr_confianza),
      viajeFolio: ctx?.folio ?? null,
      operadorNombre: ctx?.operador ?? null,
      plazoVencido,
    };
  });
}

/**
 * Cuántos comprobantes con fecha hay FUERA del periodo — la prueba de que el
 * filtro está recortando algo real.
 *
 * Se pregunta por separado porque `getGastosFiscales` ya viene filtrado y no
 * puede saber qué dejó afuera. Sin esto, un periodo vacío se ve idéntico a una
 * flota que nunca ha capturado un gasto, y las dos cosas piden acciones
 * opuestas: cambiar el filtro, o empezar a usar el producto.
 */
export async function contarGastosDelTenant(tenantId: string): Promise<{ total: number; sinFecha: number }> {
  const admin = supabaseAdmin();
  const [todos, sinFecha] = await Promise.all([
    admin.from('gasto').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId),
    admin.from('gasto').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('fecha', null),
  ]);
  if (todos.error) throw new Error(`contarGastosDelTenant: ${todos.error.message}`);
  if (sinFecha.error) throw new Error(`contarGastosDelTenant.sinFecha: ${sinFecha.error.message}`);
  return { total: todos.count ?? 0, sinFecha: sinFecha.count ?? 0 };
}

// ── Liquidaciones, en modo lectura ─────────────────────────────────────────

export interface LiquidacionFiscal {
  id: string;
  viajeFolio: string | null;
  operadorNombre: string | null;
  fecha: string;
  totalComprobado: number;
  totalAnticipo: number;
  diferencia: number;
  estatus: string;
  /** Cuántas observaciones levantó el motor. */
  observaciones: number;
  ivaAcreditable: number;
  iepsAcreditable: number;
  peajeAcreditable: number;
  litrosDieselAcreditables: number;
  pdfUrl: string | null;
}

/**
 * Las liquidaciones cerradas del periodo, para amarrar lo contable con lo
 * operativo. SOLO LECTURA: este módulo no expone nada que escriba.
 *
 * Se filtra por `created_at` y no por `fecha` porque una liquidación no tiene
 * fecha de documento: la fecha que le importa al contador es cuándo se cerró.
 * El rótulo de la pantalla lo dice con esas palabras.
 */
export async function getLiquidacionesFiscales(
  tenantId: string,
  periodo: Periodo,
): Promise<LiquidacionFiscal[]> {
  const filas = await traerTodo<Record<string, unknown>>(
    (desde, hasta) => {
      let q = supabaseAdmin()
        .from('liquidacion')
        .select('id, created_at, total_comprobado, total_anticipo, diferencia, estatus, diferencias, pdf_url, iva_acreditable, ieps_acreditable, peaje_acreditable, litros_diesel_acreditables, viaje:viaje_id(folio, operador:operador_id(nombre))', conteo(desde))
        .eq('tenant_id', tenantId);
      if (periodo.desde) q = q.gte('created_at', `${periodo.desde}T00:00:00Z`);
      if (periodo.hasta) q = q.lte('created_at', `${periodo.hasta}T23:59:59.999Z`);
      return q.order('id').range(desde, hasta);
    },
    'getLiquidacionesFiscales',
  );

  return filas
    .map((r) => {
      const v = r.viaje as { folio?: string; operador?: { nombre?: string } | null } | null;
      const difs = r.diferencias as unknown[] | null;
      return {
        id: r.id as string,
        viajeFolio: v?.folio ?? null,
        operadorNombre: v?.operador?.nombre ?? null,
        fecha: r.created_at as string,
        totalComprobado: Number(r.total_comprobado ?? 0),
        totalAnticipo: Number(r.total_anticipo ?? 0),
        diferencia: Number(r.diferencia ?? 0),
        estatus: (r.estatus as string) ?? '',
        observaciones: Array.isArray(difs) ? difs.length : 0,
        ivaAcreditable: Number(r.iva_acreditable ?? 0),
        iepsAcreditable: Number(r.ieps_acreditable ?? 0),
        peajeAcreditable: Number(r.peaje_acreditable ?? 0),
        litrosDieselAcreditables: Number(r.litros_diesel_acreditables ?? 0),
        pdfUrl: (r.pdf_url as string) || null,
      };
    })
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

// ── Export ─────────────────────────────────────────────────────────────────

export interface FilaExportCfdi {
  fecha: string;
  concepto: string;
  viaje: string;
  operador: string;
  folio: string;
  rfc_emisor: string;
  cfdi_uuid: string;
  estado_sat: string;
  efos: string;
  forma_pago: string;
  monto: number;
  sub_total: string;
  iva_traslado: string;
  ieps_traslado: string;
  clave_prod_serv: string;
  situacion_fiscal: string;
  fundamento: string;
}

/**
 * La fila que se lleva a Excel. Las columnas que no existen se van VACÍAS, no
 * en cero: un `0.00` en la columna de IVA de un ticket sin factura se importa
 * al ERP como "este gasto no causó IVA", que es una afirmación que nadie hizo.
 */
export function aFilasExport(gastos: GastoFiscal[], o: OpcionesFiscales): FilaExportCfdi[] {
  const txt = (v: string | null) => v ?? '';
  const cifra = (v: number | null) => (v === null ? '' : String(round2(v)));
  return gastos.map((g) => {
    const dominante = causaDominante(g, o);
    return {
      fecha: txt(g.fecha),
      concepto: g.concepto,
      viaje: txt(g.viajeFolio),
      operador: txt(g.operadorNombre),
      folio: txt(g.folio),
      rfc_emisor: txt(g.rfcEmisor),
      cfdi_uuid: txt(g.cfdiUuid),
      estado_sat: g.cfdiUuid ? (g.estadoSat ?? 'sin validar') : '',
      efos: g.efos === null ? '' : g.efos ? 'si' : 'no',
      forma_pago: txt(g.formaPago),
      monto: g.monto,
      sub_total: cifra(g.subTotal),
      iva_traslado: cifra(g.ivaTraslado),
      ieps_traslado: cifra(g.iepsTraslado),
      clave_prod_serv: txt(g.claveProdServ),
      situacion_fiscal: dominante ? dominante.titulo : 'Sin observación',
      fundamento: dominante ? dominante.norma : '',
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// LO QUE ESTE MÓDULO NO HACE, PARA QUE NADIE LO SUPONGA
//
// 1. NO evalúa el tope de $750/día de alimentación (LISR 28-V). Es por día y
//    por beneficiario, y el reparto proporcional cuando hay varios
//    comprobantes del mismo día ya está resuelto en `engine.ts` al liquidar.
//    Repetirlo aquí con otra implementación produciría dos cifras distintas
//    para el mismo hecho, que es el modo de falla que `lib/formato.ts` existe
//    para evitar.
// 2. NO calcula el estímulo de IEPS en pesos. El estímulo es cuota del DOF ×
//    litros, no el IEPS trasladado (`normas/lif-2026-20-A.yaml`). Sin el
//    acuerdo semanal del DOF cargado, la cifra en pesos no se puede afirmar.
// 3. NO calcula retenciones. Ver `diagnosticoRetencion`.
// 4. NO toca `cliente`, `factura_emitida`, `pago_recibido` ni `factura_viaje`.
//    El ingreso de la flota no es el trabajo que Likida automatiza.
// ═══════════════════════════════════════════════════════════════════════════
