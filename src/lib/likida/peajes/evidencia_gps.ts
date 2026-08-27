import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '../presupuesto';
import { traerTodo, traerPorIds, conteo } from '../pg';

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCIA GPS DE LOS CRUCES DE PEAJE — el "martirio" de Innovativos.
//
// El conciliador v1 (0106/desglose_peaje.ts) contesta "¿este cruce del
// proveedor coincide con un gasto de caseta de un viaje?". Esta pieza añade
// la pregunta que Innovativos hoy contesta a mano contra su GPS cada 10
// días: "¿la UNIDAD de ese viaje de verdad anduvo en carretera el día del
// cruce?" — con las posiciones que el conector GPS (Samsara/Wialon/Geotab/
// Navixy, o el pin de WhatsApp) ya escribe en `posicion`.
//
// ── LO QUE ESTA V1 AFIRMA Y LO QUE NO (léelo antes de ampliar) ─────────────
//
// SÍ afirma: «hay N posiciones de esa unidad el día del cruce» (evidencia a
// favor) o «no hay ninguna» (hueco de datos, CON su motivo exacto).
//
// NO afirma «la unidad estuvo LEJOS de la caseta» — la cubeta
// "inconsistente" del diseño (tag prestado/clonado) EXIGE la posición de la
// caseta, y no existe catálogo oficial con lat/lng de plazas de cobro
// (ficha `normas/red-nacional-autopistas.yaml`: el shapefile del IMT con
// 1,376 plazas es el camino, con su trampa de ID_PLAZA documentada). Ese es
// el escalón espacial siguiente, no esta oleada: acusar una inconsistencia
// con evidencia a medias es el error que este repo no comete.
//
// La ventana es EL DÍA, no ±minutos: la 0106 descarta la hora del cruce al
// parsear a propósito ("guardarla aparentaría una precisión que el cruce no
// usa") — mientras esa decisión siga, la evidencia se mide por día de
// México. El día del CRUCE, sin ±1: la fecha de la línea es la que el
// proveedor declara para el paso por caseta; el ±1 del conciliador es para
// casar contra `gasto.fecha` (otro dato, otra tolerancia).
//
// FAIL-CLOSED en las dos direcciones: sin unidad resoluble o sin posiciones
// no se afirma NADA negativo sobre el cruce — se dice cuál dato falta.
// ═══════════════════════════════════════════════════════════════════════════

/** Por qué una línea no tiene evidencia GPS. Cada motivo es accionable:
 *  dice exactamente qué dato falta y de quién depende conseguirlo. */
export type MotivoSinEvidencia =
  /** La línea no trae fecha legible — sin día no hay contra qué mirar. */
  | 'sin_fecha'
  /** La línea no cuadró contra ningún viaje: no se sabe qué unidad la cruzó. */
  | 'sin_viaje'
  /** El viaje existe pero no tiene unidad asignada. */
  | 'viaje_sin_unidad'
  /** Unidad conocida y CERO posiciones ese día: GPS sin conectar, o hueco. */
  | 'sin_posiciones_dia';

export type EvidenciaGpsLinea =
  | { estatus: 'con_evidencia'; posicionesDia: number }
  | { estatus: 'sin_evidencia'; motivo: MotivoSinEvidencia };

export interface LineaParaEvidencia {
  id: string;
  /** ISO YYYY-MM-DD del cruce, como la guarda la 0106. */
  fecha: string | null;
  viajeId: string | null;
}

/** `${unidadId}|${fecha}` → conteo. La llave compuesta evita un mapa anidado. */
export const llaveUnidadDia = (unidadId: string, fecha: string): string => `${unidadId}|${fecha}`;

/**
 * Clasifica una línea del desglose contra la evidencia GPS disponible. PURA:
 * las posiciones llegan ya contadas (RPC 0205) y la resolución viaje→unidad
 * ya hecha — así las pruebas cubren cada rama sin base de por medio.
 */
