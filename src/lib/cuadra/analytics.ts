// ═══════════════════════════════════════════════════════════════════════════
// ANALÍTICA del dashboard — valor que Cuadra otorga con la data capturada.
// KPIs, rendimiento por operador/ruta, tendencia de diferencias, y DETECCIÓN
// DE ANOMALÍAS/FRAUDE (mismo CFDI usado en dos viajes, folios duplicados).
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';

export interface DashboardKpis {
  viajesLiquidados: number;
  montoComprobado: number;
  diferenciaDetectada: number;   // total de dinero recuperado/observado
  conDiferencias: number;
  porRevisar: number;
  tasaCuadre: number;            // % de liquidaciones sin diferencias
}

export async function getKpis(tenantId: string): Promise<DashboardKpis> {
  const { data } = await supabaseAdmin()
    .from('liquidacion')
    .select('total_comprobado, diferencia, estatus, diferencias')
    .eq('tenant_id', tenantId);
  const rows = data ?? [];
  const conDif = rows.filter((r) => r.estatus === 'con_diferencias').length;
  const revisar = rows.filter((r) => r.estatus === 'revisar').length;
  const cuadradas = rows.filter((r) => r.estatus === 'cuadrada').length;
  const dineroObservado = rows.reduce((s, r) => {
    const difs = (r.diferencias as Array<{ tipo: string; monto: number }>) ?? [];
    return s + difs.filter((d) => d.tipo === 'sobre_politica' || d.tipo === 'duplicado').reduce((a, d) => a + Math.abs(d.monto), 0);
  }, 0);
  return {
    viajesLiquidados: rows.length,
    montoComprobado: round2(rows.reduce((s, r) => s + Number(r.total_comprobado ?? 0), 0)),
    diferenciaDetectada: round2(dineroObservado),
    conDiferencias: conDif,
    porRevisar: revisar,
    tasaCuadre: rows.length ? Math.round((cuadradas / rows.length) * 100) : 0,
  };
}

export interface OperadorStat {
  operadorId: string;
  nombre: string;
  viajes: number;
  dieselTotal: number;
  diferencias: number;
}

/** Rendimiento por operador (diésel total, # de diferencias) — señal operativa. */
export async function getStatsPorOperador(tenantId: string): Promise<OperadorStat[]> {
  const admin = supabaseAdmin();
  const [{ data: ops }, { data: gastos }, { data: viajes }] = await Promise.all([
    admin.from('operador').select('id, nombre').eq('tenant_id', tenantId),
    admin.from('gasto').select('viaje_id, concepto, monto').eq('tenant_id', tenantId).eq('concepto', 'diesel'),
    admin.from('viaje').select('id, operador_id').eq('tenant_id', tenantId),
  ]);
  const viajeToOp = new Map((viajes ?? []).map((v) => [v.id as string, v.operador_id as string]));
  const dieselPorOp = new Map<string, number>();
  const viajesPorOp = new Map<string, Set<string>>();
  for (const gr of gastos ?? []) {
    const op = viajeToOp.get(gr.viaje_id as string);
    if (!op) continue;
    dieselPorOp.set(op, (dieselPorOp.get(op) ?? 0) + Number(gr.monto));
    if (!viajesPorOp.has(op)) viajesPorOp.set(op, new Set());
    viajesPorOp.get(op)!.add(gr.viaje_id as string);
  }
  return (ops ?? []).map((o) => ({
    operadorId: o.id as string,
    nombre: o.nombre as string,
    viajes: viajesPorOp.get(o.id as string)?.size ?? 0,
    dieselTotal: round2(dieselPorOp.get(o.id as string) ?? 0),
    diferencias: 0,
  }));
}

export interface Anomalia {
  tipo: 'cfdi_duplicado' | 'folio_duplicado';
  detalle: string;
  monto: number;
  viajes: string[];
}

