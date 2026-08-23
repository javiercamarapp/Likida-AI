// ═══════════════════════════════════════════════════════════════════════════
// FACTURACIÓN A CLIENTES — qué facturé, a quién, desde hace cuánto me deben, y
// qué viajes ya se liquidaron sin que nadie los facturara.
//
// La ruta `/dashboard/facturacion` llevaba días PINTADA en el sidebar
// (`rutas.ts`) y CLASIFICADA como área `dinero` (`visibilidad.ts`), y la página
// no existía: el link daba 404 en producción. Este módulo es el motor que la
// enciende.
//
// ── LO QUE ESTE ARCHIVO NO ES ─────────────────────────────────────────────
//
// No es un segundo `getCobranza`. Ése ya existe (`comercial.ts`) y se REUSA tal
// cual: lee `factura_emitida` + la vista `factura_saldo` + `cliente` y devuelve
// el renglón de cada factura con su saldo derivado. Lo que le faltaba para que
// una pantalla de cobranza sirva son tres cosas, y son las que se agregan aquí:
//
//   1. la ANTIGÜEDAD del saldo (corriente / 1-30 / 31-60 / más de 60),
//   2. el corte POR CLIENTE, que es como se cobra de verdad (se le habla a una
//      persona, no a una factura),
//   3. los viajes LIQUIDADOS Y SIN FACTURAR — el dinero que se queda en la mesa
//      y que hoy no aparece en ninguna pantalla del producto.
//
// ── LOS DOS "HOY" SON EL BUG QUE ESTE ARCHIVO EXISTE PARA NO REPETIR ───────
//
// La vista `factura_saldo` (0049) trae una columna `vencida` calculada con el
// `current_date` DEL SERVIDOR de Postgres. Si esta pantalla la imprimiera Y
// además contara los días contra su propio "hoy", los dos relojes se separarían
// y saldría la combinación imposible que ya se documentó hoy en `libro_viaje.ts`:
// «vencida · 0 días vencida». Aquí el vencimiento se deriva UNA sola vez, de
// `vence_en` contra UN solo `hoy`, y la columna `vencida` de la vista se
// DESCARTA a propósito (ver `armarCartera`). Los IMPORTES sí vienen de la vista:
// el saldo se deriva de los pagos y no se guarda, justamente para que no se
// desincronice al cancelar un pago.
//
// ── `null` NO ES `0`, Y AQUÍ ESO DECIDE A QUIÉN SE LE HABLA HOY ────────────
//
//   · sin `vence_en`      → el cliente no tiene crédito pactado (0048/0049).
//                           NO es una factura corriente ni una vencida: no se
//                           pactó cuándo. Tiene cubeta propia.
//   · sin `ingreso_flete` → nadie capturó lo que se cobró por ese viaje.
//                           NO es un flete gratis; no entra a la suma.
//   · sin factura         → no se ha facturado. NO es una factura en $0.
//   · solo borrador       → alguien la empezó y no la timbró. NO es facturado
//                           (Likida no es PAC: el UUID llega de fuera), pero
//                           tampoco es "nadie la ha tocado".
//
// ── ESTE MÓDULO LEE DINERO CON LA SERVICE ROLE: EL GATE ES DE LA PÁGINA ────
//
// `factura_emitida`, `pago_recibido`, `factura_viaje` y `factura_saldo` viven
// detrás de `ve_finanzas()` en RLS (0049), pero `supabaseAdmin()` pasa por
// encima de RLS. La puerta real es `puedeVerRuta(rol, '/dashboard/facturacion')`
// en la página — la ruta ya está declarada como área `dinero`, que es lo que
// deja fuera al encargado (jefe de tráfico).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from './presupuesto';
// Los validadores de forma de la 0152 viven en comercial.ts junto a las otras
// RPC del lado del ingreso; `FacturaRow` es la forma que `armarCartera` recibe.
import { esNumero, esNumeroONulo, esObjeto, esTextoONulo, formaInesperada, type FacturaRow } from './comercial';
// Se importan, no se reimplementan. `diasEntre` ya rechaza cualquier cosa que no
// sea `AAAA-MM-DD` a propósito (un `.slice(0,10)` sobre un `timestamptz` se
// queda con el día UTC y CST es UTC−6), y `aNumero` es lo que impide que un
// `null` entre como 0.
import { aNumero, diasEntre, TOLERANCIA_CENTAVO } from './libro_viaje';
// `round2` se IMPORTA: hay una prueba en `formato.test.ts` que falla ante una
// segunda copia. Dos redondeos distintos hacen que la misma cifra fiscal se lea
// diferente en dos pantallas, y eso se lee como dos cálculos distintos.
import { round2, hoyMx } from '@/lib/formato';

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA — sin una sola consulta, sin reloj. Es la que se prueba.
// ═══════════════════════════════════════════════════════════════════════════

