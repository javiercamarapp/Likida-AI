// TESORERÍA de Likida (patrón de caja de RTM): cuentas (banco, Stripe, caja) y un libro de movimientos de SOLO INSERCIÓN.
// El saldo de una cuenta es la SUMA de sus movimientos; no hay saldo tecleado. Un error se corrige con una REVERSA enlazada y con motivo.
// Los movimientos los captura una persona mirando su estado de cuenta: no hay conector bancario. Sirve para que conciliar un gasto o un
// pago a vendedor tenga un movimiento que lo respalde. PURO arriba (centavos); IO abajo con `Lectura<T>`.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hoyMx } from '@/lib/formato';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { desdeRespuesta, leerSeguro, type Lectura } from './lectura';
import { centavos, errBo, pesos } from './utiles-c';
import { CONCEPTOS_MANUALES, TIPOS_CUENTA, type ConceptoManual, type TipoCuenta } from './constantes-c';

export { TIPOS_CUENTA, CONCEPTOS_MANUALES, type TipoCuenta, type ConceptoManual };
export type ConceptoMov = ConceptoManual | 'traspaso' | 'reversa';

export interface CuentaTesoreria { id: string; nombre: string; tipo: TipoCuenta; activa: boolean }
export interface MovTesoreria {
  id: string;
  cuentaId: string;
  cuentaNombre: string | null;
  fecha: string;
  concepto: ConceptoMov;
  montoCent: number;
  nota: string | null;
  reversaDe: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA
// ═══════════════════════════════════════════════════════════════════════════

export interface EntradaMovimiento {
  cuentaId: string;
  fecha: string;
  concepto: string;
  /** Pesos tal como se teclean: positivo para ingreso, saldo inicial y egreso (el signo lo pone el concepto); con signo solo en ajuste. */
  monto: number;
  nota?: string | null;
  claveIdem?: string | null;
}

export interface MovimientoValido { cuentaId: string; fecha: string; concepto: ConceptoManual; montoCent: number; nota: string | null; claveIdem: string | null }

/** PURA. Valida una captura y fija el signo del monto según el concepto. LANZA `ErrorBo`. */
export function validarMovimiento(e: EntradaMovimiento, hoy: string = hoyMx()): MovimientoValido {
  if (!e.cuentaId) throw errBo('tesor.err_cuenta');
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(e.fecha ?? '')) throw errBo('tesor.err_fecha');
  if (e.fecha > hoy) throw errBo('tesor.err_fecha_futura');
  if (!CONCEPTOS_MANUALES.includes(e.concepto as ConceptoManual)) throw errBo('tesor.err_concepto');
  const concepto = e.concepto as ConceptoManual;
  if (typeof e.monto !== 'number' || !Number.isFinite(e.monto) || e.monto === 0) throw errBo('tesor.err_monto');
  const abs = centavos(Math.abs(e.monto));
  if (abs === 0 || abs > 999_999_999_999) throw errBo('tesor.err_monto');
  let montoCent: number;
  if (concepto === 'ajuste') montoCent = e.monto < 0 ? -abs : abs;
  else {
    if (e.monto < 0) throw errBo('tesor.err_monto_positivo');
    montoCent = concepto === 'egreso' ? -abs : abs;
  }
  const nota = (e.nota ?? '').trim();
  if (nota.length > 300) throw errBo('tesor.err_nota');
  return { cuentaId: e.cuentaId, fecha: e.fecha, concepto, montoCent, nota: nota || null, claveIdem: (e.claveIdem ?? '').trim() || null };
}

/** PURA. Saldo = suma de los movimientos (centavos). Sin movimientos es 0 REAL de una cuenta sin movimiento, no un dato perdido. */
export function saldoCuentaCent(movs: ReadonlyArray<{ montoCent: number }>): number {
  return movs.reduce((s, m) => s + m.montoCent, 0);
}

/** PURA. Saldo de cada cuenta a partir de todos los movimientos. */
export function saldosPorCuenta(cuentas: readonly CuentaTesoreria[], movs: ReadonlyArray<{ cuentaId: string; montoCent: number }>): Array<{ cuenta: CuentaTesoreria; saldoCent: number; movimientos: number }> {
  return cuentas.map((cuenta) => {
    const propios = movs.filter((m) => m.cuentaId === cuenta.id);
    return { cuenta, saldoCent: saldoCuentaCent(propios), movimientos: propios.length };
  });
}

