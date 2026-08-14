// ═══════════════════════════════════════════════════════════════════════════
// EL LIBRO MAYOR DEL VIAJE — la única pregunta que le importa al dueño de la
// flota: "¿este viaje ganó dinero?".
//
// Hasta hoy Likida sabía lo que un viaje GASTÓ (`liquidacion.total_comprobado`)
// y nada de lo que produjo. El esquema ya lo soportaba desde la 0048/0049
// —`viaje.ingreso_flete`, `cliente`, `factura_emitida`, `pago_recibido`,
// `factura_saldo`— pero nadie lo leía POR VIAJE: `getRentabilidad`
// (comercial.ts) lo hace AGREGADO para toda la flota, y un agregado no dice
// cuál ruta hay que dejar de tomar.
//
// ── LA PALABRA "UTILIDAD" NO APARECE EN ESTE ARCHIVO, Y ES A PROPÓSITO ─────
//
// `ingreso − comprobado` NO es utilidad. No resta sueldo del operador,
// mantenimiento, llantas, seguro, depreciación, financiamiento ni
// administración. Un dueño de flota lee "utilidad" y entiende ganancia, y con
// ese nombre tomaría decisiones de tarifa sobre un número que no es el que
// cree. El término contable exacto —ingreso menos costos variables directos—
// es CONTRIBUCIÓN, y además avisa por sí solo que no es la ganancia. El día
// que exista un motor de costo por kilómetro, ESE se podrá llamar utilidad.
// Mismo criterio que ya aplica `Rentabilidad.contribucion` en comercial.ts.
//
// ── NADA SE ESTIMA, Y `null` NUNCA ES CERO ────────────────────────────────
//
// Los cinco huecos que este renglón puede tener son distintos entre sí y se
// dicen distinto:
//
//   · sin `ingreso_flete`   → nadie capturó lo que se cobró.  NO es un flete gratis.
//   · sin liquidación       → nadie cuadró el viaje.          NO es un viaje sin gastos.
//   · sin factura           → no se ha facturado.             NO es una factura en $0.
//   · sin pago              → no se ha cobrado.               NO es un cliente moroso.
//   · sin `vence_en`        → no hay crédito pactado (0049).  NO es una factura vencida.
//
// Por eso `contribucion` y `margenPct` son `number | null`, y cuando son
// `null` el renglón trae en `falta` la frase que dice QUÉ hay que capturar.
// Un 0 en cualquiera de esos huecos se ve exactamente igual que un 0 medido.
//
// ── ESTE MÓDULO LEE DINERO CON LA SERVICE ROLE: EL GATE ES DE LA PÁGINA ───
//
// `cliente`, `factura_emitida`, `pago_recibido` y `factura_saldo` viven detrás
// de `ve_finanzas()` en RLS (0048/0049/0054), pero `supabaseAdmin()` pasa por
// encima de RLS. La puerta real es `puedeVerArea(rol, 'dinero')` en la página
// que llame a esto — y `/dashboard/viajes` es área `operacion`, donde el
// encargado SÍ entra. El 4-ago-2026 esa página ya filtró anticipos al jefe de
// tráfico una vez. Por eso `<LibroDelViaje>` (libro.tsx) exige el permiso como
// prop en vez de confiarlo al integrador.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { exigir, traerTodo, conteo } from './pg';
// `round2` se IMPORTA, no se reimplementa: hay una prueba en `formato.test.ts`
// que falla ante una segunda copia. Dos redondeos distintos hacen que la misma
// cifra fiscal se lea diferente en dos pantallas, y eso se lee como dos
// cálculos distintos.
import { round2, TZ_MX } from '@/lib/formato';

/**
 * Un centavo. Es LA MISMA tolerancia que usa la base: `factura_total_cuadra`
 * (0049) acepta `abs(total - (subtotal + iva)) <= 0.01` y la vista
 * `factura_saldo` considera vencida solo si el saldo pasa de 0.01. Usar aquí
 * un umbral distinto haría que una factura saldada según Postgres apareciera
 * con saldo en pantalla, o al revés.
 */
export const TOLERANCIA_CENTAVO = 0.01;

// ── Los bordes de la lectura ───────────────────────────────────────────────