/** Un día del calendario, sin hora: `2026-08-14`. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * El día del CALENDARIO MEXICANO de un valor de la base.
 *
 * EXISTE POR UN BUG CONCRETO Y CARO. `liquidacion.created_at` es `timestamptz` y
 * llega como `2026-08-14T02:30:00Z`. Recortarlo con `.slice(0, 10)` toma el día
 * UTC, y CST es UTC−6: una liquidación cerrada el 13 de agosto a las 20:30 hora
 * de México sale fechada el 14. Las liquidaciones se cierran DE NOCHE, al
 * terminar el viaje, así que ese corrimiento no es un caso raro — es el caso
 * normal. Con él, "lleva 3 días sin facturar" se imprime como 2, y en el corte
 * de fin de mes un viaje del 31 de julio cuenta en agosto.
 *
 * UN VALOR DE SOLO FECHA SE DEVUELVE TAL CUAL, y es la otra mitad de la lección
 * (la misma que documenta `fechaMx` en formato.ts): `viaje.fecha_fin` es `date`,
 * no tiene zona, y convertirlo a hora de México lo correría un día HACIA ATRÁS.
 * Un día del calendario es un día del calendario; darle zona es inventarle una.
 *
 * `null` para lo que no se puede leer: una fecha ilegible no es una fecha, y de
 * ella no se deriva ningún "lleva N días".
 */
export function diaMx(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const t = valor.trim();
  if (t === '') return null;
  if (SOLO_FECHA.test(t)) return t;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  // `en-CA` es el locale que imprime AAAA-MM-DD, que es el formato con el que
  // `diasEntre` sabe trabajar y el único que se compara bien como string.
  return hoyMx(d);
}

// ── Antigüedad de saldos ───────────────────────────────────────────────────

export type ClaveCubeta = 'corriente' | 'v1_30' | 'v31_60' | 'v60_mas' | 'sin_fecha';

/**
 * Las cubetas de la cartera, EN EL ORDEN EN QUE SE PINTAN.
 *
 * ── DÓNDE CAE EL DÍA 60, Y POR QUÉ SE DECIDE EN VEZ DE DEJARLO AL AZAR ─────
 * "31-60 / más de 60" es como lo escribe un contador, y leído literal el día 60
 * cabe en las dos. Aquí el 60 es de la cubeta 31-60 (rango cerrado) y "más de
 * 60" empieza en el 61. Si no se decidiera, el mismo saldo cambiaría de columna
 * según qué comparación se escribiera primero, y la suma de las cubetas dejaría
 * de cuadrar con el total por cobrar — que es la única prueba que un contralor
 * le puede hacer a esta tabla de un vistazo.
 *
 * `sin_fecha` NO ES UNA CUBETA DE ANTIGÜEDAD y por eso va al final, separada.
 * Una factura de un cliente sin días de crédito pactados no está "corriente"
 * (eso afirmaría que todavía no le toca pagar) ni vencida (eso afirmaría que ya
 * se pasó de una fecha que nadie pactó). La 0049 lo dice en el comentario de la
 * columna: NULL es "sin condiciones registradas".
 */
export const CUBETAS: ReadonlyArray<{ clave: ClaveCubeta; rotulo: string; ayuda: string }> = [
  { clave: 'corriente', rotulo: 'Corriente', ayuda: 'Todavía no llega su fecha de pago' },
  { clave: 'v1_30', rotulo: '1 a 30 días', ayuda: 'Vencidas hace un mes o menos' },
  { clave: 'v31_60', rotulo: '31 a 60 días', ayuda: 'Vencidas hace uno o dos meses' },
  { clave: 'v60_mas', rotulo: 'Más de 60 días', ayuda: 'Vencidas hace más de dos meses' },
  { clave: 'sin_fecha', rotulo: 'Sin fecha pactada', ayuda: 'Su cliente no tiene días de crédito registrados' },
];

/** Las tres que SÍ significan vencido. `corriente` y `sin_fecha` no lo son. */
export const CUBETAS_VENCIDAS: ReadonlyArray<ClaveCubeta> = ['v1_30', 'v31_60', 'v60_mas'];

export interface Antiguedad {
  cubeta: ClaveCubeta;
  /** Días que lleva vencida. `null` cuando NO está vencida o no hay fecha. */
  diasVencida: number | null;
  /** El texto de la pastilla, ya conjugado — no se arma en la vista. */
  rotulo: string;
}