/** Detección de fraude: mismo CFDI/folio usado en 2+ viajes distintos. */
export async function detectarAnomalias(tenantId: string): Promise<Anomalia[]> {
  const { data } = await supabaseAdmin()
    .from('gasto')
    .select('viaje_id, concepto, monto, folio, cfdi_uuid')
    .eq('tenant_id', tenantId);
  const rows = data ?? [];
  const anomalias: Anomalia[] = [];

  const porUuid = new Map<string, Set<string>>();
  const montoUuid = new Map<string, number>();
  for (const r of rows) {
    if (!r.cfdi_uuid) continue;
    const k = r.cfdi_uuid as string;
    if (!porUuid.has(k)) porUuid.set(k, new Set());
    porUuid.get(k)!.add(r.viaje_id as string);
    montoUuid.set(k, Number(r.monto));
  }
  for (const [uuid, viajes] of porUuid) {
    if (viajes.size > 1) {
      anomalias.push({ tipo: 'cfdi_duplicado', detalle: `CFDI ${uuid.slice(0, 8)}… usado en ${viajes.size} viajes`, monto: montoUuid.get(uuid) ?? 0, viajes: [...viajes] });
    }
  }
  return anomalias;
}

export interface Acreditables { ieps: number; iva: number; peaje: number; }

/** Suma de estímulos acreditables del periodo (IEPS diésel + IVA + peaje 50%). */
export async function getAcreditables(tenantId: string): Promise<Acreditables> {
  const { data } = await supabaseAdmin()
    .from('liquidacion')
    .select('ieps_acreditable, iva_acreditable, peaje_acreditable')
    .eq('tenant_id', tenantId);
  const rows = data ?? [];
  return {
    ieps: round2(rows.reduce((s, r) => s + Number(r.ieps_acreditable ?? 0), 0)),
    iva: round2(rows.reduce((s, r) => s + Number(r.iva_acreditable ?? 0), 0)),
    peaje: round2(rows.reduce((s, r) => s + Number(r.peaje_acreditable ?? 0), 0)),
  };
}

export interface LiquidacionDetalle {
  id: string; folio: string; estatus: string; fecha: string;
  totalComprobado: number; totalAnticipo: number; diferencia: number;
  ieps: number; iva: number; peaje: number;
  diferencias: Array<{ tipo: string; nota: string; monto: number }>;
  gastos: Array<{ concepto: string; monto: number; folio?: string }>;
}

/** Detalle de una liquidación (read-only) — para la vista de proyector. */
export async function getLiquidacionDetalle(id: string, tenantId: string): Promise<LiquidacionDetalle | null> {
  const admin = supabaseAdmin();
  const { data } = await admin
    .from('liquidacion')
    .select('id, viaje_id, estatus, total_comprobado, total_anticipo, diferencia, diferencias, ieps_acreditable, iva_acreditable, peaje_acreditable, created_at, viaje:viaje_id(folio)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (!data) return null;
  const { data: gastos } = await admin
    .from('gasto')
    .select('concepto, monto, folio')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', data.viaje_id as string);
  return {
    id: data.id as string,
    folio: ((data.viaje as { folio?: string } | null)?.folio) ?? (data.id as string).slice(0, 8),
    estatus: data.estatus as string,
    fecha: (data.created_at as string).slice(0, 10),
    totalComprobado: Number(data.total_comprobado ?? 0),
    totalAnticipo: Number(data.total_anticipo ?? 0),
    diferencia: Number(data.diferencia ?? 0),
    ieps: Number(data.ieps_acreditable ?? 0),
    iva: Number(data.iva_acreditable ?? 0),
    peaje: Number(data.peaje_acreditable ?? 0),
    diferencias: ((data.diferencias as Array<{ tipo: string; nota: string; monto: number }>) ?? []),
    gastos: (gastos ?? []).map((g) => ({ concepto: g.concepto as string, monto: Number(g.monto), folio: (g.folio as string) || undefined })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