/**
 * Convierte a número lo que devuelve PostgREST, y devuelve `null` cuando NO
 * hay dato. Es la función que sostiene todo lo demás.
 *
 * `Number(null)` es `0` y `Number('')` también. Ese es el modo de falla
 * dominante de este renglón: un `ingreso_flete` que nadie capturó entra como
 * `0`, la contribución sale igual a menos los gastos, el margen sale −100% y
 * los tres números se ven plausibles. El dueño concluye que la ruta pierde
 * dinero cuando lo único que pasa es que falta teclear el flete.
 *
 * `NaN` e `Infinity` también son `null`: una cifra que no se puede imprimir no
 * es una cifra, y `mxn(NaN)` sale como "$NaN" en la columna que el contralor
 * cruza contra su PDF.
 */
export function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    // `numeric(12,2)` puede llegar como string según el driver; una cadena
    // vacía es un dato ausente, no un cero.
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Suma que se calla si le falta un sumando. `null` si la lista está vacía o si
 * cualquier elemento es `null`.
 *
 * Un total al que le faltó un renglón se ve igual que un total completo, solo
 * que más chico — y a la baja es la dirección que nadie revisa.
 */
export function sumarOCallar(valores: ReadonlyArray<number | null>): number | null {
  if (valores.length === 0) return null;
  let acum = 0;
  for (const v of valores) {
    if (v === null) return null;
    acum += v;
  }
  return round2(acum);
}

/** Solo fecha de calendario: `2026-08-14`. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Días enteros entre dos fechas de calendario, o `null` si alguna no lo es.
 *
 * ACEPTA SOLO `YYYY-MM-DD`, y rechazar lo demás es la decisión, no un descuido.
 * `factura_emitida.fecha` y `vence_en` son `date` en Postgres y llegan así. Si
 * algún día le entrara un `timestamptz`, recortarlo con `.slice(0,10)` se
 * quedaría con el día UTC, y CST es UTC−6: todo lo sellado después de las 18:00
 * hora local contaría un día de más. Es el mismo bug que documenta `fechaMx`
 * en formato.ts, y ahí ya costó que las fechas del PDF salieran corridas.
 *
 * Se compara en UTC porque las dos fechas se construyen en UTC: un día del
 * calendario no tiene zona, y darle una lo corre.
 */
export function diasEntre(desde: unknown, hasta: unknown): number | null {
  if (typeof desde !== 'string' || typeof hasta !== 'string') return null;
  const a = desde.trim(), b = hasta.trim();
  if (!SOLO_FECHA.test(a) || !SOLO_FECHA.test(b)) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / 86_400_000);
}

// ── Contribución y margen ──────────────────────────────────────────────────

/**
 * Ingreso del flete menos lo comprobado en el viaje. NO es la utilidad (ver el
 * encabezado de este archivo).
 *
 * `null` si falta CUALQUIERA de los dos, y ahí está el punto: un viaje con
 * ingreso capturado y SIN liquidación no tiene contribución igual al ingreso.
 * Que nadie haya cuadrado el viaje no significa que no haya gastado diésel;
 * significa que todavía no se sabe cuánto. Devolver el ingreso pelón sería la
 * versión más cara de inventar una cifra: pinta de rentable justo el viaje del
 * que menos se sabe.
 */
export function contribucion(ingreso: number | null, comprobado: number | null): number | null {
  if (ingreso === null || comprobado === null) return null;
  return round2(ingreso - comprobado);
}

/**
 * Contribución como % del ingreso.
 *
 * `null` sin ingreso —no hay contra qué medir— y `null` con ingreso 0, que es
 * división entre cero. Un `0%` afirmaría "este viaje salió a mano", que es una
 * medición, no un hueco.
 */
export function margenPct(ingreso: number | null, contrib: number | null): number | null {
  if (ingreso === null || contrib === null) return null;
  if (ingreso <= 0) return null;
  return round2((contrib / ingreso) * 100);
}

/**
 * QUÉ falta para que la contribución exista. `null` cuando no falta nada.
 *
 * La regla del producto no es "callarse cuando falta el dato": es decir qué
 * falta. Un "—" sin explicación manda al contralor a buscar en qué pantalla se
 * captura eso, y la respuesta más común (el anticipo) es justo la equivocada.
 */