/**
 * En qué cubeta cae una factura, y cuántos días lleva vencida.
 *
 * UN SOLO `hoy`, POR PARÁMETRO. Es la regla que este archivo defiende: el
 * rótulo "vencida" y el número de días salen del MISMO cálculo, así que no
 * pueden contradecirse. La combinación «vencida · 0 días vencida» —que es la
 * que ya se documentó en `libro_viaje.ts`— aquí no es posible: `diasVencida`
 * solo existe cuando la cubeta es una de las tres vencidas, y esas empiezan en
 * el día 1.
 *
 * EL DÍA DEL VENCIMIENTO TODAVÍA NO ESTÁ VENCIDO. `dias === 0` es corriente, y
 * espeja exactamente el `f.vence_en < current_date` de la vista `factura_saldo`
 * (0049): con `<=` la factura se pintaría de rojo el mismo día en que el cliente
 * todavía está a tiempo de pagarla, y alguien le hablaría a reclamarle.
 */
export function clasificarAntiguedad(venceEn: string | null | undefined, hoy: string): Antiguedad {
  if (venceEn == null) {
    return {
      cubeta: 'sin_fecha',
      diasVencida: null,
      rotulo: 'Sin crédito pactado',
    };
  }

  const dias = diasEntre(venceEn, hoy);
  if (dias === null) {
    // Una fecha que no se puede leer no es una fecha. No se supone vigente (eso
    // escondería un saldo que quizá lleva medio año afuera) ni vencida (eso
    // acusaría a un cliente por un dato ilegible): se dice.
    return {
      cubeta: 'sin_fecha',
      diasVencida: null,
      rotulo: 'No se pudo leer su vencimiento',
    };
  }

  if (dias <= 0) {
    const faltan = -dias;
    return {
      cubeta: 'corriente',
      diasVencida: null,
      rotulo: faltan === 0 ? 'Vence hoy' : faltan === 1 ? 'Vence mañana' : `Vence en ${faltan} días`,
    };
  }

  // El singular va ESCRITO. Un "(s)" de plantilla en la pantalla que el
  // contralor cruza contra su estado de cuenta se lee como software sin
  // terminar.
  const rotulo = dias === 1 ? 'Vencida ayer' : `Vencida hace ${dias} días`;
  const cubeta: ClaveCubeta = dias <= 30 ? 'v1_30' : dias <= 60 ? 'v31_60' : 'v60_mas';
  return { cubeta, diasVencida: dias, rotulo };
}

/**
 * Viva = ya se emitió y no se canceló.
 *
 * Un borrador NO es una factura todavía —Likida no timbra, así que el UUID del
 * CFDI llega de fuera (0049)— y una cancelada no es dinero que alguien deba.
 * Sumar cualquiera de las dos al "por cobrar" infla la cartera con papel que no
 * cobra nadie. Mismo criterio que `esViva` en `libro_viaje.ts` y que el filtro
 * de `getCobranza`.
 */
export function esFacturaViva(estatus: string): boolean {
  return estatus !== 'borrador' && estatus !== 'cancelada';
}

export interface RenglonCartera {
  id: string;
  folio: string | null;
  cliente: string;
  /** `factura_emitida.fecha`, un `date`: `2026-08-14`. */
  fecha: string;
  total: number;
  pagado: number;
  saldo: number;
  /** borrador | emitida | pagada | cancelada (dominio de la 0049). */
  estatus: string;
  venceEn: string | null;
  viva: boolean;
  /** Le queda saldo por encima del centavo de tolerancia de la base. */
  conSaldo: boolean;
  antiguedad: Antiguedad;
}

export interface Cubeta {
  clave: ClaveCubeta;
  rotulo: string;
  ayuda: string;
  saldo: number;
  facturas: number;
}

export interface ClienteCartera {
  cliente: string;
  facturado: number;
  cobrado: number;
  saldo: number;
  vencido: number;
  facturas: number;
  /** Saldo de ese cliente en cada cubeta. Las cinco claves siempre presentes. */
  porCubeta: Record<ClaveCubeta, number>;
  /** Días que lleva vencida la más atrasada de ese cliente. `null` si ninguna. */
  diasMasVencido: number | null;
}

export interface CarteraAntiguedad {
  /** Incluidos borradores y canceladas — la pantalla los distingue. Desde la
   *  0152 es UNA PÁGINA (≤100, las más vencidas primero); `facturasTotal`
   *  dice cuántas hay. Los agregados de abajo son sobre TODAS. */
  facturas: RenglonCartera[];
  facturasTotal: number;
  /** Cuántas están vivas (emitidas o pagadas). */
  vivas: number;
  borradores: number;
  canceladas: number;
  /** Suma del total de las facturas VIVAS: lo que se le facturó al cliente. */
  facturado: number;
  cobrado: number;
  /** Saldo vivo. Es EXACTAMENTE la suma de las cinco cubetas: un residuo por
   *  debajo del centavo de tolerancia no entra ni aquí ni allá. */
  porCobrar: number;
  /** Solo las tres cubetas vencidas. NO incluye `sin_fecha`. */
  vencido: number;
  cubetas: Cubeta[];
  clientes: ClienteCartera[];
  /** Facturas vivas CON saldo y sin fecha pactada — no entran a "vencido". */
  sinCondiciones: number;
  /** El día contra el que se juzgó TODO lo de arriba. Uno solo. */
  hoy: string;
}

