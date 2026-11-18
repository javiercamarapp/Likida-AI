// COMISIONES de vendedores — una REGLA sobre COBRADO, nunca una cifra inventada (src/lib/likida/vendedores.ts ya lo declara).
// Regla pactada (14-ago-2026): 50 % del primer mes y 20 % recurrente; las constantes viven en vendedores.ts y aquí se LEEN, no se copian.
// Base: SUBTOTAL sin IVA de una factura_saas 'pagada' con conciliada_en y referencia_banco (a confirmar). Vigencia: NO definida (los 24 meses
// del paquete son una propuesta); solo rige si `bo_comision_regla.vigencia_meses` la declara. Sin cobros reales el resultado correcto es
// «0 cobrados, 0 devengado», dicho con la regla.
//
// PURO arriba (centavos enteros, porcentajes en puntos base: 5000 = 50 %), sin base ni reloj; IO abajo con `Lectura<T>`.
// Reutiliza `listarFacturasSaas` de transferencia.ts: no duplica la lectura de facturas.
import { supabaseAdmin } from '@/lib/supabase/admin';
import { COMISION_PRIMER_MES, COMISION_RECURRENTE, ESTADOS_PROSPECTO_PERSISTIDOS, normalizarEstadoProspecto } from '@/lib/likida/vendedores';
import { listarFacturasSaas, TECHO_FACTURAS_SAAS } from '@/lib/saas/transferencia';
import { hoyMx } from '@/lib/formato';
import { conteo, traerTodo } from '@/lib/likida/pg';
import { leerSeguro, type Lectura } from './lectura';
import type { ComisionMes } from './tipos';
import { centavos, errBo, esPeriodoValido, finExclusivoDeMes, inicioDeMes, mesDeInstanteMx, mesesEntre, numeroONulo, pesos, referenciaValida } from './utiles-c';

// ═══════════════════════════════════════════════════════════════════════════
// PARTE PURA
// ═══════════════════════════════════════════════════════════════════════════

export interface ReglasComision {
  primerMesBp: number;
  recurrenteBp: number;
  /** `null` = vigencia no definida (hoy): la comisión recurrente no caduca hasta que Javier decida. */
  vigenciaMeses: number | null;
}

/** La regla tal como la dicta el CÓDIGO (fuente primaria). La vigencia viene de la tabla, o `null`. */
export function reglasDelCodigo(vigenciaMeses: number | null = null): ReglasComision {
  return { primerMesBp: Math.round(COMISION_PRIMER_MES * 10_000), recurrenteBp: Math.round(COMISION_RECURRENTE * 10_000), vigenciaMeses };
}

export interface FacturaComisionable {
  id: string;
  tenantId: string;
  estado: string;
  pagadaEn: string | null;
  conciliadaEn: string | null;
  referenciaBanco: string | null;
  /** Subtotal SIN IVA en centavos; `null` si la fila no tiene desglose (no se puede comisionar). */
  subtotalCent: number | null;
}

/** Solo lo COBRADO y CONCILIADO con referencia de banco comisiona: una «pendiente», o una «pagada» sin referencia, no. */
export function esCobradoComisionable(f: FacturaComisionable): boolean {
  return f.estado === 'pagada' && !!f.pagadaEn && !!f.conciliadaEn && referenciaValida(f.referenciaBanco) && f.subtotalCent !== null && f.subtotalCent > 0;
}

export type TipoDeMes = 'primer_mes' | 'recurrente' | 'fuera_de_vigencia' | 'sin_dato';

/**
 * ¿El mes que se paga es el primero del cliente, uno recurrente, o ya cayó fuera de la vigencia? Se mide contra la fecha de la PRIMERA
 * factura cobrada. Sin esa fecha no se puede decidir y se dice `sin_dato` (jamás se adivina «recurrente»). La vigencia solo aplica si está
 * configurada (`vigenciaMeses !== null`).
 */
