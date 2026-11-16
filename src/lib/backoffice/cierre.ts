// CIERRE MENSUAL del Back-office. Dos capas:
//   · PURA, en CENTAVOS enteros: `armarCierre`, `cuadraConFacturas`, `comprobaciones`. Sin base, sin red, sin reloj.
//   · IO: `leerInsumosCierre` (facturas, costo de IA, gastos, comisiones, libro) y la persistencia del cierre (`generarBorrador`,
//     `marcarListo`, `cerrarMes`, `reabrirMes`, `guardarTipoCambio`) sobre `bo_cierre_mes` (migración 1008).
//
// REGLAS DE HONESTIDAD (no se negocian):
//   · `null` = «no se pudo leer / falta un dato», jamás 0. Si falta UN componente, el neto es `null` y `faltantes[]` dice cuál.
//   · «Cobrado» = factura 'pagada' CON pagada_en dentro del mes (de México), conciliada_en Y referencia_banco. Una factura «pagada» sin
//     referencia de banco no es cobrado: es un hallazgo, no ingreso.
//   · Un mes solo se marca «listo» o «cerrado» con todas las comprobaciones BLOQUEANTES en verde y el mes ya terminado.
//   · Ninguna cifra se estima en silencio: el tipo de cambio es uno por mes, capturado a mano; sin él, el COGS de IA y el neto dicen
//     «falta el tipo de cambio del mes».
import { supabaseAdmin } from '@/lib/supabase/admin';
import { listarFacturasSaas, TECHO_FACTURAS_SAAS, type FacturaSaasFila } from '@/lib/saas/transferencia';
import { costoIaVentana } from '@/lib/admin/negocio';
import { desplazarMes, esPeriodo, instanteEnPeriodo, mesDeMx, rangoMes } from './periodo';
import { desdeRespuesta, esTablaAusente, leerSeguro, NO_DISPONIBLE, OK, type Lectura } from './lectura';
import type { ComisionMes, GastoMes, MovimientoContable } from './tipos';

// ───────────────────────────── Dinero en centavos ─────────────────────────────

/** Pesos → centavos enteros. El signo se separa antes del épsilon (mismo criterio que `round2`): 1.005 → 101, -1.005 → -101. */
export function aCent(pesos: number): number {
  return Math.sign(pesos) * Math.round((Math.abs(pesos) + Number.EPSILON) * 100) + 0;
}
/** Centavos → pesos (para la columna `numeric(12,2)`). */
export const aPesos = (cent: number): number => cent / 100;
const aPesosONulo = (cent: number | null): number | null => (cent === null ? null : aPesos(cent));
const aCentONulo = (pesos: unknown): number | null => (pesos === null || pesos === undefined || pesos === '' ? null : aCent(Number(pesos)));

// ───────────────────────────── Tipos ─────────────────────────────

/** Una factura de la mensualidad reducida a lo que el cierre necesita, ya en centavos. */
export interface FacturaInsumo {
  id: string;
  tenantId: string;
  tenantNombre: string;
  estado: string;
  periodoInicio: string;
  totalCent: number;
  subtotalCent: number | null;
  ivaCent: number | null;
  creadaEn: string;
  pagadaEn: string | null;
  conciliadaEn: string | null;
  referenciaBanco: string | null;
}

export function facturaInsumoDe(f: FacturaSaasFila): FacturaInsumo {
  return {
    id: f.id,
    tenantId: f.tenantId,
    tenantNombre: f.tenantNombre,
    estado: String(f.estado),
    periodoInicio: f.periodoInicio,
    totalCent: aCent(f.monto),
    subtotalCent: f.subtotal === null ? null : aCent(f.subtotal),
    ivaCent: f.iva === null ? null : aCent(f.iva),
    creadaEn: f.creadaEn,
    pagadaEn: f.pagadaEn,
    conciliadaEn: f.conciliadaEn,
    referenciaBanco: f.referenciaBanco,
  };
}

export interface CostoIaMes {
  totalUsd: number;
  porTenantUsd: Array<{ tenantId: string; usd: number }>;
}

