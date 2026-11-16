// GASTOS PROPIOS de Likida (los de la empresa, no los de una flota cliente). Captura MANUAL: el buzón automático espera un dominio de
// correo verificado y NO se construye. PURO arriba (en CENTAVOS enteros, sufijo `Cent`); IO abajo con `Lectura<T>`.
//
// Reglas de honestidad: `null` = «no se pudo leer / no hay dato», `[]` = «no hay nada»; jamás se suma un null como 0; un gasto en USD sin
// tipo de cambio del mes NO entra; sin RFC propio de Likida «deducible en forma» es «no evaluable» y no se rellena por comodidad.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { esUuidValido } from '@/lib/likida/intake/cfdi';
import { hoyMx } from '@/lib/formato';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { esTablaAusente, leerSeguro, type Lectura } from './lectura';
import type { GastoMes } from './tipos';
import { deducibleEnForma, normalizarTexto, type ComprobanteGasto, type DeducibleEnForma } from './clasificador';
import type { Proveedor } from './proveedores';
import { centavos, errBo, finExclusivoDeMes, inicioDeMes, esPeriodoValido, pesos, referenciaValida, sumarMeses, numeroONulo } from './utiles-c';
import { leerMovimiento } from './tesoreria';

export { sugerirClasificacion } from './clasificador';

const COMPROBANTES: readonly ComprobanteGasto[] = ['sin_comprobante', 'cfdi', 'invoice_extranjero'];
const RE_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA
// ═══════════════════════════════════════════════════════════════════════════

export interface EntradaGasto {
  proveedorId: string | null;
  fecha: string;
  concepto: string;
  moneda: string;
  /** En la moneda del gasto (pesos o dólares), no en centavos. */
  montoOriginal: number;
  tipoCambio?: number | null;
  /** IVA acreditable en MXN. `null` = no declarado (no es cero). */
  ivaAcreditable?: number | null;
  cfdiUuid?: string | null;
  comprobante: string;
  cuentaContable?: string | null;
  claveIdem?: string | null;
}

export interface GastoNormalizado {
  proveedorId: string | null;
  fecha: string;
  periodo: string;
  concepto: string;
  moneda: 'MXN' | 'USD';
  montoOriginalCent: number;
  tipoCambio: number | null;
  subtotalCent: number | null;
  ivaAcreditableCent: number | null;
  totalCent: number;
  cfdiUuid: string | null;
  comprobante: ComprobanteGasto;
  cuentaContable: string | null;
  claveIdem: string | null;
}

/** Convierte el monto original a MXN en centavos. USD exige tipo de cambio (`null` si falta: el llamador lo rechaza). 4 decimales de tipo de cambio exactos. */
export function totalMxnCent(moneda: 'MXN' | 'USD', montoOriginalCent: number, tipoCambio: number | null): number | null {
  if (moneda === 'MXN') return montoOriginalCent;
  if (tipoCambio === null || !(tipoCambio > 0)) return null;
  return Math.round((montoOriginalCent * Math.round(tipoCambio * 10_000)) / 10_000);
}

