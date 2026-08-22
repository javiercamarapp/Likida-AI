// ═══════════════════════════════════════════════════════════════════════════
// ANALÍTICA del dashboard — valor que Likida otorga con la data capturada.
// KPIs, rendimiento por operador/ruta, tendencia de diferencias, y DETECCIÓN
// DE ANOMALÍAS/FRAUDE (mismo CFDI usado en dos viajes, folios duplicados).
// ═══════════════════════════════════════════════════════════════════════════

import { detectarDuplicadosEntreViajes, type Anomalia } from './duplicados';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cuadrarDesdeDB } from './cuadre/desde_db';
// La agregación de `llm_costo` de una flota vive en el módulo que ESCRIBE esa
// tabla (`costos.ts`), y se importa en vez de reescribirse: `getResumenCosto` y
// `getValorAhorro` necesitan la misma consulta con distinto recorte, y dos
// copias son dos oportunidades de que una se quede atrás.
import { traerResumenCostoIaTenant } from './costos';
import { filasImprimibles } from './liquidacion/omitidos';
import { round2, TZ_MX } from '@/lib/formato';
import { logger } from '@/lib/logger';

// Los dos bordes de PostgREST (error por valor, y el recorte silencioso a
// 1,000 filas) viven en `pg.ts` desde que `operacion.ts` los necesitó también.
// La explicación larga de POR QUÉ existen está allá, junto al código.
import { exigir, traerTodo, traerPorIds, conteo } from './pg';

export interface DashboardKpis {
  viajesLiquidados: number;
  montoComprobado: number;
  diferenciaDetectada: number;   // total de dinero recuperado/observado
  conDiferencias: number;
  porRevisar: number;
  tasaCuadre: number;            // % de liquidaciones sin diferencias
}

/**
 * Corte inferior de una ventana de N días, en ISO — o `null` para "todo el
 * histórico". Vive aquí, en un solo lugar, porque el panel enseñaba
 * "ESTÍMULOS ACREDITABLES DEL PERIODO" y "LIQUIDACIONES DEL PERIODO" sobre
 * consultas que NO filtraban por fecha: los rótulos decían periodo y las
 * cifras eran de siempre. El filtro 7d/30d/Todo de la pantalla, además, solo
 * movía la gráfica de barras — un control de fecha que no cambia los números
 * de abajo enseña a desconfiar del control.
 */
function corteVentana(ventanaDias?: number, hoy: string = new Date().toISOString().slice(0, 10)): string | null {
  if (!ventanaDias) return null;
  const d = new Date(`${hoy}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (ventanaDias - 1));
  return d.toISOString();
}

export interface ComparativoPeriodo {
  /** Límites del periodo, MX (`America/Mexico_City`) — AAAA-MM-DD, ambos
   *  incluidos. Vienen en el resultado (no solo el índice de la serie) para
   *  que la tarjeta pueda enseñar QUÉ fechas está mostrando, no solo "hace
   *  N periodos". */
  desde: string;
  hasta: string;
  gastoTotal: number;
  totalViajes: number;
  /** `null` sin viajes en el periodo — dividir entre cero daría Infinity, y
   *  "$0/viaje" se leería como que salió gratis, no como que no hay con qué
   *  medir. */
  costoPorViaje: number | null;
  liquidado: number;
  /** De `totalViajes`, cuántos ya están `estatus = 'liquidado'` — para la
   *  dona "Viajes" del Resumen (liquidados vs pendientes DEL periodo, no
   *  del histórico completo de la flota). */
  viajesLiquidados: number;
}

/**
 * Serie de `pasos` periodos consecutivos de `ventanaDias` días cada uno,
 * SIN traslape, terminando en `hoy` — índice 0 es el más reciente (el que
 * ya se enseñaba como "actual"), índice `pasos-1` el más viejo. Reemplaza a
 * `getTendenciaKpis`/`comparativoEnRango` (un solo par actual/anterior):
 * las flechas ‹ › de cada tarjeta de KPI (dirección del 8-ago-2026, una por
 * tarjeta, independientes entre sí) necesitan poder seguir retrocediendo
 * más de un periodo, no solo comparar contra el inmediato anterior.
 *
 * ── AGREGADO EN SQL DESDE EL 15-AGO-2026 (mig. 0112) ────────────────────────
 *
 * La versión anterior traía el rango completo (`desdeGlobal` a `hoy`) de
 * `gasto`, `viaje` y `liquidacion` con `traerTodo` y bucketeaba en memoria —
 * UNA consulta por tabla, no `pasos` consultas, que ya era el criterio
 * correcto para no repetir la misma ventana tres veces. Pero la vista
 * "histórico" de `getSeriesKpiCards` (ventana ~10 años) lee prácticamente la
 * tabla `gasto` ENTERA del tenant, y con 45,000 gastos/mes eso toca el techo
 * de `traerTodo` (100 páginas) ~mes 2.2 (docs/escala-15k.md §6) — la MISMA
 * fecha de caducidad que `getGastosFiscales`, y esta función corre en CADA
 * carga del Resumen (tres veces: semanal/mensual/histórico).
 *
 * `serie_comparativa_tenant` (0112) recibe los mismos `ventanaDias`/`pasos`/
 * `hoy` y hace la MISMA cuenta de límites de periodo, pero el `sum()`/
 * `count()` corre en SQL: UN viaje de red para las tres tablas juntas, sin
 * techo de páginas. `gasto.fecha`/`viaje.fecha_inicio` siguen siendo
 * columnas `date` (comparación directa, usa los índices de la 0111);
 * `liquidacion.created_at` sigue bucketeándose por el día LOCAL de México
 * dentro de la función SQL — el mismo criterio que `diaLocalMx` evitaba el
 * bug de cierres de tarde cayendo en el día siguiente. La prueba de
 * equivalencia (`analytics_serie_comparativa.test.ts`) compara el bucketeo JS
 * viejo contra la forma nueva sobre el mismo dataset sintético.
 */
export async function getSerieComparativa(
  tenantId: string,
  ventanaDias: number,
  pasos: number,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<ComparativoPeriodo[]> {
  const { data, error } = await supabaseAdmin().rpc('serie_comparativa_tenant', {
    p_tenant: tenantId,
    p_ventana_dias: ventanaDias,
    p_pasos: pasos,
    p_hoy: hoy,
  });
  if (error) throw new Error(`getSerieComparativa: ${error.message}`);

  // Fail-closed: una forma inesperada (¿migración 0112 sin aplicar?) no se
  // lee como "cero periodos" — un Resumen con las tarjetas de KPI en $0 se ve
  // exactamente como una flota sin actividad.
  if (!Array.isArray(data) || data.length !== pasos) {
    throw new Error(
      `getSerieComparativa: serie_comparativa_tenant devolvió otra forma (¿migración 0112 sin aplicar?): `
      + `esperaba ${pasos} periodo(s), llegaron ${Array.isArray(data) ? data.length : typeof data}`,
    );
  }
  return (data as Array<Record<string, unknown>>).map((p) => ({
    desde: p.desde as string,
    hasta: p.hasta as string,
    gastoTotal: Number(p.gastoTotal ?? 0),
    totalViajes: Number(p.totalViajes ?? 0),
    costoPorViaje: p.costoPorViaje === null || p.costoPorViaje === undefined ? null : Number(p.costoPorViaje),
    liquidado: Number(p.liquidado ?? 0),
    viajesLiquidados: Number(p.viajesLiquidados ?? 0),
  }));
}

export interface SeriesKpiCards {
  /** [actual, anterior] — 7 días vs los 7 previos. */
  semanal: ComparativoPeriodo[];
  /** [actual, anterior] — 30 días vs los 30 previos. */
  mensual: ComparativoPeriodo[];
  /** [total] — un solo bucket, TODO el histórico. Sin "anterior": no hay
   *  tendencia que enseñar contra un periodo que no existe. */
  historico: ComparativoPeriodo[];
}

/**
 * Las 3 vistas que cada tarjeta de KPI cicla con sus flechas ‹ › (dirección
 * del 8-ago-2026: reemplaza al filtro único 7d/30d/Todo que vivía arriba de
 * las 4 tarjetas — ahora cada una cambia de granularidad por su cuenta).
 * `histórico` reusa el mismo truco que ya usaba `getTendenciaKpis`: una
 * ventana de ~10 años (de sobra para una flota que arrancó en 2026) hace de
 * "todo el histórico" sin necesitar una consulta sin cota.
 */
export async function getSeriesKpiCards(
  tenantId: string,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<SeriesKpiCards> {
  const [semanal, mensual, historico] = await Promise.all([
    getSerieComparativa(tenantId, 7, 2, hoy),
    getSerieComparativa(tenantId, 30, 2, hoy),
    getSerieComparativa(tenantId, 3650, 1, hoy),
  ]);
  return { semanal, mensual, historico };
}

/**
 * AGREGADO EN SQL DESDE EL 15-AGO-2026 (mig. 0112).
 *
 * Traía TODA `liquidacion` del tenant con `traerTodo` para contar por estatus
 * y sumar el dinero observado de `diferencias` (jsonb) en JavaScript — se lee
 * en CADA carga de /dashboard y /dashboard/contador, y caduca ~mes 8.3 con
 * 15,000 viajes/mes (docs/escala-15k.md §6). `kpis_liquidacion_tenant` hace
 * el MISMO conteo/suma en SQL: UN viaje de red, sin techo de páginas. La
 * prueba de equivalencia (`analytics_kpis_acreditables.test.ts`) compara la
 * reducción JS vieja contra la forma nueva sobre el mismo dataset sintético.
 */
export async function getKpis(tenantId: string, ventanaDias?: number): Promise<DashboardKpis> {
  const corte = corteVentana(ventanaDias);
  const { data, error } = await supabaseAdmin()
    .rpc('kpis_liquidacion_tenant', { p_tenant: tenantId, p_desde: corte });
  if (error) throw new Error(`getKpis: ${error.message}`);

  const r = data as Partial<{
    viajesLiquidados: unknown; montoComprobado: unknown; diferenciaDetectada: unknown;
    conDiferencias: unknown; porRevisar: unknown; tasaCuadre: unknown;
  }> | null;
  const campos = [r?.viajesLiquidados, r?.montoComprobado, r?.diferenciaDetectada, r?.conDiferencias, r?.porRevisar, r?.tasaCuadre];
  // Fail-closed: un `0` inventado sobre una forma inesperada se ve exactamente
  // igual que una flota que de verdad no ha liquidado nada.
  if (!r || campos.some((c) => typeof c !== 'number')) {
    throw new Error('getKpis: kpis_liquidacion_tenant devolvió otra forma (¿migración 0112 sin aplicar?)');
  }
  return {
    viajesLiquidados: r.viajesLiquidados as number,
    montoComprobado: round2(r.montoComprobado as number),
    diferenciaDetectada: round2(r.diferenciaDetectada as number),
    conDiferencias: r.conDiferencias as number,
    porRevisar: r.porRevisar as number,
    tasaCuadre: r.tasaCuadre as number,
  };
}

export interface OperadorStat {
  operadorId: string;
  nombre: string;
  viajes: number;
  dieselTotal: number;
  diferencias: number;
}

// ── La página del Agente de Liquidación (v2, 13-ago-2026) ──────────────────

export interface HechoSolo {
  tipo: 'recordatorio' | 'escalado';
  folio: string;
  operador: string | null;
  /** Timestamp ISO del sello (recordatorio_comprobacion_en / escalado_en). */
  cuando: string;
}

/**
 * Lo que el agente hizo SOLO, sin que nadie se lo pidiera: recordatorios de
 * comprobación que mandó (0087) y viajes que escaló (0058). Es el feed que
 * convierte "un software" en "un agente que trabaja de noche" — y cada
 * renglón sale de un sello real en `viaje`, no de un log decorativo.
 */
export async function getHechosSolos(tenantId: string, limite = 8): Promise<HechoSolo[]> {
  const { data, error } = await supabaseAdmin()
    .from('viaje')
    .select('folio, escalado_en, recordatorio_comprobacion_en, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId)
    .or('escalado_en.not.is.null,recordatorio_comprobacion_en.not.is.null')
    .order('id', { ascending: false })
    .limit(60);
  if (error) throw new Error(`getHechosSolos: ${error.message}`);
  const hechos: HechoSolo[] = [];
  for (const v of data ?? []) {
    const operador = ((v.operador as { nombre?: string } | null)?.nombre) ?? null;
    const folio = (v.folio as string) ?? '—';
    if (v.recordatorio_comprobacion_en) {
      hechos.push({ tipo: 'recordatorio', folio, operador, cuando: v.recordatorio_comprobacion_en as string });
    }
    if (v.escalado_en) {
      hechos.push({ tipo: 'escalado', folio, operador, cuando: v.escalado_en as string });
    }
  }
  // Los 60 viajes más recientes pueden traer hasta 120 hechos: se ordenan por
  // fecha del sello y se recortan — el feed enseña lo último, no un archivo.
  return hechos.sort((a, b) => b.cuando.localeCompare(a.cuando)).slice(0, limite);
}

export interface DineroObservadoTipo { tipo: string; monto: number; n: number }

/**
 * El dinero observado, DESGLOSADO por tipo de diferencia (sobre política,
 * duplicado, …). `getKpis` suma el total; esta lo abre para la dona del
 * agente — misma fuente (`liquidacion.diferencias`), mismo valor absoluto.
 */
export async function getDineroObservadoPorTipo(tenantId: string): Promise<DineroObservadoTipo[]> {
  const rows = await traerTodo<{ diferencias: unknown }>(
    (desde, hasta) => supabaseAdmin()
      .from('liquidacion')
      .select('diferencias')
      .eq('tenant_id', tenantId)
      .order('id')
      .range(desde, hasta),
    'getDineroObservadoPorTipo',
  );
  const acumulado = new Map<string, { monto: number; n: number }>();
  for (const r of rows) {
    for (const d of ((r.diferencias as Array<{ tipo?: unknown; monto?: unknown }>) ?? [])) {
      const tipo = typeof d.tipo === 'string' ? d.tipo : 'otro';
      const prev = acumulado.get(tipo) ?? { monto: 0, n: 0 };
      prev.monto += Math.abs(Number(d.monto ?? 0));
      prev.n += 1;
      acumulado.set(tipo, prev);
    }
  }
  return [...acumulado.entries()]
    .map(([tipo, v]) => ({ tipo, monto: v.monto, n: v.n }))
    .sort((a, b) => b.monto - a.monto);
}

/** Rendimiento por operador (diésel total, # de diferencias) — señal operativa. */
export async function getStatsPorOperador(tenantId: string): Promise<OperadorStat[]> {
  const admin = supabaseAdmin();
  const [ops, gastos, viajes, liqs] = await Promise.all([
    traerTodo<{ id: unknown; nombre: unknown }>(
      (desde, hasta) => admin.from('operador').select('id, nombre').eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getStatsPorOperador.operador',
    ),
    traerTodo<{ viaje_id: unknown; concepto: unknown; monto: unknown }>(
      (desde, hasta) => admin.from('gasto').select('viaje_id, concepto, monto').eq('tenant_id', tenantId).eq('concepto', 'diesel').order('id').range(desde, hasta),
      'getStatsPorOperador.gasto',
    ),
    traerTodo<{ id: unknown; operador_id: unknown }>(
      (desde, hasta) => admin.from('viaje').select('id, operador_id').eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getStatsPorOperador.viaje',
    ),
    // AUDITORÍA 3, ARQ-C1 (CRÍTICO, reincidente de la ola 2): `diferencias`
    // salía HARDCODEADA en 0 y la ventana del Agente de Liquidación pintaba
    // "Ningún operador acumula diferencias — la señal que quieres ver" como
    // si fuera medición. Ahora se cuenta de verdad: liquidaciones con
    // diferencia ≠ 0, cruzadas a su operador.
    traerTodo<{ viaje_id: unknown; diferencia: unknown }>(
      (desde, hasta) => admin.from('liquidacion').select('viaje_id, diferencia').eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getStatsPorOperador.liquidacion',
    ),
  ]);
  const viajeToOp = new Map(viajes.map((v) => [v.id as string, v.operador_id as string]));
  const dieselPorOp = new Map<string, number>();
  const viajesPorOp = new Map<string, Set<string>>();
  for (const gr of gastos) {
    const op = viajeToOp.get(gr.viaje_id as string);
    if (!op) continue;
    dieselPorOp.set(op, (dieselPorOp.get(op) ?? 0) + Number(gr.monto));
    if (!viajesPorOp.has(op)) viajesPorOp.set(op, new Set());
    viajesPorOp.get(op)!.add(gr.viaje_id as string);
  }
  const diferenciasPorOp = new Map<string, number>();
  for (const l of liqs) {
    const op = viajeToOp.get(l.viaje_id as string);
    if (!op) continue;
    // Centavos de redondeo no son una diferencia que amerite conversación.
    if (Math.abs(Number(l.diferencia ?? 0)) < 0.01) continue;
    diferenciasPorOp.set(op, (diferenciasPorOp.get(op) ?? 0) + 1);
  }
  return ops.map((o) => ({
    operadorId: o.id as string,
    nombre: o.nombre as string,
    viajes: viajesPorOp.get(o.id as string)?.size ?? 0,
    dieselTotal: round2(dieselPorOp.get(o.id as string) ?? 0),
    diferencias: diferenciasPorOp.get(o.id as string) ?? 0,
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
  // Un "0 anomalías" por fallo de lectura O por recorte silencioso de
  // PostgREST se lee como "revisamos y todo está limpio", que es la
  // afirmación más cara que puede hacer este producto.
  const data = await traerTodo<{ viaje_id: unknown; concepto: unknown; monto: unknown; folio: unknown; cfdi_uuid: unknown }>(
    (desde, hasta) => supabaseAdmin()
      .from('gasto')
      .select('viaje_id, concepto, monto, folio, cfdi_uuid')
      .eq('tenant_id', tenantId)
      .order('id')
      .range(desde, hasta),
    'detectarAnomalias',
  );
  return detectarDuplicadosEntreViajes(
    data.map((r) => ({
      viajeId: r.viaje_id as string,
      concepto: (r.concepto as string) ?? 'otro',
      monto: Number(r.monto),
      folio: (r.folio as string) || undefined,
      cfdiUuid: (r.cfdi_uuid as string) || undefined,
    })),
  );
}

/**
 * Liquidaciones cerradas por día, ventana de `ventanaDias` (7/30, mismo
 * `GlobalFilter` de admin/page.tsx) — SIEMPRE las `ventanaDias` fechas, con
 * `n: 0` donde no hubo cierre, para que `BarChartSimple` no comprima el
 * periodo a un solo día real. Mismo patrón que `facturasPorDia` en
 * `lib/admin/negocio.ts`; `hoy` inyectable por la misma razón que ahí
 * (una prueba de ventana no puede depender del reloj real).
 */
export async function getLiquidacionesPorDia(
  tenantId: string,
  ventanaDias: number = 7,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<Array<{ dia: string; valor: number }>> {
  // Cota inferior GENEROSA (auditoría de escala 15k): esto traía TODO el
  // histórico de `liquidacion` para bucketear una ventana de 7/30 días — con
  // ~12,000 cierres/mes, la gráfica del día pagaba leer años enteros. La cota
  // es la medianoche UTC del día MX más viejo de la ventana: MX va DETRÁS de
  // UTC, así que el día local empieza DESPUÉS de esa medianoche y la cota solo
  // puede sobrar hacia el pasado — mismo criterio que la de
  // `getSerieComparativa.liquidacion` de arriba. El bucket de abajo sigue
  // filtrando por día LOCAL: filas de sobra se descartan, nunca faltan.
  const corteViejo = new Date(`${hoy}T00:00:00Z`);
  corteViejo.setUTCDate(corteViejo.getUTCDate() - (ventanaDias - 1));
  const rows = await traerTodo<{ created_at: unknown }>(
    (desde, hasta) => supabaseAdmin()
      .from('liquidacion')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .gte('created_at', `${corteViejo.toISOString().slice(0, 10)}T00:00:00Z`)
      .order('id')
      .range(desde, hasta),
    'getLiquidacionesPorDia',
  );
  // AUDITORÍA 12, ALTO (pruebas): `.slice(0,10)` sobre el timestamptz que
  // PostgREST devuelve en UTC fechaba en el día SIGUIENTE los cierres de la
  // tarde — una liquidación cerrada el 31-jul a las 20:00 CDMX se guarda como
  // 2026-08-01T02:00Z y caía en la barra del 1-ago. La gráfica del demo (paso
  // 4 del guion) movía los cierres de 18:00-23:59 hora local a otro día. El
  // mismo `.slice` ya se arregló en el detalle (creadoEn viaja crudo y se
  // formatea en pantalla); aquí el bucket se hace con la zona horaria real.
  const diaLocal = (iso: string): string =>
    new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ_MX });
  const porDiaMap = new Map<string, number>();
  for (const r of rows) {
    const dia = diaLocal(r.created_at as string);
    porDiaMap.set(dia, (porDiaMap.get(dia) ?? 0) + 1);
  }
  const cortes = (diasAtras: number) => {
    const d = new Date(`${hoy}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - diasAtras);
    return d.toISOString().slice(0, 10);
  };
  return Array.from({ length: ventanaDias }, (_, i) => {
    const dia = cortes(ventanaDias - 1 - i);
    return { dia, valor: porDiaMap.get(dia) ?? 0 };
  });
}

