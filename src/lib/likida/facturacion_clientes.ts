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
import { conteo, traerTodo } from './pg';
// `getCobranza` YA lee facturas + saldos + nombres de cliente, con su regla de
// "el saldo no se guarda, se deriva" escrita y comentada. Reescribirlo aquí
// sería una segunda oportunidad de escribir mal exactamente la cifra que el
// contralor cruza contra su estado de cuenta.
import { getCobranza, type FacturaRow } from './comercial';
// Se importan, no se reimplementan. `diasEntre` ya rechaza cualquier cosa que no
// sea `AAAA-MM-DD` a propósito (un `.slice(0,10)` sobre un `timestamptz` se
// queda con el día UTC y CST es UTC−6), y `aNumero` es lo que impide que un
// `null` entre como 0.
import { aNumero, diasEntre, TOLERANCIA_CENTAVO } from './libro_viaje';
// `round2` se IMPORTA: hay una prueba en `formato.test.ts` que falla ante una
// segunda copia. Dos redondeos distintos hacen que la misma cifra fiscal se lea
// diferente en dos pantallas, y eso se lee como dos cálculos distintos.
import { round2, TZ_MX } from '@/lib/formato';

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
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(d);
}

/** Hoy, en hora de México. El default de todo lo que fecha en este archivo. */
export function hoyMx(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ_MX }).format(new Date());
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
  /** TODAS, incluidos borradores y canceladas — la pantalla los distingue. */
  facturas: RenglonCartera[];
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

  const filas: RenglonSinFacturar[] = pendientes.map((v) => {
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
      diasSinFacturar: diasEntre(v.liquidadoEn, entrada.hoy),
      soloBorrador: entrada.conBorrador.has(v.id),
    };
  });

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
// PARTE CON BASE DE DATOS.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cuántos ids caben en un `.in()`.
 *
 * PostgREST mete el `.in()` ENTERO en la query string. Con unos miles de uuids
 * (36 caracteres cada uno) la URL pasa del límite del servidor y la respuesta es
 * un 414 — que supabase-js reporta POR VALOR, no lanzando. Sin trocear, ese
 * fallo se leería como "ninguna factura ampara ningún viaje" y la pantalla
 * declararía que TODA la operación está sin facturar: la cifra más alarmante del
 * producto, producida por un error de red.
 */
const LOTE_IN = 200;

function trozos<T>(xs: readonly T[], tam: number): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < xs.length; i += tam) salida.push(xs.slice(i, i + tam));
  return salida;
}

export interface FacturacionClientes {
  cartera: CarteraAntiguedad;
  enLaMesa: EnLaMesa;
  /** Viajes liquidados en total — el denominador de "en la mesa". */
  viajesLiquidados: number;
  hoy: string;
}

/**
 * Todo lo que la pantalla de Facturación a clientes necesita, en una llamada.
 *
 * SIN CATCH POR DENTRO, igual que `getPanelClientes`. Un fallo de cualquiera de
 * estas lecturas tiene que subir: supabase-js reporta el error POR VALOR, así
 * que una base caída se leería como "esta flota no le ha facturado a nadie y no
 * tiene nada pendiente" — las dos conclusiones contrarias a las que esta
 * pantalla existe para dar. `traerTodo`/`exigir` ya traducen el error por valor
 * a excepción; la página decide si pinta el error o se cae.
 *
 * `hoy` entra por parámetro para poder fijarlo en una prueba sin congelar el
 * reloj, y su default es el día en HORA DE MÉXICO: la antigüedad de un saldo es
 * del cliente, no del servidor.
 */