/** Todo lo que se lee de la base para armar un cierre. Cada fuente lleva SU `Lectura`: una que falla no tumba a las demás. */
export interface InsumosCierre {
  periodo: string;
  facturas: Lectura<FacturaInsumo[]>;
  /** La lista de facturas llegó recortada por el tope: no se presenta como completa. */
  facturasTruncadas: boolean;
  /** Vía B del cobrado: la suma que calcula la base con el filtro del mes (independiente de la suma en JS). En centavos. */
  cobradoSql: Lectura<number>;
  costoIa: Lectura<CostoIaMes>;
  /** Uno por mes, capturado a mano. `null` = falta. */
  tipoCambio: number | null;
  gastos: Lectura<GastoMes[]>;
  comisiones: Lectura<ComisionMes>;
  movimientos: Lectura<MovimientoContable[]>;
}

export type Faltante = 'facturas' | 'facturas_truncadas' | 'desglose_iva' | 'costo_ia' | 'tipo_cambio' | 'gastos' | 'comisiones';

export interface MargenCliente {
  tenantId: string;
  nombre: string | null;
  /** Ingreso cobrado sin IVA. */
  ingresosCent: number | null;
  /** Costo de IA del mes en pesos (USD × tipo de cambio). */
  costoIaCent: number | null;
  margenCent: number | null;
}

export interface CierreMes {
  periodo: string;
  /** Lo que entró al banco (con IVA), solo facturas con evidencia de banco. */
  cobradoTotalCent: number | null;
  /** Ingreso cobrado SIN IVA (el que cuenta para el neto). */
  ingresosCobradosCent: number | null;
  /** Facturado en el mes (periodo de la mensualidad), sin canceladas y sin IVA. */
  ingresosFacturadosCent: number | null;
  ivaTrasladadoCent: number | null;
  cogsIaCent: number | null;
  gastosCent: number | null;
  comisionesDevengadasCent: number | null;
  /** Magnitud (siempre ≥ 0): lo que el clawback le resta al gasto de comisiones. */
  clawbackCent: number | null;
  netoCent: number | null;
  tipoCambio: number | null;
  /** Facturas cobradas del mes. `null` si no se pudo leer. */
  nCobradas: number | null;
  /** Facturas «pagadas» en el mes SIN conciliar o sin referencia de banco: no cuentan como cobrado. */
  pagadasSinEvidencia: { n: number; totalCent: number } | null;
  margenes: MargenCliente[] | null;
  faltantes: Faltante[];
}

// ───────────────────────────── PURO: armar el cierre ─────────────────────────────

const suma = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0);
const sumaONula = (xs: ReadonlyArray<number | null>): number | null => (xs.some((x) => x === null) ? null : suma(xs as number[]));

/** ¿Esta factura cuenta como COBRADO del mes? Pagada, con fecha de pago dentro del mes de México, conciliada y con referencia de banco. */
export function esCobradoDelMes(f: FacturaInsumo, periodo: string): boolean {
  return f.estado === 'pagada'
    && instanteEnPeriodo(f.pagadaEn, periodo)
    && f.conciliadaEn !== null
    && f.referenciaBanco !== null
    && f.referenciaBanco.trim() !== '';
}

/** PURA. neto = ingresos − COGS − gastos − (comisiones devengadas − clawback). `null` si falta cualquier componente. */
export function recalcularNeto(c: Pick<CierreMes, 'ingresosCobradosCent' | 'cogsIaCent' | 'gastosCent' | 'comisionesDevengadasCent' | 'clawbackCent'>): number | null {
  const { ingresosCobradosCent: ing, cogsIaCent: cogs, gastosCent: gas, comisionesDevengadasCent: dev, clawbackCent: claw } = c;
  if (ing === null || cogs === null || gas === null || dev === null || claw === null) return null;
  return ing - cogs - gas - (dev - claw);
}

/** PURA. ¿Dos vías del cobrado dicen lo mismo? `null` = no se puede decir (falta una vía). */
export function cuadraConFacturas(viaA: number | null, viaB: number | null): boolean | null {
  if (viaA === null || viaB === null) return null;
  return viaA === viaB;
}

function costoIaEnCent(usd: number, tipoCambio: number | null): number | null {
  if (usd === 0) return 0; // cero dólares son cero pesos con cualquier tipo de cambio
  return tipoCambio === null ? null : aCent(usd * tipoCambio);
}

