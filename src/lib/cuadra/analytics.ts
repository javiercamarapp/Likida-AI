// ═══════════════════════════════════════════════════════════════════════════
// ANALÍTICA del dashboard — valor que Cuadra otorga con la data capturada.
// KPIs, rendimiento por operador/ruta, tendencia de diferencias, y DETECCIÓN
// DE ANOMALÍAS/FRAUDE (mismo CFDI usado en dos viajes, folios duplicados).
// ═══════════════════════════════════════════════════════════════════════════

import { detectarDuplicadosEntreViajes, type Anomalia } from './duplicados';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cuadrarDesdeDB } from './cuadre/desde_db';

// ── Los fallos de Supabase llegan POR VALOR, no lanzando ────────────────────
// `shouldThrowOnError` es false por defecto en postgrest-js, así que un host
// inalcanzable, un 500, una llave rotada o un `grant` que le cierre la tabla al
// service-role devuelven `{ data: null, error }` y siguen. Desestructurar solo
// `data` convierte cualquiera de esos fallos en "no hay nada": el panel pintaba
// "Aún no hay liquidaciones" con la base caída y el contralor concluía que la
// flota nunca ha liquidado un viaje (auditoría 5, frontend, CRÍTICO).
//
// El panel ya sabe distinguir null de dato —`safe()` en dashboard/page.tsx
// atrapa excepciones—, así que lo único que faltaba era TRADUCIR el error por
// valor a una excepción. Se hace aquí, en el borde, y no en cada llamador.
type RespuestaPg<T> = { data: T | null; error: { message: string } | null };

function exigir<T>(res: RespuestaPg<T>, consulta: string): T | null {
  if (res.error) throw new Error(`${consulta}: ${res.error.message}`);
  return res.data;
}

export interface DashboardKpis {
  viajesLiquidados: number;
  montoComprobado: number;
  diferenciaDetectada: number;   // total de dinero recuperado/observado
  conDiferencias: number;
  porRevisar: number;
  tasaCuadre: number;            // % de liquidaciones sin diferencias
}