/** PURA. Valida y normaliza una captura; LANZA `ErrorBo` (clave del diccionario) ante lo que no se puede aceptar. `hoy` en México. */
export function normalizarGasto(e: EntradaGasto, hoy: string = hoyMx()): GastoNormalizado {
  const fecha = (e.fecha ?? '').trim();
  if (!RE_FECHA.test(fecha)) throw errBo('gastos.err_fecha');
  if (fecha > hoy) throw errBo('gastos.err_fecha_futura');
  const concepto = (e.concepto ?? '').trim();
  if (concepto.length < 1 || concepto.length > 200) throw errBo('gastos.err_concepto');
  if (e.moneda !== 'MXN' && e.moneda !== 'USD') throw errBo('gastos.err_moneda');
  const moneda = e.moneda;
  if (typeof e.montoOriginal !== 'number' || !Number.isFinite(e.montoOriginal) || e.montoOriginal < 0) throw errBo('gastos.err_monto');
  const montoOriginalCent = centavos(e.montoOriginal);
  if (montoOriginalCent > 999_999_999_999) throw errBo('gastos.err_monto');

  const tc = numeroONulo(e.tipoCambio);
  if (moneda === 'USD' && (tc === null || !(tc > 0))) throw errBo('gastos.err_sin_tipo_cambio');
  const tipoCambio = moneda === 'USD' ? tc : null;
  const totalCent = totalMxnCent(moneda, montoOriginalCent, tipoCambio);
  if (totalCent === null) throw errBo('gastos.err_sin_tipo_cambio');

  if (!COMPROBANTES.includes(e.comprobante as ComprobanteGasto)) throw errBo('gastos.err_comprobante');
  const comprobante = e.comprobante as ComprobanteGasto;
  const uuidCrudo = (e.cfdiUuid ?? '').trim();
  if (comprobante === 'cfdi') {
    if (!esUuidValido(uuidCrudo)) throw errBo('gastos.err_uuid');
  } else if (uuidCrudo) {
    throw errBo('gastos.err_uuid_sin_cfdi');
  }

  const ivaCrudo = numeroONulo(e.ivaAcreditable);
  let ivaAcreditableCent: number | null = null;
  let subtotalCent: number | null = null;
  if (ivaCrudo !== null) {
    if (comprobante !== 'cfdi' && ivaCrudo !== 0) throw errBo('gastos.err_iva_sin_cfdi');
    if (ivaCrudo < 0) throw errBo('gastos.err_iva');
    ivaAcreditableCent = centavos(ivaCrudo);
    if (ivaAcreditableCent > totalCent) throw errBo('gastos.err_iva_mayor');
    subtotalCent = totalCent - ivaAcreditableCent;
  }

  return {
    proveedorId: e.proveedorId || null,
    fecha,
    periodo: inicioDeMes(fecha),
    concepto,
    moneda,
    montoOriginalCent,
    tipoCambio,
    subtotalCent,
    ivaAcreditableCent,
    totalCent,
    cfdiUuid: comprobante === 'cfdi' ? uuidCrudo.toLowerCase() : null,
    comprobante,
    cuentaContable: (e.cuentaContable ?? '').trim() || null,
    claveIdem: (e.claveIdem ?? '').trim() || null,
  };
}

/** Suma de totales MXN en centavos. Los gastos son hechos ya normalizados (cada uno trae su total): no hay nulls que sumar como 0. */
export function totalGastosCent(gastos: ReadonlyArray<{ totalCent: number }>): number {
  return gastos.reduce((s, g) => s + g.totalCent, 0);
}

export interface BaseDuplicado {
  id?: string;
  proveedorId: string | null;
  fecha: string;
  totalCent: number;
  concepto: string | null;
  cfdiUuid: string | null;
}

/** PURA. ¿El gasto nuevo ya existe? Primero por UUID del CFDI, luego por la llave compuesta (proveedor, fecha, total, concepto). */
export function gastoDuplicado(nuevo: BaseDuplicado, existentes: readonly BaseDuplicado[]): { por: 'cfdi_uuid' | 'llave_compuesta'; id: string | null } | null {
  if (nuevo.cfdiUuid) {
    const hit = existentes.find((x) => x.cfdiUuid && x.cfdiUuid.toLowerCase() === nuevo.cfdiUuid!.toLowerCase());
    if (hit) return { por: 'cfdi_uuid', id: hit.id ?? null };
  }
  if (nuevo.proveedorId) {
    const concepto = normalizarTexto(nuevo.concepto);
    const hit = existentes.find((x) => x.proveedorId === nuevo.proveedorId && x.fecha === nuevo.fecha && x.totalCent === nuevo.totalCent && normalizarTexto(x.concepto) === concepto);
    if (hit) return { por: 'llave_compuesta', id: hit.id ?? null };
  }
  return null;
}

export interface FilaPeriodo { proveedorId: string | null; periodo: string }

/**
 * PURA. Proveedores FIJOS (cadencia mensual, activos) sin ningún gasto en los `meses` meses completos anteriores a `periodoActual`.
 * Un proveedor dado de alta dentro de esa ventana todavía no puede estar «sin gasto»: no se alerta. Devuelve el proveedor y cuántos meses
 * seguidos lleva sin gasto (hasta 12), para decirlo.
 */