/** PURA. La reversa de un movimiento: monto contrario, concepto `reversa`, enlazada con motivo obligatorio. LANZA `ErrorBo`. */
export function invertirMovimiento(mov: Pick<MovTesoreria, 'id' | 'cuentaId' | 'concepto' | 'montoCent'>, motivo: string, fecha: string): { cuentaId: string; fecha: string; concepto: 'reversa'; montoCent: number; reversaDe: string; motivo: string } {
  if (mov.concepto === 'reversa') throw errBo('tesor.err_reversar_reversa');
  const m = (motivo ?? '').trim();
  if (m.length < 3) throw errBo('tesor.err_motivo');
  return { cuentaId: mov.cuentaId, fecha, concepto: 'reversa', montoCent: -mov.montoCent, reversaDe: mov.id, motivo: m };
}

/**
 * PURA. Movimientos que pueden respaldar una conciliación: ni reversas, ni movimientos ya reversados, ni los que ya respaldan otro gasto o
 * pago (`usados`). `signo` filtra egresos (gastos y pagos a vendedores) o ingresos.
 */
export function movimientosConciliables(movs: readonly MovTesoreria[], usados: ReadonlySet<string>, signo: 'egreso' | 'ingreso' = 'egreso'): MovTesoreria[] {
  const reversados = new Set(movs.filter((m) => m.reversaDe).map((m) => m.reversaDe as string));
  return movs.filter((m) =>
    m.concepto !== 'reversa' && m.concepto !== 'saldo_inicial'
    && !reversados.has(m.id) && !usados.has(m.id)
    && (signo === 'egreso' ? m.montoCent < 0 : m.montoCent > 0));
}

// ═══════════════════════════════════════════════════════════════════════════
// IO
// ═══════════════════════════════════════════════════════════════════════════

const COL_MOV = 'id, cuenta_id, fecha, concepto, monto, nota, reversa_de, bo_tesoreria_cuenta(nombre)';

function aMov(f: Record<string, unknown>): MovTesoreria {
  const c = f.bo_tesoreria_cuenta as { nombre?: string } | Array<{ nombre?: string }> | null;
  const nombre = Array.isArray(c) ? c[0]?.nombre : c?.nombre;
  return {
    id: String(f.id),
    cuentaId: String(f.cuenta_id),
    cuentaNombre: nombre ?? null,
    fecha: String(f.fecha),
    concepto: String(f.concepto) as ConceptoMov,
    montoCent: centavos(Number(f.monto)),
    nota: typeof f.nota === 'string' ? f.nota : null,
    reversaDe: typeof f.reversa_de === 'string' ? f.reversa_de : null,
  };
}

export async function listarCuentas(): Promise<Lectura<CuentaTesoreria[]>> {
  return leerSeguro(async () => {
    const r = await supabaseAdmin().from('bo_tesoreria_cuenta').select('id, nombre, tipo, activa').order('nombre').order('id').limit(200);
    if (r.error) throw r.error;
    return ((r.data ?? []) as Array<Record<string, unknown>>).map((f) => ({
      id: String(f.id), nombre: String(f.nombre), tipo: (TIPOS_CUENTA.includes(f.tipo as TipoCuenta) ? f.tipo : 'banco') as TipoCuenta, activa: f.activa !== false,
    }));
  });
}

/** TODOS los movimientos (el libro es chico: lo escribe una persona a mano), del más reciente al más viejo. */
export async function listarMovimientos(): Promise<Lectura<MovTesoreria[]>> {
  return leerSeguro(async () => {
    const admin = supabaseAdmin();
    const filas = await traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('bo_tesoreria_mov').select(COL_MOV, conteo(d)).order('fecha', { ascending: false }).order('id').range(d, h),
      'bo.tesoreria.movs',
    );
    return filas.map(aMov);
  });
}

/** Un movimiento por id. `ok` con `null` = no existe. */
export async function leerMovimiento(id: string): Promise<Lectura<MovTesoreria | null>> {
  try {
    const r = await supabaseAdmin().from('bo_tesoreria_mov').select(COL_MOV).eq('id', id).maybeSingle();
    const l = desdeRespuesta<Record<string, unknown>>({ data: r.data as Record<string, unknown> | null, error: r.error });
    if (l.estado !== 'ok') return l;
    return { estado: 'ok', dato: l.dato ? aMov(l.dato) : null };
  } catch (e) {
    return { estado: 'error', mensaje: e instanceof Error ? e.message : String(e) };
  }
}