function cubetasEnCero(): Record<ClaveCubeta, number> {
  return { corriente: 0, v1_30: 0, v31_60: 0, v60_mas: 0, sin_fecha: 0 };
}

/**
 * La cartera por antigüedad, a partir de las facturas que ya leyó `getCobranza`.
 *
 * PURA A PROPÓSITO: recibe las facturas en vez de ir por ellas, igual que
 * `tarifaSugerida` (clientes.ts) y `armarRenglon` (libro_viaje.ts). Es la única
 * forma de fijar en pruebas los bordes que importan —el día 0, el día 60, la
 * factura sin `vence_en`, la cancelada— sin montar un mock de PostgREST que
 * aceptaría cualquier `.select()` y no probaría la consulta de todos modos.
 *
 * `FacturaRow.vencida` ENTRA Y NO SE USA. Viene de la vista, calculada con el
 * `current_date` de Postgres; usarla junto a los días contados contra este `hoy`
 * es exactamente el bug de los dos relojes que documenta el encabezado. Se
 * ignora en silencio no: se ignora dicho, aquí.
 *
 * SOLO LAS VIVAS CON SALDO ENTRAN A LAS CUBETAS. Una factura pagada con saldo 0
 * no tiene antigüedad que medir, y contarla engordaría la columna "corriente"
 * con dinero que ya entró — la única columna que el dueño mira para tranquilizarse.
 */
export function armarCartera(facturas: ReadonlyArray<FacturaRow>, hoy: string): CarteraAntiguedad {
  const filas: RenglonCartera[] = facturas.map((f) => {
    const viva = esFacturaViva(f.estatus);
    return {
      id: f.id,
      folio: f.folio,
      cliente: f.cliente,
      fecha: f.fecha,
      total: f.total,
      pagado: f.pagado,
      saldo: f.saldo,
      estatus: f.estatus,
      venceEn: f.venceEn,
      viva,
      conSaldo: f.saldo > TOLERANCIA_CENTAVO,
      antiguedad: clasificarAntiguedad(f.venceEn, hoy),
    };
  });

  const saldoCubeta = cubetasEnCero();
  const cuentaCubeta = cubetasEnCero();
  const porCliente = new Map<string, ClienteCartera>();

  let facturado = 0, cobrado = 0, porCobrar = 0, vencido = 0;
  let vivas = 0, borradores = 0, canceladas = 0, sinCondiciones = 0;

  for (const f of filas) {
    if (f.estatus === 'borrador') borradores++;
    if (f.estatus === 'cancelada') canceladas++;
    if (!f.viva) continue;
    vivas++;

    facturado += f.total;
    cobrado += f.pagado;

    const c = porCliente.get(f.cliente) ?? {
      cliente: f.cliente,
      facturado: 0, cobrado: 0, saldo: 0, vencido: 0, facturas: 0,
      porCubeta: cubetasEnCero(),
      diasMasVencido: null,
    };
    c.facturado += f.total;
    c.cobrado += f.pagado;
    c.facturas++;

    // ── EL "POR COBRAR" SE SUMA AQUÍ DENTRO, Y ESO ES LO QUE HACE CUADRAR ──
    //
    // Sin saldo no hay antigüedad que medir: ese dinero ya entró. Pero si el
    // total se sumara AFUERA de este `if`, una factura con un residuo de un
    // centavo entraría al total y a ninguna cubeta, y el renglón "Total por
    // cobrar" de la pantalla dejaría de ser la suma de las cinco columnas de
    // arriba. Esa resta de un centavo es la ÚNICA comprobación que un contralor
    // le puede hacer a la tabla de un vistazo, y una tabla que no cuadra por un
    // centavo se descarta entera.
    //
    // El umbral es el MISMO de la base: `factura_saldo` (0049) solo considera
    // vencida una factura con saldo mayor a un centavo, y `resumirCobro`
    // (libro_viaje.ts) da por cobrada la que no lo pasa. Con un umbral distinto,
    // una factura saldada según Postgres saldría con saldo en pantalla.
    if (f.conSaldo) {
      porCobrar += f.saldo;
      c.saldo += f.saldo;
      const k = f.antiguedad.cubeta;
      saldoCubeta[k] += f.saldo;
      cuentaCubeta[k]++;
      c.porCubeta[k] += f.saldo;
      if (k === 'sin_fecha') sinCondiciones++;
      if (f.antiguedad.diasVencida !== null) {
        vencido += f.saldo;
        c.vencido += f.saldo;
        c.diasMasVencido = Math.max(c.diasMasVencido ?? 0, f.antiguedad.diasVencida);
      }
    }

    porCliente.set(f.cliente, c);
  }

  const cubetas: Cubeta[] = CUBETAS.map((c) => ({
    clave: c.clave,
    rotulo: c.rotulo,
    ayuda: c.ayuda,
    saldo: round2(saldoCubeta[c.clave]),
    facturas: cuentaCubeta[c.clave],
  }));

  const clientes = [...porCliente.values()].map((c) => ({
    ...c,
    facturado: round2(c.facturado),
    cobrado: round2(c.cobrado),
    saldo: round2(c.saldo),
    vencido: round2(c.vencido),
    porCubeta: {
      corriente: round2(c.porCubeta.corriente),
      v1_30: round2(c.porCubeta.v1_30),
      v31_60: round2(c.porCubeta.v31_60),
      v60_mas: round2(c.porCubeta.v60_mas),
      sin_fecha: round2(c.porCubeta.sin_fecha),
    },
  // Primero a quien más se le debe VENCIDO —es a quien hay que hablarle hoy— y
  // luego por saldo. El nombre desempata para que la tabla no cambie de orden
  // entre dos cargas de la misma página.
  })).sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo || a.cliente.localeCompare(b.cliente, 'es'));

  // Lo más vencido arriba; entre iguales, el saldo más grande. Las canceladas y
  // los borradores caen al final (no tienen antigüedad que ordenar).
  const orden = [...filas].sort((a, b) => {
    if (a.viva !== b.viva) return a.viva ? -1 : 1;
    const da = a.antiguedad.diasVencida ?? -1;
    const db = b.antiguedad.diasVencida ?? -1;
    if (da !== db) return db - da;
    if (a.saldo !== b.saldo) return b.saldo - a.saldo;
    return a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.id.localeCompare(b.id);
  });

  return {
    facturas: orden,
    facturasTotal: orden.length,
    vivas,
    borradores,
    canceladas,
    facturado: round2(facturado),
    cobrado: round2(cobrado),
    porCobrar: round2(porCobrar),
    vencido: round2(vencido),
    cubetas,
    clientes,
    sinCondiciones,
    hoy,
  };
}