export function proveedoresSinGastoReciente(
  proveedores: readonly Proveedor[],
  gastos: readonly FilaPeriodo[],
  periodoActual: string,
  meses = 2,
): Array<{ proveedor: Proveedor; mesesSinGasto: number }> {
  const conGasto = new Map<string, Set<string>>();
  for (const g of gastos) {
    if (!g.proveedorId) continue;
    const set = conGasto.get(g.proveedorId) ?? new Set<string>();
    set.add(g.periodo);
    conGasto.set(g.proveedorId, set);
  }
  const ventanaDesde = sumarMeses(periodoActual, -meses);
  const salida: Array<{ proveedor: Proveedor; mesesSinGasto: number }> = [];
  for (const p of proveedores) {
    if (!p.activo || p.cadencia !== 'mensual') continue;
    const alta = p.creadoEn ? inicioDeMes(p.creadoEn.slice(0, 10)) : null;
    if (alta && alta > ventanaDesde) continue;
    const set = conGasto.get(p.id);
    let sin = 0;
    for (let i = 1; i <= 12; i++) {
      if (set?.has(sumarMeses(periodoActual, -i))) break;
      sin++;
    }
    if (sin >= meses) salida.push({ proveedor: p, mesesSinGasto: sin });
  }
  return salida;
}

export interface GastoFila extends GastoMes {
  montoOriginalCent: number;
  tipoCambio: number | null;
  deducibleEnForma: DeducibleEnForma;
  conciliadoEn: string | null;
  referenciaBanco: string | null;
}

export interface ResumenGastos {
  n: number;
  totalCent: number;
  sinComprobante: number;
  conciliados: number;
  /** `null` si ningún gasto declara su IVA: «no declarado» no es cero. */
  ivaAcreditableCent: number | null;
  conIvaDeclarado: number;
}

/** PURA. Las cifras de la cabecera. Con cero gastos son ceros REALES de una lectura completa; la pantalla decide si lo dice o no. */
export function resumirGastos(gastos: readonly GastoFila[]): ResumenGastos {
  const declarados = gastos.filter((g) => g.ivaAcreditableCent !== null);
  return {
    n: gastos.length,
    totalCent: totalGastosCent(gastos),
    sinComprobante: gastos.filter((g) => g.comprobante === 'sin_comprobante').length,
    conciliados: gastos.filter((g) => g.conciliado).length,
    ivaAcreditableCent: declarados.length === 0 ? null : declarados.reduce((s, g) => s + (g.ivaAcreditableCent ?? 0), 0),
    conIvaDeclarado: declarados.length,
  };
}

/** PURA. Total por mes para la gráfica de columnas: un mes SIN ninguna captura es `null` (sin dato), no una columna en cero. */
export function gastoPorMes(gastos: ReadonlyArray<{ periodo: string; totalCent: number }>, hastaPeriodo: string, meses = 6): Array<{ periodo: string; totalCent: number | null }> {
  const suma = new Map<string, number>();
  for (const g of gastos) suma.set(g.periodo, (suma.get(g.periodo) ?? 0) + g.totalCent);
  const salida: Array<{ periodo: string; totalCent: number | null }> = [];
  for (let i = meses - 1; i >= 0; i--) {
    const p = sumarMeses(hastaPeriodo, -i);
    salida.push({ periodo: p, totalCent: suma.has(p) ? suma.get(p)! : null });
  }
  return salida;
}

/** PURA. Total por proveedor (mayor primero). Los sin proveedor se agrupan bajo `sinProveedor`. */
export function gastoPorProveedor(gastos: ReadonlyArray<{ proveedorId: string | null; proveedor: string | null; totalCent: number }>, sinProveedor: string): Array<{ clave: string; etiqueta: string; totalCent: number }> {
  const m = new Map<string, { etiqueta: string; totalCent: number }>();
  for (const g of gastos) {
    const clave = g.proveedorId ?? '__sin';
    const cur = m.get(clave) ?? { etiqueta: g.proveedor ?? sinProveedor, totalCent: 0 };
    cur.totalCent += g.totalCent;
    m.set(clave, cur);
  }
  return [...m.entries()].map(([clave, v]) => ({ clave, ...v })).sort((a, b) => b.totalCent - a.totalCent);
}

// ═══════════════════════════════════════════════════════════════════════════
// IO
// ═══════════════════════════════════════════════════════════════════════════