export async function getFacturacionClientes(
  tenantId: string,
  hoy: string = hoyMx(),
): Promise<FacturacionClientes> {
  const admin = supabaseAdmin();

  const [cobranza, facturas, viajes, liquidaciones, clientes] = await Promise.all([
    // La cartera con su saldo derivado. Se reusa entero.
    getCobranza(tenantId),
    // Segunda pasada por `factura_emitida`, y sí es a propósito: `getCobranza`
    // no devuelve `viaje_id` (no le hace falta para su cartera) y esta pantalla
    // lo necesita para saber qué viaje ya está amparado. Reescribir `getCobranza`
    // para colarle la columna sería una segunda copia del renglón que da el
    // saldo, y ése es el número que no puede tener dos versiones.
    traerTodo<{ id: unknown; viaje_id: unknown; estatus: unknown }>(
      (d, h) => admin.from('factura_emitida').select('id, viaje_id, estatus', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getFacturacionClientes.factura',
    ),
    // Solo los LIQUIDADOS: es la lista que la pantalla contesta, y traer la
    // tabla entera para tirar el resto es pagar por nada. `estatus` solo admite
    // `abierto | en_cuadre | liquidado` (constraint `viaje_estatus_dominio`).
    traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('viaje')
        .select('id, folio, origen, destino, cliente_id, ingreso_flete, fecha_fin', conteo(d))
        .eq('tenant_id', tenantId).eq('estatus', 'liquidado').order('id').range(d, h),
      'getFacturacionClientes.viaje',
    ),
    // `created_at` es `timestamptz`: se convierte con `diaMx`, NUNCA con
    // `.slice(0,10)` — CST es UTC−6 y las liquidaciones se cierran de noche.
    traerTodo<{ viaje_id: unknown; created_at: unknown }>(
      (d, h) => admin.from('liquidacion').select('viaje_id, created_at', conteo(d))
        .eq('tenant_id', tenantId).order('viaje_id').range(d, h),
      'getFacturacionClientes.liquidacion',
    ),
    traerTodo<{ id: unknown; nombre: unknown }>(
      (d, h) => admin.from('cliente').select('id, nombre', conteo(d))
        .eq('tenant_id', tenantId).order('id').range(d, h),
      'getFacturacionClientes.cliente',
    ),
  ]);

  // ── Qué viaje está amparado por qué tipo de factura ──────────────────────
  const estatusPorFactura = new Map<string, string>();
  for (const f of facturas) estatusPorFactura.set(f.id as string, String(f.estatus));

  const conFacturaViva = new Set<string>();
  const conBorrador = new Set<string>();
  const marcar = (viajeId: string, estatus: string) => {
    if (estatus === 'borrador') conBorrador.add(viajeId);
    else if (esFacturaViva(estatus)) conFacturaViva.add(viajeId);
    // Una cancelada no marca nada: el viaje vuelve a estar sin facturar, que es
    // justo el caso de refacturación que previó la 0049.
  };

  for (const f of facturas) {
    const viajeId = (f.viaje_id as string) ?? null;
    if (viajeId) marcar(viajeId, String(f.estatus));
  }

  // `factura_viaje` NO tiene `tenant_id` (hereda el de su factura, 0049), así
  // que el filtro por flota se aplica AQUÍ: solo se preguntan los ids de
  // facturas que ya vinieron acotadas por `tenant_id`. Un id de otra flota no
  // puede entrar a esta consulta porque no está en la lista.
  const idsFactura = [...estatusPorFactura.keys()];
  for (const lote of trozos(idsFactura, LOTE_IN)) {
    const ligas = await traerTodo<{ factura_id: unknown; viaje_id: unknown }>(
      (d, h) => admin.from('factura_viaje').select('factura_id, viaje_id', conteo(d))
        .in('factura_id', lote).order('factura_id').order('viaje_id').range(d, h),
      'getFacturacionClientes.factura_viaje',
    );
    for (const l of ligas) {
      const estatus = estatusPorFactura.get(l.factura_id as string);
      if (estatus) marcar(l.viaje_id as string, estatus);
    }
  }

  // ── Cuándo se liquidó cada viaje ─────────────────────────────────────────
  const cierrePorViaje = new Map<string, string>();
  for (const l of liquidaciones) {
    const dia = diaMx(l.created_at);
    if (dia === null) continue;
    const viajeId = l.viaje_id as string;
    // `liquidacion_viaje_uidx` (0005) admite UNA por viaje; si un día dejara de
    // ser única, se queda la MÁS ANTIGUA — es la que mide de verdad cuánto lleva
    // el dinero sin pedirse, y la más nueva lo haría ver más fresco de lo que es.
    const previo = cierrePorViaje.get(viajeId);
    if (previo === undefined || dia < previo) cierrePorViaje.set(viajeId, dia);
  }

  const nombrePorCliente = new Map(clientes.map((c) => [c.id as string, c.nombre as string]));

  const liquidados: ViajeLiquidado[] = viajes.map((v) => {
    const clienteId = (v.cliente_id as string) ?? null;
    return {
      id: v.id as string,
      folio: (v.folio as string) ?? null,
      origen: (v.origen as string) ?? null,
      destino: (v.destino as string) ?? null,
      cliente: clienteId ? nombrePorCliente.get(clienteId) ?? null : null,
      ingresoFlete: v.ingreso_flete,
      // El cierre de la liquidación manda; `fecha_fin` es el respaldo para un
      // viaje marcado liquidado sin fila en `liquidacion`. Sin ninguno de los
      // dos NO se inventa una fecha: el renglón sale sin días.
      liquidadoEn: cierrePorViaje.get(v.id as string) ?? diaMx(v.fecha_fin),
    };
  });

  return {
    cartera: armarCartera(cobranza.facturas, hoy),
    enLaMesa: armarEnLaMesa({ viajes: liquidados, conFacturaViva, conBorrador, hoy }),
    viajesLiquidados: liquidados.length,
    hoy,
  };
}
