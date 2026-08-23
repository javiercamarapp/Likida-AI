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
import { traerTodo, conteo } from './pg';
import { acotada } from './presupuesto';
import { round2, hoyMx, inicioDiaMx, finDiaMx } from '@/lib/formato';
import { identificarComercio } from './facturacion/identificar';
import { COMERCIOS } from './facturacion/comercios';
import { calcularCaducidad, type Plazo } from './facturacion/caducidad';
import { evaluarTope15, type ResultadoTope15 } from './periodo/combustible';
import {
  proporcionAlimentacionPorGasto, diasSobreTope, CONCEPTOS_CON_TOPE_ALIMENTACION,
} from './cuadre/tope_alimentacion';
// La constante vive en el motor a propósito: el panel y el motor tienen que
// juzgar «no pagado» con el MISMO valor, o vuelven las dos cifras (FISC-C3-2).
import { FORMA_PAGO_SIN_PAGAR, medioNoAdmitidoCombustible } from './cuadre/engine';
import { getConfig, type LikidaConfig } from './config';

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
   * ¿El PORTAL del comercio ya cerró su plazo? Lo calcula `getGastosFiscales`
   * con el plazo del comercio (`facturacion/caducidad.ts`). Es política de un
   * tercero (nivel 6), no un plazo legal: el derecho de exigir la factura
   * vive todo el ejercicio (`normas/politica-portales-plazos.yaml`).
   *
   * `null` = no se sabe (sin fecha de ticket confiable, o comercio no
   * reconocido). NO es `false`: decirle "todavía te da tiempo" a alguien
   * sobre un ticket cuyo plazo no conocemos es la mentira cara.
   */
  plazoVencido: boolean | null;
  /**
   * Presente cuando la fila es una CELDA AGREGADA (mig. 0151): representa
   * `celda.n` comprobantes con EXACTAMENTE las mismas dimensiones fiscales
   * (concepto, clave, forma de pago, estado SAT, EFOS, con/sin CFDI, con/sin
   * desglose de IVA, sobre/bajo el tope de efectivo, plazo del comercio…).
   * En una celda `monto`, `ivaTraslado`, `iepsTraslado` y `subTotal` son
   * SUMAS; `id`/`cfdiUuid` son los de UN comprobante de muestra; `viajeId`,
   * `folio`, `viajeFolio` y `operadorNombre` no existen (la celda cruza
   * viajes). Ausente = un comprobante individual, como siempre.
   */
  celda?: CeldaFiscal;
}

/**
 * Lo que una celda sabe además de sus dimensiones — las sumas y los conteos
 * que la ley de abajo necesita para pesar la celda como si fueran sus `n`
 * comprobantes, uno por uno.
 */
export interface CeldaFiscal {
  /** Comprobantes que la celda representa (≥ 1). */
  n: number;
  /**
   * `monto > efectivoTopeMxn` evaluado FILA POR FILA en SQL con el tope que
   * mandó el llamador (config del tenant). La REGLA (LISR 27-III: efectivo
   * no combustible sobre el tope no deduce) sigue en `causasDe`; SQL solo
   * partió las filas en dos montones. Sobre la SUMA de una celda no se puede
   * evaluar: $3,000 en tres tickets de $1,000 no rebasan un tope de $2,000.
   */
  sobreTopeEfectivo: boolean;
  /** `nulo` = sin desglose; `positivo` = iva > 0; `no_positivo` = iva ≤ 0. Homogéneo por celda. */
  ivaEstado: 'nulo' | 'positivo' | 'no_positivo';
  /** Cuántos de los `n` no traen `ieps_traslado`. */
  iepsNulos: number;
  /** Cuántos de los `n` no traen `sub_total` (la base de casetas que no se afirma). */
  subTotalNulos: number;
  /**
   * Solo en celdas de alimentación TIMBRADA de un (viaje, día) cuyo total
   * timbrado rebasa el tope de LISR 28-V: el total timbrado de ESE día. La
   * proporción `min(1, tope/total)` la calcula `resumirFiscal` con el mismo
   * `diasSobreTope` del motor — SQL no conoce la fórmula, solo partió esos
   * días en celdas propias. `null` = la celda deduce entera (p = 1).
   */
  totalTimbradoDia: number | null;
}

/** Cuántos comprobantes pesa una fila: `n` si es celda, 1 si es un comprobante. */
function pesoDe(g: GastoFiscal): number {
  return g.celda ? g.celda.n : 1;
}

/**
 * LISR 27-III, el único juicio POR MONTO de la ley: sobre un comprobante se
 * compara aquí; sobre una celda se lee la partición que SQL hizo con el MISMO
 * tope (ver `CeldaFiscal.sobreTopeEfectivo`).
 */