export function tipoDeMes(primeraCobradaEn: string | null | undefined, periodo: string, vigenciaMeses: number | null): TipoDeMes {
  if (!primeraCobradaEn) return 'sin_dato';
  const mesPrimera = primeraCobradaEn.length === 10 ? inicioDeMes(primeraCobradaEn) : mesDeInstanteMx(primeraCobradaEn);
  if (!mesPrimera) return 'sin_dato';
  const d = mesesEntre(mesPrimera, periodo);
  if (d < 0) return 'sin_dato';
  if (d === 0) return 'primer_mes';
  if (vigenciaMeses !== null && d >= vigenciaMeses) return 'fuera_de_vigencia';
  return 'recurrente';
}

export type MotivoOmision = 'sin_vendedor' | 'no_cobrado' | 'fuera_de_periodo' | 'ya_devengado' | 'sin_dato' | 'fuera_de_vigencia';

export interface EntradaDevengo {
  vendedorId: string | null;
  factura: FacturaComisionable;
  primeraCobradaEn: string | null;
  periodo: string;
  /** Ids de factura que ya tienen su devengo: devengar dos veces la misma factura no existe. */
  yaDevengadas: ReadonlySet<string>;
  reglas: ReglasComision;
}

export type ResultadoDevengo =
  | { omitido: MotivoOmision }
  | { devengo: { facturaId: string; concepto: 'primer_mes' | 'recurrente'; baseCent: number; pctBp: number; montoCent: number } };

/** Comisión en centavos: base × puntos base / 10 000, redondeada al centavo (la mitad sube; 0.5 ¢ → 1 ¢). Aritmética entera hasta el último paso. */
export function comisionCent(baseCent: number, pctBp: number): number {
  return Math.round((baseCent * pctBp) / 10_000);
}

/** PURA. Decide si una factura devenga comisión en el periodo y cuánto. Nunca lanza: lo que no procede devuelve su motivo. */
export function devengar(e: EntradaDevengo): ResultadoDevengo {
  if (!e.vendedorId) return { omitido: 'sin_vendedor' };
  if (!esCobradoComisionable(e.factura)) return { omitido: 'no_cobrado' };
  if (e.yaDevengadas.has(e.factura.id)) return { omitido: 'ya_devengado' };
  if (mesDeInstanteMx(e.factura.pagadaEn) !== e.periodo) return { omitido: 'fuera_de_periodo' };
  const tipo = tipoDeMes(e.primeraCobradaEn, e.periodo, e.reglas.vigenciaMeses);
  if (tipo === 'sin_dato') return { omitido: 'sin_dato' };
  if (tipo === 'fuera_de_vigencia') return { omitido: 'fuera_de_vigencia' };
  const pctBp = tipo === 'primer_mes' ? e.reglas.primerMesBp : e.reglas.recurrenteBp;
  const baseCent = e.factura.subtotalCent as number;
  return { devengo: { facturaId: e.factura.id, concepto: tipo, baseCent, pctBp, montoCent: comisionCent(baseCent, pctBp) } };
}

export interface DevengoExistente { id: string; vendedorId: string; facturaId: string | null; baseCent: number; montoCent: number }

export interface ClawbackCalculado { referenciaOrigen: string; vendedorId: string; facturaId: string | null; baseCent: number; montoCent: number }

/**
 * PURA. Si la factura de un devengo se CANCELÓ después, el ajuste: un movimiento NEGATIVO, exactamente el contrario, ligado al origen.
 * `null` si no procede (la factura no está cancelada, el devengo era cero, o ya se revirtió). El ajuste se resta hacia adelante: jamás
 * se le pide dinero al vendedor.
 */
export function calcularClawback(d: DevengoExistente, estadoFactura: string | null, yaRevertidos: ReadonlySet<string>): ClawbackCalculado | null {
  if (estadoFactura !== 'cancelada') return null;
  if (yaRevertidos.has(d.id)) return null;
  if (d.montoCent <= 0) return null;
  return { referenciaOrigen: d.id, vendedorId: d.vendedorId, facturaId: d.facturaId, baseCent: d.baseCent, montoCent: -d.montoCent };
}

