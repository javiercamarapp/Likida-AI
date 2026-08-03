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
  /** Facturas (filas de `gasto` — cada una es un comprobante que pasó por
   *  OCR/CFDI) procesadas por día, ventana de `ventanaDias` (default 7) —
   *  siempre TODAS las fechas de la ventana, con `n: 0` en las que no hubo
   *  actividad, para que la gráfica de barras no comprima el periodo a un
   *  solo día real. */
  facturasPorDia: Array<{ dia: string; n: number }>;
  /** Total histórico de facturas (todas las filas de `gasto`, sin filtro
   *  de fecha) — para el contador retro junto al saludo. */
  facturasTotal: number;
  /** % de cambio de los últimos 7 días vs los 7 anteriores — `null` sin
   *  suficiente historia (menos de 14 días con datos) para no inventar una
   *  tendencia de dos puntos. */
  tendenciaCosto: number | null;
  tendenciaTokens: number | null;
}

/**
 * `hoy` es inyectable (default: fecha real) — mismo criterio que
 * `cuadrarViaje({ hoy })` en el motor: una prueba de tendencia no puede
 * depender del reloj del sistema el día que corra.
 *
 * `ventanaDias` (default 7) es lo que mueve el `<GlobalFilter>` de Inicio
 * (7d/30d) — solo afecta `facturasPorDia`; el resto de los números
 * (costoIaUsd, tendencias, etc.) son totales o comparativos de 7 días fijos
 * a propósito, no se re-derivan por ventana todavía.
 */
export async function getResumenNegocio(
  hoy: string = new Date().toISOString().slice(0, 10),
  ventanaDias: number = 7,
): Promise<ResumenNegocio> {
  const admin = supabaseAdmin();
  const [tenantsRes, viajesRes, costoRes, gastoRes] = await Promise.all([
    admin.from('tenant').select('id, nombre, plan'),
    admin.from('viaje').select('id, tenant_id'),
    admin.from('llm_costo').select('tenant_id, fase, modelo, tokens_in, tokens_out, costo_usd, created_at'),
    admin.from('gasto').select('created_at'),
  ]);
  // Los cuatro fallan POR VALOR (supabase-js), no lanzando: sin este chequeo
  // explícito, una base caída se lee "0 tenants, $0 gastados" — que es
  // indistinguible de que Likida de verdad no tiene nada, el mismo error que
  // ya se cerró para el panel de una flota (analytics.ts).
  if (tenantsRes.error) throw new Error(`getResumenNegocio/tenant: ${tenantsRes.error.message}`);
  if (viajesRes.error) throw new Error(`getResumenNegocio/viaje: ${viajesRes.error.message}`);
  if (costoRes.error) throw new Error(`getResumenNegocio/llm_costo: ${costoRes.error.message}`);
  if (gastoRes.error) throw new Error(`getResumenNegocio/gasto: ${gastoRes.error.message}`);

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

  // Tendencia real, no de adorno: si la ventana ANTERIOR está vacía (Likida
  // lleva menos de 7 días con actividad), "creció ∞%" no dice nada — se
  // calla en vez de inventar una flecha.
  const cortes = (diasAtras: number) => {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - diasAtras);
    return d.toISOString().slice(0, 10);
  };
  const [inicioActual, inicioAnterior] = [cortes(7), cortes(14)];
  const sumaEnVentana = (desde: string, hasta: string, campo: 'costoUsd' | 'tokens') =>
    porDia.filter((d) => d.dia >= desde && d.dia < hasta).reduce((s, d) => s + d[campo], 0);
  const tendencia = (campo: 'costoUsd' | 'tokens'): number | null => {
    const actual = sumaEnVentana(inicioActual, cortes(0), campo);
    const anterior = sumaEnVentana(inicioAnterior, inicioActual, campo);
    if (anterior === 0) return null;
    return round2(((actual - anterior) / anterior) * 100);
  };

  const viajesPorTenant = new Map<string, number>();
  for (const v of (viajesRes.data ?? []) as Array<{ tenant_id: string }>) {
    viajesPorTenant.set(v.tenant_id, (viajesPorTenant.get(v.tenant_id) ?? 0) + 1);
  }
  // Últimos 7 días, siempre las 7 fechas (0 donde no hubo facturas) — el
  // mismo criterio de `cortes()` de arriba, para que "hoy" sea inyectable
  // en las pruebas en vez de depender del reloj real.
  const facturasPorDiaMap = new Map<string, number>();
  for (const g of (gastoRes.data ?? []) as Array<{ created_at: string }>) {
    const dia = g.created_at.slice(0, 10);
    facturasPorDiaMap.set(dia, (facturasPorDiaMap.get(dia) ?? 0) + 1);
  }
  const facturasPorDia = Array.from({ length: ventanaDias }, (_, i) => {
    const dia = cortes(ventanaDias - 1 - i);
    return { dia, n: facturasPorDiaMap.get(dia) ?? 0 };
  });

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
    facturasPorDia,
    facturasTotal: (gastoRes.data ?? []).length,
    tendenciaCosto: tendencia('costoUsd'),
    tendenciaTokens: tendencia('tokens'),
  };
}