const COLUMNAS_GASTO =
  'id, proveedor_id, fecha, periodo, concepto, moneda, monto_original, tipo_cambio, subtotal_mxn, iva_acreditable_mxn, total_mxn, cfdi_uuid, comprobante_estado, deducible_en_forma, cuenta_contable, conciliado_en, referencia_banco, bo_proveedor(nombre)';

function aGastoFila(f: Record<string, unknown>): GastoFila {
  const prov = f.bo_proveedor as { nombre?: string } | Array<{ nombre?: string }> | null;
  const nombre = Array.isArray(prov) ? prov[0]?.nombre : prov?.nombre;
  const subtotal = numeroONulo(f.subtotal_mxn);
  const iva = numeroONulo(f.iva_acreditable_mxn);
  const comp = COMPROBANTES.includes(f.comprobante_estado as ComprobanteGasto) ? (f.comprobante_estado as ComprobanteGasto) : 'sin_comprobante';
  const ded = f.deducible_en_forma === 'si' || f.deducible_en_forma === 'no' ? f.deducible_en_forma : 'no_evaluable';
  return {
    id: String(f.id),
    proveedorId: typeof f.proveedor_id === 'string' ? f.proveedor_id : null,
    proveedor: nombre ?? null,
    fecha: String(f.fecha),
    periodo: String(f.periodo),
    concepto: typeof f.concepto === 'string' ? f.concepto : null,
    moneda: f.moneda === 'USD' ? 'USD' : 'MXN',
    totalCent: centavos(Number(f.total_mxn)),
    subtotalCent: subtotal === null ? null : centavos(subtotal),
    ivaAcreditableCent: iva === null ? null : centavos(iva),
    cfdiUuid: typeof f.cfdi_uuid === 'string' ? f.cfdi_uuid : null,
    comprobante: comp,
    cuentaContable: typeof f.cuenta_contable === 'string' ? f.cuenta_contable : null,
    conciliado: typeof f.conciliado_en === 'string',
    montoOriginalCent: centavos(Number(f.monto_original)),
    tipoCambio: numeroONulo(f.tipo_cambio),
    deducibleEnForma: ded as DeducibleEnForma,
    conciliadoEn: typeof f.conciliado_en === 'string' ? f.conciliado_en : null,
    referenciaBanco: typeof f.referencia_banco === 'string' ? f.referencia_banco : null,
  };
}

/** Gastos vivos (no anulados) entre dos periodos `aaaa-mm-01` inclusivos. Lanza si la base falla (la clasifica `leerSeguro`). */
export async function leerGastos(opts: { desdePeriodo?: string; hastaPeriodo?: string } = {}): Promise<Lectura<GastoFila[]>> {
  return leerSeguro(async () => {
    const admin = supabaseAdmin();
    const filas = await traerTodo<Record<string, unknown>>((d, h) => {
      let q = admin.from('bo_gasto').select(COLUMNAS_GASTO, conteo(d)).is('anulado_en', null);
      if (opts.desdePeriodo) q = q.gte('periodo', opts.desdePeriodo);
      if (opts.hastaPeriodo) q = q.lte('periodo', opts.hastaPeriodo);
      return q.order('fecha', { ascending: false }).order('id').range(d, h);
    }, 'bo.leerGastos');
    return filas.map(aGastoFila);
  });
}

/** Interfaz fija con los otros lotes (cierre mensual, contabilidad): los gastos de UN mes. `no_disponible` si la tabla no existe todavía. */
export async function getGastosDelMes(periodo: string): Promise<Lectura<GastoMes[]>> {
  if (!esPeriodoValido(periodo)) return { estado: 'error', mensaje: 'periodo inválido' };
  const l = await leerGastos({ desdePeriodo: periodo, hastaPeriodo: periodo });
  return l.estado === 'ok' ? { estado: 'ok', dato: l.dato } : l;
}

/** El RFC propio de Likida. `ok` con `null` = la entidad existe pero aún no tiene RFC; `no_disponible` = ni siquiera existe la tabla. */
export async function leerRfcPropio(): Promise<Lectura<string | null>> {
  return leerSeguro(async () => {
    const { data, error } = await supabaseAdmin().from('bo_entidad').select('rfc').eq('id', 1).maybeSingle();
    if (error) throw error;
    const rfc = (data as { rfc?: string | null } | null)?.rfc;
    return typeof rfc === 'string' && rfc.trim() ? rfc.trim() : null;
  });
}