/** PURA. Arma el cierre del mes con lo leído. Nada se estima: lo que falta queda `null` y se lista en `faltantes`. */
export function armarCierre(i: InsumosCierre, periodo: string = i.periodo): CierreMes {
  const faltantes: Faltante[] = [];
  const falta = (f: Faltante) => { if (!faltantes.includes(f)) faltantes.push(f); };

  // ── Facturas ──
  let facturas: FacturaInsumo[] | null = null;
  if (i.facturas.estado !== 'ok') falta('facturas');
  else if (i.facturasTruncadas) falta('facturas_truncadas');
  else facturas = i.facturas.dato;

  let cobradoTotalCent: number | null = null;
  let ingresosCobradosCent: number | null = null;
  let ivaTrasladadoCent: number | null = null;
  let ingresosFacturadosCent: number | null = null;
  let nCobradas: number | null = null;
  let pagadasSinEvidencia: CierreMes['pagadasSinEvidencia'] = null;
  let cobradas: FacturaInsumo[] = [];
  if (facturas !== null) {
    cobradas = facturas.filter((f) => esCobradoDelMes(f, periodo));
    nCobradas = cobradas.length;
    cobradoTotalCent = suma(cobradas.map((f) => f.totalCent));
    ingresosCobradosCent = sumaONula(cobradas.map((f) => f.subtotalCent));
    ivaTrasladadoCent = sumaONula(cobradas.map((f) => f.ivaCent));
    if (ingresosCobradosCent === null || ivaTrasladadoCent === null) falta('desglose_iva');
    const delMes = facturas.filter((f) => f.estado !== 'cancelada' && f.periodoInicio.slice(0, 7) === periodo.slice(0, 7));
    ingresosFacturadosCent = sumaONula(delMes.map((f) => f.subtotalCent));
    const sinEvidencia = facturas.filter((f) => f.estado === 'pagada' && instanteEnPeriodo(f.pagadaEn, periodo) && !esCobradoDelMes(f, periodo));
    pagadasSinEvidencia = { n: sinEvidencia.length, totalCent: suma(sinEvidencia.map((f) => f.totalCent)) };
  }

  // ── COGS de IA ──
  let cogsIaCent: number | null = null;
  if (i.costoIa.estado !== 'ok') falta('costo_ia');
  else {
    cogsIaCent = costoIaEnCent(i.costoIa.dato.totalUsd, i.tipoCambio);
    if (cogsIaCent === null) falta('tipo_cambio');
  }

  // ── Gastos y comisiones (los entregan otros módulos) ──
  let gastosCent: number | null = null;
  if (i.gastos.estado !== 'ok') falta('gastos');
  else gastosCent = suma(i.gastos.dato.map((g) => g.totalCent));

  let comisionesDevengadasCent: number | null = null;
  let clawbackCent: number | null = null;
  if (i.comisiones.estado !== 'ok') falta('comisiones');
  else {
    comisionesDevengadasCent = i.comisiones.dato.devengadoCent;
    clawbackCent = Math.abs(i.comisiones.dato.clawbackCent);
  }

  const parcial = { ingresosCobradosCent, cogsIaCent, gastosCent, comisionesDevengadasCent, clawbackCent };
  const netoCent = recalcularNeto(parcial);

  // ── Margen por cliente ──
  let margenes: MargenCliente[] | null = null;
  if (facturas !== null) {
    const nombres = new Map(facturas.map((f) => [f.tenantId, f.tenantNombre]));
    const ids = new Set<string>(cobradas.map((f) => f.tenantId));
    if (i.costoIa.estado === 'ok') for (const t of i.costoIa.dato.porTenantUsd) ids.add(t.tenantId);
    margenes = [...ids].map((tenantId): MargenCliente => {
      const ingresosCent = sumaONula(cobradas.filter((f) => f.tenantId === tenantId).map((f) => f.subtotalCent));
      const usd = i.costoIa.estado === 'ok' ? suma(i.costoIa.dato.porTenantUsd.filter((t) => t.tenantId === tenantId).map((t) => t.usd)) : null;
      const costoIaCent = usd === null ? null : costoIaEnCent(usd, i.tipoCambio);
      const margenCent = ingresosCent === null || costoIaCent === null ? null : ingresosCent - costoIaCent;
      return { tenantId, nombre: nombres.get(tenantId) ?? null, ingresosCent, costoIaCent, margenCent };
    }).sort((a, b) => {
      if (a.margenCent === null && b.margenCent !== null) return 1;
      if (b.margenCent === null && a.margenCent !== null) return -1;
      if (a.margenCent !== null && b.margenCent !== null && a.margenCent !== b.margenCent) return b.margenCent - a.margenCent;
      return (a.nombre ?? a.tenantId).localeCompare(b.nombre ?? b.tenantId);
    });
  }

  return {
    periodo, cobradoTotalCent, ingresosCobradosCent, ingresosFacturadosCent, ivaTrasladadoCent, cogsIaCent, gastosCent,
    comisionesDevengadasCent, clawbackCent, netoCent, tipoCambio: i.tipoCambio, nCobradas, pagadasSinEvidencia, margenes, faltantes,
  };
}

