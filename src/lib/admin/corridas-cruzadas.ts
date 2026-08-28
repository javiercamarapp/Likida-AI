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
import { acotada } from '@/lib/likida/presupuesto';

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
  /**
   * El gasto MEDIDO de esta corrida (`agente_corrida.costo_usd`, 0123).
   *
   * `null` = «esta corrida no midió su gasto», JAMÁS $0 — es la misma regla
   * que `backoffice.ts:17` defiende en los partes, y aquí importa igual: un
   * agente al que se le pinta $0.00 se lee como un agente gratis, y el
   * siguiente que lo mire dejará de buscar dónde se va el dinero.
   */
  costoUsd: number | null;
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
    // `== null` cubre null y undefined de una vez; Number(null) sería 0 y eso
    // convertiría «no se midió» en «no gastó».
    costoUsd: f.costo_usd == null ? null : Number(f.costo_usd),
    duracionMs: fin === null ? null : new Date(fin).getTime() - new Date(inicio).getTime(),
  };
}

// `costo_usd` faltaba en este select desde que la 0123 lo añadió: la columna
// se escribía y ninguna pantalla la leía, así que la traza sustituía el gasto
// MEDIDO por una correlación temporal contra `llm_costo`. La correlación se
// queda (mide la flota entera en la ventana, que es otra pregunta útil), pero
// ya no es la única respuesta disponible.
const COLUMNAS = 'id, agente, tenant_id, inicio, fin, estado, disparo, tareas_hechas, tareas_total, resumen, error, costo_usd, tenant:tenant_id(nombre)';

/**
 * Las últimas `limite` corridas de TODOS los agentes y TODAS las flotas.
 * LANZA ante error de lectura: "sin corridas" sobre una base caída afirmaría
 * que los agentes no trabajan — lo que este historial existe para desmentir.
 */
export async function corridasRecientes(limite = 15): Promise<CorridaCruzada[]> {
  const { data, error } = await acotada(supabaseAdmin()
    .from('agente_corrida')
    .select(COLUMNAS)
    .order('inicio', { ascending: false })
    .limit(limite), 'corridasRecientes');
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
  const { data, error } = await acotada(admin
    .from('agente_corrida')
    .select(COLUMNAS)
    .eq('id', id)
    .maybeSingle(), 'trazaDeCorrida');
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

  // Se SUMA EN LA BASE (`resumen_costo_ia_tenant`, 0064, con la ventana):
  // antes esto paginaba `llm_costo` a JS con `traerTodo`, que LANZA a las
  // 100,000 filas — una corrida de cierre masivo de una flota de 50k
  // viajes/mes cruza eso en horas. La ventana es [inicio, fin): la RPC compara
  // `created_at < p_hasta`, el `.lte` anterior incluía el milisegundo exacto
  // de `fin` — una llamada al modelo con ese timestamp exacto es la única
  // diferencia posible, y es la convención de todas las RPC de costo.
  const { inicio, fin, tenantId } = corrida;
  const { data: agregado, error: eCosto } = await acotada(admin
    .rpc('resumen_costo_ia_tenant', { p_tenant: tenantId, p_desde: inicio, p_hasta: fin }), 'trazaDeCorrida.llm_costo');
  if (eCosto) throw new Error(`trazaDeCorrida.llm_costo: ${eCosto.message}`);
  const t = (agregado as { totales?: Partial<CostoVentana & { n: number }> } | null)?.totales;
  const esNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (!t || !esNum(t.n) || !esNum(t.tokensIn) || !esNum(t.tokensOut) || !esNum(t.costoUsd)) {
    // Fail-closed de FORMA: un `?? 0` aquí afirmaría "la corrida salió gratis".
    throw new Error('trazaDeCorrida.llm_costo: resumen_costo_ia_tenant devolvió otra forma (¿migración 0064 sin aplicar?)');
  }
  const costo: CostoVentana = { llamadas: t.n, tokensIn: t.tokensIn, tokensOut: t.tokensOut, costoUsd: t.costoUsd };
  return { corrida, costo, costoNoDisponible: null };
}
