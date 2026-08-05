// ═══════════════════════════════════════════════════════════════════════════
// ANALÍTICA del dashboard — valor que Cuadra otorga con la data capturada.
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
import { round2 } from '@/lib/formato';
import { logger } from '@/lib/logger';

// Los dos bordes de PostgREST (error por valor, y el recorte silencioso a
// 1,000 filas) viven en `pg.ts` desde que `operacion.ts` los necesitó también.
// La explicación larga de POR QUÉ existen está allá, junto al código.
import { exigir, traerTodo, conteo } from './pg';

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

export async function getKpis(tenantId: string, ventanaDias?: number): Promise<DashboardKpis> {
  const corte = corteVentana(ventanaDias);
  const rows = await traerTodo<{ total_comprobado: unknown; diferencia: unknown; estatus: unknown; diferencias: unknown }>(
    (desde, hasta) => {
      const q = supabaseAdmin()
        .from('liquidacion')
        .select('total_comprobado, diferencia, estatus, diferencias')
        .eq('tenant_id', tenantId);
      return (corte ? q.gte('created_at', corte) : q).order('id').range(desde, hasta);
    },
    'getKpis',
  );
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
  const [ops, gastos, viajes] = await Promise.all([
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
  return ops.map((o) => ({
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
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<Array<{ dia: string; valor: number }>> {
  const rows = await traerTodo<{ created_at: unknown }>(
    (desde, hasta) => supabaseAdmin()
      .from('liquidacion')
      .select('created_at')
      .eq('tenant_id', tenantId)
      .order('id')
      .range(desde, hasta),
    'getLiquidacionesPorDia',
  );
  const porDiaMap = new Map<string, number>();
  for (const r of rows) {
    const dia = (r.created_at as string).slice(0, 10);
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

export interface Acreditables {
  /** Litros de diésel elegibles. El estímulo en pesos lo calcula el contador. */
  litrosDiesel: number; ieps: number; iva: number; peaje: number; }

/** Suma de estímulos acreditables del periodo (IEPS diésel + IVA + peaje 50%). */
export async function getAcreditables(tenantId: string, ventanaDias?: number): Promise<Acreditables> {
  const corte = corteVentana(ventanaDias);
  const rows = await traerTodo<{ ieps_acreditable: unknown; iva_acreditable: unknown; peaje_acreditable: unknown; litros_diesel_acreditables: unknown }>(
    (desde, hasta) => {
      const q = supabaseAdmin()
        .from('liquidacion')
        .select('ieps_acreditable, iva_acreditable, peaje_acreditable, litros_diesel_acreditables')
        .eq('tenant_id', tenantId);
      return (corte ? q.gte('created_at', corte) : q).order('id').range(desde, hasta);
    },
    'getAcreditables',
  );
  return {
    ieps: round2(rows.reduce((s, r) => s + Number(r.ieps_acreditable ?? 0), 0)),
    iva: round2(rows.reduce((s, r) => s + Number(r.iva_acreditable ?? 0), 0)),
    peaje: round2(rows.reduce((s, r) => s + Number(r.peaje_acreditable ?? 0), 0)),
    // El IEPS ya no se presenta en pesos —el estímulo es cuota semanal × litros
    // y esa cuota no la tenemos—, así que lo que se entrega es el dato duro.
    litrosDiesel: round2(rows.reduce((s, r) => s + Number(r.litros_diesel_acreditables ?? 0), 0)),
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

/** Los viajes de la flota, el más reciente primero. `viaje` NO tiene columna
 *  de unidad ni de POD (no existen en el esquema), así que la tabla enseña lo
 *  que sí hay — inventar columnas vacías haría ver el producto más completo y
 *  la pantalla más inútil. */
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

export async function getViajes(tenantId: string, limite = 100): Promise<ViajeRow[]> {
  const res = await supabaseAdmin()
    .from('viaje')
    .select('id, folio, origen, destino, estatus, anticipo, fecha_inicio, intake_pendientes, avisado_en, aceptado_en, escalado_en, avisos_enviados, operador:operador_id(nombre)')
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
    avisadoEn: (v.avisado_en as string) || null,
    aceptadoEn: (v.aceptado_en as string) || null,
    escaladoEn: (v.escalado_en as string) || null,
    avisosEnviados: Number(v.avisos_enviados ?? 0),
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

export interface OperadorDetalle {
  operadorId: string; nombre: string; telefono: string | null; numeroEmpleado: string | null;
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
      licencia: unknown; licencia_tipo: unknown; licencia_vence: unknown;
    }>(
      (desde, hasta) => admin.from('operador')
        .select('id, nombre, telefono, numero_empleado, activo, licencia, licencia_tipo, licencia_vence')
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
  diferencias: Array<{ tipo: string; nota: string; monto: number }>;
  /** `ocrExtra` viaja porque la etiqueta del renglón depende del producto
   *  impreso en el ticket: sin él el panel dice "Diésel" donde el PDF dice
   *  "Combustible Magna" (auditoría 5, arquitectura, ALTO 1). */
  gastos: Array<{ concepto: string; monto: number; folio?: string; ocrExtra?: Record<string, unknown>; imagenUrl?: string }>;
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
    .select('id, viaje_id, estatus, total_comprobado, total_anticipo, diferencia, diferencias, ieps_acreditable, litros_diesel_acreditables, iva_acreditable, peaje_acreditable, created_at, pdf_url, viaje:viaje_id(folio, operador_id, operador:operador_id(nombre))')
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
  const viaje = data.viaje as { folio?: string; operador_id?: string; operador?: { nombre?: string } | null } | null;
  return {
    id: data.id as string,
    viajeId: data.viaje_id as string,
    folio: (viaje?.folio) ?? (data.id as string).slice(0, 8),
    operadorId: viaje?.operador_id ?? '',
    operadorNombre: viaje?.operador?.nombre ?? '—',
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
    diferencias: ((data.diferencias as Array<{ tipo: string; nota: string; monto: number }>) ?? []),
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
): Promise<Array<{ concepto: string; monto: number; folio?: string; ocrExtra?: Record<string, unknown>; imagenUrl?: string }>> {
  const res = await admin
    .from('gasto')
    .select('id, concepto, monto, folio, ocr_extra, imagen_url')
    .eq('tenant_id', tenantId)
    .eq('viaje_id', viajeId)
    .order('fecha', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true });
  const filas = exigir(res, 'getLiquidacionDetalle/gastos') ?? [];
  return filas.map((g) => ({
    concepto: g.concepto as string,
    monto: Number(g.monto),
    folio: (g.folio as string) || undefined,
    ocrExtra: (g.ocr_extra as Record<string, unknown>) || undefined,
    imagenUrl: (g.imagen_url as string) || undefined,
  }));
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
        .map((g) => ({
          concepto: g.concepto as string,
          monto: Number(g.monto),
          folio: g.folio || undefined,
          ocrExtra: g.ocrExtra,
        })),
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

export interface ConciliacionConsolidado {
  conciliadas: number;
  porConciliar: number;
  /** Cuántos CFDI consolidados distintos aportaron esas líneas — un contador
   *  que ve "12 pendientes" quiere saber si es un XML grande o varios chicos. */
  cfdis: number;
}

/**
 * Resumen de `cfdi_consolidado_linea` (auditoría 10, `intake/consolidado.ts`)
 * para la pantalla de Combustible & Casetas: cuánto del diésel-por-monedero y
 * peaje-por-TAG que YA llegó por WhatsApp quedó ligado solo contra el JOIN, y
 * cuánto le toca revisar a un humano.
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
  const cfdis = new Set(filas.map((f) => f.cfdi_xml_id as string)).size;
  return { conciliadas, porConciliar: filas.length - conciliadas, cfdis };
}