export function faltaParaLaContribucion(ingreso: number | null, comprobado: number | null): string | null {
  const sinIngreso = ingreso === null;
  const sinLiquidacion = comprobado === null;
  if (!sinIngreso && !sinLiquidacion) return null;
  if (sinIngreso && sinLiquidacion) {
    return 'Faltan las dos mitades: el ingreso del flete que le cobras al cliente, y cerrar la liquidación del viaje.';
  }
  if (sinIngreso) {
    return 'Falta capturar el ingreso del flete — lo que le cobras al cliente. El anticipo no sirve: ese es el dinero que le adelantas al operador.';
  }
  return 'Falta cerrar la liquidación del viaje: sin ella no se sabe cuánto se comprobó, y no se supone cero.';
}

// ── Estado documental ──────────────────────────────────────────────────────

export type EstadoDocumental = 'sin_comprobantes' | 'sin_cfdi' | 'parcial' | 'con_cfdi';

export interface Documental {
  estado: EstadoDocumental;
  comprobantes: number;
  conCfdi: number;
  sinCfdi: number;
  /** El texto de la pastilla, ya conjugado — no se arma en la vista. */
  rotulo: string;
}

/**
 * Cuánto del viaje viene respaldado con CFDI.
 *
 * `sin_comprobantes` NO es `sin_cfdi`: un viaje al que nadie le mandó una foto
 * está sin capturar, y uno con seis tickets y ningún UUID está capturado y sin
 * respaldo fiscal. Son dos problemas distintos y se resuelven con dos personas
 * distintas (el operador y el proveedor).
 *
 * `conCfdi` se acota a `comprobantes` por si al llamador se le cruzan los
 * conteos: un "8 de 5 con CFDI" en pantalla destruye la confianza en toda la
 * tabla, y aquí los dos números salen del mismo arreglo.
 */
export function clasificarDocumental(comprobantes: number, conCfdi: number): Documental {
  const total = Math.max(0, Math.trunc(comprobantes));
  const con = Math.min(Math.max(0, Math.trunc(conCfdi)), total);
  const sin = total - con;

  if (total === 0) {
    return { estado: 'sin_comprobantes', comprobantes: 0, conCfdi: 0, sinCfdi: 0, rotulo: 'Sin comprobantes recibidos' };
  }
  // El singular va ESCRITO, no armado con "(s)".
  const cuantos = total === 1 ? '1 comprobante' : `${total} comprobantes`;
  if (con === 0) {
    return {
      estado: 'sin_cfdi', comprobantes: total, conCfdi: 0, sinCfdi: sin,
      rotulo: total === 1 ? '1 comprobante, sin CFDI' : `${cuantos}, ninguno con CFDI`,
    };
  }
  if (sin === 0) {
    return {
      estado: 'con_cfdi', comprobantes: total, conCfdi: con, sinCfdi: 0,
      rotulo: total === 1 ? '1 comprobante, con CFDI' : `${cuantos}, todos con CFDI`,
    };
  }
  return {
    estado: 'parcial', comprobantes: total, conCfdi: con, sinCfdi: sin,
    rotulo: `${con} de ${total} comprobantes con CFDI`,
  };
}

// ── Observaciones fiscales ─────────────────────────────────────────────────

export interface ObservacionFiscal {
  /** El código del motor: `sin_cfdi`, `rfc_receptor`, `efectivo_sobre_tope`… */
  tipo: string;
  /** La frase en español que ya escribió el motor. `null` si la fila no la trae. */
  nota: string | null;
  /** El monto señalado. `null` cuando la observación no lleva importe. */
  monto: number | null;
}

/**
 * Lee `liquidacion.diferencias` (jsonb) sin creerle a su forma.
 *
 * Es una columna jsonb escrita por el motor y por versiones anteriores del
 * motor: una fila vieja puede traer `null`, un objeto suelto o un elemento sin
 * `nota`. Un `.map()` optimista sobre eso revienta la página entera de un viaje
 * por una fila de 2026-07. Lo que no se pueda leer se salta; lo que se lea sale
 * tal cual, sin reescribir la frase del motor (esa ya cita su fundamento).
 *
 * Devuelve `[]` para "no hay observaciones". El llamador distingue eso de "no
 * hay liquidación" por `RenglonLibro.observaciones === null`, que no es lo mismo.
 */