function sobreTopeEfectivo(g: GastoFiscal, o: OpcionesFiscales): boolean {
  return g.celda ? g.celda.sobreTopeEfectivo : g.monto > o.efectivoTopeMxn;
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
  /** LISR 28-V: tope diario de alimentación. `null` = tenant sin tope
   *  configurado, y entonces tampoco se prorratea — el MISMO interruptor con
   *  el que el motor decide si aplica la regla (`topeAlimentacion != null`). */
  viaticosTopeFiscalDiarioMxn: number | null;
  /** RFA 2026 regla 2.9: ¿la flota califica a la facilidad del 15%?
   *  true = declaró dedicación exclusiva + régimen; false = declaró que NO;
   *  undefined = sin declarar. AUDITORÍA 14, ALTO: sin esto el panel ofrecía
   *  la válvula a flotas que el motor declara no elegibles. */
  elegible15?: boolean;
}

/**
 * Movida de `dashboard/contador/comun.tsx` el 10-ago-2026: ese panel se borró
 * (rediseño desde cero), pero `dashboard/page.tsx` (Resumen) también la
 * necesita para su Motor fiscal — vivía en un archivo de página en vez de en
 * la capa de datos, así que borrar el panel se la hubiera llevado entre pies.
 */
export function opcionesDe(cfg: LikidaConfig): OpcionesFiscales {
  const f15 = cfg.facilidadCombustibleEfectivo;
  return {
    efectivoTopeMxn: cfg.estimulos.efectivoTopeMxn,
    clavesCombustible: cfg.hidrocarburos.claves,
    clavesDieselIeps: cfg.estimulos.clavesDieselIeps,
    // `?? null` y no un default: si la config del tenant perdió el tope, el
    // motor tampoco lo aplica (lee con `!= null`) — inventar $750 aquí haría
    // que el panel prorratee un tope que la liquidación no aplicó.
    viaticosTopeFiscalDiarioMxn: cfg.estimulos.viaticosTopeFiscalDiarioMxn ?? null,
    // AUDITORÍA 14, ALTO: el panel ofrecía el 15% a flotas no elegibles. La
    // declaración de la flota (al registrarse) llega hasta aquí.
    elegible15: (f15 && f15.dedicacionExclusivaCarga !== undefined && f15.regimenElegible !== undefined)
      ? (f15.dedicacionExclusivaCarga === true && f15.regimenElegible === true)
      : undefined,
  };
}

// ── Deducibilidad por comprobante ──────────────────────────────────────────