/** ¿Likida tiene RFC propio ya capturado? Cualquier cosa que no sea un RFC leído es «no» (el candado nunca se abre por una lectura fallida). */
export async function hayRfcPropio(): Promise<boolean> {
  const l = await leerRfcPropio();
  return l.estado === 'ok' && l.dato !== null;
}

export interface ResultadoCrearGasto { id: string; repetido: boolean }

/**
 * Registra un gasto. Idempotente por `claveIdem` (repetir devuelve el mismo id con `repetido: true`); rechaza el duplicado por UUID de CFDI
 * y por llave compuesta contra los gastos vivos del mismo mes.
 */
export async function crearGasto(entrada: EntradaGasto, actorId: string): Promise<ResultadoCrearGasto> {
  const g = normalizarGasto(entrada);
  const admin = supabaseAdmin();

  if (g.claveIdem) {
    const { data, error } = await admin.from('bo_gasto').select('id').eq('clave_idem', g.claveIdem).maybeSingle();
    if (error) throw new Error(`crearGasto.idem: ${error.message}`);
    if (data) return { id: String((data as { id: string }).id), repetido: true };
  }

  const { data: previos, error: errPrev } = await admin.from('bo_gasto')
    .select('id, proveedor_id, fecha, total_mxn, concepto, cfdi_uuid')
    .is('anulado_en', null).eq('periodo', g.periodo).order('id').limit(2000);
  if (errPrev) throw new Error(`crearGasto.previos: ${errPrev.message}`);
  const existentes: BaseDuplicado[] = ((previos ?? []) as Array<Record<string, unknown>>).map((p) => ({
    id: String(p.id), proveedorId: typeof p.proveedor_id === 'string' ? p.proveedor_id : null, fecha: String(p.fecha),
    totalCent: centavos(Number(p.total_mxn)), concepto: typeof p.concepto === 'string' ? p.concepto : null, cfdiUuid: typeof p.cfdi_uuid === 'string' ? p.cfdi_uuid : null,
  }));
  const dup = gastoDuplicado({ proveedorId: g.proveedorId, fecha: g.fecha, totalCent: g.totalCent, concepto: g.concepto, cfdiUuid: g.cfdiUuid }, existentes);
  if (dup) throw errBo(dup.por === 'cfdi_uuid' ? 'gastos.err_duplicado_uuid' : 'gastos.err_duplicado_llave');
  // El UUID de un CFDI también se repite en OTRO mes: la base lo impide (índice único); se pregunta antes para dar el mensaje claro.
  if (g.cfdiUuid) {
    // orden-no-importa: solo se pregunta si EXISTE otro gasto con ese UUID de CFDI; cualquier fila basta para rechazar el duplicado.
    const { data: otro } = await admin.from('bo_gasto').select('id').is('anulado_en', null).ilike('cfdi_uuid', g.cfdiUuid).limit(1);
    if ((otro ?? []).length > 0) throw errBo('gastos.err_duplicado_uuid');
  }

  const rfcPropio = await hayRfcPropio();
  const { data, error } = await admin.from('bo_gasto').insert({
    proveedor_id: g.proveedorId,
    fecha: g.fecha,
    periodo: g.periodo,
    concepto: g.concepto,
    moneda: g.moneda,
    monto_original: pesos(g.montoOriginalCent),
    tipo_cambio: g.tipoCambio,
    subtotal_mxn: g.subtotalCent === null ? null : pesos(g.subtotalCent),
    iva_acreditable_mxn: g.ivaAcreditableCent === null ? null : pesos(g.ivaAcreditableCent),
    total_mxn: pesos(g.totalCent),
    cfdi_uuid: g.cfdiUuid,
    comprobante_estado: g.comprobante,
    deducible_en_forma: deducibleEnForma({ rfcPropio, comprobante: g.comprobante, cfdiUuid: g.cfdiUuid }),
    cuenta_contable: g.cuentaContable,
    clave_idem: g.claveIdem,
    creado_por: actorId,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') {
      // Carrera con otra captura idéntica: si fue la misma clave de idempotencia es un reintento, no un error.
      if (g.claveIdem) {
        const { data: ya } = await admin.from('bo_gasto').select('id').eq('clave_idem', g.claveIdem).maybeSingle();
        if (ya) return { id: String((ya as { id: string }).id), repetido: true };
      }
      throw errBo('gastos.err_duplicado_llave');
    }
    throw new Error(`crearGasto: ${error.message}`);
  }
  return { id: String((data as { id: string }).id), repetido: false };
}