export interface SaldoVendedor {
  devengadoCent: number;
  /** Suma de ajustes (NEGATIVA o cero). */
  clawbackCent: number;
  pagadoCent: number;
  autorizadoCent: number;
  saldoCent: number;
  /** El saldo es negativo: se arrastra a lo siguiente; nunca se pide dinero de vuelta. */
  arrastrar: boolean;
  /** Lo que de verdad se le podría pagar hoy (nunca negativo). */
  porPagarCent: number;
  /** Cuánto debe descontarse de lo que viene (positivo) cuando el saldo es negativo. */
  arrastreCent: number;
}

/** PURA. Saldo del vendedor: devengado + ajustes − pagado − autorizado. Un saldo negativo se ARRASTRA. */
export function saldoVendedor(
  movs: ReadonlyArray<{ tipo: 'devengo' | 'clawback'; montoCent: number }>,
  pagos: ReadonlyArray<{ estado: string; montoCent: number }>,
): SaldoVendedor {
  const devengadoCent = movs.filter((m) => m.tipo === 'devengo').reduce((s, m) => s + m.montoCent, 0);
  const clawbackCent = movs.filter((m) => m.tipo === 'clawback').reduce((s, m) => s + m.montoCent, 0);
  const pagadoCent = pagos.filter((p) => p.estado === 'pagado').reduce((s, p) => s + p.montoCent, 0);
  const autorizadoCent = pagos.filter((p) => p.estado === 'autorizado').reduce((s, p) => s + p.montoCent, 0);
  const saldoCent = devengadoCent + clawbackCent - pagadoCent - autorizadoCent;
  return { devengadoCent, clawbackCent, pagadoCent, autorizadoCent, saldoCent, arrastrar: saldoCent < 0, porPagarCent: Math.max(saldoCent, 0), arrastreCent: saldoCent < 0 ? -saldoCent : 0 };
}

export type FaltaParaAutorizar = 'cfdi_honorarios' | 'saldo_no_positivo' | 'monto_invalido' | 'monto_excede_saldo';

/** PURA. ¿Un pago puede autorizarse? Sin CFDI de honorarios NO, aunque el cálculo esté perfecto; el monto no puede pasar del saldo. */
export function listoParaAutorizar(p: { saldoCent: number; montoCent: number; cfdiHonorariosUuid: string | null }): { listo: boolean; falta: FaltaParaAutorizar[] } {
  const falta: FaltaParaAutorizar[] = [];
  if (!p.cfdiHonorariosUuid) falta.push('cfdi_honorarios');
  if (p.saldoCent <= 0) falta.push('saldo_no_positivo');
  if (!(p.montoCent > 0)) falta.push('monto_invalido');
  else if (p.saldoCent > 0 && p.montoCent > p.saldoCent) falta.push('monto_excede_saldo');
  return { listo: falta.length === 0, falta };
}

export interface MovComision {
  id: string;
  vendedorId: string;
  facturaId: string | null;
  prospectoId: string | null;
  tenantId: string | null;
  periodo: string;
  tipo: 'devengo' | 'clawback';
  concepto: 'primer_mes' | 'recurrente' | 'ajuste';
  baseCent: number;
  pctBp: number | null;
  montoCent: number;
  referenciaOrigen: string | null;
}

export interface PagoVendedor {
  id: string;
  vendedorId: string;
  periodo: string;
  montoCent: number;
  cfdiUuid: string | null;
  cfdiRecibidoEn: string | null;
  estado: 'borrador' | 'autorizado' | 'pagado';
  autorizadoEn: string | null;
  pagadoEn: string | null;
  referenciaBanco: string | null;
}

export interface FilaVendedor {
  vendedorId: string;
  nombre: string;
  /** Cobrado base del periodo (subtotal sin IVA de lo que devengó este mes). */
  cobradoBaseCent: number;
  /** Porcentajes aplicados este mes, en puntos base y sin repetir. Vacío = ningún devengo. */
  pctsBp: number[];
  devengadoCent: number;
  clawbackCent: number;
  saldo: SaldoVendedor;
  pago: PagoVendedor | null;
}