// ───────────────────────────── PURO: comprobaciones (dos vías independientes) ─────────────────────────────

export type ClaveComprobacion = 'cobrado_dos_vias' | 'neto_recalculado' | 'usd_con_tipo_cambio' | 'libro_cuadra' | 'pagadas_sin_evidencia';
/** ok = pasa · falla = las dos vías no coinciden · no_evaluable = falta un dato para decidir · aviso = informativa con hallazgo. */
export type EstadoComprobacion = 'ok' | 'falla' | 'no_evaluable' | 'aviso';

export interface Comprobacion {
  clave: ClaveComprobacion;
  /** Una bloqueante que no esté en `ok` impide marcar el mes «listo». */
  bloqueante: boolean;
  estado: EstadoComprobacion;
  /** Vía A (o el valor guardado). */
  aCent: number | null;
  /** Vía B (o el valor recalculado). */
  bCent: number | null;
  diffCent: number | null;
  /** Conteo asociado (facturas, movimientos…), cuando aplica. */
  n: number | null;
}

const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b);

/**
 * PURA. Las comprobaciones del cierre, patrón de dos vías independientes (RTM):
 *   C1 cobrado (bloqueante): la suma en JS de las facturas cobradas = la suma que calcula la base con el filtro del mes.
 *   C2 neto (bloqueante): el neto recalculado desde los componentes = el neto guardado en el borrador (si hay).
 *   C3 USD con tipo de cambio (bloqueante): si hay gastos en USD o costo de IA, existe el tipo de cambio del mes.
 *   C4 libro (informativa): debe = haber en el libro contable, si el módulo de contabilidad existe.
 *   C5 pagadas sin evidencia (informativa): facturas «pagadas» sin referencia de banco, que no cuentan como cobrado.
 */
export function comprobaciones(cierre: CierreMes, i: InsumosCierre, guardado?: { netoCent: number | null } | null): Comprobacion[] {
  // C1
  const viaA = cierre.cobradoTotalCent;
  const viaB = i.cobradoSql.estado === 'ok' ? i.cobradoSql.dato : null;
  const c1 = cuadraConFacturas(viaA, viaB);
  const C1: Comprobacion = {
    clave: 'cobrado_dos_vias', bloqueante: true, estado: c1 === null ? 'no_evaluable' : c1 ? 'ok' : 'falla',
    aCent: viaA, bCent: viaB, diffCent: diff(viaA, viaB), n: cierre.nCobradas,
  };

  // C2
  const recalculado = recalcularNeto(cierre);
  const guardadoCent = guardado ? guardado.netoCent : cierre.netoCent;
  const C2: Comprobacion = {
    clave: 'neto_recalculado', bloqueante: true,
    estado: recalculado === null && guardadoCent === null ? 'no_evaluable' : recalculado === guardadoCent ? 'ok' : 'falla',
    aCent: guardadoCent, bCent: recalculado, diffCent: diff(guardadoCent, recalculado), n: null,
  };

  // C3
  const gastosUsd = i.gastos.estado === 'ok' ? i.gastos.dato.filter((g) => g.moneda === 'USD').length : null;
  const iaUsd = i.costoIa.estado === 'ok' ? i.costoIa.dato.totalUsd : null;
  const haceFaltaTipo = (gastosUsd !== null && gastosUsd > 0) || (iaUsd !== null && iaUsd > 0);
  const C3: Comprobacion = {
    clave: 'usd_con_tipo_cambio', bloqueante: true,
    estado: i.tipoCambio !== null ? 'ok' : gastosUsd === null || iaUsd === null ? 'no_evaluable' : haceFaltaTipo ? 'falla' : 'ok',
    aCent: null, bCent: null, diffCent: null, n: gastosUsd,
  };

  // C4
  let C4: Comprobacion;
  if (i.movimientos.estado !== 'ok') {
    C4 = { clave: 'libro_cuadra', bloqueante: false, estado: 'no_evaluable', aCent: null, bCent: null, diffCent: null, n: null };
  } else {
    const debe = suma(i.movimientos.dato.map((m) => m.debeCent));
    const haber = suma(i.movimientos.dato.map((m) => m.haberCent));
    C4 = { clave: 'libro_cuadra', bloqueante: false, estado: debe === haber ? 'ok' : 'falla', aCent: debe, bCent: haber, diffCent: debe - haber, n: i.movimientos.dato.length };
  }

  // C5
  const ps = cierre.pagadasSinEvidencia;
  const C5: Comprobacion = {
    clave: 'pagadas_sin_evidencia', bloqueante: false,
    estado: ps === null ? 'no_evaluable' : ps.n > 0 ? 'aviso' : 'ok',
    aCent: ps === null ? null : ps.totalCent, bCent: null, diffCent: null, n: ps === null ? null : ps.n,
  };

  return [C1, C2, C3, C4, C5];
}