// ── El dinero que se queda en la mesa ──────────────────────────────────────

/** Cuántos renglones se listan. El TOTAL siempre se dice aparte: recortar la
 *  lista está bien, recortar la cifra sin decirlo no. Mismo criterio que
 *  `LIMITE_SIN_INGRESO` en clientes.ts. */
export const LIMITE_EN_LA_MESA = 25;

export interface ViajeLiquidado {
  id: string;
  folio: string | null;
  origen: string | null;
  destino: string | null;
  cliente: string | null;
  /** Crudo a propósito: `aNumero` es quien decide si hay dato. */
  ingresoFlete: unknown;
  /** El día en que se cerró la liquidación, ya en calendario mexicano
   *  (`diaMx`). `null` cuando no hay ni liquidación ni fecha de fin. */
  liquidadoEn: string | null;
}

export interface RenglonSinFacturar {
  viajeId: string;
  folio: string;
  /** `Monterrey → Querétaro`, o lo que haya. `null` si no se capturó ninguno. */
  ruta: string | null;
  cliente: string | null;
  /** `null` = nadie capturó el ingreso del flete. NO es un flete gratis. */
  ingreso: number | null;
  liquidadoEn: string | null;
  /** Días desde que se liquidó. `null` si no hay contra qué contarlos. */
  diasSinFacturar: number | null;
  /** Tiene una factura en BORRADOR: alguien la empezó y no la timbró. */
  soloBorrador: boolean;
}

export interface EnLaMesa {
  /** Los más antiguos primero, hasta `LIMITE_EN_LA_MESA`. */
  viajes: RenglonSinFacturar[];
  /** Cuántos hay EN TOTAL, aunque la lista venga recortada. */
  total: number;
  /**
   * Suma del ingreso de los que SÍ lo traen capturado. No es "lo que se dejó de
   * facturar": es el piso conocido de esa cifra, y `sinIngreso` dice cuánto le
   * falta para ser la cifra completa.
   */
  ingresoCapturado: number;
  /** De `total`, cuántos NO traen ingreso capturado y no entran a la suma. */
  sinIngreso: number;
  /** De `total`, cuántos ya tienen una factura en borrador. */
  conBorrador: number;
  /** Días que lleva el más antiguo sin facturarse. `null` si ninguno se puede fechar. */
  diasMasViejo: number | null;
}

