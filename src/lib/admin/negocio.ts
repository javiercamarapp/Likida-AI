// ═══════════════════════════════════════════════════════════════════════════
// RESUMEN DE NEGOCIO — la consola de superadmin, no el panel de una flota.
//
// Cruza TODOS los tenants a propósito: es la única función del repo con
// permiso de ver toda la base a la vez. `usd()` (formato.ts) ya lo advierte
// en su propio comentario — "nunca para el cliente" — y esta es la primera
// pantalla que de verdad lo pinta: costo de IA en dólares, por fase, de
// Likida completa. Vive fuera de analytics.ts (tenant-scoped en cada línea)
// para que nadie copie un patrón de aquí a una consulta de cliente y filtre
// de menos.
//
// Sin paginación: hoy son 131 filas de llm_costo y 1 tenant. El día que
// crezca de verdad, esto necesita el mismo `traerTodo` que ya usa
// analytics.ts — no antes.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { round2 } from '@/lib/formato';

export interface ResumenNegocio {
  tenants: number;
  flotas: Array<{ id: string; nombre: string; plan: string; viajes: number; costoIaUsd: number }>;
  viajesProcesados: number;
  costoIaUsd: number;
  tokensIn: number;
  tokensOut: number;
  porFase: Array<{ fase: string; n: number; costoUsd: number }>;
  porModelo: Array<{ modelo: string; n: number; costoUsd: number }>;
  porDia: Array<{ dia: string; costoUsd: number; tokens: number }>;
}

export async function getResumenNegocio(): Promise<ResumenNegocio> {
  const admin = supabaseAdmin();
  const [tenantsRes, viajesRes, costoRes] = await Promise.all([
    admin.from('tenant').select('id, nombre, plan'),
    admin.from('viaje').select('id, tenant_id'),
    admin.from('llm_costo').select('tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at'),
  ]);
  // Los tres fallan POR VALOR (supabase-js), no lanzando: sin este chequeo
  // explícito, una base caída se lee "0 tenants, $0 gastados" — que es
  // indistinguible de que Likida de verdad no tiene nada, el mismo error que
  // ya se cerró para el panel de una flota (analytics.ts).
  if (tenantsRes.error) throw new Error(`getResumenNegocio/tenant: ${tenantsRes.error.message}`);
  if (viajesRes.error) throw new Error(`getResumenNegocio/viaje: ${viajesRes.error.message}`);
  if (costoRes.error) throw new Error(`getResumenNegocio/llm_costo: ${costoRes.error.message}`);

  const filas = (costoRes.data ?? []) as Array<
    { tenant_id: string; fase: string; modelo: string; tokens_in: number; tokens_out: number; costo_usd: number; created_at: string }
  >;
  const porFaseMap = new Map<string, { n: number; costoUsd: number }>();
  const porModeloMap = new Map<string, { n: number; costoUsd: number }>();
  const porDiaMap = new Map<string, { costoUsd: number; tokens: number }>();
  const costoPorTenant = new Map<string, number>();
  let costoIaUsd = 0, tokensIn = 0, tokensOut = 0;
  for (const f of filas) {
    costoPorTenant.set(f.tenant_id, (costoPorTenant.get(f.tenant_id) ?? 0) + Number(f.costo_usd));
    const costo = Number(f.costo_usd);
    const tokens = Number(f.tokens_in) + Number(f.tokens_out);
    costoIaUsd += costo;
    tokensIn += Number(f.tokens_in);
    tokensOut += Number(f.tokens_out);

    const fase = porFaseMap.get(f.fase) ?? { n: 0, costoUsd: 0 };
    fase.n += 1; fase.costoUsd += costo;
    porFaseMap.set(f.fase, fase);

    const modelo = porModeloMap.get(f.modelo) ?? { n: 0, costoUsd: 0 };
    modelo.n += 1; modelo.costoUsd += costo;
    porModeloMap.set(f.modelo, modelo);

    // `created_at` es UTC; el corte por día aquí es aproximado a propósito
    // (no es un dato fiscal, es una gráfica de tendencia) — el mismo criterio
    // fino de `fechaMx` sería trabajo de más para una vista que solo enseña
    // si el gasto sube o baja semana a semana.
    const dia = f.created_at.slice(0, 10);
    const d = porDiaMap.get(dia) ?? { costoUsd: 0, tokens: 0 };
    d.costoUsd += costo; d.tokens += tokens;
    porDiaMap.set(dia, d);
  }
  const porFase = [...porFaseMap.entries()]
    .map(([fase, v]) => ({ fase, n: v.n, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
  const porModelo = [...porModeloMap.entries()]
    .map(([modelo, v]) => ({ modelo, n: v.n, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
  const porDia = [...porDiaMap.entries()]
    .map(([dia, v]) => ({ dia, costoUsd: round2(v.costoUsd), tokens: v.tokens }))
    .sort((a, b) => a.dia.localeCompare(b.dia));

  const viajesPorTenant = new Map<string, number>();
  for (const v of (viajesRes.data ?? []) as Array<{ tenant_id: string }>) {
    viajesPorTenant.set(v.tenant_id, (viajesPorTenant.get(v.tenant_id) ?? 0) + 1);
  }
  const flotasBase = (tenantsRes.data ?? []) as Array<{ id: string; nombre: string; plan: string }>;
  const flotas = flotasBase.map((t) => ({
    ...t,
    viajes: viajesPorTenant.get(t.id) ?? 0,
    costoIaUsd: round2(costoPorTenant.get(t.id) ?? 0),
  }));
  return {
    tenants: flotas.length,
    flotas,
    viajesProcesados: (viajesRes.data ?? []).length,
    costoIaUsd: round2(costoIaUsd),
    tokensIn,
    tokensOut,
    porFase,
    porModelo,
    porDia,
  };
}

export interface ConversacionActiva {
  telefono: string;
  tenantNombre: string;
  estado: Record<string, unknown>;
  actualizadaEn: string;
}

/**
 * `wa_conversacion.estado` es una MÁQUINA DE ESTADOS (jsonb: qué espera el
 * bot de este teléfono ahora mismo), NO un historial de mensajes — Likida no
 * guarda el texto de la conversación de WhatsApp. Por eso esto no es un
 * "inbox" con hilos que se puedan leer: es el estado operativo real de cada
 * conversación en curso, que es lo que SÍ existe.
 */
export async function getConversacionesActivas(): Promise<ConversacionActiva[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('wa_conversacion')
    .select('telefono, estado, updated_at, tenant:tenant_id(nombre)')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getConversacionesActivas: ${error.message}`);
  return (data ?? []).map((c) => ({
    telefono: c.telefono as string,
    tenantNombre: ((c.tenant as { nombre?: string } | null)?.nombre) ?? '—',
    estado: (c.estado as Record<string, unknown>) ?? {},
    actualizadaEn: c.updated_at as string,
  }));
}