export function evidenciaDeLinea(
  linea: LineaParaEvidencia,
  unidadPorViaje: ReadonlyMap<string, string | null>,
  posicionesPorUnidadDia: ReadonlyMap<string, number>,
): EvidenciaGpsLinea {
  if (!linea.fecha) return { estatus: 'sin_evidencia', motivo: 'sin_fecha' };
  if (!linea.viajeId) return { estatus: 'sin_evidencia', motivo: 'sin_viaje' };
  const unidadId = unidadPorViaje.get(linea.viajeId) ?? null;
  if (!unidadId) return { estatus: 'sin_evidencia', motivo: 'viaje_sin_unidad' };
  const n = posicionesPorUnidadDia.get(llaveUnidadDia(unidadId, linea.fecha)) ?? 0;
  if (n > 0) return { estatus: 'con_evidencia', posicionesDia: n };
  return { estatus: 'sin_evidencia', motivo: 'sin_posiciones_dia' };
}

export interface ResumenEvidenciaGps {
  /** Total de líneas evaluadas (todas las del desglose, no solo las visibles). */
  total: number;
  conEvidencia: number;
  sinEvidencia: number;
  /** El desglose del hueco, motivo por motivo — para que el contralor sepa
   *  si le falta conectar el GPS o le faltan viajes conciliados. */
  porMotivo: Record<MotivoSinEvidencia, number>;
}

export function resumirEvidencia(clasificadas: ReadonlyArray<EvidenciaGpsLinea>): ResumenEvidenciaGps {
  const porMotivo: Record<MotivoSinEvidencia, number> = {
    sin_fecha: 0, sin_viaje: 0, viaje_sin_unidad: 0, sin_posiciones_dia: 0,
  };
  let conEvidencia = 0;
  for (const c of clasificadas) {
    if (c.estatus === 'con_evidencia') conEvidencia++;
    else porMotivo[c.motivo]++;
  }
  return {
    total: clasificadas.length,
    conEvidencia,
    sinEvidencia: clasificadas.length - conEvidencia,
    porMotivo,
  };
}

export interface EvidenciaGpsDesglose {
  resumen: ResumenEvidenciaGps;
  /** id de línea → su evidencia, para anotar las líneas visibles del panel. */
  porLinea: Map<string, EvidenciaGpsLinea>;
}

export interface ContextoEvidenciaGps {
  unidadPorViaje: Map<string, string | null>;
  /** `llaveUnidadDia(unidad, fecha)` → conteo de posiciones ese día MX. */
  posicionesPorUnidadDia: Map<string, number>;
}

/**
 * El contexto que la clasificación necesita: viaje→unidad y el agregado de
 * posiciones (RPC 0205) para el rango de días de las líneas. Compartido entre
 * el panel (`evidenciaGpsDeDesglose`) y la bitácora RMF 9.1.8 — una sola
 * resolución, no dos que se separen en silencio.
 *
 * Lanza ante error de base, por la misma razón que el llamador: un contexto a
 * medias produce "sin evidencia" falsos.
 */