export function leerObservaciones(diferencias: unknown): ObservacionFiscal[] {
  if (!Array.isArray(diferencias)) return [];
  const salida: ObservacionFiscal[] = [];
  for (const d of diferencias) {
    if (d === null || typeof d !== 'object') continue;
    const o = d as Record<string, unknown>;
    if (typeof o.tipo !== 'string' || o.tipo.trim() === '') continue;
    const nota = typeof o.nota === 'string' && o.nota.trim() !== '' ? o.nota.trim() : null;
    salida.push({ tipo: o.tipo.trim(), nota, monto: aNumero(o.monto) });
  }
  return salida;
}

// ── Facturación y cobro ────────────────────────────────────────────────────

export type EstadoFacturacion = 'sin_factura' | 'solo_borrador' | 'facturado' | 'cancelada';
/** `sin_dato` no es un estado de la cobranza, es un estado de la LECTURA: la
 *  factura existe y su saldo no se pudo leer. Sin él, ese caso caería en
 *  `sin_cobrar` y la pantalla acusaría de moroso a un cliente que quizá ya pagó. */
export type EstadoCobro = 'sin_factura' | 'sin_dato' | 'sin_cobrar' | 'parcial' | 'cobrado';

export interface FacturaDelViaje {
  id: string;
  folio: string | null;
  /** `factura_emitida.fecha`, un `date`: `2026-08-14`. */
  fecha: string | null;
  /** borrador | emitida | pagada | cancelada (dominio de la 0049). */
  estatus: string;
  total: number | null;
  /** Abonado, de la vista `factura_saldo`. `null` = no se pudo leer su saldo. */
  pagado: number | null;
  saldo: number | null;
  /** `null` = el cliente no tiene días de crédito pactados (0048/0049). */
  venceEn: string | null;
  /**
   * La factura ampara MÁS viajes que éste (`factura_viaje`, 0049). Cuando es
   * `true` sus importes NO son de este viaje y no se le pueden atribuir.
   */
  amparaVarios: boolean;
}

export interface Cobro {
  estadoFacturacion: EstadoFacturacion;
  estadoCobro: EstadoCobro;
  /** Suma de las facturas VIVAS. `null` si alguna no se pudo leer. */
  totalFacturado: number | null;
  totalCobrado: number | null;
  saldo: number | null;
  /** Días que lleva sin cobrarse la factura viva más ANTIGUA con saldo. */
  diasPorCobrar: number | null;
  /** Días que lleva vencida la más atrasada. `null` si ninguna pasó su fecha. */
  diasVencida: number | null;
  /** Hay factura viva sin `vence_en`: su cliente no tiene crédito pactado. */
  sinCondiciones: boolean;
  /** Alguna factura ampara varios viajes: los importes de arriba no son de éste. */
  importesCompartidos: boolean;
  facturas: readonly FacturaDelViaje[];
}

/** Viva = ya se emitió y no se canceló. Un borrador no es una factura todavía. */
function esViva(f: FacturaDelViaje): boolean {
  return f.estatus !== 'borrador' && f.estatus !== 'cancelada';
}

/**
 * El estado de facturación y cobro del viaje, y los días que lleva el dinero
 * afuera.
 *
 * ── POR QUÉ NO SE LEE `factura_saldo.vencida` ──────────────────────────────
 * La vista la calcula con `current_date` DEL SERVIDOR de Postgres, y este
 * renglón fija su "hoy" en hora de México para los días por cobrar. Dos "hoy"
 * distintos en el mismo renglón dejan pasar la combinación imposible: una
 * factura marcada "vencida" junto a "0 días vencida". Aquí el criterio de
 * vencimiento se deriva UNA vez, de `venceEn` contra el mismo `hoy` que todo
 * lo demás. Los importes sí vienen de la vista: el saldo se deriva de los
 * pagos y no se guarda (0049), justamente para que no se desincronice.
 *
 * `hoy` entra por parámetro —no se lee del reloj aquí dentro— para que la
 * función sea probable sin congelar el tiempo, igual que `getTickets`.
 */