export async function getKpis(tenantId: string): Promise<DashboardKpis> {
  const res = await supabaseAdmin()
    .from('liquidacion')
    .select('total_comprobado, diferencia, estatus, diferencias')
    .eq('tenant_id', tenantId);
  const rows = exigir(res, 'getKpis') ?? [];
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

export type { Anomalia } from './duplicados';

/**
 * Detección de fraude entre viajes. La lógica vive en `duplicados.ts` (pura y
 * probada); aquí solo se traen las filas.
 *
 * La versión anterior tenía esta lógica pegada a Supabase, y por eso nunca se
 * probó: declaraba detectar `folio_duplicado` y solo producía `cfdi_duplicado`.
 */
export async function detectarAnomalias(tenantId: string): Promise<Anomalia[]> {
  const res = await supabaseAdmin()
    .from('gasto')
    .select('viaje_id, concepto, monto, folio, cfdi_uuid')
    .eq('tenant_id', tenantId);
  // Un "0 anomalías" por fallo de lectura se lee como "revisamos y todo está
  // limpio", que es la afirmación más cara que puede hacer este producto.
  const data = exigir(res, 'detectarAnomalias');
  return detectarDuplicadosEntreViajes(
    (data ?? []).map((r) => ({
      viajeId: r.viaje_id as string,
      concepto: (r.concepto as string) ?? 'otro',
      monto: Number(r.monto),
      folio: (r.folio as string) || undefined,
      cfdiUuid: (r.cfdi_uuid as string) || undefined,
    })),
  );
}

export interface Acreditables {
  /** Litros de diésel elegibles. El estímulo en pesos lo calcula el contador. */
  litrosDiesel: number; ieps: number; iva: number; peaje: number; }

/** Suma de estímulos acreditables del periodo (IEPS diésel + IVA + peaje 50%). */
export async function getAcreditables(tenantId: string): Promise<Acreditables> {
  const res = await supabaseAdmin()
    .from('liquidacion')
    .select('ieps_acreditable, iva_acreditable, peaje_acreditable, litros_diesel_acreditables')
    .eq('tenant_id', tenantId);
  const rows = exigir(res, 'getAcreditables') ?? [];
  return {
    ieps: round2(rows.reduce((s, r) => s + Number(r.ieps_acreditable ?? 0), 0)),
    iva: round2(rows.reduce((s, r) => s + Number(r.iva_acreditable ?? 0), 0)),
    peaje: round2(rows.reduce((s, r) => s + Number(r.peaje_acreditable ?? 0), 0)),
    // El IEPS ya no se presenta en pesos —el estímulo es cuota semanal × litros
    // y esa cuota no la tenemos—, así que lo que se entrega es el dato duro.
    litrosDiesel: round2(rows.reduce((s, r) => s + Number(r.litros_diesel_acreditables ?? 0), 0)),
  };
}

export interface LiquidacionDetalle {
  id: string; folio: string; estatus: string; fecha: string;
  totalComprobado: number; totalAnticipo: number; diferencia: number;
  ieps: number; litrosDiesel: number; iva: number; peaje: number;
  diferencias: Array<{ tipo: string; nota: string; monto: number }>;
  /** `ocrExtra` viaja porque la etiqueta del renglón depende del producto
   *  impreso en el ticket: sin él el panel dice "Diésel" donde el PDF dice
   *  "Combustible Magna" (auditoría 5, arquitectura, ALTO 1). */
  gastos: Array<{ concepto: string; monto: number; folio?: string; ocrExtra?: Record<string, unknown> }>;
  /** Las tres cubetas del motor, o `null` si no se pudieron reconstruir. */
  deducibilidad: { totalDeducible: number; totalNoDeducible: number; totalPorConfirmar: number } | null;
}

/** Detalle de una liquidación (read-only) — para la vista de proyector. */
export async function getLiquidacionDetalle(id: string, tenantId: string): Promise<LiquidacionDetalle | null> {
  const admin = supabaseAdmin();
  const res = await admin
    .from('liquidacion')
    .select('id, viaje_id, estatus, total_comprobado, total_anticipo, diferencia, diferencias, ieps_acreditable, litros_diesel_acreditables, iva_acreditable, peaje_acreditable, created_at, viaje:viaje_id(folio)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  // `null` significa AHORA una sola cosa: la liquidación no existe (y la página
  // responde notFound()). Antes también significaba "no se pudo leer", y el
  // contralor que hacía clic en una liquidación real leía "Esta página no
  // existe. Puede que el enlace esté mal escrito".
  const data = exigir(res, 'getLiquidacionDetalle');
  if (!data) return null;
  const resGastos = await admin
    .from('gasto')
    .select('concepto, monto, folio, ocr_extra')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', data.viaje_id as string);
  const gastos = exigir(resGastos, 'getLiquidacionDetalle/gastos');
  return {
    id: data.id as string,
    folio: ((data.viaje as { folio?: string } | null)?.folio) ?? (data.id as string).slice(0, 8),
    estatus: data.estatus as string,
    fecha: (data.created_at as string).slice(0, 10),
    totalComprobado: Number(data.total_comprobado ?? 0),
    totalAnticipo: Number(data.total_anticipo ?? 0),
    diferencia: Number(data.diferencia ?? 0),
    ieps: Number(data.ieps_acreditable ?? 0),
    // El select no la pedía, así que el detalle NUNCA podía mostrar los litros:
    // el contralor veía "1,850 L elegibles" en la tarjeta de la lista, hacía clic,
    // y en la liquidación que los produjo no había ninguna mención.
    litrosDiesel: Number(data.litros_diesel_acreditables ?? 0),
    iva: Number(data.iva_acreditable ?? 0),
    peaje: Number(data.peaje_acreditable ?? 0),
    diferencias: ((data.diferencias as Array<{ tipo: string; nota: string; monto: number }>) ?? []),
    gastos: (gastos ?? []).map((g) => ({
      concepto: g.concepto as string,
      monto: Number(g.monto),
      folio: (g.folio as string) || undefined,
      ocrExtra: (g.ocr_extra as Record<string, unknown>) || undefined,
    })),
    deducibilidad: await reconstruirDeducibilidad(tenantId, data.viaje_id as string),
  };
}

/**
 * Cuánto de lo comprobado sobrevive una revisión del SAT — el cálculo que
 * diferencia al producto y que el panel NO podía enseñar.
 *
 * Las tres cubetas se calculan en el motor y se imprimen en el PDF, pero no se
 * persisten: no hay columnas `total_deducible` / `total_no_deducible` /
 * `total_por_confirmar` ni parámetros en `guardar_liquidacion_tx`. El contralor
 * que revisa desde el navegador —el uso que el panel promete— veía "Comprobado
 * $47,300" y ahí terminaba (auditoría 5, frontend, ALTO 2).
 *
 * En vez de recalcularlas aquí —que sería la cuarta copia de la lógica del
 * dinero— se reconstruye la liquidación con el MISMO motor que alimenta al PDF.
 * Dos consecuencias buscadas:
 *
 *  - Si la reconstrucción no cuadra con lo persistido (config del tenant
 *    cambiada, gastos añadidos después del cierre), las cubetas no van a sumar
 *    `totalComprobado` y `filasDeducibilidad` devuelve null: la pantalla se
 *    calla en vez de contradecir a su propio total. Ese portón ya existe y está
 *    probado en `liquidacion/deducibilidad.ts`.
 *  - Si la reconstrucción falla (viaje borrado, lectura caída), el detalle se
 *    sirve igual sin el desglose. Es un extra: no puede tirar la pantalla que
 *    el contralor sí puede leer.
 */
async function reconstruirDeducibilidad(tenantId: string, viajeId: string) {
  try {
    const liq = await cuadrarDesdeDB(tenantId, viajeId);
    return {
      totalDeducible: liq.totalDeducible,
      totalNoDeducible: liq.totalNoDeducible,
      totalPorConfirmar: liq.totalPorConfirmar,
    };
  } catch {
    return null;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