/** Ids de movimientos que ya respaldan un gasto o un pago (para no ofrecerlos dos veces). Si la columna aún no existe, es el conjunto vacío. */
export async function movimientosUsados(): Promise<ReadonlySet<string>> {
  const admin = supabaseAdmin();
  const usados = new Set<string>();
  for (const tabla of ['bo_gasto', 'bo_pago_vendedor']) {
    const r = await admin.from(tabla).select('tesoreria_mov_id').not('tesoreria_mov_id', 'is', null).order('id').limit(5000);
    if (r.error) continue;
    for (const f of (r.data ?? []) as Array<{ tesoreria_mov_id: string }>) usados.add(String(f.tesoreria_mov_id));
  }
  return usados;
}

export async function crearCuenta(entrada: { nombre: string; tipo: string }): Promise<string> {
  const nombre = (entrada.nombre ?? '').trim();
  if (nombre.length < 1 || nombre.length > 80) throw errBo('tesor.err_nombre');
  if (!TIPOS_CUENTA.includes(entrada.tipo as TipoCuenta)) throw errBo('tesor.err_tipo');
  const { data, error } = await supabaseAdmin().from('bo_tesoreria_cuenta').insert({ nombre, tipo: entrada.tipo }).select('id').single();
  if (error) {
    if (error.code === '23505') throw errBo('tesor.err_cuenta_duplicada', { nombre });
    throw new Error(`crearCuenta: ${error.message}`);
  }
  return String((data as { id: string }).id);
}

/** Registra un movimiento. Idempotente por `claveIdem`. La cuenta debe existir y estar activa. */
export async function registrarMovimiento(entrada: EntradaMovimiento, actorId: string): Promise<{ id: string; repetido: boolean }> {
  const v = validarMovimiento(entrada);
  const admin = supabaseAdmin();
  const { data: cuenta, error: errC } = await admin.from('bo_tesoreria_cuenta').select('id, activa').eq('id', v.cuentaId).maybeSingle();
  if (errC) throw new Error(`registrarMovimiento.cuenta: ${errC.message}`);
  if (!cuenta) throw errBo('tesor.err_cuenta');
  if ((cuenta as { activa?: boolean }).activa === false) throw errBo('tesor.err_cuenta_inactiva');
  const { data, error } = await admin.from('bo_tesoreria_mov').insert({
    cuenta_id: v.cuentaId, fecha: v.fecha, concepto: v.concepto, monto: pesos(v.montoCent), nota: v.nota, clave_idem: v.claveIdem, creado_por: actorId,
  }).select('id').single();
  if (error) {
    if (error.code === '23505' && v.claveIdem) {
      const { data: ya } = await admin.from('bo_tesoreria_mov').select('id').eq('clave_idem', v.claveIdem).maybeSingle();
      if (ya) return { id: String((ya as { id: string }).id), repetido: true };
    }
    throw new Error(`registrarMovimiento: ${error.message}`);
  }
  return { id: String((data as { id: string }).id), repetido: false };
}

/** Reversa un movimiento con motivo. Una sola vez por movimiento (único en la base). */
export async function reversarMovimiento(movId: string, motivo: string, actorId: string): Promise<string> {
  const l = await leerMovimiento(movId);
  if (l.estado === 'no_disponible') throw errBo('tesor.err_no_disponible');
  if (l.estado === 'error') throw new Error(`reversarMovimiento.leer: ${l.mensaje}`);
  if (!l.dato) throw errBo('tesor.err_mov_no_existe');
  const inv = invertirMovimiento(l.dato, motivo, hoyMx());
  const { data, error } = await supabaseAdmin().from('bo_tesoreria_mov').insert({
    cuenta_id: inv.cuentaId, fecha: inv.fecha, concepto: inv.concepto, monto: pesos(inv.montoCent), reversa_de: inv.reversaDe, motivo_reversa: inv.motivo, creado_por: actorId,
  }).select('id').single();
  if (error) {
    if (error.code === '23505') throw errBo('tesor.err_ya_reversado');
    throw new Error(`reversarMovimiento: ${error.message}`);
  }
  return String((data as { id: string }).id);
}