/** Lunes-a-domingo ISO de una fecha simple (columna `date`, sin hora) →
 *  "Sem NN" para el eje X — el algoritmo estándar: el jueves de la semana
 *  decide a qué año pertenece (evita que la semana 1 de enero se lea como
 *  la última del año anterior en fechas de fin de diciembre). */
function semanaIso(fechaIso: string): { anio: number; semana: number } {
  const d = new Date(`${fechaIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const inicioAnio = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioAnio.getTime()) / 86_400_000 + 1) / 7);
  return { anio: d.getUTCFullYear(), semana };
}

/** Últimas `semanas` semanas ISO completas (lunes-domingo), terminando en la
 *  semana de `hoy` — mismas etiquetas para cualquier serie semanal de esta
 *  página (`getGastoPorSemana`/`getLiquidadoPorSemana`), para que dos
 *  gráficas contiguas hablen del mismo eje X. */
function ultimasSemanas(semanas: number, hoy: string): Array<{ anio: number; semana: number; etiqueta: string }> {
  const out: Array<{ anio: number; semana: number; etiqueta: string }> = [];
  const cursor = new Date(`${hoy}T00:00:00Z`);
  for (let i = semanas - 1; i >= 0; i--) {
    const d = new Date(cursor);
    d.setUTCDate(d.getUTCDate() - i * 7);
    const { anio, semana } = semanaIso(d.toISOString().slice(0, 10));
    out.push({ anio, semana, etiqueta: `${anio}-S${String(semana).padStart(2, '0')}` });
  }
  return out;
}

export interface GastoSemanalPorCategoria {
  categorias: string[];
  series: Array<{ nombre: string; valores: number[] }>;
}

/**
 * Gasto de las últimas `semanas` semanas ISO, agrupado por concepto — hasta
 * las 3 categorías con MÁS gasto total en la ventana, no fijas a mano: el
 * dominio real de `gasto.concepto` incluye 'viaticos' (heredado, el OCR ya
 * no lo emite — mig. 0025) junto a 'diesel'/'caseta'/etc., así que fijar 3
 * categorías de antemano podría enseñar una en ceros mientras una real con
 * gasto de verdad se queda fuera. Reusa `StackedBars` (`admin/ui/graficas`),
 * no un componente nuevo — mismo lenguaje monocromo por opacidad del resto
 * del producto.
 */
export async function getGastoPorSemana(
  tenantId: string,
  semanas: number = 5,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<GastoSemanalPorCategoria> {
  const bloques = ultimasSemanas(semanas, hoy);
  const desdeGlobal = new Date(`${hoy}T00:00:00Z`);
  desdeGlobal.setUTCDate(desdeGlobal.getUTCDate() - (semanas * 7 - 1));

  const filas = await traerTodo<{ fecha: unknown; concepto: unknown; monto: unknown }>(
    (desde, hasta) => supabaseAdmin().from('gasto').select('fecha, concepto, monto')
      .eq('tenant_id', tenantId).gte('fecha', desdeGlobal.toISOString().slice(0, 10)).lte('fecha', hoy)
      .order('id').range(desde, hasta),
    'getGastoPorSemana',
  );

  const totalPorConcepto = new Map<string, number>();
  const porSemanaConcepto = new Map<string, number>(); // clave: `${anio}-${semana}-${concepto}`
  for (const f of filas) {
    const { anio, semana } = semanaIso(f.fecha as string);
    const concepto = (f.concepto as string) ?? 'otro';
    const monto = Number(f.monto ?? 0);
    totalPorConcepto.set(concepto, (totalPorConcepto.get(concepto) ?? 0) + monto);
    const k = `${anio}-${semana}-${concepto}`;
    porSemanaConcepto.set(k, (porSemanaConcepto.get(k) ?? 0) + monto);
  }

  const top3 = [...totalPorConcepto.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c);

  return {
    categorias: bloques.map((b) => b.etiqueta),
    series: top3.map((concepto) => ({
      nombre: concepto,
      valores: bloques.map((b) => round2(porSemanaConcepto.get(`${b.anio}-${b.semana}-${concepto}`) ?? 0)),
    })),
  };
}

/** Cuántas semanas hacia atrás enseña cada vista — mismo mapeo en las 3
 *  funciones `*Series` de esta página (Actividad, Gasto por categoría,
 *  Liquidado, Top rutas): 5 semanas para "semanal" (el detalle de siempre),
 *  ~3 meses para "mensual", ~1 año para "histórico" — más ancho de vista
 *  según se aleja el zoom, sin ser una consulta sin cota. */
const SEMANAS_POR_MODO = { semanal: 5, mensual: 13, historico: 52 } as const;
export type ModoPeriodo = keyof typeof SEMANAS_POR_MODO;

export interface GastoSemanalSeries {
  semanal: GastoSemanalPorCategoria; mensual: GastoSemanalPorCategoria; historico: GastoSemanalPorCategoria;
}

/** Las 3 vistas de "Gasto por categoría" para el selector Semanal/Mensual/
 *  Histórico compartido del Resumen (8-ago-2026) — antes esta gráfica
 *  vivía fija a 5 semanas, con su propio rótulo ("últimas 5 semanas"); el
 *  selector único de la página ahora la mueve igual que a Actividad. */
export async function getGastoPorSemanaSeries(
  tenantId: string,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<GastoSemanalSeries> {
  const [semanal, mensual, historico] = await Promise.all([
    getGastoPorSemana(tenantId, SEMANAS_POR_MODO.semanal, hoy),
    getGastoPorSemana(tenantId, SEMANAS_POR_MODO.mensual, hoy),
    getGastoPorSemana(tenantId, SEMANAS_POR_MODO.historico, hoy),
  ]);
  return { semanal, mensual, historico };
}

/**
 * Total LIQUIDADO (pesos, `total_comprobado`) de las últimas `semanas`
 * semanas ISO — a diferencia de `getLiquidacionesPorDia` (que cuenta
 * cierres, no pesos, para /dashboard/analitica), esto suma dinero: la
 * gráfica "Liquidado por semana" del Resumen enseña cuánto se pagó, no
 * cuántas liquidaciones se cerraron. `created_at` es timestamptz — bucket
 * por DÍA LOCAL (mismo patrón que `getSerieComparativa`), no por el UTC
 * crudo, para no repetir el bug ya pagado de cierres de tarde cayendo en el
 * día siguiente.
 */
export async function getLiquidadoPorSemana(
  tenantId: string,
  semanas: number = 5,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<Array<{ dia: string; valor: number }>> {
  const bloques = ultimasSemanas(semanas, hoy);
  const desdeGlobal = new Date(`${hoy}T00:00:00Z`);
  desdeGlobal.setUTCDate(desdeGlobal.getUTCDate() - (semanas * 7 - 1));

  const filas = await traerTodo<{ created_at: unknown; total_comprobado: unknown }>(
    (desde, hasta) => supabaseAdmin().from('liquidacion').select('created_at, total_comprobado')
      .eq('tenant_id', tenantId).gte('created_at', `${desdeGlobal.toISOString().slice(0, 10)}T00:00:00Z`)
      .order('id').range(desde, hasta),
    'getLiquidadoPorSemana',
  );

  const diaLocalMx = (iso: string): string => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ_MX });
  const porSemana = new Map<string, number>();
  for (const f of filas) {
    const { anio, semana } = semanaIso(diaLocalMx(f.created_at as string));
    const k = `${anio}-${semana}`;
    porSemana.set(k, (porSemana.get(k) ?? 0) + Number(f.total_comprobado ?? 0));
  }

  return bloques.map((b) => ({ dia: b.etiqueta, valor: round2(porSemana.get(`${b.anio}-${b.semana}`) ?? 0) }));
}

export interface LiquidadoSemanalSeries {
  semanal: Array<{ dia: string; valor: number }>;
  mensual: Array<{ dia: string; valor: number }>;
  historico: Array<{ dia: string; valor: number }>;
}

/** Las 3 vistas de "Liquidado por semana" — mismo criterio y mismo mapeo
 *  de semanas que `getGastoPorSemanaSeries` (`SEMANAS_POR_MODO`). */
export async function getLiquidadoPorSemanaSeries(
  tenantId: string,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<LiquidadoSemanalSeries> {
  const [semanal, mensual, historico] = await Promise.all([
    getLiquidadoPorSemana(tenantId, SEMANAS_POR_MODO.semanal, hoy),
    getLiquidadoPorSemana(tenantId, SEMANAS_POR_MODO.mensual, hoy),
    getLiquidadoPorSemana(tenantId, SEMANAS_POR_MODO.historico, hoy),
  ]);
  return { semanal, mensual, historico };
}

/** Viajes iniciados por MES, histórico completo — a diferencia de `viajes`
 *  (que ya carga la página para `AvanceCierre`/`ViajesAtencion`), ese
 *  arreglo viene topado a 100 filas más recientes por diseño: de sobra para
 *  una ventana de 7/30 días, corto para "todo el histórico" de una flota
 *  con más de 100 viajes en total, donde la vista histórica se leería como
 *  un tramo reciente disfrazado de serie completa. `traerTodo` pagina sin
 *  el tope de 1,000 filas de PostgREST; `fecha_inicio` es columna `date`
 *  (sin hora/zona horaria que resolver, a diferencia de `created_at`). */
export async function getViajesPorMes(tenantId: string): Promise<Array<{ dia: string; valor: number }>> {
  const rows = await traerTodo<{ fecha_inicio: unknown }>(
    (desde, hasta) => supabaseAdmin()
      .from('viaje')
      .select('fecha_inicio')
      .eq('tenant_id', tenantId)
      .not('fecha_inicio', 'is', null)
      .order('id')
      .range(desde, hasta),
    'getViajesPorMes',
  );
  const porMes = new Map<string, number>();
  for (const r of rows) {
    const mes = (r.fecha_inicio as string).slice(0, 7); // YYYY-MM
    porMes.set(mes, (porMes.get(mes) ?? 0) + 1);
  }
  return Array.from(porMes.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, valor]) => ({ dia, valor }));
}

export interface Acreditables {
  /** Litros de diésel elegibles. El estímulo en pesos lo calcula el contador. */
  litrosDiesel: number; ieps: number; iva: number; peaje: number; }

/**
 * Suma de estímulos acreditables del periodo (IEPS diésel + IVA + peaje 50%).
 *
 * AGREGADO EN SQL DESDE EL 15-AGO-2026 (mig. 0112): traía TODA `liquidacion`
 * del tenant con `traerTodo` para sumar cuatro columnas ya calculadas por
 * liquidación —sin lógica fiscal que reimplementar, solo aritmética— y
 * caducaba ~mes 8.3 con 15,000 viajes/mes (docs/escala-15k.md §6).
 * `acreditables_liquidacion_tenant` hace las cuatro sumas en SQL: UN viaje de
 * red. La prueba de equivalencia (`analytics_kpis_acreditables.test.ts`)
 * compara la reducción JS vieja contra la forma nueva sobre el mismo dataset.
 */
export async function getAcreditables(tenantId: string, ventanaDias?: number): Promise<Acreditables> {
  const corte = corteVentana(ventanaDias);
  const { data, error } = await supabaseAdmin()
    .rpc('acreditables_liquidacion_tenant', { p_tenant: tenantId, p_desde: corte });
  if (error) throw new Error(`getAcreditables: ${error.message}`);

  const r = data as Partial<{ litrosDiesel: unknown; ieps: unknown; iva: unknown; peaje: unknown }> | null;
  const campos = [r?.litrosDiesel, r?.ieps, r?.iva, r?.peaje];
  if (!r || campos.some((c) => typeof c !== 'number')) {
    throw new Error('getAcreditables: acreditables_liquidacion_tenant devolvió otra forma (¿migración 0112 sin aplicar?)');
  }
  return {
    ieps: round2(r.ieps as number),
    iva: round2(r.iva as number),
    peaje: round2(r.peaje as number),
    // El IEPS ya no se presenta en pesos —el estímulo es cuota semanal × litros
    // y esa cuota no la tenemos—, así que lo que se entrega es el dato duro.
    litrosDiesel: round2(r.litrosDiesel as number),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALOR & AHORRO — lo que Likida le ahorra a la flota.
//
// Esta es la pantalla más fácil de convertir en mentira, así que la regla es
// más estricta que en el resto del archivo: CADA cifra es un conteo real de la
// base, o es una ESTIMACIÓN declarada como tal con su supuesto a la vista.
// Nunca una tercera cosa.
//
// Lo que se cuenta de verdad:
//   · documentos que pasaron por el Agente OCR  → `gasto.ocr_confianza` no nula
//   · acciones de IA por agente                 → filas de `llm_costo` por fase
//   · liquidaciones que cerró el motor          → filas de `liquidacion`
//   · comprobantes sin viaje que el sistema resolvió → `comprobante_huerfano`
//   · dinero que el cuadre observó              → `getKpis().diferenciaDetectada`
//
// `gasto.ocr_raw` NO sirve para esto aunque el nombre lo sugiera: está MUERTA
// (`repo.ts` escribe `ocr_confianza`/`ocr_extra` y nunca `ocr_raw`), así que
// contarla daría 0 documentos procesados con 40 en la tabla — la cifra más
// vergonzosa posible en la pantalla que presume el trabajo del producto.
//
// Lo que NO se calcula aquí, y por qué:
//   · multas de Carta Porte evitadas — Likida no valida Carta Porte todavía
//   · días de cobro (DSO) reducidos — no hay tabla de facturación ni cobranza
//   · "por cada $1 que pagas, ahorras $X" — Likida no le cobra a nadie, y sin
//     denominador real ese número se inventa solo
//   · mensajes de WhatsApp atendidos — `wa_mensaje_procesado` no tiene
//     `tenant_id`: son 102 filas globales que NO se pueden atribuir a una
//     flota sin inventar la atribución
// ═══════════════════════════════════════════════════════════════════════════

/** Minutos que toma capturar UN comprobante a mano (teclear monto, folio,
 *  RFC, fecha, y archivarlo). Es un SUPUESTO, no una medición: se declara
 *  aquí, se enseña en pantalla, y el que lo lea puede discutirlo. */
export const MINUTOS_CAPTURA_MANUAL = 4;

export interface ValorAhorro {
  /** Comprobantes que pasaron por el Agente OCR. Conteo real. */
  documentosProcesados: number;
  /** Liquidaciones que cerró el motor de cuadre. Conteo real. */
  liquidacionesCerradas: number;
  /** Comprobantes que llegaron sin viaje y el sistema logró amarrar. Real. */
  huerfanosResueltos: number;
  huerfanosTotales: number;
  /** Acciones de IA por agente (filas de `llm_costo`). Conteo real. */
  accionesPorAgente: Array<{ fase: string; n: number }>;
  /** Documentos procesados por mes, acumulado. Conteo real. */
  acumuladoPorMes: Array<{ mes: string; n: number; acumulado: number }>;
  /** ESTIMACIÓN: documentosProcesados × MINUTOS_CAPTURA_MANUAL. */
  horasAhorradasEstimadas: number;
}

/** Lo que devuelve `resumen_documentos_tenant()` (mig. 0064). */
interface ResumenDocumentos {
  procesados: number;
  /** DISPERSA: solo los meses con actividad, igual que cuando se agrupaba en JS. */
  porMes: Array<{ mes: string; n: number }>;
}

/**
 * Cuántas filas hay, sin traer ninguna.
 *
 * `head: true` con `count: 'exact'` no devuelve ni un renglón: solo el total, en
 * un viaje a la base. Es el mismo patrón que ya usa `contarViajes` más abajo,
 * pero LANZA en vez de devolver `null`: aquí el llamador es `getValorAhorro`,
 * cuyo contrato es que un fallo de lectura sube como excepción y el panel enseña
 * su estado de error. Un `0` devuelto por un fallo diría "esta flota nunca
 * liquidó nada", que es una afirmación falsa sobre el trabajo del cliente.
 *
 * `noNula` acota a las filas que tengan esa columna con valor — para separar
 * "huérfanos resueltos" de "huérfanos totales" sin traerse ninguno de los dos.
 */
async function contarFilas(tabla: string, tenantId: string, noNula?: string): Promise<number> {
  let q = supabaseAdmin().from(tabla).select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId);
  if (noNula) q = q.not(noNula, 'is', null);
  const { count, error } = await q;
  if (error) throw new Error(`getValorAhorro/${tabla}: ${error.message}`);
  // `count` nulo NO es cero: PostgREST solo lo manda si pudo contar. Devolver 0
  // aquí sería inventar una medición, que es la regla que define este producto.
  if (typeof count !== 'number') {
    throw new Error(`getValorAhorro/${tabla}: la base no devolvió el conteo; no se inventa un 0`);
  }
  return count;
}

/**
 * AGREGADO EN SQL DESDE EL 5-AGO-2026 (mig. 0064).
 *
 * Las dos lecturas grandes de esta función se traían la tabla ENTERA del tenant
 * para reducirla a un puñado de números, y las dos tenían fecha de caducidad
 * calculable — `traerTodo` LANZA al pasar de 100,000 filas:
 *
 *   · `llm_costo` — una fila por llamada al modelo, ~2,000 al día → **día 50**
 *   · `gasto`     — ~660 comprobantes al día, ~240 mil al año     → **mes 5**
 *
 * Y esta pantalla es la del CLIENTE, no la consola de Javier: el que se queda
 * mirando el error es el comprador. La de `gasto` además traía las filas que NO
 * habían pasado por OCR solo para que JavaScript las descartara — con un tercio
 * de captura manual, la mitad del tráfico era de más.
 *
 * Los dos conteos chicos (`liquidacion`, `comprobante_huerfano`) también dejaron
 * de traer filas: son `head: true`. No corrían la misma prisa —~11 mil
 * liquidaciones al año tardan casi una década en tocar el techo— pero traer una
 * tabla completa para hacerle `.length` no se sostiene en la misma función donde
 * se acaba de arreglar exactamente eso.
 *
 * El acumulado corrido se sigue calculando aquí: es una lista de decenas de
 * meses, no era lo que había que mover a la base.
 */
export async function getValorAhorro(tenantId: string): Promise<ValorAhorro> {
  const [docs, liquidacionesCerradas, huerfanosTotales, huerfanosResueltos, costoIa] = await Promise.all([
    traerResumenDocumentos(tenantId),
    contarFilas('liquidacion', tenantId),
    contarFilas('comprobante_huerfano', tenantId),
    contarFilas('comprobante_huerfano', tenantId, 'resuelto_en'),
    traerResumenCostoIaTenant(tenantId, 'getValorAhorro.llm_costo'),
  ]);

  // Mismo criterio que el resto del archivo: si no se pudo leer, se lanza. Un
  // "0 acciones de IA" por fallo de lectura se lee como "el producto no hizo
  // nada por esta flota", en la pantalla que existe para enseñar lo contrario.
  if ('err' in costoIa) throw new Error(`getValorAhorro.llm_costo: ${costoIa.err}`);

  let corrido = 0;
  const acumuladoPorMes = docs.porMes.map(({ mes, n }) => {
    corrido += n;
    return { mes, n, acumulado: corrido };
  });

  return {
    documentosProcesados: docs.procesados,
    liquidacionesCerradas,
    huerfanosResueltos,
    huerfanosTotales,
    // El orden lo pone JavaScript y no SQL a propósito: la lista tiene seis
    // fases como mucho, y la función de la 0064 la entrega ordenada por COSTO
    // (que es lo que quiere `getResumenCosto`) mientras que esta pantalla la
    // quiere por NÚMERO DE ACCIONES. Reordenar seis elementos aquí es más barato
    // que una segunda consulta con otro `order by`.
    accionesPorAgente: costoIa.ok.porFase
      .map((f) => ({ fase: f.fase, n: f.n }))
      .sort((a, b) => b.n - a.n),
    acumuladoPorMes,
    horasAhorradasEstimadas: round2((docs.procesados * MINUTOS_CAPTURA_MANUAL) / 60),
  };
}

/** `resumen_documentos_tenant()` (mig. 0064), con el mismo fallo-cerrado de
 *  forma que su hermana en `costos.ts`: una respuesta inesperada LANZA en vez de
 *  dejar que `?? 0` pinte "0 documentos procesados" sobre una tabla llena. */
async function traerResumenDocumentos(tenantId: string): Promise<ResumenDocumentos> {
  const { data, error } = await supabaseAdmin().rpc('resumen_documentos_tenant', { p_tenant: tenantId });
  if (error) throw new Error(`getValorAhorro.gasto: ${error.message}`);
  const r = data as Partial<ResumenDocumentos> | null;
  if (!r || typeof r.procesados !== 'number' || !Array.isArray(r.porMes)) {
    throw new Error(
      'getValorAhorro.gasto: resumen_documentos_tenant devolvió otra forma (¿migración 0064 sin aplicar?). '
      + 'No se pinta un 0 de documentos procesados que nadie midió.',
    );
  }
  return r as ResumenDocumentos;
}

// ── Consultas de las páginas de operación de /dashboard ────────────────────

export interface ViajeRow {
  id: string; folio: string; origen: string | null; destino: string | null;
  estatus: string; anticipo: number; operadorNombre: string | null;
  fechaInicio: string | null; intakePendientes: number;
  // La unidad amarrada (`viaje.unidad_id`, 0047). `null` = viaje sin unidad —
  // que es un estado real y perseguible (el tablero del despacho lo cuenta),
  // no un hueco. El eco viaja resuelto para que la pantalla no re-consulte.
  unidadId: string | null;
  unidadEco: string | null;
  // Las cuatro marcas de la confirmación del chofer (mig. 0058). Se leen en
  // `dashboard/confirmacion.ts`; aquí solo se traen. Un `null` en `avisadoEn`
  // NO significa lo mismo que un 0 en `avisosEnviados`: el primero es "no hay
  // registro del aviso" y el segundo es un conteo real, así que la columna
  // nullable se conserva nullable en vez de aplanarse a cero.
  avisadoEn: string | null;
  aceptadoEn: string | null;
  escaladoEn: string | null;
  avisosEnviados: number;
}

/** Los viajes de la flota, el más reciente primero. `viaje.unidad_id` existe
 *  desde la 0047 y aquí se trae con su número económico (el comentario viejo
 *  decía que no había columna de unidad — dejó de ser verdad ese día). De POD
 *  sigue sin haber columna en `viaje`: esa evidencia vive en su tabla y se
 *  cruza en `getPods`. */
/**
 * Cuántos viajes tiene la flota EN TOTAL.
 *
 * Existe porque `getViajes` trae 100 y el KPI enseñaba `viajes.length` como si
 * fuera el total. Con 8 viajes de prueba coincidían y nadie lo notaba; a 30
 * viajes diarios, el panel diría "100" para siempre a partir del cuarto día.
 * Es el rótulo que miente, que es la regla que define este producto.
 *
 * `head: true` no trae ni una fila: solo el conteo, en un viaje a la base.
 */
export async function contarViajes(
  tenantId: string,
  /** Acota a estos estatus. Sin esto, cuenta todos. */
  estatus?: string[],
): Promise<number | null> {
  let q = supabaseAdmin()
    .from('viaje')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  // El índice `idx_viaje_tenant` es (tenant_id, estatus), así que este filtro
  // sale del mismo índice que ya sirve al conteo total.
  if (estatus?.length) q = q.in('estatus', estatus);
  const { count, error } = await q;

  // `null` ≠ 0, y la diferencia importa: un cero se lee como "esta flota no ha
  // hecho viajes" y sería una afirmación falsa. Quien llame enseña "—" y dice
  // que no se pudo contar.
  if (error) {
    logger.warn('contarViajes', { tenantId, err: error.message });
    return null;
  }
  return count ?? null;
}

/**
 * Los viajes SIN LIQUIDAR, todos, sin ventana.
 *
 * `getViajes` trae los 100 más recientes, y de ahí se sacaban el conteo de
 * abiertos y —peor— la SUMA DEL ANTICIPO ABIERTO. A 30 viajes diarios, cien
 * viajes son tres días y medio: un viaje que lleve cinco abiertos cae fuera de
 * la ventana y su anticipo desaparece de una cifra de dinero, sin que nada lo
 * indique. Ese es el recorte silencioso que `traerTodo` existe para impedir.
 *
 * No hay riesgo de traer demasiado: lo abierto está acotado por la operación
 * —una flota tiene decenas de viajes vivos, no miles— y hay un índice único
 * que impide dos abiertos por operador (mig. 0029). Lo que crece sin techo es
 * el histórico liquidado, y eso no entra aquí.
 */
export async function getViajesSinLiquidar(tenantId: string): Promise<Array<{ id: string; anticipo: number }>> {
  const filas = await traerTodo<{ id: unknown; anticipo: unknown }>(
    (desde, hasta) => supabaseAdmin()
      .from('viaje')
      .select('id, anticipo')
      .eq('tenant_id', tenantId)
      .in('estatus', ['abierto', 'en_cuadre'])
      .order('id')
      .range(desde, hasta),
    'getViajesSinLiquidar',
  );
  return filas.map((v) => ({ id: v.id as string, anticipo: Number(v.anticipo ?? 0) }));
}

/** Un renglón de la bitácora del Agente de Conductores (F4): cada sello real
 *  del ciclo de comunicación con el chofer, del más reciente al más viejo. */
export interface EventoConductor {
  tipo: 'avisado' | 'acepto' | 'escalado' | 'llegada' | 'descarga' | 'regreso';
  folio: string;
  operador: string | null;
  cuando: string;
}

const SELLOS_CONDUCTOR: ReadonlyArray<[EventoConductor['tipo'], string]> = [
  ['avisado', 'avisado_en'], ['acepto', 'aceptado_en'], ['escalado', 'escalado_en'],
  ['llegada', 'llegada_en'], ['descarga', 'descarga_en'], ['regreso', 'regreso_en'],
];

/** Los sellos de los viajes recientes, aplanados a una bitácora. Ventana de
 *  60 viajes: es la bitácora de actividad, no un histórico exhaustivo — la
 *  vista lo rotula así. */
export async function getEventosConductores(tenantId: string, limite = 15): Promise<EventoConductor[]> {
  const res = await supabaseAdmin()
    .from('viaje')
    .select('folio, id, avisado_en, aceptado_en, escalado_en, llegada_en, descarga_en, regreso_en, operador:operador_id(nombre)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(60);
  const filas = exigir(res, 'getEventosConductores') ?? [];
  const eventos: EventoConductor[] = [];
  for (const v of filas) {
    const op = ((v.operador as { nombre?: string } | null)?.nombre) ?? null;
    const folio = (v.folio as string) || (v.id as string).slice(0, 8);
    for (const [tipo, col] of SELLOS_CONDUCTOR) {
      const cuando = (v as Record<string, unknown>)[col];
      if (typeof cuando === 'string') eventos.push({ tipo, folio, operador: op, cuando });
    }
  }
  return eventos.sort((a, b) => Date.parse(b.cuando) - Date.parse(a.cuando)).slice(0, limite);
}

/** Viajes escalados que siguen sin chofer que acepte — la alerta del Inicio
 *  (F2). Conteo directo y no un filtro sobre los 100 recientes: un viaje
 *  escalado puede ser justamente el viejo que ya salió de esa ventana.
 *  `null` ≠ 0, como en `contarViajes`. */
export async function contarEscalados(tenantId: string): Promise<number | null> {
  const { count, error } = await supabaseAdmin()
    .from('viaje')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('estatus', ['abierto', 'en_cuadre'])
    .not('escalado_en', 'is', null)
    .is('aceptado_en', null);
  if (error) {
    logger.warn('contarEscalados', { tenantId, err: error.message });
    return null;
  }
  return count ?? null;
}

export async function getViajes(tenantId: string, limite = 100): Promise<ViajeRow[]> {
  const res = await supabaseAdmin()
    .from('viaje')
    .select('id, folio, origen, destino, estatus, anticipo, fecha_inicio, intake_pendientes, avisado_en, aceptado_en, escalado_en, avisos_enviados, unidad_id, operador:operador_id(nombre), unidad:unidad_id(numero_economico)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limite);
  const filas = exigir(res, 'getViajes') ?? [];
  return filas.map((v) => ({
    id: v.id as string,
    folio: (v.folio as string) || (v.id as string).slice(0, 8),
    origen: (v.origen as string) || null,
    destino: (v.destino as string) || null,
    estatus: v.estatus as string,
    anticipo: Number(v.anticipo ?? 0),
    operadorNombre: ((v.operador as { nombre?: string } | null)?.nombre) ?? null,
    fechaInicio: (v.fecha_inicio as string) || null,
    intakePendientes: Number(v.intake_pendientes ?? 0),
    unidadId: (v.unidad_id as string) || null,
    unidadEco: ((v.unidad as { numero_economico?: string } | null)?.numero_economico) ?? null,
    avisadoEn: (v.avisado_en as string) || null,
    aceptadoEn: (v.aceptado_en as string) || null,
    escaladoEn: (v.escalado_en as string) || null,
    avisosEnviados: Number(v.avisos_enviados ?? 0),
  }));
}

/**
 * El Registro de Viajes v2 (22-ago-2026): una PÁGINA del registro, ordenada
 * por inicio del viaje (el más reciente arriba; sin fecha, al final) y con
 * búsqueda por folio, origen o destino. Se pide una fila de más que
 * `porPagina` para saber si hay otra página sin contar la tabla entera —
 * `hayMas` es eso, no un total.
 *
 * La búsqueda va a la base, no sobre las 100 cargadas: si el contralor busca
 * un folio de hace tres meses, tiene que encontrarlo aunque no esté entre
 * los recientes. El texto entra escapado (`%`, `_` y `,` fuera), porque
 * `.or()` de PostgREST arma el filtro en una sola cadena separada por comas.
 */
export type FiltroRegistro = 'todos' | 'abiertos' | 'en_cuadre' | 'liquidados' | 'escalados';

export async function getViajesRegistro(
  tenantId: string,
  opciones: { q?: string; pagina?: number; porPagina?: number; filtro?: FiltroRegistro } = {},
): Promise<{ filas: ViajeRow[]; hayMas: boolean }> {
  const porPagina = Math.max(1, Math.min(100, opciones.porPagina ?? 100));
  const pagina = Math.max(1, opciones.pagina ?? 1);
  const desde = (pagina - 1) * porPagina;
  let consulta = supabaseAdmin()
    .from('viaje')
    .select('id, folio, origen, destino, estatus, anticipo, fecha_inicio, intake_pendientes, avisado_en, aceptado_en, escalado_en, avisos_enviados, unidad_id, operador:operador_id(nombre), unidad:unidad_id(numero_economico)')
    .eq('tenant_id', tenantId);
  // El filtro de estatus va a la base por la misma razón que la búsqueda:
  // filtrar en memoria sobre una página de 100 dejaría "Liquidados" con 3
  // filas y una página 2 que sí tiene más.
  if (opciones.filtro === 'abiertos') consulta = consulta.eq('estatus', 'abierto');
  else if (opciones.filtro === 'en_cuadre') consulta = consulta.eq('estatus', 'en_cuadre');
  else if (opciones.filtro === 'liquidados') consulta = consulta.eq('estatus', 'liquidado');
  else if (opciones.filtro === 'escalados') {
    consulta = consulta.in('estatus', ['abierto', 'en_cuadre']).not('escalado_en', 'is', null).is('aceptado_en', null);
  }
  const q = (opciones.q ?? '').trim().replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (q) {
    const patron = `%${q}%`;
    consulta = consulta.or(`folio.ilike.${patron},origen.ilike.${patron},destino.ilike.${patron}`);
  }
  const res = await consulta
    .order('fecha_inicio', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(desde, desde + porPagina);
  const crudas = exigir(res, 'getViajesRegistro') ?? [];
  const hayMas = crudas.length > porPagina;
  const filas = crudas.slice(0, porPagina).map((v) => ({
    id: v.id as string,
    folio: (v.folio as string) || (v.id as string).slice(0, 8),
    origen: (v.origen as string) || null,
    destino: (v.destino as string) || null,
    estatus: v.estatus as string,
    anticipo: Number(v.anticipo ?? 0),
    operadorNombre: ((v.operador as { nombre?: string } | null)?.nombre) ?? null,
    fechaInicio: (v.fecha_inicio as string) || null,
    intakePendientes: Number(v.intake_pendientes ?? 0),
    unidadId: (v.unidad_id as string) || null,
    unidadEco: ((v.unidad as { numero_economico?: string } | null)?.numero_economico) ?? null,
    avisadoEn: (v.avisado_en as string) || null,
    aceptadoEn: (v.aceptado_en as string) || null,
    escaladoEn: (v.escalado_en as string) || null,
    avisosEnviados: Number(v.avisos_enviados ?? 0),
  }));
  return { filas, hayMas };
}

export interface LiquidacionDeViaje {
  id: string; viajeId: string; estatus: string; comprobado: number; diferencia: number;
}

/** Las liquidaciones de ESTOS viajes (por `viaje_id`, no por folio: el folio
 *  es texto libre del TMS y puede repetirse). Para la página del registro:
 *  comprobado, diferencia y el link al detalle. Un viaje sin fila aquí no
 *  tiene liquidación todavía y la tabla lo dice con un guion. */
export async function getLiquidacionesDeViajes(tenantId: string, viajeIds: string[]): Promise<LiquidacionDeViaje[]> {
  if (viajeIds.length === 0) return [];
  const res = await supabaseAdmin()
    .from('liquidacion')
    .select('id, viaje_id, estatus, total_comprobado, diferencia')
    .eq('tenant_id', tenantId)
    .in('viaje_id', viajeIds);
  const filas = exigir(res, 'getLiquidacionesDeViajes') ?? [];
  return filas.map((l) => ({
    id: l.id as string,
    viajeId: l.viaje_id as string,
    estatus: (l.estatus as string) || 'cuadrada',
    comprobado: Number(l.total_comprobado ?? 0),
    diferencia: Number(l.diferencia ?? 0),
  }));
}

export interface DocumentoRow {
  id: string; concepto: string; monto: number; fecha: string | null; folio: string | null;
  rfcEmisor: string | null; cfdiUuid: string | null; estadoSat: string | null;
  ocrConfianza: number | null; efos: boolean | null; xmlVerificado: boolean | null;
  tieneImagen: boolean;
}

/** La bandeja del Agente OCR — cada fila de `gasto` es un comprobante que
 *  entró por WhatsApp y pasó por el agente. */
export async function getDocumentos(tenantId: string, limite = 100): Promise<DocumentoRow[]> {
  const res = await supabaseAdmin()
    .from('gasto')
    .select('id, concepto, monto, fecha, folio, rfc_emisor, cfdi_uuid, estado_sat, ocr_confianza, efos, xml_verificado, imagen_url')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limite);
  const filas = exigir(res, 'getDocumentos') ?? [];
  return filas.map((g) => ({
    id: g.id as string,
    concepto: (g.concepto as string) ?? 'otro',
    monto: Number(g.monto ?? 0),
    fecha: (g.fecha as string) || null,
    folio: (g.folio as string) || null,
    rfcEmisor: (g.rfc_emisor as string) || null,
    cfdiUuid: (g.cfdi_uuid as string) || null,
    estadoSat: (g.estado_sat as string) || null,
    ocrConfianza: g.ocr_confianza === null || g.ocr_confianza === undefined ? null : Number(g.ocr_confianza),
    efos: (g.efos as boolean) ?? null,
    xmlVerificado: (g.xml_verificado as boolean) ?? null,
    tieneImagen: Boolean(g.imagen_url),
  }));
}

export interface GastoPorConcepto { concepto: string; n: number; total: number }

/** Gasto agrupado por concepto (diésel, caseta, alimentación…) — la base de
 *  la página de Combustible & Casetas. */
export async function getGastoPorConcepto(tenantId: string): Promise<GastoPorConcepto[]> {
  const filas = await traerTodo<{ concepto: unknown; monto: unknown }>(
    (desde, hasta) => supabaseAdmin().from('gasto').select('concepto, monto')
      .eq('tenant_id', tenantId).order('id').range(desde, hasta),
    'getGastoPorConcepto',
  );
  const mapa = new Map<string, { n: number; total: number }>();
  for (const f of filas) {
    const k = (f.concepto as string) ?? 'otro';
    const v = mapa.get(k) ?? { n: 0, total: 0 };
    v.n += 1; v.total += Number(f.monto ?? 0);
    mapa.set(k, v);
  }
  return [...mapa.entries()]
    .map(([concepto, v]) => ({ concepto, n: v.n, total: round2(v.total) }))
    .sort((a, b) => b.total - a.total);
}

export interface GastoPorRuta { ruta: string; total: number }

/** Gasto agrupado por ruta (origen → destino) — mismo patrón de join en
 *  memoria que `getStatsPorOperador`: `gasto` no tiene columna de ruta, así
 *  que se cruza con `viaje` por `viaje_id`. Top 5 por gasto, no la lista
 *  entera — es para "¿qué ruta me está costando más?", no un reporte. */
export async function getGastoPorRuta(tenantId: string): Promise<GastoPorRuta[]> {
  const admin = supabaseAdmin();
  const [gastos, viajes] = await Promise.all([
    traerTodo<{ viaje_id: unknown; monto: unknown }>(
      (desde, hasta) => admin.from('gasto').select('viaje_id, monto').eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getGastoPorRuta.gasto',
    ),
    traerTodo<{ id: unknown; origen: unknown; destino: unknown }>(
      (desde, hasta) => admin.from('viaje').select('id, origen, destino').eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getGastoPorRuta.viaje',
    ),
  ]);
  const rutaPorViaje = new Map(
    viajes.map((v) => [v.id as string, `${(v.origen as string) || '—'} → ${(v.destino as string) || '—'}`]),
  );
  const mapa = new Map<string, number>();
  for (const g of gastos) {
    const ruta = rutaPorViaje.get(g.viaje_id as string);
    if (!ruta) continue;
    mapa.set(ruta, (mapa.get(ruta) ?? 0) + Number(g.monto ?? 0));
  }
  return [...mapa.entries()]
    .map(([ruta, total]) => ({ ruta, total: round2(total) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);
}

/**
 * Ciudad → región de logística en México — hecho geográfico real (INEGI/
 * gremio del autotransporte), NO una categoría de negocio inventada.
 * Cobertura deliberadamente acotada a las plazas más comunes en carga por
 * carretera; una ciudad que no está aquí NO se adivina — sale sin región
 * en vez de con una región falsa (misma regla de "nunca inventar" que el
 * resto del producto, aplicada a geografía en vez de a dinero).
 */
const REGION_POR_CIUDAD: Record<string, string> = {
  'ciudad de mexico': 'Centro', 'cdmx': 'Centro', 'mexico city': 'Centro',
  'toluca': 'Centro', 'puebla': 'Centro', 'queretaro': 'Centro', 'pachuca': 'Centro',
  'cuernavaca': 'Centro', 'tlaxcala': 'Centro',
  'guadalajara': 'Occidente', 'leon': 'Occidente', 'aguascalientes': 'Occidente',
  'morelia': 'Occidente', 'colima': 'Occidente', 'zapopan': 'Occidente', 'irapuato': 'Occidente',
  'celaya': 'Occidente', 'zamora': 'Occidente',
  'monterrey': 'Noreste', 'saltillo': 'Noreste', 'reynosa': 'Noreste', 'nuevo laredo': 'Noreste',
  'matamoros': 'Noreste', 'torreon': 'Noreste', 'ciudad victoria': 'Noreste',
  'tijuana': 'Noroeste', 'mexicali': 'Noroeste', 'hermosillo': 'Noroeste',
  'culiacan': 'Noroeste', 'ciudad juarez': 'Noroeste', 'chihuahua': 'Noroeste',
  'la paz': 'Noroeste', 'los mochis': 'Noroeste',
  'veracruz': 'Golfo', 'xalapa': 'Golfo', 'tampico': 'Golfo', 'coatzacoalcos': 'Golfo',
  'villahermosa': 'Sureste', 'merida': 'Sureste', 'cancun': 'Sureste', 'campeche': 'Sureste',
  'oaxaca': 'Sur', 'tuxtla gutierrez': 'Sur', 'acapulco': 'Sur', 'chilpancingo': 'Sur',
};

/** Sin diacríticos, minúsculas — para que "Querétaro"/"queretaro" empaten
 *  con la misma llave del catálogo. */
function normalizarCiudad(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Busca la región de una ciudad EN LA LLAVE del catálogo (no al revés):
 *  "Guadalajara, Jal." contiene "guadalajara" — evita exigir que el campo
 *  libre venga exactamente igual al catálogo. */
function regionDe(ciudad: string | null): string | null {
  if (!ciudad) return null;
  const norm = normalizarCiudad(ciudad);
  for (const [clave, region] of Object.entries(REGION_POR_CIUDAD)) {
    if (norm.includes(clave)) return region;
  }
  return null;
}

export interface RutaConRegion {
  origen: string; destino: string; total: number;
  /** % del gasto total de las rutas devueltas (no del gasto total de la
   *  flota) — mismo criterio que un top-N: el 100% es la suma de ESTE top,
   *  no un universo más grande que el usuario no ve. */
  pct: number;
  /** `null` cuando ni origen ni destino matchean el catálogo — se enseña
   *  como "sin clasificar" en vez de adivinar. */
  region: string | null;
}

/**
 * Top rutas por gasto CON región — a diferencia de `getGastoPorRuta` (que
 * regresa la ruta ya concatenada en un string), aquí se necesitan origen y
 * destino por separado para poder buscar la región de cada uno.
 */
export async function getTopRutasPorGasto(
  tenantId: string, top: number = 5, ventana?: { desde: string; hasta: string },
): Promise<RutaConRegion[]> {
  const admin = supabaseAdmin();
  const [gastos, viajes] = await Promise.all([
    traerTodo<{ viaje_id: unknown; monto: unknown }>(
      (desde, hasta) => {
        let q = admin.from('gasto').select('viaje_id, monto').eq('tenant_id', tenantId);
        if (ventana) q = q.gte('fecha', ventana.desde).lte('fecha', ventana.hasta);
        return q.order('id').range(desde, hasta);
      },
      'getTopRutasPorGasto.gasto',
    ),
    traerTodo<{ id: unknown; origen: unknown; destino: unknown }>(
      (desde, hasta) => admin.from('viaje').select('id, origen, destino').eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getTopRutasPorGasto.viaje',
    ),
  ]);
  const viajePorId = new Map(viajes.map((v) => [v.id as string, v]));
  const mapa = new Map<string, { origen: string; destino: string; total: number }>();
  for (const g of gastos) {
    const v = viajePorId.get(g.viaje_id as string);
    if (!v) continue;
    const origen = (v.origen as string) || '—';
    const destino = (v.destino as string) || '—';
    const clave = `${origen}→${destino}`;
    const prev = mapa.get(clave) ?? { origen, destino, total: 0 };
    prev.total += Number(g.monto ?? 0);
    mapa.set(clave, prev);
  }
  const ordenado = [...mapa.values()].sort((a, b) => b.total - a.total).slice(0, top);
  const sumaTop = ordenado.reduce((s, r) => s + r.total, 0) || 1;
  return ordenado.map((r) => ({
    origen: r.origen, destino: r.destino, total: round2(r.total),
    pct: round2((r.total / sumaTop) * 100),
    // La región del DESTINO — es el mercado al que llega la carga, la
    // pregunta operativa habitual ("¿dónde estoy vendiendo/entregando?").
    region: regionDe(r.destino),
  }));
}

export interface TopRutasSeries {
  semanal: RutaConRegion[]; mensual: RutaConRegion[]; historico: RutaConRegion[];
}

/** Las 3 vistas de "Top rutas por gasto" — mismo mapeo de semanas que
 *  `getGastoPorSemanaSeries` (`SEMANAS_POR_MODO`); "histórico" no manda
 *  ventana en absoluto (sin cota), no una de 52 semanas disfrazada de
 *  "todo". */
export async function getTopRutasPorGastoSeries(
  tenantId: string, top: number = 5,
  hoy: string = new Date().toLocaleDateString('en-CA', { timeZone: TZ_MX }),
): Promise<TopRutasSeries> {
  const ventanaDe = (semanas: number) => {
    const hastaD = new Date(`${hoy}T00:00:00Z`);
    const desdeD = new Date(hastaD);
    desdeD.setUTCDate(desdeD.getUTCDate() - (semanas * 7 - 1));
    return { desde: desdeD.toISOString().slice(0, 10), hasta: hoy };
  };
  const [semanal, mensual, historico] = await Promise.all([
    getTopRutasPorGasto(tenantId, top, ventanaDe(SEMANAS_POR_MODO.semanal)),
    getTopRutasPorGasto(tenantId, top, ventanaDe(SEMANAS_POR_MODO.mensual)),
    getTopRutasPorGasto(tenantId, top),
  ]);
  return { semanal, mensual, historico };
}

export interface OperadorDetalle {
  operadorId: string; nombre: string; telefono: string | null; numeroEmpleado: string | null;
  /** RFC del trabajador (mig. 0080) — para la rama buena de RLISR 57. */
  rfc: string | null;
  activo: boolean; viajes: number; anticipoTotal: number; comprobadoTotal: number;
  /** % de anticipo comprobado, o `null` si nunca recibió anticipo (dividir
   *  entre cero daría 0% y se leería como "no comprobó nada"). */
  pctComprobado: number | null;
  /** Licencia del chofer (0053). `null` = NO CAPTURADA, que no es lo mismo que
   *  vencida: la pantalla dice "sin registrar" y no marca a nadie. Inventar una
   *  fecha haría salir vigente o vencido a quien no lo es. */
  licencia: string | null;
  licenciaTipo: string | null;
  /** ISO `AAAA-MM-DD`. */
  licenciaVence: string | null;
}

/** Operadores con su anticipo abierto y qué tanto comprobaron — el cruce que
 *  el dueño usa para la conversación difícil. No existía: `getStatsPorOperador`
 *  solo suma diésel. */
export async function getOperadoresDetalle(tenantId: string): Promise<OperadorDetalle[]> {
  const admin = supabaseAdmin();
  const [ops, viajes, liqs] = await Promise.all([
    traerTodo<{
      id: unknown; nombre: unknown; telefono: unknown; numero_empleado: unknown; activo: unknown;
      licencia: unknown; licencia_tipo: unknown; licencia_vence: unknown; rfc: unknown;
    }>(
      (desde, hasta) => admin.from('operador')
        .select('id, nombre, telefono, numero_empleado, activo, licencia, licencia_tipo, licencia_vence, rfc')
        .eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getOperadoresDetalle.operador',
    ),
    traerTodo<{ id: unknown; operador_id: unknown; anticipo: unknown }>(
      (desde, hasta) => admin.from('viaje').select('id, operador_id, anticipo')
        .eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getOperadoresDetalle.viaje',
    ),
    traerTodo<{ viaje_id: unknown; total_comprobado: unknown }>(
      (desde, hasta) => admin.from('liquidacion').select('viaje_id, total_comprobado')
        .eq('tenant_id', tenantId).order('id').range(desde, hasta),
      'getOperadoresDetalle.liquidacion',
    ),
  ]);

  const comprobadoPorViaje = new Map<string, number>();
  for (const l of liqs) {
    const k = l.viaje_id as string;
    comprobadoPorViaje.set(k, (comprobadoPorViaje.get(k) ?? 0) + Number(l.total_comprobado ?? 0));
  }
  const acum = new Map<string, { viajes: number; anticipo: number; comprobado: number }>();
  for (const v of viajes) {
    const op = v.operador_id as string;
    if (!op) continue;
    const a = acum.get(op) ?? { viajes: 0, anticipo: 0, comprobado: 0 };
    a.viajes += 1;
    a.anticipo += Number(v.anticipo ?? 0);
    a.comprobado += comprobadoPorViaje.get(v.id as string) ?? 0;
    acum.set(op, a);
  }

  return ops.map((o) => {
    const a = acum.get(o.id as string) ?? { viajes: 0, anticipo: 0, comprobado: 0 };
    return {
      operadorId: o.id as string,
      nombre: o.nombre as string,
      telefono: (o.telefono as string) || null,
      numeroEmpleado: (o.numero_empleado as string) || null,
      rfc: (o.rfc as string | null) ?? null,
      activo: Boolean(o.activo),
      viajes: a.viajes,
      anticipoTotal: round2(a.anticipo),
      comprobadoTotal: round2(a.comprobado),
      pctComprobado: a.anticipo > 0 ? Math.round((a.comprobado / a.anticipo) * 100) : null,
      licencia: (o.licencia as string) || null,
      licenciaTipo: (o.licencia_tipo as string) || null,
      licenciaVence: (o.licencia_vence as string) || null,
    };
  }).sort((x, y) => y.viajes - x.viajes);
}

export interface LiquidacionDetalle {
  id: string; viajeId: string; folio: string; estatus: string;
  /** Chofer asignado hoy — para "Reasignar chofer" (Task 3 del plan de roles). */
  operadorId: string; operadorNombre: string;
  /** ISO crudo, en UTC. Se formatea en la pantalla y en hora de México:
   *  `.slice(0, 10)` aquí fechaba en agosto lo cerrado el 31 de julio a las
   *  20:00 hora local (auditoría 5, frontend, MEDIO 3). */
  creadoEn: string;
  totalComprobado: number; totalAnticipo: number; diferencia: number;
  ieps: number; litrosDiesel: number; iva: number; peaje: number;
  diferencias: Array<{ tipo: string; nota: string; monto: number; gastoId?: string }>;
  /** `ocrExtra` viaja porque la etiqueta del renglón depende del producto
   *  impreso en el ticket: sin él el panel dice "Diésel" donde el PDF dice
   *  "Combustible Magna" (auditoría 5, arquitectura, ALTO 1).
   *
   *  `id` cruza el renglón con sus `diferencias` (por `gastoId`) para pintar
   *  su estado; `fecha`, `formaPago`, `cfdiUuid` y `estadoSat` son las
   *  columnas de la tabla del detalle v2. Todo opcional: un gasto viejo sin
   *  XML no trae forma de pago y la celda dice "—", no "Efectivo". */
  gastos: Array<{
    id?: string; concepto: string; monto: number; folio?: string; fecha?: string;
    formaPago?: string; cfdiUuid?: string; estadoSat?: string; cfdiValido?: boolean;
    ocrExtra?: Record<string, unknown>; imagenUrl?: string;
  }>;
  /** La ficha del viaje que se liquidó (22-ago-2026, detalle v2): ruta,
   *  unidad, cliente y los sellos de WhatsApp (0058/0090) para la línea de
   *  tiempo. Todo nullable: lo que no se capturó se pinta como guion. */
  viaje: {
    origen: string | null; destino: string | null; fechaInicio: string | null;
    creadoEn: string | null;
    unidadEco: string | null; unidadPlacas: string | null; clienteNombre: string | null;
    operadorTelefono: string | null;
    avisadoEn: string | null; aceptadoEn: string | null;
    llegadaEn: string | null; descargaEn: string | null; regresoEn: string | null;
  };
  /** Cuándo entró el primer y el último comprobante del viaje (`gasto.created_at`,
   *  hora de recepción por WhatsApp) y cuántos hay en total, duplicados
   *  incluidos. `null` cuando no hay ninguno. */
  comprobantesEntre: { primero: string | null; ultimo: string | null; n: number };
  /** Cuántos comprobantes NO están en `gastos` por estar excluidos del total
   *  (duplicados y montos no positivos). `0` cuando la tabla es completa. */
  comprobantesExcluidos: number;
  /** true cuando `gastos` son las filas del motor y por tanto suman
   *  `totalComprobado`. false cuando se sirvieron crudos de la base y la suma
   *  puede no cuadrar: la pantalla lo dice en vez de dejar que el contralor lo
   *  descubra con el dedo. */
  comprobantesCuadran: boolean;
  /** Las tres cubetas del motor, o `null` si no se pudieron reconstruir. */
  deducibilidad: { totalDeducible: number; totalNoDeducible: number; totalPorConfirmar: number } | null;
  /** Ruta del PDF del contralor en storage (`liquidacion.pdf_url`), o `null`.
   *  No es una URL pública: se firma en `/api/export/pdf/[id]`. */
  pdfPath: string | null;
}

/** Detalle de una liquidación (read-only) — para la vista de proyector. */
export async function getLiquidacionDetalle(id: string, tenantId: string): Promise<LiquidacionDetalle | null> {
  const admin = supabaseAdmin();
  const res = await admin
    .from('liquidacion')
    .select('id, viaje_id, estatus, total_comprobado, total_anticipo, diferencia, diferencias, ieps_acreditable, litros_diesel_acreditables, iva_acreditable, peaje_acreditable, created_at, pdf_url, viaje:viaje_id(folio, origen, destino, fecha_inicio, created_at, avisado_en, aceptado_en, llegada_en, descarga_en, regreso_en, operador_id, operador:operador_id(nombre, telefono), unidad:unidad_id(numero_economico, placas), cliente:cliente_id(nombre))')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  // `null` significa AHORA una sola cosa: la liquidación no existe (y la página
  // responde notFound()). Antes también significaba "no se pudo leer", y el
  // contralor que hacía clic en una liquidación real leía "Esta página no
  // existe. Puede que el enlace esté mal escrito".
  const data = exigir(res, 'getLiquidacionDetalle');
  if (!data) return null;
  const totalComprobado = Number(data.total_comprobado ?? 0);
  const reconstruida = await reconstruir(
    tenantId, data.viaje_id as string, totalComprobado, data.diferencias,
  );
  // Solo se consulta `gasto` cuando el motor no pudo reconstruir: en el camino
  // normal las filas salen de la reconstrucción, que ya trae los gastos.
  const crudos = reconstruida ? null : await leerGastos(admin, tenantId, data.viaje_id as string);
  const gastos = reconstruida?.filas ?? crudos ?? [];
  const comprobantesEntre = await ventanaComprobantes(admin, tenantId, data.viaje_id as string);
  const viaje = data.viaje as {
    folio?: string; origen?: string | null; destino?: string | null; fecha_inicio?: string | null;
    created_at?: string | null; avisado_en?: string | null; aceptado_en?: string | null;
    llegada_en?: string | null; descarga_en?: string | null; regreso_en?: string | null;
    operador_id?: string; operador?: { nombre?: string; telefono?: string | null } | null;
    unidad?: { numero_economico?: string | null; placas?: string | null } | null;
    cliente?: { nombre?: string | null } | null;
  } | null;
  const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    id: data.id as string,
    viajeId: data.viaje_id as string,
    folio: (viaje?.folio) ?? (data.id as string).slice(0, 8),
    operadorId: viaje?.operador_id ?? '',
    operadorNombre: viaje?.operador?.nombre ?? '—',
    viaje: {
      origen: texto(viaje?.origen), destino: texto(viaje?.destino),
      fechaInicio: texto(viaje?.fecha_inicio), creadoEn: texto(viaje?.created_at),
      unidadEco: texto(viaje?.unidad?.numero_economico), unidadPlacas: texto(viaje?.unidad?.placas),
      clienteNombre: texto(viaje?.cliente?.nombre),
      operadorTelefono: texto(viaje?.operador?.telefono),
      avisadoEn: texto(viaje?.avisado_en), aceptadoEn: texto(viaje?.aceptado_en),
      llegadaEn: texto(viaje?.llegada_en), descargaEn: texto(viaje?.descarga_en), regresoEn: texto(viaje?.regreso_en),
    },
    comprobantesEntre,
    estatus: data.estatus as string,
    creadoEn: data.created_at as string,
    totalComprobado,
    totalAnticipo: Number(data.total_anticipo ?? 0),
    diferencia: Number(data.diferencia ?? 0),
    ieps: Number(data.ieps_acreditable ?? 0),
    // El select no la pedía, así que el detalle NUNCA podía mostrar los litros:
    // el contralor veía "1,850 L elegibles" en la tarjeta de la lista, hacía clic,
    // y en la liquidación que los produjo no había ninguna mención.
    litrosDiesel: Number(data.litros_diesel_acreditables ?? 0),
    iva: Number(data.iva_acreditable ?? 0),
    peaje: Number(data.peaje_acreditable ?? 0),
    diferencias: ((data.diferencias as Array<{ tipo: string; nota: string; monto: number; gastoId?: string }>) ?? []),
    gastos,
    comprobantesExcluidos: reconstruida?.excluidos ?? 0,
    comprobantesCuadran: reconstruida !== null,
    deducibilidad: reconstruida?.deducibilidad ?? null,
    pdfPath: (data.pdf_url as string) || null,
  };
}

/**
 * Los comprobantes tal como están guardados. Es el camino de RESPALDO: se usa
 * solo cuando el motor no pudo reconstruir el viaje, y entonces la tabla puede
 * no sumar el total (`comprobantesCuadran: false`).
 *
 * Lleva `.order()` porque sin él Postgres puede devolver los renglones en
 * distinto orden entre recargas: el contralor recarga y los comprobantes se
 * barajan (auditoría 5, frontend, BAJO 2). Se ordena por fecha del comprobante,
 * que es como se lee un estado de cuenta, con `id` de desempate para que dos
 * tickets del mismo día tampoco bailen.
 */
async function leerGastos(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  viajeId: string,
): Promise<LiquidacionDetalle['gastos']> {
  const res = await admin
    .from('gasto')
    .select('id, concepto, monto, folio, fecha, forma_pago, cfdi_uuid, estado_sat, cfdi_valido, ocr_extra, imagen_url')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId)
    .order('fecha', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });
  const filas = exigir(res, 'getLiquidacionDetalle/gastos') ?? [];
  return filas.map((g) => ({
    id: (g.id as string) || undefined,
    concepto: g.concepto as string,
    monto: Number(g.monto),
    folio: (g.folio as string) || undefined,
    fecha: (g.fecha as string) || undefined,
    formaPago: (g.forma_pago as string) || undefined,
    cfdiUuid: (g.cfdi_uuid as string) || undefined,
    estadoSat: (g.estado_sat as string) || undefined,
    cfdiValido: g.cfdi_valido != null ? Boolean(g.cfdi_valido) : undefined,
    ocrExtra: (g.ocr_extra as Record<string, unknown>) || undefined,
    imagenUrl: (g.imagen_url as string) || undefined,
  }));
}

/**
 * Primer y último comprobante recibido del viaje — los dos extremos de la
 * línea de tiempo del detalle. Se lee `created_at` (hora de recepción por
 * WhatsApp), no `fecha` (la impresa en el ticket, que el OCR puede leer mal
 * y que no dice cuándo llegó). Cuenta TODOS los gastos del viaje, duplicados
 * incluidos: la pregunta es "cuándo mandó cosas el chofer", no "cuántos
 * cuentan". Si la lectura falla se lanza (fail closed, como todo aquí).
 */
async function ventanaComprobantes(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  viajeId: string,
): Promise<LiquidacionDetalle['comprobantesEntre']> {
  const res = await admin
    .from('gasto')
    .select('created_at')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId)
    .order('created_at', { ascending: true });
  const filas = (exigir(res, 'getLiquidacionDetalle/ventana') ?? []) as Array<{ created_at?: unknown }>;
  const sellos = filas.map((f) => f.created_at).filter((c): c is string => typeof c === 'string');
  return { primero: sellos[0] ?? null, ultimo: sellos[sellos.length - 1] ?? null, n: filas.length };
}

/**
 * Reconstruye la liquidación con el MISMO motor que alimenta al PDF, y saca de
 * ahí las dos cosas que el panel no podía enseñar.
 *
 * **Las tres cubetas.** Cuánto de lo comprobado sobrevive una revisión del SAT
 * es el cálculo que diferencia al producto, y no se persiste: no hay columnas
 * `total_deducible` / `total_no_deducible` / `total_por_confirmar` ni
 * parámetros en `guardar_liquidacion_tx`. El contralor que revisa desde el
 * navegador veía "Comprobado $47,300" y ahí terminaba (auditoría 5, frontend,
 * ALTO 2). Recalcularlas aquí sería la cuarta copia de la lógica del dinero.
 *
 * **Los renglones que SÍ suman el total.** `totalComprobado` excluye los
 * duplicados y los montos ≤ 0, pero el duplicado se persiste igual: el único
 * unique de la base es por `cfdi_uuid` y por `img_hash`, así que dos fotos
 * distintas del mismo ticket de caseta producen dos filas. El panel leía
 * `gasto` directo y pintaba las cuatro: la tarjeta de arriba decía $9,400 y la
 * tabla de abajo sumaba $10,800, con la fila duplicada pintada igual que las
 * demás. En un producto cuyo argumento de venta es "detectamos duplicados"
 * (auditoría 5, frontend, MEDIO 4). El PDF ya lo resolvía con
 * `filasImprimibles`, y su invariante —la suma de las filas es EXACTAMENTE
 * `totalComprobado`— está probada en `liquidacion/omitidos.ts`. Aquí se reusa
 * esa función en vez de repetir el criterio: si cambia en un lado y no en el
 * otro, vuelve el mismo bug.
 *
 * Dos consecuencias buscadas del diseño:
 *
 *  - Si la reconstrucción no cuadra con lo persistido (config del tenant
 *    cambiada, gastos añadidos después del cierre), las cubetas no van a sumar
 *    `totalComprobado` y `filasDeducibilidad` devuelve null: la pantalla se
 *    calla en vez de contradecir a su propio total. Ese portón ya existe y está
 *    probado en `liquidacion/deducibilidad.ts`.
 *  - Si la reconstrucción falla (viaje borrado, lectura caída), el detalle se
 *    sirve igual: sin desglose y con los comprobantes crudos, marcados como
 *    "puede no sumar". Es un extra: no puede tirar la pantalla que el contralor
 *    sí puede leer.
 *
 * EL PORTÓN. Se descarta la reconstrucción entera si su `totalComprobado` no
 * coincide con el que está PERSISTIDO, con un centavo de tolerancia por los
 * redondeos del motor. Sin este portón la pantalla vuelve a contradecirse por
 * el otro lado: medido contra el tenant del demo, la liquidación
 * `VJ-2026-0845` tiene $12,100 guardados y CERO filas en `gasto`, así que la
 * reconstrucción devolvía 0 y el pie de la tabla afirmaba "Total comprobado
 * $12,100.00" debajo de ninguna fila. Es el mismo criterio que ya aplica
 * `filasDeducibilidad`, y por la misma razón.
 */
type FilaImprimibleConFiscal = {
  formaPago?: string; cfdiUuid?: string; estadoSat?: string; cfdiValido?: boolean;
};

async function reconstruir(
  tenantId: string,
  viajeId: string,
  totalPersistido: number,
  diferenciasPersistidas: unknown,
) {
  try {
    const liq = await cuadrarDesdeDB(tenantId, viajeId);
    if (Math.abs(liq.totalComprobado - totalPersistido) > 0.015) return null;
    // ── EL PORTÓN DE ARRIBA NO PUEDE VER UN CAMBIO DE CONFIG ────────────────
    //
    // AUDITORÍA 6, CRÍTICO de frontend. `cuadrarDesdeDB` llama a `getConfig`
    // FRESCO en cada carga, así que el detalle recalcula con la política, el
    // RFC y las vigencias de HOY, no con las del cierre. Y `totalComprobado`
    // —la única cifra que este portón compara— es una suma de montos que no
    // lee ni una clave de `config`: ni política, ni RFC, ni hidrocarburos, ni
    // estímulos. El portón siempre pasa justo cuando lo que cambió es lo que
    // mueve las cubetas.
    //
    // Medido con el motor real, mismo CFDI de diésel de $5,800:
    //   al cerrar (sin RFC de flota)  → deducible 5,800 · por confirmar 0
    //   al reabrir (con RFC ya capturado, distinto del receptor)
    //                                 → deducible 0     · por confirmar 5,800
    //   |totalComprobado1 − totalComprobado2| = 0
    //
    // Y no es de laboratorio: capturar el RFC del cliente es el paso más
    // mundano del alta, y `getConfig` sobrescribe `empresa.rfc` con la columna
    // `tenant.rfc` en CADA llamada. El contralor ya mandó el PDF a su contador
    // citando "$X deducibles"; al reabrir la misma liquidación lee otra cifra,
    // sin marca de que se recalculó ni de cuándo.
    //
    // Las tres cubetas no se persisten (no hay columnas ni parámetros en
    // `guardar_liquidacion_tx`), así que no hay contra qué compararlas. Pero
    // `diferencias` SÍ se persiste, y es justo lo que un cambio de config
    // mueve: en el escenario de arriba pasa de ['anticipo'] a
    // ['rfc_receptor_no_verificable','anticipo']. Comparar los TIPOS detecta la
    // deriva sin tocar el RPC —cambiarle la firma a nueve días del demo es
    // exactamente cómo nació la doble firma que arregla la 0022—.
    //
    // Ante deriva, la pantalla se calla: cae al camino de gastos crudos, que ya
    // se marca como "puede no sumar". Callar es lo que este archivo ya hace
    // cuando no puede sostener una cifra, y contradecir el PDF archivado sin
    // avisar es peor que no enseñar el desglose.
    if (derivoLaConfig(diferenciasPersistidas, liq.diferencias)) return null;
    const { filas, duplicados } = filasImprimibles(liq);
    return {
      deducibilidad: {
        totalDeducible: liq.totalDeducible,
        totalNoDeducible: liq.totalNoDeducible,
        totalPorConfirmar: liq.totalPorConfirmar,
      },
      // El orden se fija AQUÍ y no se hereda: `getGastos` (repo.ts) no lleva
      // `.order()`, así que Postgres puede devolver los comprobantes en
      // distinto orden entre recargas y el contralor ve la tabla barajarse
      // (auditoría 5, frontend, BAJO 2). Mismo criterio que el camino de
      // respaldo —fecha del comprobante, `id` de desempate— para que las dos
      // rutas pinten la misma tabla. Ordenar no mueve ninguna suma.
      filas: [...filas]
        .sort((x, y) => (x.fecha ?? '').localeCompare(y.fecha ?? '') || x.id.localeCompare(y.id))
        .map((g) => {
          // Las filas del motor son `Gasto` completos disfrazados de
          // `FilaImprimible`: se leen los campos de la tabla sin pedirlos a
          // la base otra vez.
          const x = g as FilaImprimibleConFiscal;
          return {
            id: g.id,
            concepto: g.concepto as string,
            monto: Number(g.monto),
            folio: g.folio || undefined,
            fecha: g.fecha || undefined,
            formaPago: x.formaPago || undefined,
            cfdiUuid: x.cfdiUuid || undefined,
            estadoSat: x.estadoSat || undefined,
            cfdiValido: x.cfdiValido,
            ocrExtra: g.ocrExtra,
            imagenUrl: g.imagenUrl,
          };
        }),
      excluidos: duplicados,
    };
  } catch {
    return null;
  }
}

/**
 * ¿El conjunto de TIPOS de diferencia que produce el motor hoy es distinto del
 * que se guardó al cerrar, o cambió el `esperado` de alguno que se repite?
 *
 * Se comparan los tipos como conjunto, no la lista entera: los montos y los
 * textos pueden variar por redondeo o por una leyenda reescrita sin que el
 * veredicto cambie, y saltar por eso dejaría el desglose apagado siempre. Lo
 * que importa es si apareció o desapareció un motivo — `rfc_receptor`,
 * `rfc_receptor_no_verificable`, `efectivo_sobre_tope`, `sin_cfdi`—, que es
 * exactamente la huella que deja un cambio de política, de RFC o de vigencia.
 *
 * AUDITORÍA 8, CRÍTICO: comparar solo el tipo no basta. `viatico_excede_fiscal`
 * se emite siempre que el gasto exceda EL TOPE QUE SEA, así que un ajuste al
 * tope de alimentación del tenant (`estimulos.viaticosTopeFiscalDiarioMxn`,
 * config editable igual que el RFC del hallazgo original) mueve el
 * `totalDeducible` sin mover el conjunto de tipos. `esperado` sí es ese dato:
 * a diferencia de `monto`/`real` (calculados, sujetos a redondeo), `esperado`
 * es el valor de configuración contra el que se compara — `pol.topeMonto`,
 * `input.anticipo`, `topeAlimentacion` — y no varía salvo que la config sí
 * haya cambiado. Se incluye en la llave solo cuando está presente, para no
 * romper los tipos que nunca lo traen.
 *
 * Si lo persistido no es una lista utilizable, NO se declara deriva: una
 * liquidación vieja con `diferencias: null` es un dato que falta, no una
 * contradicción, y apagar el desglose por eso castigaría al camino bueno.
 */
export function derivoLaConfig(
  persistidas: unknown,
  actuales: Array<{ tipo?: string; esperado?: number }>,
): boolean {
  if (!Array.isArray(persistidas)) return false;
  const llaves = (xs: Array<{ tipo?: string; esperado?: number }>) =>
    new Set(
      xs
        .filter((d): d is { tipo: string; esperado?: number } => typeof d?.tipo === 'string')
        .map((d) => (typeof d.esperado === 'number' ? `${d.tipo}:${d.esperado}` : d.tipo)),
    );
  const antes = llaves(persistidas as Array<{ tipo?: string; esperado?: number }>);
  const ahora = llaves(actuales ?? []);
  if (antes.size !== ahora.size) return true;
  for (const t of ahora) if (!antes.has(t)) return true;
  return false;
}

/** Un estado de cuenta (CFDI consolidado) recibido, con el saldo de su
 *  conciliación — la bitácora del Agente de Peajes (F5). */
export interface DesgloseRecibido {
  cfdiXmlId: string;
  /** Los primeros 8 del UUID — suficiente para reconocerlo, sin ocupar media tabla. */
  uuidCorto: string;
  recibido: string | null;
  lineas: number;
  conciliadas: number;
  porConciliar: number;
  sinMatch: number;
  monto: number;
}

/** Los consolidados recibidos, agrupados desde sus líneas. Ventana de las
 *  1,000 líneas MÁS RECIENTES; si una flota la rebasa, los más viejos salen
 *  de esta bitácora — no de la base.
 *
 *  AUDITORÍA DE ESCALA 15k: aquí decía "ventana de 2,000 líneas" sobre un
 *  `.limit(2000)` — y PostgREST aplica min(limit, max_rows), así que la
 *  ventana real siempre fue de 1,000. Peor: SIN `.order()`, esas 1,000 eran
 *  las que Postgres quisiera — la bitácora podía enseñar consolidados viejos
 *  y callarse los recién recibidos. El límite se declara como lo que es y el
 *  orden garantiza que lo que entra a la ventana es lo último. */
export async function getDesglosesRecibidos(tenantId: string, limite = 8): Promise<DesgloseRecibido[]> {
  const res = await supabaseAdmin()
    .from('cfdi_consolidado_linea')
    .select('cfdi_xml_id, estatus, monto, cfdi:cfdi_xml_id(cfdi_uuid, created_at)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1000);
  const filas = exigir(res, 'getDesglosesRecibidos') ?? [];
  const porCfdi = new Map<string, DesgloseRecibido>();
  for (const f of filas) {
    const id = f.cfdi_xml_id as string;
    const rel = f.cfdi as { cfdi_uuid?: string; created_at?: string } | Array<{ cfdi_uuid?: string; created_at?: string }> | null;
    const cfdi = Array.isArray(rel) ? rel[0] : rel;
    const d = porCfdi.get(id) ?? {
      cfdiXmlId: id,
      uuidCorto: (cfdi?.cfdi_uuid ?? id).slice(0, 8).toUpperCase(),
      recibido: cfdi?.created_at ?? null,
      lineas: 0, conciliadas: 0, porConciliar: 0, sinMatch: 0, monto: 0,
    };
    d.lineas += 1;
    d.monto += Number(f.monto ?? 0);
    if (f.estatus === 'conciliada') d.conciliadas += 1;
    else if (f.estatus === 'sin_match') d.sinMatch += 1;
    else d.porConciliar += 1;
    porCfdi.set(id, d);
  }
  return [...porCfdi.values()]
    .map((d) => ({ ...d, monto: round2(d.monto) }))
    .sort((a, b) => Date.parse(b.recibido ?? '1970-01-01') - Date.parse(a.recibido ?? '1970-01-01'))
    .slice(0, limite);
}

export interface ConciliacionConsolidado {
  conciliadas: number;
  porConciliar: number;
  /** Un humano ya la miró y ningún gasto capturado le correspondía —
   *  `estatus = 'sin_match'` (migración 0077). Documentada, cerrada, y NO
   *  cuenta como `porConciliar`: contarla ahí haría que "revisar a mano" no
   *  bajara nunca aunque el contador sí estuviera resolviendo la cola. */
  sinMatch: number;
  /** Cuántos CFDI consolidados distintos aportaron esas líneas — un contador
   *  que ve "12 pendientes" quiere saber si es un XML grande o varios chicos. */
  cfdis: number;
}

/**
 * Resumen de `cfdi_consolidado_linea` (auditoría 10, `intake/consolidado.ts`)
 * para la pantalla de Combustible & Casetas: cuánto del diésel-por-monedero y
 * peaje-por-TAG que YA llegó por WhatsApp quedó ligado solo contra el JOIN,
 * cuánto le toca revisar a un humano, y cuánto un humano ya revisó sin
 * encontrarle gasto (`resolverLineaAMano`, `intake/consolidado.ts`).
 *
 * `null` si el tenant nunca ha mandado un consolidado — no es lo mismo que
 * "0 pendientes": la pantalla debe distinguir "no hay nada que mostrar" de
 * "todavía no existe esta integración para este tenant".
 */
export async function getConciliacionConsolidado(tenantId: string): Promise<ConciliacionConsolidado | null> {
  const filas = await traerTodo<{ estatus: unknown; cfdi_xml_id: unknown }>(
    (desde, hasta) => supabaseAdmin().from('cfdi_consolidado_linea').select('estatus, cfdi_xml_id', conteo(desde))
      .eq('tenant_id', tenantId).order('id').range(desde, hasta),
    'getConciliacionConsolidado',
  );
  if (filas.length === 0) return null;
  const conciliadas = filas.filter((f) => f.estatus === 'conciliada').length;
  const sinMatch = filas.filter((f) => f.estatus === 'sin_match').length;
  const cfdis = new Set(filas.map((f) => f.cfdi_xml_id as string)).size;
  return { conciliadas, porConciliar: filas.length - conciliadas - sinMatch, sinMatch, cfdis };
}

export interface CandidatoLineaConsolidado {
  gastoId: string;
  monto: number;
  fecha: string | null;
  /** Folio del viaje al que pertenece ese gasto candidato — `null` cuando el
   *  gasto ya no existe (borrado) o su viaje no tiene folio capturado. La
   *  pantalla lo enseña para que un contador reconozca el viaje sin tener
   *  que abrir cada gasto ("viaje VJ-104", no un UUID). */
  viajeFolio: string | null;
}

export interface LineaPorConciliar {
  id: string;
  /** El folio fiscal del CFDI consolidado del que salió esta línea. */
  cfdiUuid: string | null;
  /** 1-based, el orden en que apareció en el XML (mig. 0076). */
  indice: number;
  fuente: 'ecc12' | 'concepto_base';
  fecha: string | null;
  monto: number;
  descripcion: string | null;
  estacionRfc: string | null;
  folioOperacion: string | null;
  candidatos: CandidatoLineaConsolidado[];
}

/**
 * La cola real: las líneas de `cfdi_consolidado_linea` que el JOIN automático
 * (`guardarYConciliarConsolidado`) NO pudo ligar solo, enriquecidas con lo que
 * un humano necesita para decidir — el folio fiscal del CFDI y, por cada
 * candidato, el folio del VIAJE al que pertenece (la columna `candidatos` solo
 * guarda `gastoId`/`monto`/`fecha`; el folio se resuelve aquí con dos
 * consultas más, no se duplica en la tabla).
 *
 * `resolverLineaAMano` (`intake/consolidado.ts`) es quien cierra cada línea
 * que esta función lista.
 */
export async function getLineasPorConciliar(tenantId: string): Promise<LineaPorConciliar[]> {
  const filas = await traerTodo<{
    id: unknown; cfdi_xml_id: unknown; indice: unknown; fuente: unknown; fecha: unknown;
    monto: unknown; descripcion: unknown; estacion_rfc: unknown; folio_operacion: unknown;
    candidatos: unknown;
  }>(
    (desde, hasta) => supabaseAdmin().from('cfdi_consolidado_linea')
      .select('id, cfdi_xml_id, indice, fuente, fecha, monto, descripcion, estacion_rfc, folio_operacion, candidatos', conteo(desde))
      .eq('tenant_id', tenantId).eq('estatus', 'por_conciliar')
      .order('created_at').order('id').range(desde, hasta),
    'getLineasPorConciliar',
  );
  if (filas.length === 0) return [];

  type CandidatoCrudo = { gastoId: string; monto: number; fecha: string | null };
  const candidatosPorFila = filas.map((f) => (f.candidatos as CandidatoCrudo[] | null) ?? []);

  const cfdiXmlIds = [...new Set(filas.map((f) => f.cfdi_xml_id as string))];
  const gastoIds = [...new Set(candidatosPorFila.flat().map((c) => c.gastoId))];

  // `traerPorIds` y no un `.in()` directo (auditoría de escala 15k): con miles
  // de líneas pendientes, el `.in()` se recorta a 1,000 en silencio y el
  // humano decide sin saber de qué CFDI o viaje viene cada candidato.
  const filasXml = await traerPorIds(
    cfdiXmlIds,
    (tanda) => supabaseAdmin().from('cfdi_xml').select('id, cfdi_uuid')
      .eq('tenant_id', tenantId).in('id', tanda),
    'getLineasPorConciliar.cfdi_xml',
  );
  const uuidPorXmlId = new Map(filasXml.map((r) => [r.id as string, (r.cfdi_uuid as string) || null]));

  // Los candidatos ya no existen como filas "disponibles" — pueden estar
  // ligados a OTRA línea desde entonces — así que aquí solo se pide su
  // `viaje_id` para el folio; monto y fecha se enseñan del JSON guardado
  // (lo que el JOIN vio en su momento, no lo que el gasto diga hoy).
  let folioPorGastoId = new Map<string, string | null>();
  if (gastoIds.length > 0) {
    const filasGasto = await traerPorIds(
      gastoIds,
      (tanda) => supabaseAdmin().from('gasto').select('id, viaje_id')
        .eq('tenant_id', tenantId).in('id', tanda),
      'getLineasPorConciliar.gasto',
    );
    const viajeIdPorGasto = new Map(filasGasto.map((g) => [g.id as string, (g.viaje_id as string) || null]));

    const viajeIds = [...new Set(filasGasto.map((g) => g.viaje_id as string).filter((v): v is string => !!v))];
    let folioPorViajeId = new Map<string, string | null>();
    if (viajeIds.length > 0) {
      const filasViaje = await traerPorIds(
        viajeIds,
        (tanda) => supabaseAdmin().from('viaje').select('id, folio')
          .eq('tenant_id', tenantId).in('id', tanda),
        'getLineasPorConciliar.viaje',
      );
      folioPorViajeId = new Map(filasViaje.map((v) => [v.id as string, (v.folio as string) || null]));
    }
    folioPorGastoId = new Map(gastoIds.map((gid) => {
      const viajeId = viajeIdPorGasto.get(gid);
      return [gid, viajeId ? (folioPorViajeId.get(viajeId) ?? null) : null];
    }));
  }

  return filas.map((f, i) => ({
    id: f.id as string,
    cfdiUuid: uuidPorXmlId.get(f.cfdi_xml_id as string) ?? null,
    indice: Number(f.indice),
    fuente: f.fuente as 'ecc12' | 'concepto_base',
    fecha: (f.fecha as string) || null,
    monto: Number(f.monto),
    descripcion: (f.descripcion as string) || null,
    estacionRfc: (f.estacion_rfc as string) || null,
    folioOperacion: (f.folio_operacion as string) || null,
    candidatos: candidatosPorFila[i].map((c) => ({
      gastoId: c.gastoId,
      monto: Number(c.monto),
      fecha: c.fecha ?? null,
      viajeFolio: folioPorGastoId.get(c.gastoId) ?? null,
    })),
  }));
}

// ── Detalle de liquidaciones (tabla de Cuadre) ──────────────────────────────
//
// Movida aquí desde `dashboard/cuadre/page.tsx` el 10-ago-2026: vivía como
// función local no exportada dentro de esa página, y al borrarla para el
// rediseño de "dueño de flota" (ver inventario en
// `docs/conocimiento/41-inventario-dueno-flota-pre-rediseno.md`) esta consulta
// se habría perdido en silencio — es la única de las 17 páginas del
// inventario cuya lógica no vivía ya en `lib/likida`.

export interface LiqRow { id: string; folio: string; creadoEn: string; comprobado: number; diferencia: number; estatus: string }

export async function getLiquidaciones(tenantId: string): Promise<LiqRow[]> {
  const { data, error } = await supabaseAdmin()
    .from('liquidacion')
    .select('id, estatus, total_comprobado, diferencia, created_at, viaje:viaje_id(folio)')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(50);
  // supabase-js reporta el fallo POR VALOR: sin este throw, una lectura caída
  // devolvía `[]` y la tabla salía con encabezados y cero filas bajo unos KPIs
  // que decían "12 viajes liquidados" (auditoría 5, frontend, CRÍTICO).
  if (error) throw new Error(`getLiquidaciones: ${error.message}`);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    folio: ((r.viaje as { folio?: string } | null)?.folio) ?? (r.id as string).slice(0, 8),
    creadoEn: r.created_at as string,
    comprobado: Number(r.total_comprobado ?? 0),
    diferencia: Number(r.diferencia ?? 0),
    estatus: r.estatus as string,
  }));
}