/** PURA. La tabla por vendedor y periodo. Todos los vendedores salen, aunque no hayan devengado: el «0 cobrados» es el dato. */
export function resumenPorVendedor(
  vendedores: ReadonlyArray<{ id: string; nombre: string }>,
  movs: readonly MovComision[],
  pagos: readonly PagoVendedor[],
  periodo: string,
): FilaVendedor[] {
  return vendedores.map((v) => {
    const suyos = movs.filter((m) => m.vendedorId === v.id);
    const delMes = suyos.filter((m) => m.periodo === periodo);
    const devs = delMes.filter((m) => m.tipo === 'devengo');
    return {
      vendedorId: v.id,
      nombre: v.nombre,
      cobradoBaseCent: devs.reduce((s, m) => s + m.baseCent, 0),
      pctsBp: [...new Set(devs.map((m) => m.pctBp).filter((p): p is number => p !== null))].sort((a, b) => b - a),
      devengadoCent: devs.reduce((s, m) => s + m.montoCent, 0),
      clawbackCent: delMes.filter((m) => m.tipo === 'clawback').reduce((s, m) => s + m.montoCent, 0),
      saldo: saldoVendedor(suyos, pagos.filter((p) => p.vendedorId === v.id)),
      pago: pagos.find((p) => p.vendedorId === v.id && p.periodo === periodo) ?? null,
    };
  });
}

/** PURA. Devengado total por mes (para la gráfica): un mes SIN ningún movimiento es `null`, no una columna en cero. */
export function devengadoPorMes(movs: readonly MovComision[], hastaPeriodo: string, meses = 6): Array<{ periodo: string; montoCent: number | null }> {
  const suma = new Map<string, number>();
  for (const m of movs) suma.set(m.periodo, (suma.get(m.periodo) ?? 0) + m.montoCent);
  const out: Array<{ periodo: string; montoCent: number | null }> = [];
  const [a, mm] = hastaPeriodo.split('-').map(Number);
  for (let i = meses - 1; i >= 0; i--) {
    const idx = a * 12 + (mm - 1) - i;
    const p = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
    out.push({ periodo: p, montoCent: suma.has(p) ? suma.get(p)! : null });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// IO
// ═══════════════════════════════════════════════════════════════════════════

const COL_MOV = 'id, vendedor_id, prospecto_id, tenant_id, factura_saas_id, periodo, tipo, concepto, base_cobrada, pct_aplicado, monto, referencia_origen';

function aMov(f: Record<string, unknown>): MovComision {
  const pct = numeroONulo(f.pct_aplicado);
  return {
    id: String(f.id),
    vendedorId: String(f.vendedor_id),
    facturaId: typeof f.factura_saas_id === 'string' ? f.factura_saas_id : null,
    prospectoId: typeof f.prospecto_id === 'string' ? f.prospecto_id : null,
    tenantId: typeof f.tenant_id === 'string' ? f.tenant_id : null,
    periodo: String(f.periodo),
    tipo: f.tipo === 'clawback' ? 'clawback' : 'devengo',
    concepto: (f.concepto === 'ajuste' || f.concepto === 'recurrente' ? f.concepto : 'primer_mes') as MovComision['concepto'],
    baseCent: centavos(Number(f.base_cobrada)),
    pctBp: pct === null ? null : Math.round(pct * 10_000),
    montoCent: centavos(Number(f.monto)),
    referenciaOrigen: typeof f.referencia_origen === 'string' ? f.referencia_origen : null,
  };
}

const COL_PAGO = 'id, vendedor_id, periodo, monto_autorizado, cfdi_honorarios_uuid, cfdi_honorarios_recibido_en, estado, autorizado_en, pagado_en, referencia_banco';

export function aPago(f: Record<string, unknown>): PagoVendedor {
  return {
    id: String(f.id),
    vendedorId: String(f.vendedor_id),
    periodo: String(f.periodo),
    montoCent: centavos(Number(f.monto_autorizado)),
    cfdiUuid: typeof f.cfdi_honorarios_uuid === 'string' ? f.cfdi_honorarios_uuid : null,
    cfdiRecibidoEn: typeof f.cfdi_honorarios_recibido_en === 'string' ? f.cfdi_honorarios_recibido_en : null,
    estado: (f.estado === 'autorizado' || f.estado === 'pagado' ? f.estado : 'borrador') as PagoVendedor['estado'],
    autorizadoEn: typeof f.autorizado_en === 'string' ? f.autorizado_en : null,
    pagadoEn: typeof f.pagado_en === 'string' ? f.pagado_en : null,
    referenciaBanco: typeof f.referencia_banco === 'string' ? f.referencia_banco : null,
  };
}

/** Todos los movimientos de comisión (el libro es chico). */
export async function leerMovimientosComision(): Promise<Lectura<MovComision[]>> {
  return leerSeguro(async () => {
    const admin = supabaseAdmin();
    const filas = await traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('bo_comision_mov').select(COL_MOV, conteo(d)).order('periodo', { ascending: false }).order('id').range(d, h),
      'bo.comisiones.movs',
    );
    return filas.map(aMov);
  });
}

export async function leerPagosVendedor(): Promise<Lectura<PagoVendedor[]>> {
  return leerSeguro(async () => {
    const admin = supabaseAdmin();
    const filas = await traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('bo_pago_vendedor').select(COL_PAGO, conteo(d)).order('periodo', { ascending: false }).order('id').range(d, h),
      'bo.comisiones.pagos',
    );
    return filas.map(aPago);
  });
}