/** Las bloqueantes que NO están en `ok`. */
export const bloqueantesPendientes = (cs: readonly Comprobacion[]): Comprobacion[] => cs.filter((c) => c.bloqueante && c.estado !== 'ok');
/** ¿Se puede marcar «listo»? Solo con todas las bloqueantes en `ok` (y haber corrido las comprobaciones). */
export const puedeMarcarseListo = (cs: readonly Comprobacion[]): boolean => cs.length > 0 && bloqueantesPendientes(cs).length === 0;

// ───────────────────────────── IO: lectura de insumos ─────────────────────────────

/** Un módulo de otro lote que aún no existe (o no exporta lo esperado) es `no_disponible`; un fallo real de ese módulo es `error`. */
export async function deOtroLote<T>(cargar: () => Promise<Lectura<T>>): Promise<Lectura<T>> {
  try {
    return await cargar();
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    if (/cannot find module|failed to (resolve|load)|is not a function|is not defined|unknown variable dynamic import/i.test(mensaje)) return NO_DISPONIBLE;
    return { estado: 'error', mensaje };
  }
}

async function leerCobradoSql(periodo: string): Promise<Lectura<number>> {
  const r = rangoMes(periodo);
  return leerSeguro(async () => {
    const { data, error, count } = await supabaseAdmin()
      .from('factura_saas')
      .select('monto', { count: 'exact' })
      .eq('estado', 'pagada')
      .gte('pagada_en', r.desdeIso)
      .lt('pagada_en', r.hastaIso)
      .not('conciliada_en', 'is', null)
      .not('referencia_banco', 'is', null)
      .neq('referencia_banco', '')
      .order('id')
      .limit(5000);
    if (error) throw error;
    const filas = (data ?? []) as Array<{ monto: unknown }>;
    if ((count ?? filas.length) > filas.length) throw new Error('el cobrado de la base llegó recortado');
    return suma(filas.map((f) => aCent(Number(f.monto))));
  });
}

/** Lee todo lo que el cierre necesita, cada fuente por su lado. `tipoCambio` omitido = se lee del cierre guardado. */
export async function leerInsumosCierre(periodo: string, tipoCambio?: number | null): Promise<InsumosCierre> {
  const r = rangoMes(periodo);
  const [facturas, cobradoSql, costoIa, tc, gastos, comisiones, movimientos] = await Promise.all([
    leerSeguro(() => listarFacturasSaas({ limite: TECHO_FACTURAS_SAAS })),
    leerCobradoSql(periodo),
    leerSeguro(async (): Promise<CostoIaMes> => {
      const v = await costoIaVentana(r.desdeIso, r.hastaIso);
      return { totalUsd: v.totales.costoUsd, porTenantUsd: v.porTenant.map((t) => ({ tenantId: t.tenantId, usd: t.costoUsd })) };
    }),
    tipoCambio !== undefined ? Promise.resolve(tipoCambio) : leerCierre(periodo).then((l) => (l.estado === 'ok' ? l.dato?.tipoCambio ?? null : null)),
    deOtroLote(async () => (await import('./gastos')).getGastosDelMes(periodo)),
    deOtroLote(async () => (await import('./comisiones')).leerComisionesDelMes(periodo)),
    deOtroLote(async () => (await import('./contabilidad')).leerMovimientosDelMes(periodo)),
  ]);
  return {
    periodo,
    facturas: facturas.estado === 'ok' ? OK(facturas.dato.filas.map(facturaInsumoDe)) : facturas,
    facturasTruncadas: facturas.estado === 'ok' ? facturas.dato.truncado : false,
    cobradoSql,
    costoIa,
    tipoCambio: tc,
    gastos,
    comisiones,
    movimientos,
  };
}