export function resumirCobro(facturas: ReadonlyArray<FacturaDelViaje>, hoy: string): Cobro {
  const vivas = facturas.filter(esViva);
  const importesCompartidos = facturas.some((f) => f.amparaVarios);

  const estadoFacturacion: EstadoFacturacion =
    facturas.length === 0 ? 'sin_factura'
      : vivas.length > 0 ? 'facturado'
        : facturas.some((f) => f.estatus === 'borrador') ? 'solo_borrador'
          : 'cancelada';

  if (vivas.length === 0) {
    // Sin factura viva no hay nada que cobrar, y eso NO es "cobrado $0": es que
    // todavía no se le pidió el dinero al cliente.
    return {
      estadoFacturacion,
      estadoCobro: 'sin_factura',
      totalFacturado: null,
      totalCobrado: null,
      saldo: null,
      diasPorCobrar: null,
      diasVencida: null,
      sinCondiciones: false,
      importesCompartidos,
      facturas,
    };
  }

  const totalFacturado = sumarOCallar(vivas.map((f) => f.total));
  const totalCobrado = sumarOCallar(vivas.map((f) => f.pagado));
  const saldo = sumarOCallar(vivas.map((f) => f.saldo));

  // Con saldo desconocido no se afirma ni "cobrado" ni "sin cobrar": las dos
  // serían una conclusión sobre un dato que no se leyó.
  const conSaldo = vivas.filter((f) => f.saldo !== null && f.saldo > TOLERANCIA_CENTAVO);
  // El SALDO manda, y se pregunta primero. Al revés (mirando lo abonado antes
  // que lo que falta), una factura de $0 —el flete de cortesía, la nota a
  // precio cero— caía en "sin cobrar" con nada que cobrar: la cartera del
  // cliente salía con un pendiente que no existe.
  const estadoCobro: EstadoCobro =
    totalCobrado === null || saldo === null ? 'sin_dato'
      : saldo <= TOLERANCIA_CENTAVO ? 'cobrado'
        : totalCobrado <= TOLERANCIA_CENTAVO ? 'sin_cobrar'
          : 'parcial';

  // La más ANTIGUA con saldo: es la que de verdad mide cuánto lleva el dinero
  // afuera. Promediar las fechas de varias facturas daría un número que no
  // corresponde a ninguna.
  const dias = conSaldo
    .map((f) => diasEntre(f.fecha, hoy))
    .filter((d): d is number => d !== null);
  const diasPorCobrar = dias.length > 0 ? Math.max(...dias) : null;

  const vencidas = conSaldo
    .map((f) => diasEntre(f.venceEn, hoy))
    .filter((d): d is number => d !== null && d > 0);
  const diasVencida = vencidas.length > 0 ? Math.max(...vencidas) : null;

  return {
    estadoFacturacion,
    estadoCobro,
    totalFacturado,
    totalCobrado,
    saldo,
    diasPorCobrar,
    diasVencida,
    // Sin fecha pactada no se puede decir que algo se venció: no se pactó cuándo.
    sinCondiciones: vivas.some((f) => f.venceEn === null),
    importesCompartidos,
    facturas,
  };
}

/** El rótulo de la columna "Facturado". Vive aquí para que diga lo mismo en
 *  cada pantalla que muestre el renglón. */
export function rotuloFacturacion(e: EstadoFacturacion): string {
  switch (e) {
    case 'sin_factura': return 'Sin facturar';
    case 'solo_borrador': return 'Solo borrador';
    case 'facturado': return 'Facturado';
    case 'cancelada': return 'Factura cancelada';
  }
}

/** El rótulo de la columna "Cobrado". */
export function rotuloCobro(e: EstadoCobro): string {
  switch (e) {
    case 'sin_factura': return 'Nada que cobrar todavía';
    case 'sin_dato': return 'No se pudo leer el saldo';
    case 'sin_cobrar': return 'Sin cobrar';
    case 'parcial': return 'Cobrado en parte';
    case 'cobrado': return 'Cobrado';
  }
}

// ── El renglón ─────────────────────────────────────────────────────────────

export interface RenglonLibro {
  viajeId: string;
  folio: string;
  /** `Monterrey → Querétaro`, o lo que haya. `null` si no se capturó ninguno. */
  ruta: string | null;
  fechaInicio: string | null;
  estatus: string;
  cliente: string | null;
  /** Número económico de la unidad. `null` = el viaje entró por WhatsApp (0047). */
  unidad: string | null;
  operador: string | null;
  ingreso: number | null;
  /** `liquidacion.total_comprobado`. `null` = el viaje no tiene liquidación. */
  comprobado: number | null;
  contribucion: number | null;
  margenPct: number | null;
  /** Qué falta para que contribución y margen existan. `null` = no falta nada. */
  falta: string | null;
  liquidacionId: string | null;
  documental: Documental;
  /** `null` = no hay liquidación. `[]` = la hay y salió limpia. No es lo mismo. */
  observaciones: ObservacionFiscal[] | null;
  cobro: Cobro;
}