/**
 * Concilia un gasto contra el banco. EXIGE evidencia: una referencia de banco tecleada (≥ 3 caracteres) o un movimiento de tesorería
 * elegido (que aporta su propia referencia). Compare-and-set: dos clics no concilian dos veces.
 */
export async function conciliarGasto(
  gastoId: string,
  p: { referenciaBanco?: string | null; tesoreriaMovId?: string | null },
  actorId: string,
): Promise<void> {
  let referencia = (p.referenciaBanco ?? '').trim();
  const movId = (p.tesoreriaMovId ?? '').trim() || null;
  if (movId) {
    const mov = await leerMovimiento(movId);
    if (mov.estado === 'no_disponible') throw errBo('tesor.err_no_disponible');
    if (mov.estado === 'error') throw new Error(`conciliarGasto.mov: ${mov.mensaje}`);
    if (!mov.dato) throw errBo('tesor.err_mov_no_existe');
    const base = `${mov.dato.fecha} · ${mov.dato.cuentaNombre ?? mov.dato.cuentaId.slice(0, 8)} · ${mov.dato.id.slice(0, 8)}`;
    referencia = referencia ? `${referencia} (${base})` : base;
  }
  if (!referenciaValida(referencia)) throw errBo('gastos.err_referencia');

  // La conexión se abre DESPUÉS de validar: una referencia vacía se rechaza sin tocar la base.
  const admin = supabaseAdmin();
  const ahora = new Date().toISOString();
  const cambios = { conciliado_en: ahora, conciliado_por: actorId, referencia_banco: referencia };
  const actualizar = (c: Record<string, unknown>) => admin.from('bo_gasto').update(c).eq('id', gastoId).is('conciliado_en', null).is('anulado_en', null).select('id');
  // El enlace al movimiento de tesorería viaja en la misma escritura; si la columna de la 1015 aún no existe, se concilia sin el enlace.
  let r = await actualizar(movId ? { ...cambios, tesoreria_mov_id: movId } : cambios);
  if (r.error && movId && esTablaAusente(r.error)) r = await actualizar(cambios);
  if (r.error) throw new Error(`conciliarGasto: ${r.error.message}`);
  if ((r.data ?? []).length === 0) {
    const { data: f } = await admin.from('bo_gasto').select('conciliado_en, anulado_en').eq('id', gastoId).maybeSingle();
    if (!f) throw errBo('gastos.err_no_existe');
    if ((f as { anulado_en?: string | null }).anulado_en) throw errBo('gastos.err_anulado');
    throw errBo('gastos.err_ya_conciliado');
  }
}

/** Anula un gasto vivo (nunca se borra). Motivo obligatorio. Una sola vez. */
export async function anularGasto(gastoId: string, motivo: string, actorId: string): Promise<void> {
  const m = (motivo ?? '').trim();
  if (m.length < 3) throw errBo('gastos.err_motivo');
  const admin = supabaseAdmin();
  const { data: tocadas, error } = await admin.from('bo_gasto')
    .update({ anulado_en: new Date().toISOString(), anulado_por: actorId, motivo_anulacion: m })
    .eq('id', gastoId).is('anulado_en', null).select('id');
  if (error) throw new Error(`anularGasto: ${error.message}`);
  if ((tocadas ?? []).length === 0) {
    const { data: f } = await admin.from('bo_gasto').select('id').eq('id', gastoId).maybeSingle();
    throw errBo(f ? 'gastos.err_ya_anulado' : 'gastos.err_no_existe');
  }
}

/** Límites de un mes para consultas por fecha (inclusivo, exclusivo). */
export function limitesDeMes(periodo: string): { desde: string; hasta: string } {
  return { desde: periodo, hasta: finExclusivoDeMes(periodo) };
}