// ───────────────────────────── IO: persistencia del cierre ─────────────────────────────

export interface SnapshotCierre {
  version: 1;
  generadoEn: string;
  cierre: CierreMes;
  comprobaciones: Comprobacion[];
}

export type EstadoCierre = 'abierto' | 'listo' | 'cerrado';

export interface CierreGuardado {
  periodo: string;
  estado: EstadoCierre;
  netoCent: number | null;
  tipoCambio: number | null;
  snapshot: SnapshotCierre | null;
  cerradoPor: string | null;
  cerradoEn: string | null;
  actualizadoEn: string | null;
}

export type CodigoErrorCierre =
  | 'tabla_no_disponible' | 'periodo_invalido' | 'mes_en_curso' | 'ya_cerrado' | 'sin_borrador' | 'estado_incorrecto'
  | 'bloqueantes' | 'conflicto' | 'tipo_cambio_invalido' | 'motivo_corto';

/** Un rechazo del flujo del cierre con código estable; la acción lo traduce con su diccionario. */
export class ErrorCierre extends Error {
  constructor(public readonly codigo: CodigoErrorCierre, public readonly pendientes: Comprobacion[] = []) {
    super(`cierre: ${codigo}`);
    this.name = 'ErrorCierre';
  }
}

interface FilaCierre {
  periodo: string;
  estado: string;
  neto: unknown;
  tipo_cambio_usd: unknown;
  snapshot: unknown;
  cerrado_por: string | null;
  cerrado_en: string | null;
  actualizado_en: string | null;
}

const COLUMNAS_CIERRE = 'periodo, estado, neto, tipo_cambio_usd, snapshot, cerrado_por, cerrado_en, actualizado_en';

function snapshotDe(valor: unknown): SnapshotCierre | null {
  const s = valor as Partial<SnapshotCierre> | null;
  if (!s || typeof s !== 'object' || s.version !== 1 || !s.cierre || typeof s.cierre !== 'object' || !Array.isArray(s.comprobaciones)) return null;
  return s as SnapshotCierre;
}

/** PURA. La fila de la base como `CierreGuardado`. */
export function cierreDeFila(f: FilaCierre): CierreGuardado {
  return {
    periodo: f.periodo,
    estado: (['abierto', 'listo', 'cerrado'].includes(f.estado) ? f.estado : 'abierto') as EstadoCierre,
    netoCent: aCentONulo(f.neto),
    tipoCambio: f.tipo_cambio_usd === null || f.tipo_cambio_usd === undefined ? null : Number(f.tipo_cambio_usd),
    snapshot: snapshotDe(f.snapshot),
    cerradoPor: f.cerrado_por,
    cerradoEn: f.cerrado_en,
    actualizadoEn: f.actualizado_en,
  };
}