/** Lo que `armarRenglon` necesita, ya leído. Separado de la consulta para que
 *  todo el criterio del renglón se pueda probar sin base de datos. */
export interface EntradaLibro {
  viaje: {
    id: string;
    folio: string | null;
    origen: string | null;
    destino: string | null;
    fechaInicio: string | null;
    estatus: string;
    /** Crudo a propósito: `aNumero` es quien decide si hay dato. */
    ingresoFlete: unknown;
  };
  cliente: string | null;
  unidad: string | null;
  operador: string | null;
  /** `null` = el viaje NO tiene liquidación. Distinto de una con total 0. */
  liquidacion: { id: string; totalComprobado: unknown; diferencias: unknown } | null;
  comprobantes: { total: number; conCfdi: number };
  facturas: ReadonlyArray<FacturaDelViaje>;
  hoy: string;
}

/**
 * Arma el renglón completo. PURA: sin I/O, sin reloj, sin `supabaseAdmin`.
 *
 * Todo el criterio del libro mayor vive aquí, y `getLibroViaje` solo le pone la
 * lectura enfrente. Es lo que permite fijar en pruebas los cinco huecos del
 * encabezado sin montar un mock de PostgREST — que además aceptaría cualquier
 * `.select()` y no probaría la consulta de todos modos.
 */
export function armarRenglon(e: EntradaLibro): RenglonLibro {
  const ingreso = aNumero(e.viaje.ingresoFlete);
  // Sin liquidación el comprobado es DESCONOCIDO, no cero. `total_comprobado`
  // es `not null default 0` en la tabla, así que un 0 aquí sí es un 0 medido:
  // el viaje se cuadró y no se comprobó nada. Los dos casos se ven igual en
  // pantalla si se aplastan, y significan cosas opuestas.
  const comprobado = e.liquidacion === null ? null : aNumero(e.liquidacion.totalComprobado);
  const contrib = contribucion(ingreso, comprobado);

  const ruta = e.viaje.origen && e.viaje.destino
    ? `${e.viaje.origen} → ${e.viaje.destino}`
    : e.viaje.origen ?? e.viaje.destino ?? null;

  return {
    viajeId: e.viaje.id,
    // Mismo respaldo que `getLiquidacionDetalle`: `viaje.folio` es nullable y
    // un renglón sin encabezado no se puede citar por teléfono.
    folio: e.viaje.folio ?? e.viaje.id.slice(0, 8),
    ruta,
    fechaInicio: e.viaje.fechaInicio,
    estatus: e.viaje.estatus,
    cliente: e.cliente,
    unidad: e.unidad,
    operador: e.operador,
    ingreso,
    comprobado,
    contribucion: contrib,
    margenPct: margenPct(ingreso, contrib),
    falta: faltaParaLaContribucion(ingreso, comprobado),
    liquidacionId: e.liquidacion?.id ?? null,
    documental: clasificarDocumental(e.comprobantes.total, e.comprobantes.conCfdi),
    observaciones: e.liquidacion === null ? null : leerObservaciones(e.liquidacion.diferencias),
    cobro: resumirCobro(e.facturas, e.hoy),
  };
}

// ── La lectura ─────────────────────────────────────────────────────────────

/**
 * El renglón del libro mayor de UN viaje, o `null` si ese viaje no es de esta
 * flota.
 *
 * `null` significa AHORA una sola cosa —no existe aquí— porque `exigir()`
 * traduce el error por valor de supabase-js a una excepción. Sin eso, una base
 * caída se leería como "ese viaje no existe" y la página respondería un 404
 * sobre un viaje real (es el bug que ya se pagó en `getLiquidacionDetalle`).
 *
 * NINGÚN EMBED. La 0075 dejó DOS relaciones entre `viaje`↔`operador`,
 * `gasto`→`viaje` y `liquidacion`→`viaje`, así que un `operador(nombre)` a
 * secas lo rechaza PostgREST en runtime y ni `tsc` ni un mock lo ven
 * (`embeds_con_alias.test.ts`). Son lecturas puntuales de una sola fila: seis
 * consultas en paralelo cuestan menos que una clase de bug que ya tumbó tres
 * caminos en producción el 14-ago-2026.
 *
 * `hoy` por parámetro, en hora de México, como en el resto de `analytics.ts`:
 * los días por cobrar son del cliente, no del servidor.
 */