export type CausaPerdida =
  /** El PORTAL del comercio cerró su plazo (política de nivel 6, no la ley):
   *  el derecho legal de exigir la factura vive todo el ejercicio. */
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
  /** Depende de algo que todavía puede moverse (el 15%, una aclaración, la
   *  Conciliación de Factura del SAT). */
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
  // AUD3 FI-A2, ALTO: esto era `gravedad: 'perdida'` y el KPI lo sumaba a
  // "monto perdido". La ficha `normas/politica-portales-plazos.yaml`
  // (jerarquía 6) dice lo contrario: el plazo del portal "tiene CERO fuerza
  // legal" y "el plazo LEGAL para pedir factura es todo el ejercicio" — y el
  // motor, sobre el mismo ticket, imprime "legalmente puedes exigirlo dentro
  // del ejercicio" (engine.ts, rama vencida). Dar por perdida una deducción
  // que la Conciliación de Factura recupera es confundir nivel 6 con
  // obligación fiscal: el error más caro del dominio (normas/README.md).
  plazo_vencido: {
    gravedad: 'en_riesgo',
    titulo: 'Plazo del comercio vencido',
    norma: 'LISR 27-III',
    detalle: 'El portal del comercio cerró su plazo — política del comercio, no la ley. El derecho legal vive todo el ejercicio: recuperarlo exige pedir la factura directo al emisor (Conciliación de Factura del SAT). Sin CFDI al cierre, no ampara deducción ni acredita IVA.',
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
    // camino que le pide a alguien que lo revise— en vez de darlo por vencido.
    if (g.plazoVencido === true) push('plazo_vencido');
    else push('sin_cfdi');
  }

  // El medio de pago solo se juzga cuando se conoce. Un gasto sin `forma_pago`
  // NO se cuenta como efectivo: suponerlo inflaría el numerador contra la
  // flota (mismo criterio que `getAcumuladoCombustible` en repo.ts).
  // AUDITORÍA 18-c3, FISC-C3-1 (CRÍTICO): para COMBUSTIBLE la frontera no es
  // "es '01'" sino "no está en la lista cerrada de la LISR 27-III" — la RFA 2.9
  // define el cubo del 15% por exclusión. `medioNoAdmitidoCombustible` es el
  // MISMO predicado que usa el motor, importado a propósito: si el panel se
  // escribe su copia, vuelven las dos cifras sobre el mismo comprobante.
  if (esCombustible(g, o)) {
    if (medioNoAdmitidoCombustible(g.formaPago)) {
      // AUDITORÍA 14-15, ALTO: mismo estándar que el motor — pero SIN DECLARAR
      // (elegible15 undefined) NO es "deducción perdida": el motor lo mantiene
      // "por confirmar" y el panel debe decir lo mismo (en_riesgo), no perdido.
      if (o.elegible15 === false) push('efectivo_no_elegible');
      else push('combustible_efectivo');
    }
    // El tope de efectivo NO aplica al combustible: su frontera es la lista de
    // la LISR 27-III, arriba. `sobreTopeEfectivo` (de master) prefiere la celda
    // que ya calculó el motor sobre recalcular el monto aquí.
  } else if (g.formaPago === '01' && sobreTopeEfectivo(g, o)) {
    push('efectivo_sobre_tope');
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
// `plazo_vencido` bajó del grupo de pérdidas al de riesgo (AUD3 FI-A2): un
// ticket sin CFDI con el portal cerrado cuesta una gestión ante el emisor,
// no el dinero — así que una pérdida dura (efectivo sobre el tope) le gana
// la dominancia.
const ORDEN: CausaPerdida[] = [
  'efos', 'cfdi_cancelado', 'efectivo_sobre_tope',
  'efos_indeterminado', 'plazo_vencido', 'combustible_efectivo', 'sin_cfdi',
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
    // Una celda pesa sus `n` comprobantes: las causas son las mismas para
    // todos (la celda es homogénea en cada dimensión que `causasDe` mira) y
    // el monto ya viene sumado.
    const peso = pesoDe(f.gasto);
    const prev = porCausaMapa.get(f.dominante.causa) ?? { n: 0, monto: 0 };
    porCausaMapa.set(f.dominante.causa, { n: prev.n + peso, monto: prev.monto + f.gasto.monto });
    if (f.dominante.gravedad === 'perdida') montoPerdido += f.gasto.monto;
    else if (f.dominante.gravedad === 'en_riesgo') montoEnRiesgo += f.gasto.monto;
    else montoRecuperable += f.gasto.monto;

    // EL IVA SOLO SE SUMA SI EL COMPROBANTE LO DESGLOSA. Estimarlo al 16%
    // sobre el total daría una cifra que el contador teclea en su declaración
    // y que no está en ningún papel.
    if (f.gasto.ivaTraslado !== null && f.gasto.ivaTraslado > 0) ivaPerdidoDocumentado += f.gasto.ivaTraslado;
    else sinDesgloseDeIva += peso;
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
    sinFormaPago: gastos.filter((g) => !g.formaPago).reduce((s, g) => s + pesoDe(g), 0),
    sinFecha: gastos.filter((g) => !g.fecha).reduce((s, g) => s + pesoDe(g), 0),
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
   * con CFDI vigente, emisor limpio y gasto deducible (LIVA 5). En erogaciones
   * PARCIALMENTE deducibles (alimentación sobre el tope de LISR 28-V) entra
   * solo la proporción deducible — LIVA 5-I, el mismo criterio del motor.
   */
  ivaAcreditable: number;
  /**
   * IVA desglosado que NO se acredita: el de comprobantes que no lo sostienen
   * (motivo ya contado en perdidas) MÁS la porción no deducible del IVA de los
   * viáticos sobre el tope. Acreditable + no acreditable siguen sumando todo
   * el IVA desglosado — el contralor lo cruza con una calculadora.
   */
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
  if (g.formaPago === '01' && !esCombustible(g, o) && sobreTopeEfectivo(g, o)) return false;
  // AUDITORÍA 14, ALTO: el combustible en EFECTIVO no acredita IVA — la
  // facilidad del 15% (RFA 2.9) solo salva la deducción de ISR, y el motor ya
  // lo niega (SIN_ACREDITAMIENTO). El panel afirmaba IVA sobre esos CFDIs.
  if (medioNoAdmitidoCombustible(g.formaPago) && esCombustible(g, o)) return false;
  // AUDITORÍA 18-c3, FISC-C3-2 (CRÍTICO): LIVA 5-III exige que el impuesto esté
  // "efectivamente pagado en el mes". `'99' Por definir` = la contraprestación
  // NO se ha pagado (RMF 2.7.1.29 fr. II), que es el caso normal de un CFDI PPD
  // —la flota con línea de crédito en la refaccionaria—. El motor ya lo negaba
  // (`engine.ts`, el candado de `59c02ec`); este módulo, que es el que alimenta
  // «IVA acreditable documentado» del panel del contador, se había quedado sin
  // él: el MISMO UUID daba $8,000 en la pantalla y $0.00 en el PDF, y el que se
  // teclea en la declaración es el de la pantalla. Se acreditará el mes en que
  // se pague, con su complemento de pago.
  //
  // Ojo con el criterio del módulo: se niega SOLO cuando la columna dice '99'.
  // Un comprobante SIN `forma_pago` es desconocido, no impago (mismo estándar
  // que `causasDe` y que `getAcumuladoCombustible`).
  if (g.formaPago === FORMA_PAGO_SIN_PAGAR) return false;
  return true;
}

export function resumirFiscal(gastos: GastoFiscal[], o: OpcionesFiscales): ResumenFiscal {
  let gastoTotal = 0, ivaAcreditable = 0, ivaNoAcreditable = 0;
  let iepsDieselDocumentado = 0, subTotalCasetas = 0;
  let conCfdi = 0, conCfdiSinDesglose = 0, casetasSinSubTotal = 0;
  let porValidar = 0, vigentes = 0, cancelados = 0;

  // AUDITORÍA 4, E4: esto sumaba el IVA COMPLETO de un viático que el motor
  // acreditaba en proporción al tope de LISR 28-V (LIVA 5-I: "en la proporción
  // en la que dichas erogaciones sean deducibles"). Sobre $900 con tope de
  // $750: el panel decía 100% donde la liquidación decía 83.3%. El criterio
  // es EL MISMO módulo que usa el motor (`cuadre/tope_alimentacion.ts`), no
  // una réplica. El tope es por día Y POR BENEFICIARIO: este panel mira un
  // periodo con muchos viajes, así que se parte por viaje —la liquidación es
  // de un solo operador— antes de aplicar el criterio, igual que el motor.
  const proporciones = new Map<string, number>();
  if (o.viaticosTopeFiscalDiarioMxn != null) {
    const porViaje = new Map<string, GastoFiscal[]>();
    for (const g of gastos) {
      if (g.celda) continue; // las celdas traen su día ya partido (abajo)
      porViaje.set(g.viajeId, [...(porViaje.get(g.viajeId) ?? []), g]);
    }
    for (const delViaje of porViaje.values()) {
      for (const [id, p] of proporcionAlimentacionPorGasto(delViaje, o.viaticosTopeFiscalDiarioMxn)) {
        proporciones.set(id, p);
      }
    }
  }
  /**
   * La MISMA proporción para una celda: SQL (mig. 0151) partió en celdas
   * propias los timbrados de alimentación de cada (viaje, día) cuyo total
   * timbrado rebasa el tope, y trae ese total. La fórmula —`min(1,
   * tope/totalTimbrado)`, calculada solo sobre lo timbrado— sigue siendo la
   * de `diasSobreTope`: se le pasa el día como un solo comprobante timbrado
   * por el total y se lee su proporción. Sin tope configurado, 1 (el motor
   * tampoco prorratea).
   */
  const proporcionDeCelda = (g: GastoFiscal): number => {
    const total = g.celda?.totalTimbradoDia;
    if (total == null || o.viaticosTopeFiscalDiarioMxn == null) return 1;
    const dia = diasSobreTope(
      [{ id: 'dia', concepto: CONCEPTOS_CON_TOPE_ALIMENTACION[0], monto: total, fecha: '2000-01-01', cfdiUuid: 'x' }],
      o.viaticosTopeFiscalDiarioMxn,
    )[0];
    return dia?.proporcionTimbrado ?? 1;
  };

  for (const g of gastos) {
    const peso = pesoDe(g);
    gastoTotal += g.monto;
    if (g.cfdiUuid) {
      conCfdi += peso;
      if (g.estadoSat === 'vigente') vigentes += peso;
      else if (g.estadoSat === 'cancelado') cancelados += peso;
      else porValidar += peso;
      if (g.ivaTraslado === null) conCfdiSinDesglose += peso;
    }
    if (g.ivaTraslado !== null && g.ivaTraslado > 0) {
      if (ivaSostenible(g, o)) {
        const proporcion = Math.max(0, Math.min(1, g.celda ? proporcionDeCelda(g) : (proporciones.get(g.id) ?? 1)));
        ivaAcreditable += g.ivaTraslado * proporcion;
        // El resto del traslado existe en el papel y NO se acredita: va a la
        // otra cubeta para que las dos sigan sumando el IVA desglosado.
        ivaNoAcreditable += g.ivaTraslado * (1 - proporcion);
      } else {
        ivaNoAcreditable += g.ivaTraslado;
      }
    }
    // El IEPS del diésel exige pago electrónico y NO tiene la válvula del 15%
    // que la RFA 2.9 concede para ISR: la facilidad salva la deducción, no el
    // acreditamiento (LIF 2026 20-A, 4º párrafo).
    if (esDieselConIeps(g, o) && g.iepsTraslado !== null && g.formaPago && g.formaPago !== '01') {
      iepsDieselDocumentado += g.iepsTraslado;
    }
    if (g.concepto === 'caseta') {
      // En una celda `subTotal` es la suma de los que SÍ traen base y
      // `subTotalNulos` cuenta los que no; en un comprobante, uno u otro.
      if (g.subTotal !== null) subTotalCasetas += g.subTotal;
      casetasSinSubTotal += g.celda ? g.celda.subTotalNulos : (g.subTotal === null ? 1 : 0);
    }
  }

  const n = gastos.reduce((s, g) => s + pesoDe(g), 0);
  return {
    n,
    gastoTotal: round2(gastoTotal),
    conCfdi,
    sinCfdi: n - conCfdi,
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
    const cuenta = (xs: GastoFiscal[]) => xs.reduce((s, g) => s + pesoDe(g), 0);
    return {
      concepto,
      n: cuenta(filas),
      monto: round2(filas.reduce((s, g) => s + g.monto, 0)),
      conCfdi: cuenta(conCfdi),
      montoConCfdi: round2(conCfdi.reduce((s, g) => s + g.monto, 0)),
      sinCfdi: cuenta(sinCfdi),
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
    if (medioNoAdmitidoCombustible(g.formaPago)) efectivo += g.monto;
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
    candidatos: candidatos.reduce((s, g) => s + pesoDe(g), 0),
    montoCandidatos: round2(candidatos.reduce((s, g) => s + g.monto, 0)),
  };
}

// ── Lectura de la base ─────────────────────────────────────────────────────
//
// ── ESCALA 50k VIAJES/MES (mig. 0151): AGREGADO POR DIMENSIONES, LEY EN TS ──
//
// Antes esto traía a JS TODOS los comprobantes del periodo (`traerTodo`, techo
// 100,000 filas → con 'ejercicio' por defecto y 300k gastos/mes, reventaba
// ~día 10) y luego `traerPorIds` sobre los 600k viajes del año para ponerles
// folio y operador — que NINGUNA pantalla lee (Resumen, Contador y el chat
// consumen solo montoPerdido/EnRiesgo/Recuperable, porCausa y ResumenFiscal).
//
// La 0112 NO lo movió a RPC porque `resumirFiscal`/`resumirPerdidas` son LEY
// (deducibilidad por comprobante) y reescribirla en SQL la duplicaría. Esto
// la respeta: SQL NO juzga nada — AGRUPA los comprobantes por las dimensiones
// exactas que la ley de arriba consulta por fila (concepto, clave SAT, forma
// de pago, estado SAT, EFOS, con/sin CFDI, con/sin desglose de IVA, con/sin
// fecha) y devuelve por celda sumas y conteos. Cada celda llega aquí como un
// `GastoFiscal` con `celda.n`, y las MISMAS funciones de la ley la pesan por
// `n` (ver `pesoDe`). Cientos de celdas en vez de millones de filas, y la
// regla sigue viviendo en un solo sitio.
//
// Los DOS juicios que no son categóricos se resuelven sin mover la regla:
//   · `monto > efectivoTopeMxn` (LISR 27-III) — SQL parte cada fila con el
//     tope que ESTA función le manda desde la config del tenant; la regla de
//     qué hacer con ese montón sigue en `causasDe` (`sobreTopeEfectivo`).
//   · La proporción de alimentación por (viaje, día) (LISR 28-V / LIVA 5-I) —
//     SQL parte en celdas propias los timbrados de los días cuyo total
//     timbrado rebasa el tope y trae ese total; `resumirFiscal` calcula la
//     proporción con `diasSobreTope` del motor. Los días que no rebasan no
//     se parten: la proporción sería 1, el mismo resultado.
//   · El plazo del PORTAL (`plazoVencido`): la identificación del comercio
//     (`identificarComercio`) y el reloj (`calcularCaducidad`) siguen siendo
//     los de `facturacion/`. Como `vencido` es monótono en la fecha para un
//     plazo dado, basta con que SQL diga en qué BANDA cae la fecha respecto a
//     los cortes que `cortesDePlazo` calcula aquí con el reloj real (uno por
//     plazo distinto del catálogo) — y agrupe los sin CFDI por (banda, RFC
//     emisor, host del portal, emisor leído), que es lo que el identificador
//     mira. Cardinalidad: comercios × bandas, no tickets.
//
// POR QUÉ SE FILTRA POR `fecha` Y NO POR `created_at`: `fecha` es la del
// COMPROBANTE, la que decide en qué periodo cae para el SAT. Un ticket del 30
// de julio subido el 2 de agosto es de julio para el contador. Los
// comprobantes SIN `fecha` quedan fuera de cualquier corte por periodo, y se
// cuentan y se dicen (`sinFecha`) en vez de meterlos callados al mes actual.

/** Forma EXACTA de una celda tal como la emite `gastos_fiscales_agregados_tenant`. */
interface CeldaCruda {
  concepto: string; claveProdServ: string | null; formaPago: string | null;
  efos: boolean | null; efosRevisar: boolean | null; estadoSat: string | null;
  tieneCfdi: boolean; sinFecha: boolean; ivaEstado: CeldaFiscal['ivaEstado'];
  sobreTopeEfectivo: boolean;
  banda: number | null; rfcEmisor: string | null; host: string | null; emisor: string | null;
  totalTimbradoDia: number | null;
  n: number; monto: number; iva: number; ieps: number; iepsNulos: number;
  subTotal: number; subTotalNulos: number;
  muestraId: string; muestraCfdi: string | null; fechaMax: string | null;
}

/**
 * Fail-closed de FORMA: una celda que no encaje LANZA. Un `?? 0` aquí
 * convertiría una migración sin aplicar o una columna renombrada en un panel
 * fiscal en ceros — exactamente la cifra que el contador no debe ver.
 */
function leerCelda(x: unknown, i: number): CeldaCruda {
  const falla = (campo: string) => new Error(
    `getGastosFiscales: la celda ${i} de gastos_fiscales_agregados_tenant no trae \`${campo}\` con la forma esperada (¿migración 0151 sin aplicar?)`,
  );
  if (!x || typeof x !== 'object') throw falla('celda');
  const c = x as Record<string, unknown>;
  const str = (k: string): string | null => {
    const v = c[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== 'string') throw falla(k);
    return v || null;
  };
  const strReq = (k: string): string => { const v = str(k); if (v === null) throw falla(k); return v; };
  const num = (k: string): number => {
    const v = c[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw falla(k);
    return v;
  };
  const numOpt = (k: string): number | null => (c[k] === null || c[k] === undefined ? null : num(k));
  const bool = (k: string): boolean | null => {
    const v = c[k];
    if (v === null || v === undefined) return null;
    if (typeof v !== 'boolean') throw falla(k);
    return v;
  };
  const boolReq = (k: string): boolean => { const v = bool(k); if (v === null) throw falla(k); return v; };
  const ivaEstado = strReq('ivaEstado');
  if (ivaEstado !== 'nulo' && ivaEstado !== 'positivo' && ivaEstado !== 'no_positivo') throw falla('ivaEstado');
  const n = num('n');
  if (!Number.isInteger(n) || n < 1) throw falla('n');
  return {
    concepto: strReq('concepto'), claveProdServ: str('claveProdServ'), formaPago: str('formaPago'),
    efos: bool('efos'), efosRevisar: bool('efosRevisar'), estadoSat: str('estadoSat'),
    tieneCfdi: boolReq('tieneCfdi'), sinFecha: boolReq('sinFecha'), ivaEstado,
    sobreTopeEfectivo: boolReq('sobreTopeEfectivo'),
    banda: numOpt('banda'), rfcEmisor: str('rfcEmisor'), host: str('host'), emisor: str('emisor'),
    totalTimbradoDia: numOpt('totalTimbradoDia'),
    n, monto: num('monto'), iva: num('iva'), ieps: num('ieps'), iepsNulos: num('iepsNulos'),
    subTotal: num('subTotal'), subTotalNulos: num('subTotalNulos'),
    muestraId: strReq('muestraId'), muestraCfdi: str('muestraCfdi'), fechaMax: str('fechaMax'),
  };
}

/** Un plazo del catálogo como llave de mapa (`{dias: 7}` y `'mes_natural'` son distintos). */
const llavePlazo = (p: Plazo): string => JSON.stringify(p);

/** El default que `armar` (facturacion/pendientes.ts) usa sin comercio reconocido. */
const PLAZO_SIN_COMERCIO: Plazo = 'mes_natural';

/** Hasta dónde se busca el corte de un plazo. Los del catálogo son de semanas;
 *  si alguno llegara a exceder esto, `cortesDePlazo` LANZA en vez de adivinar. */
const BUSQUEDA_CORTE_DIAS = 400;

export interface CortesPlazo {
  /** Fechas ISO ascendentes: el primer día NO vencido de cada plazo distinto. */
  cortes: string[];
  /** ¿Un ticket de este plazo, cuya fecha cae en `banda`, ya venció? */
  vencido(plazo: Plazo, banda: number): boolean;
}

/**
 * Los cortes de fecha que hacen de `plazoVencido` una dimensión agrupable.
 *
 * Para un plazo dado, `calcularCaducidad(fecha).vencido` es monótono: vencido
 * para toda fecha anterior a un día, no vencido de ese día en adelante. Ese
 * día es el CORTE del plazo y se encuentra con el reloj REAL (no con una
 * fórmula propia): caminando hacia atrás desde `hoy` hasta el primer día
 * vencido. Con los cortes ordenados, SQL solo cuenta cuántos quedan por
 * encima de la fecha de cada ticket (`banda`), y aquí se decide: un plazo
 * cuyo corte es el j-ésimo (de k) está vencido si la fecha cae debajo de
 * él, o sea si `banda ≥ k − j`.
 */
export function cortesDePlazo(hoy: string): CortesPlazo {
  const plazos = new Map<string, Plazo>([[llavePlazo(PLAZO_SIN_COMERCIO), PLAZO_SIN_COMERCIO]]);
  for (const c of COMERCIOS) plazos.set(llavePlazo(c.plazo), c.plazo);

  const corteDe = new Map<string, string>();
  for (const [llave, plazo] of plazos) {
    let corte: string | null = null;
    for (let atras = 0; atras <= BUSQUEDA_CORTE_DIAS; atras++) {
      const d = new Date(`${hoy}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - atras);
      const fecha = d.toISOString().slice(0, 10);
      if (calcularCaducidad({ fechaTicket: fecha, plazo, hoy }).vencido) break;
      corte = fecha;
    }
    if (corte === null) throw new Error(`cortesDePlazo: el plazo ${llave} no vence en ${BUSQUEDA_CORTE_DIAS} días desde ${hoy}`);
    corteDe.set(llave, corte);
  }
  const cortes = [...new Set(corteDe.values())].sort();
  return {
    cortes,
    vencido(plazo, banda) {
      const corte = corteDe.get(llavePlazo(plazo));
      if (corte === undefined) throw new Error(`cortesDePlazo: plazo ${llavePlazo(plazo)} fuera del catálogo`);
      return banda >= cortes.length - cortes.indexOf(corte);
    },
  };
}

/**
 * ¿El portal ya cerró su plazo para esta celda sin CFDI? El MISMO camino que
 * `armar` (facturacion/pendientes.ts): identificar el comercio por la liga,
 * el RFC o el texto del emisor —aquí el HOST de la liga, que es lo que los
 * dominios del catálogo describen— y, sin comercio, el default conservador.
 * Sin fecha (`banda` nula) no se afirma nada: `null`.
 */
function plazoVencidoDeCelda(c: CeldaCruda, cortes: CortesPlazo): boolean | null {
  if (c.tieneCfdi || c.banda === null) return null;
  const comercio = identificarComercio({
    urlFacturacion: c.host ?? undefined,
    rfcEmisor: c.rfcEmisor ?? undefined,
    textoTicket: c.emisor ?? undefined,
  });
  return cortes.vencido(comercio?.plazo ?? PLAZO_SIN_COMERCIO, c.banda);
}

function aGastoFiscal(c: CeldaCruda, cortes: CortesPlazo): GastoFiscal {
  return {
    id: c.muestraId,
    viajeId: '',
    concepto: c.concepto,
    monto: c.monto,
    fecha: c.sinFecha ? null : c.fechaMax,
    folio: null,
    rfcEmisor: c.rfcEmisor,
    cfdiUuid: c.tieneCfdi ? c.muestraCfdi : null,
    cfdiValido: null,
    estadoSat: c.estadoSat,
    efos: c.efos,
    efosRevisar: c.efosRevisar,
    formaPago: c.formaPago,
    subTotal: c.subTotalNulos >= c.n ? null : c.subTotal,
    ivaTraslado: c.ivaEstado === 'nulo' ? null : c.iva,
    iepsTraslado: c.iepsNulos >= c.n ? null : c.ieps,
    claveProdServ: c.claveProdServ,
    tipoComprobante: null,
    xmlVerificado: null,
    ocrConfianza: null,
    viajeFolio: null,
    operadorNombre: null,
    plazoVencido: plazoVencidoDeCelda(c, cortes),
    celda: {
      n: c.n,
      sobreTopeEfectivo: c.sobreTopeEfectivo,
      ivaEstado: c.ivaEstado,
      iepsNulos: c.iepsNulos,
      subTotalNulos: c.subTotalNulos,
      totalTimbradoDia: c.totalTimbradoDia,
    },
  };
}

/**
 * Los comprobantes del tenant en un periodo, AGREGADOS por dimensión fiscal
 * (ver el encabezado de esta sección). Misma firma y mismo tipo que siempre:
 * cada elemento es un `GastoFiscal`, y las funciones de la ley de arriba lo
 * pesan por `celda.n`. Un viaje de red, sin techo de páginas.
 *
 * `opciones` son las del tenant (`opcionesDe(getConfig)`): de ahí salen el
 * tope de efectivo y el de alimentación con los que SQL parte las filas.
 * Pasarle opciones de OTRO tenant partiría con un tope que no es el suyo;
 * si el llamador no las manda, se leen aquí.
 *
 * `hoy` se inyecta para que una prueba de plazos no dependa del reloj.
 */
export async function getGastosFiscales(
  tenantId: string,
  periodo: Periodo,
  hoy: string = hoyMx(),
  opciones?: OpcionesFiscales,
): Promise<GastoFiscal[]> {
  const o = opciones ?? opcionesDe(await getConfig(tenantId));
  const cortes = cortesDePlazo(hoy);
  const { data, error } = await acotada(supabaseAdmin().rpc('gastos_fiscales_agregados_tenant', {
    p_tenant: tenantId,
    p_desde: periodo.desde,
    p_hasta: periodo.hasta,
    p_tope_efectivo: o.efectivoTopeMxn,
    p_tope_alimentacion: o.viaticosTopeFiscalDiarioMxn,
    p_conceptos_alimentacion: [...CONCEPTOS_CON_TOPE_ALIMENTACION],
    p_cortes: cortes.cortes,
  }), 'getGastosFiscales');
  if (error) throw new Error(`getGastosFiscales: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error(`getGastosFiscales: gastos_fiscales_agregados_tenant devolvió ${typeof data} en vez de un arreglo (¿migración 0151 sin aplicar?)`);
  }
  return data.map((x, i) => aGastoFiscal(leerCelda(x, i), cortes));
}

export interface GastosFiscalesSeries {
  semanal: GastoFiscal[];
  mensual: GastoFiscal[];
  historico: GastoFiscal[];
}

/**
 * Las mismas 3 vistas que las flechas ‹ › de las tarjetas de KPI operativas
 * (`getSeriesKpiCards`, `analytics.ts`) — dirección del 8-ago-2026: "En
 * riesgo/perdido" y "Recuperable pidiendo factura" (Motor fiscal) suben al
 * nivel de KPI y ciclan semanal/mensual/histórico igual que las demás.
 *
 * NO son periodos consecutivos que se restan entre sí como `Periodo`
 * ('mes'/'mes_anterior'/'ejercicio') — son ventanas de días desde HOY,
 * calculadas a mano con el mismo criterio que `diasEjercicio` en
 * `dashboard/page.tsx`. `historico` reusa el `Periodo` real ('todo',
 * `desde`/`hasta` ambos `null`): desde la mig. 0151 una lectura sin cota ya
 * no trae la tabla entera sino sus celdas (acotadas por dimensiones, no por
 * volumen), así que la vista se conserva.
 */
export async function getGastosFiscalesSeries(
  tenantId: string,
  hoy: string = hoyMx(),
): Promise<GastosFiscalesSeries> {
  const haceNDias = (n: number): string => {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  };
  // La config se lee UNA vez para las tres ventanas.
  const o = opcionesDe(await getConfig(tenantId));
  // `clave: 'mes'` es un relleno — `getGastosFiscales` solo lee `desde`/
  // `hasta`, y estas ventanas no son un mes calendario. Se fija a 'mes' en
  // vez de inventar un valor nuevo en `ClavePeriodo` porque esa unión la
  // consume la UI del selector de /dashboard/contador (`SelectorPeriodo`,
  // `urlDePeriodo`) — agregar 'semana' ahí solo para este uso interno habría
  // sido el cambio más grande, no el más chico.
  //
  // ── `allSettled` POR MODO, NO `Promise.all` (FE-4) ───────────────────────
  //
  // No es por rechazos sueltos: `Promise.all` engancha las tres promesas, así
  // que ninguna queda sin escuchar. Es por lo que se puede DECIR después.
  // `Promise.all` se rinde con la PRIMERA que rompe y propaga solo ese error:
  // si la ventana de 7 días truena por un timeout y la histórica truena
  // porque la migración 0151 no está aplicada, el log guarda el timeout y la
  // causa real —la que hay que arreglar— nunca se ve. `allSettled` espera a
  // las tres y nombra TODAS las que fallaron, con la primera razón como
  // `cause` para no perder el stack.
  //
  // Y SIGUE FALLANDO EN BLOQUE A PROPÓSITO: la ventana que no se pudo leer
  // NO se rellena con `[]`. Un arreglo vacío recorre `resumirPerdidas` sin
  // quejarse y sale por pantalla como "$0.00 en riesgo" — una medición que
  // nadie hizo, sobre la cifra que el contador cruza con su papel. Devolver
  // por modo un `null` que la pantalla sepa distinguir exigiría cambiar el
  // tipo de retorno y las dos páginas que lo consumen (Resumen y Contador),
  // que no son de esta pasada. Mientras tanto: las tres o ninguna, con el
  // nombre de la(s) que falló(aron) en el mensaje.
  const modos = ['semanal', 'mensual', 'historico'] as const;
  const r = await Promise.allSettled([
    getGastosFiscales(tenantId, { clave: 'mes', desde: haceNDias(7), hasta: hoy, etiqueta: 'últimos 7 días' }, hoy, o),
    getGastosFiscales(tenantId, { clave: 'mes', desde: haceNDias(30), hasta: hoy, etiqueta: 'últimos 30 días' }, hoy, o),
    getGastosFiscales(tenantId, resolverPeriodo('todo', hoy), hoy, o),
  ]);
  const rotas = r.flatMap((x, i) => (x.status === 'rejected' ? [{ modo: modos[i], razon: x.reason as unknown }] : []));
  if (rotas.length > 0) {
    throw new Error(
      `getGastosFiscalesSeries: ${rotas.map((x) => `${x.modo} (${x.razon instanceof Error ? x.razon.message : String(x.razon)})`).join('; ')}`,
      { cause: rotas[0].razon },
    );
  }
  const [semanal, mensual, historico] = r.map((x) => (x as PromiseFulfilledResult<GastoFiscal[]>).value);
  return { semanal, mensual, historico };
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
    acotada(admin.from('gasto').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId), 'contarGastosDelTenant'),
    acotada(admin.from('gasto').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).is('fecha', null), 'contarGastosDelTenant.sinFecha'),
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
      // DAT-08 (auditoría prod): el rango se armaba con `Z` —medianoche y
      // último milisegundo de LONDRES—, así que el periodo real iba de las
      // 18:00 del día anterior a las 17:59 del último día, en hora de México.
      // Una liquidación cerrada el 31 de diciembre a las 19:00 se contaba en el
      // ejercicio SIGUIENTE, y el rótulo seguía diciendo "del periodo".
      if (periodo.desde) q = q.gte('created_at', inicioDiaMx(periodo.desde));
      if (periodo.hasta) q = q.lte('created_at', finDiaMx(periodo.hasta));
      return acotada(q.order('id').range(desde, hasta), 'getLiquidacionesFiscales');
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
  // Una celda agregada NO es una fila de Excel: su `monto` suma `n`
  // comprobantes y su `cfdi_uuid` es el de uno de muestra. Exportarla
  // inventaría un comprobante que no existe — se rechaza en vez de callarlo.
  const celdas = gastos.filter((g) => g.celda).length;
  if (celdas > 0) {
    throw new Error(`aFilasExport: ${celdas} fila(s) son celdas agregadas (mig. 0151); el export exige comprobantes individuales`);
  }
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