/** `ok` con `null` = esa tabla existe y aún no hay cierre de ese mes. */
export async function leerCierre(periodo: string): Promise<Lectura<CierreGuardado | null>> {
  try {
    const r = desdeRespuesta(await supabaseAdmin().from('bo_cierre_mes').select(COLUMNAS_CIERRE).eq('periodo', periodo).maybeSingle());
    if (r.estado !== 'ok') return r;
    return OK(r.dato ? cierreDeFila(r.dato as FilaCierre) : null);
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** Los cierres más recientes (para el tablero y el selector de mes). */
export async function leerCierresRecientes(limite = 12): Promise<Lectura<CierreGuardado[]>> {
  try {
    // orden-no-importa: `periodo` es la llave primaria de bo_cierre_mes, así que el orden por periodo ya es total (sin empates).
    const r = desdeRespuesta(await supabaseAdmin().from('bo_cierre_mes').select(COLUMNAS_CIERRE).order('periodo', { ascending: false }).limit(limite));
    if (r.estado !== 'ok') return r;
    return OK(((r.dato ?? []) as FilaCierre[]).map(cierreDeFila));
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** PURA. Las columnas de `bo_cierre_mes` (pesos) y el snapshot, a partir del cierre armado. */
export function columnasDeCierre(cierre: CierreMes, cs: readonly Comprobacion[], generadoEn: string) {
  const snapshot: SnapshotCierre = { version: 1, generadoEn, cierre, comprobaciones: [...cs] };
  return {
    ingresos_cobrados: aPesosONulo(cierre.ingresosCobradosCent),
    ingresos_facturados: aPesosONulo(cierre.ingresosFacturadosCent),
    iva_trasladado: aPesosONulo(cierre.ivaTrasladadoCent),
    cogs_ia: aPesosONulo(cierre.cogsIaCent),
    gastos_operativos: aPesosONulo(cierre.gastosCent),
    comisiones_devengadas: aPesosONulo(cierre.comisionesDevengadasCent),
    clawback_aplicado: aPesosONulo(cierre.clawbackCent),
    neto: aPesosONulo(cierre.netoCent),
    tipo_cambio_usd: cierre.tipoCambio,
    snapshot,
  };
}

function exigirLectura(l: Lectura<CierreGuardado | null>): CierreGuardado | null {
  if (l.estado === 'no_disponible') throw new ErrorCierre('tabla_no_disponible');
  if (l.estado === 'error') throw new Error(`cierre.leer: ${l.mensaje}`);
  return l.dato;
}

function exigirPeriodo(periodo: string): void {
  if (!esPeriodo(periodo)) throw new ErrorCierre('periodo_invalido');
}

function exigirMesTerminado(periodo: string): void {
  if (periodo >= mesDeMx()) throw new ErrorCierre('mes_en_curso');
}

function falloDeEscritura(error: { code?: string; message?: string }): never {
  if (esTablaAusente(error)) throw new ErrorCierre('tabla_no_disponible');
  throw new Error(`cierre.escribir: ${error.message ?? 'error'}`);
}

/** Calcula el cierre con insumos frescos, lo guarda como borrador (`abierto`) y devuelve el cierre con sus comprobaciones. */
export async function generarBorrador(periodo: string): Promise<{ cierre: CierreMes; comprobaciones: Comprobacion[] }> {
  exigirPeriodo(periodo);
  const previo = exigirLectura(await leerCierre(periodo));
  if (previo?.estado === 'cerrado') throw new ErrorCierre('ya_cerrado');
  const insumos = await leerInsumosCierre(periodo, previo?.tipoCambio ?? null);
  const cierre = armarCierre(insumos, periodo);
  const cs = comprobaciones(cierre, insumos, null);
  const { error } = await supabaseAdmin().from('bo_cierre_mes').upsert(
    { periodo, estado: 'abierto', ...columnasDeCierre(cierre, cs, new Date().toISOString()) },
    { onConflict: 'periodo' },
  );
  if (error) falloDeEscritura(error);
  return { cierre, comprobaciones: cs };
}

/** Recalcula, compara contra el borrador guardado y solo con todas las bloqueantes en verde pasa a `listo` o `cerrado`. */
async function avanzar(periodo: string, desde: 'abierto' | 'listo', hacia: 'listo' | 'cerrado', actorId: string | null): Promise<{ cierre: CierreMes; comprobaciones: Comprobacion[] }> {
  exigirPeriodo(periodo);
  exigirMesTerminado(periodo);
  const previo = exigirLectura(await leerCierre(periodo));
  if (!previo) throw new ErrorCierre('sin_borrador');
  if (previo.estado === 'cerrado') throw new ErrorCierre('ya_cerrado');
  if (previo.estado !== desde) throw new ErrorCierre('estado_incorrecto');
  const insumos = await leerInsumosCierre(periodo, previo.tipoCambio);
  const cierre = armarCierre(insumos, periodo);
  const cs = comprobaciones(cierre, insumos, { netoCent: previo.netoCent });
  if (!puedeMarcarseListo(cs)) throw new ErrorCierre('bloqueantes', bloqueantesPendientes(cs));
  const ahora = new Date().toISOString();
  const cambios = {
    estado: hacia,
    ...columnasDeCierre(cierre, cs, ahora),
    ...(hacia === 'cerrado' ? { cerrado_por: actorId, cerrado_en: ahora } : {}),
  };
  // Compare-and-set: solo se avanza si el mes sigue en el estado que se leyó (dos pestañas no cierran dos veces).
  const { data, error } = await supabaseAdmin().from('bo_cierre_mes').update(cambios).eq('periodo', periodo).eq('estado', desde).select('periodo');
  if (error) falloDeEscritura(error);
  if ((data ?? []).length === 0) throw new ErrorCierre('conflicto');
  return { cierre, comprobaciones: cs };
}

/** abierto → listo. Exige mes terminado y todas las comprobaciones bloqueantes en verde. */
export const marcarListo = (periodo: string) => avanzar(periodo, 'abierto', 'listo', null);

/** listo → cerrado, firmado por quien cierra. Vuelve a correr las comprobaciones: si algo cambió desde el borrador, no cierra. */
export const cerrarMes = (periodo: string, actorId: string) => avanzar(periodo, 'listo', 'cerrado', actorId);

/** Reabre un mes cerrado con motivo obligatorio (≥ 5 caracteres). La base deja la fila de reapertura y bloquea cualquier otra salida. */
export async function reabrirMes(periodo: string, motivo: string, actorId: string): Promise<void> {
  exigirPeriodo(periodo);
  const m = motivo.trim();
  if (m.length < 5) throw new ErrorCierre('motivo_corto');
  const { error } = await supabaseAdmin().rpc('bo_reabrir_cierre', { p_periodo: periodo, p_motivo: m, p_actor: actorId });
  if (!error) return;
  if (esTablaAusente(error) || error.code === 'PGRST202') throw new ErrorCierre('tabla_no_disponible');
  if (/no est[aá] cerrado|no existe un cierre/i.test(error.message ?? '')) throw new ErrorCierre('estado_incorrecto');
  throw new Error(`reabrirMes: ${error.message}`);
}

/** El tipo de cambio de un mes: uno solo, positivo, a lo más 4 decimales. Cambiarlo devuelve el mes a `abierto` (el neto cambia). */
export function tipoCambioValido(valor: number): boolean {
  return Number.isFinite(valor) && valor > 0 && valor < 1000 && Math.round(valor * 10_000) / 10_000 === valor;
}

export async function guardarTipoCambio(periodo: string, valor: number): Promise<void> {
  exigirPeriodo(periodo);
  if (!tipoCambioValido(valor)) throw new ErrorCierre('tipo_cambio_invalido');
  const previo = exigirLectura(await leerCierre(periodo));
  if (previo?.estado === 'cerrado') throw new ErrorCierre('ya_cerrado');
  const { error } = await supabaseAdmin().from('bo_cierre_mes').upsert({ periodo, estado: 'abierto', tipo_cambio_usd: valor }, { onConflict: 'periodo' });
  if (error) falloDeEscritura(error);
}

// ───────────────────────────── La vista del cierre (lo que pintan la pantalla y el update) ─────────────────────────────

export interface VistaCierre {
  periodo: string;
  /** La fila guardada: `ok` con `null` = aún sin borrador; `no_disponible` = la migración no está aplicada. */
  guardado: Lectura<CierreGuardado | null>;
  /** `cerrado` = las cifras congeladas del snapshot; `en_vivo` = calculadas ahora con lo que hay en la base. */
  origen: 'cerrado' | 'en_vivo';
  cierre: CierreMes;
  comprobaciones: Comprobacion[];
}

/**
 * Un mes CERRADO se muestra con sus cifras congeladas (no se recalcula: el cierre es un hecho); cualquier otro se calcula ahora y sus
 * comprobaciones comparan contra el borrador guardado (si cambió el neto desde entonces, `neto_recalculado` falla y pide regenerar).
 */
export async function leerVistaCierre(periodo: string): Promise<VistaCierre> {
  const guardado = await leerCierre(periodo);
  const g = guardado.estado === 'ok' ? guardado.dato : null;
  if (g && g.estado === 'cerrado' && g.snapshot) {
    return { periodo, guardado, origen: 'cerrado', cierre: g.snapshot.cierre, comprobaciones: g.snapshot.comprobaciones };
  }
  const insumos = await leerInsumosCierre(periodo, g?.tipoCambio ?? null);
  const cierre = armarCierre(insumos, periodo);
  return { periodo, guardado, origen: 'en_vivo', cierre, comprobaciones: comprobaciones(cierre, insumos, g ? { netoCent: g.netoCent } : null) };
}

/** El cobrado (con IVA) del mes anterior según SU cierre guardado, para la variación del update. `null` si ese mes no tiene cierre guardado: sin base no hay variación. */
export async function cobradoDelMesAnterior(periodo: string): Promise<number | null> {
  const previo = await leerCierre(desplazarMes(periodo, -1));
  return previo.estado === 'ok' ? previo.dato?.snapshot?.cierre.cobradoTotalCent ?? null : null;
}