export interface VendedorBasico { id: string; nombre: string; email: string }

/** Las cuentas con rol vendedor (lectura ligera; no cuenta prospectos como `listarVendedores`). */
export async function leerVendedoresBasico(): Promise<Lectura<VendedorBasico[]>> {
  return leerSeguro(async () => {
    const r = await supabaseAdmin().from('app_user').select('id, nombre, email').eq('rol', 'vendedor').order('email').order('id').limit(500);
    if (r.error) throw r.error;
    return ((r.data ?? []) as Array<Record<string, unknown>>).map((f) => ({ id: String(f.id), nombre: typeof f.nombre === 'string' && f.nombre ? f.nombre : String(f.email), email: String(f.email) }));
  });
}

export interface ClienteCerrado { prospectoId: string; vendedorId: string | null; tenantId: string; empresa: string; cerradoEn: string | null }

/** Prospectos ganados que ya tienen flota (`tenant_id`). Por flota se toma el cierre MÁS ANTIGUO. Usa `normalizarEstadoProspecto` (won/cerrado). */
export async function leerClientesCerrados(): Promise<Lectura<ClienteCerrado[]>> {
  return leerSeguro(async () => {
    const ganados = ESTADOS_PROSPECTO_PERSISTIDOS.filter((e) => normalizarEstadoProspecto(e) === 'won');
    const admin = supabaseAdmin();
    const filas = await traerTodo<Record<string, unknown>>(
      (d, h) => admin.from('prospecto').select('id, empresa, vendedor_id, tenant_id, estado, cerrado_en', conteo(d))
        .not('tenant_id', 'is', null).is('duplicado_de', null).in('estado', ganados as string[]).order('id').range(d, h),
      'bo.comisiones.clientes',
    );
    const porTenant = new Map<string, ClienteCerrado>();
    for (const f of filas) {
      const c: ClienteCerrado = {
        prospectoId: String(f.id), vendedorId: typeof f.vendedor_id === 'string' ? f.vendedor_id : null, tenantId: String(f.tenant_id),
        empresa: typeof f.empresa === 'string' ? f.empresa : '—', cerradoEn: typeof f.cerrado_en === 'string' ? f.cerrado_en : null,
      };
      const previo = porTenant.get(c.tenantId);
      if (!previo || (c.cerradoEn !== null && (previo.cerradoEn === null || c.cerradoEn < previo.cerradoEn))) porTenant.set(c.tenantId, c);
    }
    return [...porTenant.values()];
  });
}