export async function contextoEvidenciaGps(
  tenantId: string,
  lineas: ReadonlyArray<{ fecha: string | null; viajeId: string | null }>,
): Promise<ContextoEvidenciaGps> {
  const admin = supabaseAdmin();

  // viaje → unidad, solo de los viajes que las líneas referencian.
  // `traerPorIds`: un `.in()` con miles de viajes se recorta a 1,000 en
  // silencio y además viaja en la URL (ver pg.ts) — y un mapa recortado aquí
  // produce `viaje_sin_unidad` FALSOS, el hueco que este módulo no inventa.
  const viajeIds = [...new Set(lineas.map((l) => l.viajeId).filter((v): v is string => !!v))];
  const unidadPorViaje = new Map<string, string | null>();
  if (viajeIds.length > 0) {
    const data = await traerPorIds<{ id: unknown; unidad_id: unknown }>(
      viajeIds,
      (tanda) => acotada(
        admin.from('viaje').select('id, unidad_id').eq('tenant_id', tenantId).in('id', tanda),
        'evidencia_gps.viajes',
      ),
      'evidencia_gps.viajes',
    );
    for (const v of data) unidadPorViaje.set(String(v.id), (v.unidad_id as string | null) ?? null);
  }

  // El rango de días y las unidades involucradas → el agregado (0205), paginado
  // con `traerTodo`: `max_rows` también recorta lo que devuelve un RPC, y
  // unidades×días crece más allá de 1,000 sin avisar. El desempate del cursor
  // es (unidad_id, dia) — la llave del GROUP BY, única por construcción. Sin
  // unidades o sin fechas no hay nada que contar y el mapa queda vacío: cada
  // línea cae a su motivo exacto.
  const fechas = lineas.map((l) => l.fecha).filter((f): f is string => !!f).sort();
  const unidades = [...new Set([...unidadPorViaje.values()].filter((u): u is string => !!u))];
  const posicionesPorUnidadDia = new Map<string, number>();
  if (fechas.length > 0 && unidades.length > 0) {
    const filas = await traerTodo<{ unidad_id: unknown; dia: unknown; n: unknown }>(
      (d, h) => acotada(
        admin.rpc('posiciones_por_unidad_dia', {
          p_tenant: tenantId,
          p_unidades: unidades,
          p_desde: fechas[0],
          p_hasta: fechas[fechas.length - 1],
        }, conteo(d)).order('unidad_id').order('dia').range(d, h),
        'evidencia_gps.posiciones',
      ),
      'evidencia_gps.posiciones',
    );
    for (const f of filas) {
      posicionesPorUnidadDia.set(llaveUnidadDia(String(f.unidad_id), String(f.dia).slice(0, 10)), Number(f.n));
    }
  }
  return { unidadPorViaje, posicionesPorUnidadDia };
}

/**
 * La evidencia GPS de TODAS las líneas de un desglose. Recalculable a
 * voluntad (misma filosofía que el conciliador: es una anotación sobre el
 * archivo del proveedor, no escribe en `gasto` ni en nada fiscal — de hecho
 * no escribe NADA: se computa al leer).
 *
 * Lanza ante error de base: un resumen a medias diría "sin evidencia" de
 * cruces que sí la tienen, y ese falso hueco es exactamente lo que el
 * contralor no debe ver. El llamador (page.tsx) lo envuelve en su `safe()`.
 */
export async function evidenciaGpsDeDesglose(tenantId: string, desgloseId: string): Promise<EvidenciaGpsDesglose> {
  const admin = supabaseAdmin();

  const filas = await traerTodo<{ id: unknown; fecha: unknown; viaje_id: unknown }>(
    (d, h) => acotada(admin
      .from('desglose_peaje_linea')
      .select('id, fecha, viaje_id', conteo(d))
      .eq('tenant_id', tenantId)
      .eq('desglose_id', desgloseId)
      .order('indice').order('id')
      .range(d, h), 'evidencia_gps.lineas'),
    'evidencia_gps.lineas',
  );
  const lineas: LineaParaEvidencia[] = filas.map((f) => ({
    id: String(f.id),
    fecha: (f.fecha as string | null) ?? null,
    viajeId: (f.viaje_id as string | null) ?? null,
  }));

  const { unidadPorViaje, posicionesPorUnidadDia } = await contextoEvidenciaGps(tenantId, lineas);

  const porLinea = new Map<string, EvidenciaGpsLinea>();
  const clasificadas: EvidenciaGpsLinea[] = [];
  for (const l of lineas) {
    const e = evidenciaDeLinea(l, unidadPorViaje, posicionesPorUnidadDia);
    porLinea.set(l.id, e);
    clasificadas.push(e);
  }
  return { resumen: resumirEvidencia(clasificadas), porLinea };
}
