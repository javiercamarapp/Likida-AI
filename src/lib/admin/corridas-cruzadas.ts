// ═══════════════════════════════════════════════════════════════════════════
// LAS CORRIDAS VISTAS DESDE ARRIBA — `agente_corrida` (0102) cruzada por
// TODOS los tenants, para /admin/observabilidad (la lista) y
// /admin/corridas/[id] (la traza de UNA corrida).
//
// La lectura POR FLOTA ya existe (`ultimasCorridas` en agentes/corridas.ts,
// la ficha del cliente); esto es el otro ángulo: el superadmin mirando todas.
// Vive en lib/admin por la misma regla que soporte.ts — el permiso de cruzar
// tenants no se mezcla con lecturas tenant-scoped.
//
// ── EL COSTO DE IA ES CORRELACIÓN POR TIEMPO, NO UN JOIN ───────────────────
//
// `llm_costo` NO tiene `corrida_id` (0003: tenant, viaje, modelo, tokens,
// costo, created_at) y no se le inventa: lo que se puede afirmar con lo que
// existe es "las llamadas de ESTA flota DENTRO de la ventana [inicio, fin]
// de esta corrida". Si otro proceso de la misma flota gastó IA en ese lapso
// (un mensaje de WhatsApp entrando a media corrida), su costo cae en la
// ventana — por eso la pantalla lo rotula "en la ventana de la corrida" y
// nunca "de esta corrida". Un join exacto necesitaría la columna que no
// existe; la cifra honesta es esta, con su supuesto a la vista.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { conteo, traerTodo } from '@/lib/likida/pg';

export interface CorridaCruzada {
  id: string;
  agente: string;
  /** `null` = corrida del negocio (hoy solo `ventas`, 0105), sin flota. */
  tenantId: string | null;
  tenantNombre: string | null;
  inicio: string;
  fin: string | null;
  estado: string;
  disparo: string;
  tareasHechas: number | null;
  tareasTotal: number | null;
  resumen: Record<string, unknown> | null;
  error: string | null;
  /** `null` sin fin: una corrida sin cerrar no tiene duración que afirmar. */
  duracionMs: number | null;
}

function desdeFila(f: Record<string, unknown>): CorridaCruzada {
  const inicio = String(f.inicio);
  const fin = f.fin === null || f.fin === undefined ? null : String(f.fin);
  return {
    id: String(f.id),
    agente: String(f.agente),
    tenantId: (f.tenant_id as string | null) ?? null,
    tenantNombre: ((f.tenant as { nombre?: string } | null)?.nombre) ?? null,
    inicio,
    fin,
    estado: String(f.estado),
    disparo: String(f.disparo),
    tareasHechas: f.tareas_hechas == null ? null : Number(f.tareas_hechas),
    tareasTotal: f.tareas_total == null ? null : Number(f.tareas_total),
    resumen: (f.resumen as Record<string, unknown> | null) ?? null,
    error: (f.error as string | null) ?? null,
    duracionMs: fin === null ? null : new Date(fin).getTime() - new Date(inicio).getTime(),
  };
}

const COLUMNAS = 'id, agente, tenant_id, inicio, fin, estado, disparo, tareas_hechas, tareas_total, resumen, error, tenant:tenant_id(nombre)';

/**
 * Las últimas `limite` corridas de TODOS los agentes y TODAS las flotas.
 * LANZA ante error de lectura: "sin corridas" sobre una base caída afirmaría
 * que los agentes no trabajan — lo que este historial existe para desmentir.
 */
export async function corridasRecientes(limite = 15): Promise<CorridaCruzada[]> {
  const { data, error } = await supabaseAdmin()
    .from('agente_corrida')
    .select(COLUMNAS)
    .order('inicio', { ascending: false })
    .limit(limite);
  if (error) throw new Error(`corridasRecientes: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(desdeFila);
}

export interface CostoVentana {
  llamadas: number;
  tokensIn: number;
  tokensOut: number;
  costoUsd: number;
}

export interface TrazaCorrida {
  corrida: CorridaCruzada;
  /** El costo de IA de la flota EN LA VENTANA de la corrida — correlación por
   *  tiempo, no un join (ver la cabecera). `null` cuando no se puede
   *  correlacionar, con el porqué en `costoNoDisponible`. */
  costo: CostoVentana | null;
  costoNoDisponible: string | null;
}

/** Una corrida por id, con su costo de ventana. `null` = no existe. */
export async function trazaDeCorrida(id: string): Promise<TrazaCorrida | null> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('agente_corrida')
    .select(COLUMNAS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`trazaDeCorrida: ${error.message}`);
  if (!data) return null;

  const corrida = desdeFila(data as Record<string, unknown>);

  // Los dos casos donde la correlación no puede afirmarse — se DICE cuál:
  if (corrida.tenantId === null) {
    return {
      corrida, costo: null,
      costoNoDisponible: 'Corrida del negocio (sin flota): llm_costo se atribuye por flota y aquí no hay una a la cual acotar la ventana.',
    };
  }
  if (corrida.fin === null) {
    return {
      corrida, costo: null,
      costoNoDisponible: 'La corrida no tiene fin registrado: sin ventana cerrada, cualquier suma incluiría gasto posterior que no le toca.',
    };
  }

  // `traerTodo` y no un .limit: una corrida larga de una flota activa puede
  // cruzar más de 1,000 llamadas al modelo, y PostgREST recorta en silencio
  // (el porqué vive en pg.ts) — una suma recortada sería una cifra inventada.
  const { inicio, fin, tenantId } = corrida;
  const filas = await traerTodo<Record<string, unknown>>(
    (d, h) => admin.from('llm_costo')
      .select('tokens_in, tokens_out, costo_usd', conteo(d))
      .eq('tenant_id', tenantId)
      .gte('created_at', inicio)
      .lte('created_at', fin)
      .order('created_at', { ascending: true })
      .range(d, h),
    'trazaDeCorrida.llm_costo',
  );

  const costo: CostoVentana = { llamadas: filas.length, tokensIn: 0, tokensOut: 0, costoUsd: 0 };
  for (const f of filas) {
    costo.tokensIn += Number(f.tokens_in ?? 0);
    costo.tokensOut += Number(f.tokens_out ?? 0);
    costo.costoUsd += Number(f.costo_usd ?? 0);
  }
  return { corrida, costo, costoNoDisponible: null };
}