/** Un viaje de la mesa, ya como renglón. Lo usan `armarEnLaMesa` (JS) y
 *  `armarFacturacionClientes` (RPC): una sola forma de armar la ruta, el folio
 *  de respaldo y los días. */
export function renglonSinFacturar(v: ViajeLiquidado, soloBorrador: boolean, hoy: string): RenglonSinFacturar {
  const ruta = v.origen && v.destino
    ? `${v.origen} → ${v.destino}`
    : v.origen ?? v.destino ?? null;
  return {
    viajeId: v.id,
    // Mismo respaldo que `armarRenglon`: `viaje.folio` es nullable y un
    // renglón sin encabezado no se puede citar por teléfono.
    folio: v.folio ?? v.id.slice(0, 8),
    ruta,
    cliente: v.cliente,
    ingreso: aNumero(v.ingresoFlete),
    liquidadoEn: v.liquidadoEn,
    diasSinFacturar: diasEntre(v.liquidadoEn, hoy),
    soloBorrador,
  };
}

/**
 * Los viajes ya liquidados que nadie facturó.
 *
 * PURA: recibe los conjuntos ya resueltos. La consulta vive abajo.
 *
 * ── QUÉ CUENTA COMO "FACTURADO", Y POR QUÉ EL BORRADOR NO ─────────────────
 * Un viaje está facturado si alguna factura VIVA lo ampara, sea por
 * `factura_emitida.viaje_id` (la liga directa) o por `factura_viaje` (la fina,
 * para la factura que cubre varios viajes). Un BORRADOR no cuenta: Likida no
 * timbra —el UUID del CFDI llega de fuera (0049)— así que un borrador es papel
 * que todavía no le cobra a nadie. Pero tampoco es lo mismo que "nadie lo ha
 * tocado", y por eso sale marcado en vez de mezclado: quien lo ve sabe si le
 * toca capturar de cero o nada más terminar lo empezado.
 *
 * Una factura CANCELADA tampoco cuenta, y ahí está el caso que la 0049 previó
 * en el comentario de `factura_viaje`: "un viaje puede refacturarse tras una
 * cancelación". Un viaje con su única factura cancelada vuelve a esta lista,
 * que es exactamente donde tiene que estar.
 */
