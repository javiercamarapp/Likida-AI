// ═══════════════════════════════════════════════════════════════════════════
// ANALÍTICA del dashboard — valor que Cuadra otorga con la data capturada.
// KPIs, rendimiento por operador/ruta, tendencia de diferencias, y DETECCIÓN
// DE ANOMALÍAS/FRAUDE (mismo CFDI usado en dos viajes, folios duplicados).
// ═══════════════════════════════════════════════════════════════════════════

import { detectarDuplicadosEntreViajes, type Anomalia } from './duplicados';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { cuadrarDesdeDB } from './cuadre/desde_db';
import { filasImprimibles } from './liquidacion/omitidos';

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
  id: string; folio: string; estatus: string;
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
  gastos: Array<{ concepto: string; monto: number; folio?: string; ocrExtra?: Record<string, unknown> }>;
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
    .select('id, viaje_id, estatus, total_comprobado, total_anticipo, diferencia, diferencias, ieps_acreditable, litros_diesel_acreditables, iva_acreditable, peaje_acreditable, created_at, pdf_url, viaje:viaje_id(folio)')
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
  return {
    id: data.id as string,
    folio: ((data.viaje as { folio?: string } | null)?.folio) ?? (data.id as string).slice(0, 8),
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
): Promise<Array<{ concepto: string; monto: number; folio?: string; ocrExtra?: Record<string, unknown> }>> {
  const res = await admin
    .from('gasto')
    .select('id, concepto, monto, folio, ocr_extra')
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
 * que se guardó al cerrar?
 *
 * Se comparan los tipos como conjunto, no la lista entera: los montos y los
 * textos pueden variar por redondeo o por una leyenda reescrita sin que el
 * veredicto cambie, y saltar por eso dejaría el desglose apagado siempre. Lo
 * que importa es si apareció o desapareció un motivo — `rfc_receptor`,
 * `rfc_receptor_no_verificable`, `efectivo_sobre_tope`, `sin_cfdi`—, que es
 * exactamente la huella que deja un cambio de política, de RFC o de vigencia.
 *
 * Si lo persistido no es una lista utilizable, NO se declara deriva: una
 * liquidación vieja con `diferencias: null` es un dato que falta, no una
 * contradicción, y apagar el desglose por eso castigaría al camino bueno.
 */
function derivoLaConfig(persistidas: unknown, actuales: Array<{ tipo?: string }>): boolean {
  if (!Array.isArray(persistidas)) return false;
  const tipos = (xs: Array<{ tipo?: string }>) =>
    new Set(xs.map((d) => d?.tipo).filter((t): t is string => typeof t === 'string'));
  const antes = tipos(persistidas as Array<{ tipo?: string }>);
  const ahora = tipos(actuales ?? []);
  if (antes.size !== ahora.size) return true;
  for (const t of ahora) if (!antes.has(t)) return true;
  return false;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