/** La vigencia configurada (`null` si no hay tabla, no hay fila o está sin definir). El porcentaje SIEMPRE sale del código. */
export async function leerReglasVigentes(): Promise<ReglasComision> {
  try {
    const r = await supabaseAdmin().from('bo_comision_regla').select('vigencia_meses').lte('vigente_desde', hoyMx())
      .order('vigente_desde', { ascending: false }).order('id').limit(1).maybeSingle();
    if (r.error) return reglasDelCodigo(null);
    const v = numeroONulo((r.data as { vigencia_meses?: unknown } | null)?.vigencia_meses);
    return reglasDelCodigo(v !== null && v > 0 ? Math.trunc(v) : null);
  } catch {
    return reglasDelCodigo(null);
  }
}

export interface ResultadoDevengarPeriodo {
  periodo: string;
  devengos: number;
  clawbacks: number;
  yaExistian: number;
  devengadoCent: number;
  clawbackCent: number;
  omitidos: Partial<Record<MotivoOmision, number>>;
  clientesCerrados: number;
  facturasLeidas: number;
}

/**
 * «Devengar periodo»: idempotente. Dos corridas dejan exactamente lo mismo (índice único por factura y tipo; las ya devengadas se saltan).
 * Además genera los clawbacks pendientes de facturas canceladas, en ESTE periodo (hacia adelante). Lanza si la lectura de facturas fue parcial:
 * nunca se calcula sobre un recorte.
 */