export function armarEnLaMesa(entrada: {
  viajes: ReadonlyArray<ViajeLiquidado>;
  conFacturaViva: ReadonlySet<string>;
  conBorrador: ReadonlySet<string>;
  hoy: string;
}): EnLaMesa {
  const pendientes = entrada.viajes.filter((v) => !entrada.conFacturaViva.has(v.id));

  const filas: RenglonSinFacturar[] = pendientes.map((v) => renglonSinFacturar(v, entrada.conBorrador.has(v.id), entrada.hoy));

  // Los agregados se calculan sobre TODOS los pendientes, antes de recortar la
  // lista: una suma sobre los 25 listados con el rótulo del total sería la
  // cifra inventada más fácil de este archivo.
  let ingresoCapturado = 0, sinIngreso = 0, conBorrador = 0;
  let diasMasViejo: number | null = null;
  for (const f of filas) {
    if (f.ingreso === null) sinIngreso++;
    else ingresoCapturado += f.ingreso;
    if (f.soloBorrador) conBorrador++;
    if (f.diasSinFacturar !== null) {
      diasMasViejo = Math.max(diasMasViejo ?? f.diasSinFacturar, f.diasSinFacturar);
    }
  }

  // El más viejo arriba: es el que de verdad mide cuánto lleva el dinero sin
  // pedirse. Un viaje que no se puede fechar va al final, sin inventarle fecha.
  const orden = [...filas].sort((a, b) => {
    const da = a.diasSinFacturar, db = b.diasSinFacturar;
    if (da === null && db === null) return a.folio.localeCompare(b.folio, 'es');
    if (da === null) return 1;
    if (db === null) return -1;
    if (da !== db) return db - da;
    return (b.ingreso ?? 0) - (a.ingreso ?? 0) || a.folio.localeCompare(b.folio, 'es');
  });

  return {
    viajes: orden.slice(0, LIMITE_EN_LA_MESA),
    total: filas.length,
    ingresoCapturado: round2(ingresoCapturado),
    sinIngreso,
    conBorrador,
    diasMasViejo,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE CON BASE DE DATOS — UNA RPC desde el 22-ago-2026 (mig. 0152).
//
// Antes: `getCobranza` (todas las facturas) + `factura_emitida` + TODOS los
// viajes liquidados + TODAS las liquidaciones + `cliente` + `factura_viaje`
// por lotes, y `armarCartera`/`armarEnLaMesa` reducían en JS. Con 50k
// viajes/mes eso caducaba ~mes 2 (docs/escala-50k/MAPA.md #13).
// `facturacion_clientes_tenant` hace las DOS reducciones en SQL con las
// mismas reglas (un solo `hoy`, cubetas, borrador ≠ facturado, cierre en día
// local MX) y devuelve los agregados completos + una página de facturas (≤100)
// + los 25 viajes más viejos de la mesa. `armarCartera` y `armarEnLaMesa`
// siguen aquí, PURAS: son el oráculo de la prueba de equivalencia
// (facturacion_clientes_equivalencia.test.ts) y de las pruebas de bordes.
// ═══════════════════════════════════════════════════════════════════════════

export interface FacturacionClientes {
  cartera: CarteraAntiguedad;
  enLaMesa: EnLaMesa;
  /** Viajes liquidados en total — el denominador de "en la mesa". */
  viajesLiquidados: number;
  hoy: string;
}

export interface OpcionesFacturacion {
  /** Acota las FACTURAS por `fecha` (AAAA-MM-DD). `null` = sin cota. La mesa nunca se acota. */
  desde?: string | null;
  hasta?: string | null;
  /** Facturas en la página (≤100). */
  limiteFacturas?: number;
}

const LIMITE_FACTURAS = 100;

/**
 * Del jsonb de `facturacion_clientes_tenant` a `FacturacionClientes`, validando
 * la FORMA campo por campo. PURA: es la que prueba la equivalencia. Cualquier
 * campo fuera de forma LANZA — una cartera a medias se ve igual que una entera.
 */
export function armarFacturacionClientes(data: unknown, hoy: string): FacturacionClientes {
  const mal = (detalle: string) => formaInesperada('getFacturacionClientes', 'facturacion_clientes_tenant', detalle);
  if (!esObjeto(data) || !esObjeto(data.cartera) || !esObjeto(data.enLaMesa) || !esNumero(data.viajesLiquidados)) {
    throw mal(`llegó ${typeof data}`);
  }
  const c = data.cartera;
  const m = data.enLaMesa;
  if (!esNumero(c.facturasTotal) || !esNumero(c.vivas) || !esNumero(c.borradores) || !esNumero(c.canceladas)
    || !esNumero(c.facturado) || !esNumero(c.cobrado) || !esNumero(c.porCobrar) || !esNumero(c.vencido)
    || !esNumero(c.sinCondiciones) || !Array.isArray(c.cubetas) || !Array.isArray(c.clientes) || !Array.isArray(c.facturas)) {
    throw mal('cartera con campos fuera de forma');
  }
  if (!esNumero(m.total) || !esNumero(m.ingresoCapturado) || !esNumero(m.sinIngreso) || !esNumero(m.conBorrador)
    || !esNumeroONulo(m.diasMasViejo) || !Array.isArray(m.viajes)) {
    throw mal('enLaMesa con campos fuera de forma');
  }

  const saldoPorCubeta = new Map<string, { saldo: number; facturas: number }>();
  for (const b of c.cubetas as unknown[]) {
    if (!esObjeto(b) || typeof b.clave !== 'string' || !esNumero(b.saldo) || !esNumero(b.facturas)) throw mal('cubeta fuera de forma');
    saldoPorCubeta.set(b.clave, { saldo: round2(b.saldo), facturas: b.facturas });
  }
  // Las cinco, SIEMPRE, en el orden en que se pintan — y si falta una, se dice.
  const cubetas: Cubeta[] = CUBETAS.map((k) => {
    const b = saldoPorCubeta.get(k.clave);
    if (!b) throw mal(`falta la cubeta ${k.clave}`);
    return { clave: k.clave, rotulo: k.rotulo, ayuda: k.ayuda, saldo: b.saldo, facturas: b.facturas };
  });

  const leerCubetas = (v: unknown): Record<ClaveCubeta, number> => {
    if (!esObjeto(v)) throw mal('porCubeta fuera de forma');
    const salida = cubetasEnCero();
    for (const k of CUBETAS) {
      const x = v[k.clave];
      if (!esNumero(x)) throw mal(`porCubeta.${k.clave} fuera de forma`);
      salida[k.clave] = round2(x);
    }
    return salida;
  };

  const clientes: ClienteCartera[] = (c.clientes as unknown[]).map((x) => {
    if (!esObjeto(x) || typeof x.cliente !== 'string' || !esNumero(x.facturado) || !esNumero(x.cobrado)
      || !esNumero(x.saldo) || !esNumero(x.vencido) || !esNumero(x.facturas) || !esNumeroONulo(x.diasMasVencido)) {
      throw mal('cliente fuera de forma');
    }
    return {
      cliente: x.cliente,
      facturado: round2(x.facturado),
      cobrado: round2(x.cobrado),
      saldo: round2(x.saldo),
      vencido: round2(x.vencido),
      facturas: x.facturas,
      porCubeta: leerCubetas(x.porCubeta),
      diasMasVencido: x.diasMasVencido,
    };
  });

  const facturas: RenglonCartera[] = (c.facturas as unknown[]).map((f) => {
    if (!esObjeto(f) || typeof f.id !== 'string' || !esTextoONulo(f.folio) || typeof f.cliente !== 'string'
      || typeof f.fecha !== 'string' || !esNumero(f.total) || !esNumero(f.pagado) || !esNumero(f.saldo)
      || typeof f.estatus !== 'string' || !esTextoONulo(f.venceEn)) {
      throw mal('factura fuera de forma');
    }
    const saldo = round2(f.saldo);
    return {
      id: f.id,
      folio: f.folio,
      cliente: f.cliente,
      fecha: f.fecha,
      total: round2(f.total),
      pagado: round2(f.pagado),
      saldo,
      estatus: f.estatus,
      venceEn: f.venceEn,
      viva: esFacturaViva(f.estatus),
      conSaldo: saldo > TOLERANCIA_CENTAVO,
      // El rótulo y los días salen del MISMO `hoy` con el que SQL clasificó.
      antiguedad: clasificarAntiguedad(f.venceEn, hoy),
    };
  });

  const viajes: RenglonSinFacturar[] = (m.viajes as unknown[]).map((v) => {
    if (!esObjeto(v) || typeof v.id !== 'string' || !esTextoONulo(v.folio) || !esTextoONulo(v.origen)
      || !esTextoONulo(v.destino) || !esTextoONulo(v.cliente) || !esTextoONulo(v.liquidadoEn)
      || typeof v.soloBorrador !== 'boolean') {
      throw mal('viaje en la mesa fuera de forma');
    }
    return renglonSinFacturar({
      id: v.id, folio: v.folio, origen: v.origen, destino: v.destino, cliente: v.cliente,
      ingresoFlete: v.ingresoFlete, liquidadoEn: v.liquidadoEn,
    }, v.soloBorrador, hoy);
  });

  return {
    cartera: {
      facturas,
      facturasTotal: c.facturasTotal,
      vivas: c.vivas,
      borradores: c.borradores,
      canceladas: c.canceladas,
      facturado: round2(c.facturado),
      cobrado: round2(c.cobrado),
      porCobrar: round2(c.porCobrar),
      vencido: round2(c.vencido),
      cubetas,
      clientes,
      sinCondiciones: c.sinCondiciones,
      hoy,
    },
    enLaMesa: {
      viajes,
      total: m.total,
      ingresoCapturado: round2(m.ingresoCapturado),
      sinIngreso: m.sinIngreso,
      conBorrador: m.conBorrador,
      diasMasViejo: m.diasMasViejo,
    },
    viajesLiquidados: data.viajesLiquidados,
    hoy,
  };
}

/**
 * Todo lo que la pantalla de Facturación a clientes necesita, en una llamada.
 *
 * SIN CATCH POR DENTRO, igual que `getPanelClientes`. Un fallo tiene que
 * subir: supabase-js reporta el error POR VALOR, así que una base caída se
 * leería como "esta flota no le ha facturado a nadie y no tiene nada
 * pendiente" — las dos conclusiones contrarias a las que esta pantalla existe
 * para dar. La página decide si pinta el error o se cae.
 *
 * `hoy` entra por parámetro para poder fijarlo en una prueba sin congelar el
 * reloj, y su default es el día en HORA DE MÉXICO: la antigüedad de un saldo es
 * del cliente, no del servidor. Es el MISMO `hoy` con el que SQL clasifica.
 */
export async function getFacturacionClientes(
  tenantId: string,
  hoy: string = hoyMx(),
  opciones: OpcionesFacturacion = {},
): Promise<FacturacionClientes> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('facturacion_clientes_tenant', {
      p_tenant: tenantId,
      p_hoy: hoy,
      p_desde: opciones.desde ?? null,
      p_hasta: opciones.hasta ?? null,
      p_limite_facturas: Math.min(Math.max(Math.trunc(opciones.limiteFacturas ?? LIMITE_FACTURAS), 1), LIMITE_FACTURAS),
    }),
    'facturacion_clientes_tenant',
  );
  if (error) throw new Error(`getFacturacionClientes: ${error.message}`);
  return armarFacturacionClientes(data, hoy);
}