export async function getLibroViaje(
  tenantId: string,
  viajeId: string,
  hoy: string = new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(new Date()),
): Promise<RenglonLibro | null> {
  const admin = supabaseAdmin();

  const resViaje = await admin
    .from('viaje')
    .select('id, folio, origen, destino, fecha_inicio, estatus, cliente_id, unidad_id, operador_id, ingreso_flete')
    .eq('id', viajeId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  const v = exigir(resViaje, 'getLibroViaje.viaje');
  if (!v) return null;

  const clienteId = (v.cliente_id as string | null) ?? null;
  const unidadId = (v.unidad_id as string | null) ?? null;
  const operadorId = (v.operador_id as string | null) ?? null;

  const [cliente, unidad, operador, liq, gastos, directas, ligas] = await Promise.all([
    clienteId
      ? admin.from('cliente').select('nombre').eq('id', clienteId).eq('tenant_id', tenantId).maybeSingle()
        .then((r) => exigir(r, 'getLibroViaje.cliente'))
      : Promise.resolve(null),
    unidadId
      ? admin.from('unidad').select('numero_economico').eq('id', unidadId).eq('tenant_id', tenantId).maybeSingle()
        .then((r) => exigir(r, 'getLibroViaje.unidad'))
      : Promise.resolve(null),
    operadorId
      ? admin.from('operador').select('nombre').eq('id', operadorId).eq('tenant_id', tenantId).maybeSingle()
        .then((r) => exigir(r, 'getLibroViaje.operador'))
      : Promise.resolve(null),
    // `maybeSingle` es seguro: `liquidacion_viaje_uidx` (0005) admite UNA
    // liquidación por viaje. Si un día deja de ser única, esto falla ruidoso
    // en vez de elegir en silencio cuál de las dos enseñar.
    admin.from('liquidacion').select('id, total_comprobado, diferencias')
      .eq('viaje_id', viajeId).eq('tenant_id', tenantId).maybeSingle()
      .then((r) => exigir(r, 'getLibroViaje.liquidacion')),
    traerTodo<{ id: unknown; cfdi_uuid: unknown }>(
      (d, h) => admin.from('gasto').select('id, cfdi_uuid', conteo(d))
        .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('id').range(d, h),
      'getLibroViaje.gasto',
    ),
    traerTodo<{ id: unknown; folio: unknown; fecha: unknown; estatus: unknown; total: unknown }>(
      (d, h) => admin.from('factura_emitida').select('id, folio, fecha, estatus, total', conteo(d))
        .eq('tenant_id', tenantId).eq('viaje_id', viajeId).order('id').range(d, h),
      'getLibroViaje.factura_directa',
    ),
    // `factura_viaje` NO tiene `tenant_id` (hereda el de su factura, 0049), así
    // que aquí solo se recogen ids: el filtro por flota se aplica al leer
    // `factura_emitida`, que sí lo tiene. Un id de otra flota entra a esta
    // lista y sale sin fila en el paso siguiente.
    traerTodo<{ factura_id: unknown }>(
      (d, h) => admin.from('factura_viaje').select('factura_id', conteo(d))
        .eq('viaje_id', viajeId).order('factura_id').range(d, h),
      'getLibroViaje.factura_viaje',
    ),
  ]);

  const porId = new Map<string, { folio: string | null; fecha: string | null; estatus: string; total: number | null }>();
  for (const f of directas) {
    porId.set(f.id as string, {
      folio: (f.folio as string) ?? null,
      fecha: (f.fecha as string) ?? null,
      estatus: String(f.estatus),
      total: aNumero(f.total),
    });
  }

  const idsLigados = [...new Set(ligas.map((l) => l.factura_id as string))].filter((id) => !porId.has(id));
  if (idsLigados.length > 0) {
    const extra = await traerTodo<{ id: unknown; folio: unknown; fecha: unknown; estatus: unknown; total: unknown }>(
      (d, h) => admin.from('factura_emitida').select('id, folio, fecha, estatus, total', conteo(d))
        .eq('tenant_id', tenantId).in('id', idsLigados).order('id').range(d, h),
      'getLibroViaje.factura_ligada',
    );
    for (const f of extra) {
      porId.set(f.id as string, {
        folio: (f.folio as string) ?? null,
        fecha: (f.fecha as string) ?? null,
        estatus: String(f.estatus),
        total: aNumero(f.total),
      });
    }
  }

  const ids = [...porId.keys()];
  let facturas: FacturaDelViaje[] = [];
  if (ids.length > 0) {
    const [saldos, cobertura] = await Promise.all([
      // El saldo NO es una columna: se deriva de los pagos (0049). Leerlo de la
      // vista es lo que impide que la pantalla y la suma de pagos digan cosas
      // distintas del mismo dinero.
      traerTodo<{ factura_id: unknown; pagado: unknown; saldo: unknown; vence_en: unknown }>(
        (d, h) => admin.from('factura_saldo').select('factura_id, pagado, saldo, vence_en', conteo(d))
          .eq('tenant_id', tenantId).in('factura_id', ids).order('factura_id').range(d, h),
        'getLibroViaje.factura_saldo',
      ),
      // Cuántos viajes ampara cada una de esas facturas. Sin esto, una factura
      // que cubre cinco viajes pintaría sus $180,000 completos en el renglón de
      // uno solo, y el margen de ese viaje saldría cinco veces mejor de lo que es.
      traerTodo<{ factura_id: unknown; viaje_id: unknown }>(
        (d, h) => admin.from('factura_viaje').select('factura_id, viaje_id', conteo(d))
          .in('factura_id', ids).order('factura_id').order('viaje_id').range(d, h),
        'getLibroViaje.cobertura',
      ),
    ]);

    const saldoPorId = new Map(saldos.map((s) => [s.factura_id as string, s]));
    const viajesPorFactura = new Map<string, Set<string>>();
    for (const c of cobertura) {
      const fid = c.factura_id as string;
      const set = viajesPorFactura.get(fid) ?? new Set<string>();
      set.add(c.viaje_id as string);
      viajesPorFactura.set(fid, set);
    }

    facturas = ids.map((id) => {
      const base = porId.get(id)!;
      const s = saldoPorId.get(id);
      return {
        id,
        folio: base.folio,
        fecha: base.fecha,
        estatus: base.estatus,
        total: base.total,
        // Sin fila en la vista el saldo es DESCONOCIDO. No se sustituye por el
        // total ni por 0: lo primero afirmaría que nadie ha pagado, lo segundo
        // que ya está saldada, y las dos son conclusiones sobre un dato ausente.
        pagado: s ? aNumero(s.pagado) : null,
        saldo: s ? aNumero(s.saldo) : null,
        venceEn: s ? ((s.vence_en as string) ?? null) : null,
        amparaVarios: (viajesPorFactura.get(id)?.size ?? 0) > 1,
      };
    });
  }

  return armarRenglon({
    viaje: {
      id: v.id as string,
      folio: (v.folio as string) ?? null,
      origen: (v.origen as string) ?? null,
      destino: (v.destino as string) ?? null,
      fechaInicio: (v.fecha_inicio as string) ?? null,
      estatus: String(v.estatus),
      ingresoFlete: v.ingreso_flete,
    },
    cliente: (cliente?.nombre as string) ?? null,
    unidad: (unidad?.numero_economico as string) ?? null,
    operador: (operador?.nombre as string) ?? null,
    liquidacion: liq
      ? { id: liq.id as string, totalComprobado: liq.total_comprobado, diferencias: liq.diferencias }
      : null,
    comprobantes: {
      total: gastos.length,
      // La prueba de que un gasto trae CFDI es el UUID, no `cfdi_valido` (que
      // es nullable y significa "no se pudo verificar", no "no lo tiene").
      conCfdi: gastos.filter((g) => typeof g.cfdi_uuid === 'string' && g.cfdi_uuid.trim() !== '').length,
    },
    facturas,
    hoy,
  });
}