export interface CostoPorFaseModelo { fase: string; modelo: string; n: number; costoUsd: number }

/**
 * `llm_costo` agrupado por fase Y modelo A LA VEZ (no cada uno por separado
 * como en `getResumenNegocio`) — para Model Ops y Agente OCR, que necesitan
 * saber qué modelo corrió DENTRO de una fase específica (p. ej. "¿qué costó
 * OCR, desglosado por modelo?"), algo que `porFase`/`porModelo` no pueden
 * responder solos porque cada uno agrupa por un solo eje. Mismo dato real
 * de siempre, solo agrupado más fino — nada nuevo que instrumentar.
 */
export async function getCostoPorFaseModelo(): Promise<CostoPorFaseModelo[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.from('llm_costo').select('fase, modelo, costo_usd');
  if (error) throw new Error(`getCostoPorFaseModelo: ${error.message}`);
  const map = new Map<string, { fase: string; modelo: string; n: number; costoUsd: number }>();
  for (const f of (data ?? []) as Array<{ fase: string; modelo: string; costo_usd: number }>) {
    const key = `${f.fase}::${f.modelo}`;
    const cur = map.get(key) ?? { fase: f.fase, modelo: f.modelo, n: 0, costoUsd: 0 };
    cur.n += 1;
    cur.costoUsd += Number(f.costo_usd);
    map.set(key, cur);
  }
  return [...map.values()]
    .map((v) => ({ ...v, costoUsd: round2(v.costoUsd) }))
    .sort((a, b) => b.costoUsd - a.costoUsd);
}

export interface TurnoConversacion { role: 'user' | 'assistant'; content: string }

export interface ConversacionActiva {
  telefono: string;
  tenantNombre: string;
  turns: TurnoConversacion[];
  actualizadaEn: string;
}

/**
 * CORRECCIÓN (2-ago-2026, tras verla mal renderizada): `wa_conversacion.
 * estado` SÍ trae el historial de mensajes — `{ turns: ConvTurn[] }`, la
 * misma forma que `conv.ts` (`loadConversation`/`saveConversation`) lee y
 * escribe, acotada a `MAX_TURNS` recientes. El comentario anterior de esta
 * función decía que Likida "no guarda el texto de la conversación" — estaba
 * mal: sí lo guarda, solo que en una ventana rodante, no para siempre.
 */
export async function getConversacionesActivas(): Promise<ConversacionActiva[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('wa_conversacion')
    .select('telefono, estado, updated_at, tenant:tenant_id(nombre)')
    .order('updated_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`getConversacionesActivas: ${error.message}`);
  return (data ?? []).map((c) => {
    const estado = (c.estado as { turns?: TurnoConversacion[] }) ?? {};
    return {
      telefono: c.telefono as string,
      tenantNombre: ((c.tenant as { nombre?: string } | null)?.nombre) ?? '—',
      turns: Array.isArray(estado.turns) ? estado.turns : [],
      actualizadaEn: c.updated_at as string,
    };
  });
}

export interface MiembroEquipo {
  id: string;
  email: string;
  nombre: string | null;
  rol: string;
  tenantId: string | null;
  tenantNombre: string | null;
  operadorId: string | null;
}

/**
 * Roster real de `app_user` para la página Equipo/RBAC — mismo patrón de
 * error que el resto del archivo (falla por valor, se revisa `.error` a
 * mano). `tenant_id` es nullable (superadmin no pertenece a ninguna flota,
 * 0001_init.sql:21), así que el join a `tenant` viene NULL en esas filas —
 * no un error, un superadmin de verdad no tiene flota.
 */
export async function getEquipo(): Promise<MiembroEquipo[]> {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from('app_user')
    .select('id, tenant_id, rol, nombre, email, operador_id, tenant:tenant_id(nombre)')
    .order('rol', { ascending: true });
  if (error) throw new Error(`getEquipo: ${error.message}`);
  return (data ?? []).map((u) => ({
    id: u.id as string,
    email: u.email as string,
    nombre: (u.nombre as string | null) ?? null,
    rol: u.rol as string,
    tenantId: (u.tenant_id as string | null) ?? null,
    tenantNombre: ((u.tenant as { nombre?: string } | null)?.nombre) ?? null,
    operadorId: (u.operador_id as string | null) ?? null,
  }));
}