export async function devengarPeriodo(periodo: string, actorId: string): Promise<ResultadoDevengarPeriodo> {
  if (!esPeriodoValido(periodo)) throw errBo('comis.err_periodo');
  if (periodo >= finExclusivoDeMes(inicioDeMes(hoyMx()))) throw errBo('comis.err_periodo_futuro');
  const admin = supabaseAdmin();

  const clientes = await leerClientesCerrados();
  if (clientes.estado === 'no_disponible') throw errBo('comis.err_no_disponible');
  if (clientes.estado === 'error') throw new Error(`devengarPeriodo.clientes: ${clientes.mensaje}`);
  const movsL = await leerMovimientosComision();
  if (movsL.estado === 'no_disponible') throw errBo('comis.err_no_disponible');
  if (movsL.estado === 'error') throw new Error(`devengarPeriodo.movs: ${movsL.mensaje}`);

  const lectura = await listarFacturasSaas({ limite: TECHO_FACTURAS_SAAS });
  if (lectura.truncado) throw errBo('comis.err_truncado');
  const facturas = new Map(lectura.filas.map((f) => [f.id, f]));
  const comisionable = (f: (typeof lectura.filas)[number]): FacturaComisionable => ({
    id: f.id, tenantId: f.tenantId, estado: String(f.estado), pagadaEn: f.pagadaEn, conciliadaEn: f.conciliadaEn, referenciaBanco: f.referenciaBanco,
    subtotalCent: f.subtotal === null ? null : centavos(f.subtotal),
  });

  const reglas = await leerReglasVigentes();
  const porTenant = new Map(clientes.dato.map((c) => [c.tenantId, c]));
  const primera = new Map<string, string>();
  for (const f of lectura.filas) {
    if (!porTenant.has(f.tenantId)) continue;
    const c = comisionable(f);
    if (!esCobradoComisionable(c) || !c.pagadaEn) continue;
    const prev = primera.get(f.tenantId);
    if (!prev || c.pagadaEn < prev) primera.set(f.tenantId, c.pagadaEn);
  }

  const yaDevengadas = new Set(movsL.dato.filter((m) => m.tipo === 'devengo' && m.facturaId).map((m) => m.facturaId as string));
  const yaRevertidos = new Set(movsL.dato.filter((m) => m.tipo === 'clawback' && m.referenciaOrigen).map((m) => m.referenciaOrigen as string));

  const out: ResultadoDevengarPeriodo = { periodo, devengos: 0, clawbacks: 0, yaExistian: 0, devengadoCent: 0, clawbackCent: 0, omitidos: {}, clientesCerrados: clientes.dato.length, facturasLeidas: lectura.filas.length };
  const omitir = (m: MotivoOmision) => { out.omitidos[m] = (out.omitidos[m] ?? 0) + 1; };

  for (const f of lectura.filas) {
    const cliente = porTenant.get(f.tenantId);
    if (!cliente) continue;
    const r = devengar({ vendedorId: cliente.vendedorId, factura: comisionable(f), primeraCobradaEn: primera.get(f.tenantId) ?? null, periodo, yaDevengadas, reglas });
    if ('omitido' in r) {
      // Lo «no cobrado» y «fuera de periodo» es el curso normal de un mes: solo se cuentan los motivos que el humano debe ver.
      if (r.omitido !== 'fuera_de_periodo' && r.omitido !== 'ya_devengado' && r.omitido !== 'no_cobrado') omitir(r.omitido);
      if (r.omitido === 'ya_devengado') out.yaExistian += 1;
      continue;
    }
    const { error } = await admin.from('bo_comision_mov').insert({
      vendedor_id: cliente.vendedorId, prospecto_id: cliente.prospectoId, tenant_id: cliente.tenantId, factura_saas_id: r.devengo.facturaId, periodo,
      tipo: 'devengo', concepto: r.devengo.concepto, base_cobrada: pesos(r.devengo.baseCent), pct_aplicado: r.devengo.pctBp / 10_000, monto: pesos(r.devengo.montoCent), creado_por: actorId,
    });
    if (error) {
      if (error.code === '23505') { out.yaExistian += 1; continue; }
      throw new Error(`devengarPeriodo.insert: ${error.message}`);
    }
    yaDevengadas.add(r.devengo.facturaId);
    out.devengos += 1;
    out.devengadoCent += r.devengo.montoCent;
  }

  // Clawbacks de facturas canceladas después de haberse comisionado (incluye los devengos recién insertados: no los hay cancelados, pero es inocuo).
  for (const m of movsL.dato) {
    if (m.tipo !== 'devengo' || !m.facturaId) continue;
    const c = calcularClawback({ id: m.id, vendedorId: m.vendedorId, facturaId: m.facturaId, baseCent: m.baseCent, montoCent: m.montoCent }, facturas.get(m.facturaId)?.estado ?? null, yaRevertidos);
    if (!c) continue;
    const { error } = await admin.from('bo_comision_mov').insert({
      vendedor_id: c.vendedorId, prospecto_id: m.prospectoId, tenant_id: m.tenantId, factura_saas_id: c.facturaId, periodo,
      tipo: 'clawback', concepto: 'ajuste', base_cobrada: pesos(c.baseCent), pct_aplicado: null, monto: pesos(c.montoCent), referencia_origen: c.referenciaOrigen, creado_por: actorId,
    });
    if (error) {
      if (error.code === '23505') continue;
      throw new Error(`devengarPeriodo.clawback: ${error.message}`);
    }
    yaRevertidos.add(m.id);
    out.clawbacks += 1;
    out.clawbackCent += c.montoCent;
  }
  return out;
}

/** Interfaz fija con el cierre mensual (LOTE A): lo devengado, los ajustes (como magnitud POSITIVA) y lo pagado del mes. */
export async function leerComisionesDelMes(periodo: string): Promise<Lectura<ComisionMes>> {
  if (!esPeriodoValido(periodo)) return { estado: 'error', mensaje: 'periodo inválido' };
  const [movs, pagos] = await Promise.all([leerMovimientosComision(), leerPagosVendedor()]);
  if (movs.estado !== 'ok') return movs;
  if (pagos.estado !== 'ok') return pagos;
  const delMes = movs.dato.filter((m) => m.periodo === periodo);
  const hasta = finExclusivoDeMes(periodo);
  return {
    estado: 'ok',
    dato: {
      periodo,
      devengadoCent: delMes.filter((m) => m.tipo === 'devengo').reduce((s, m) => s + m.montoCent, 0),
      clawbackCent: -delMes.filter((m) => m.tipo === 'clawback').reduce((s, m) => s + m.montoCent, 0),
      pagadoCent: pagos.dato.filter((p) => p.estado === 'pagado' && p.pagadoEn !== null && p.pagadoEn >= periodo && p.pagadoEn < hasta).reduce((s, p) => s + p.montoCent, 0),
    },
  };
}
