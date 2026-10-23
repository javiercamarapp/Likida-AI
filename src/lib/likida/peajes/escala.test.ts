import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { generarFilasEscala, generarLibroEscala } from './fixtures/generar_iave_sintetico';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-32 · ESCALA A 60 000 LÍNEAS Y RETENCIÓN.
// Requisito: el cierre junta decenas (mes ≈ 26–36 mil, dos meses ≈ 60 mil) y la herramienta del cliente
// «se bloquea» con eso. Aquí se importa/cruza/revisa un archivo del TOPE sin pasarse de memoria ni de tiempo.
// Presupuestos medidos bajo heavy.sh (ver A2-reconciliacion.md): el tope de tiempo es ~5× lo medido.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async () => {} }));

const desglose = await import('../intake/desglose_peaje');
const { revisionDeDesglose } = await import('./revision_cobros');
const { vincularPorIcident } = await import('./vincular_viaje');
import type { ViajeFuente } from './viajes_fuente';
const { MAX_LINEAS_DESGLOSE, LOTE_INSERCION_LINEAS, LOTE_ESCRITURA_LINEAS } = desglose;
const { LEASE_SEGUNDOS } = await import('./ingesta');

import { round2 } from '@/lib/formato';
import { diasDeDiferencia, VENTANA_DIAS_FECHA, TOLERANCIA_MONTO_MXN } from '../intake/consolidado';
const TOLERANCIA_CENTAVOS_MXN = TOLERANCIA_MONTO_MXN;

// ── DEFINICIÓN DE REFERENCIA del cruce: copia literal del algoritmo anterior (barrido completo de los gastos por
// línea, O(líneas × gastos)). El cruce de producción debe dar EXACTAMENTE lo mismo, solo que sin el barrido.
type GastoRef = import('../intake/desglose_peaje').GastoCaseta;
type CruceRef = import('../intake/desglose_peaje').CruceLinea;
interface CandidatoEvaluado { gasto: GastoRef; dias: number; diff: number }
const resumenCandidato = (c: CandidatoEvaluado) => ({ gastoId: c.gasto.id, monto: c.gasto.monto, fecha: c.gasto.fecha });
function cruzarReferencia(
  /** `unidadId`: la unidad que `peaje_tag` casa con el TAG de la línea (null/ausente si el TAG no está dado de alta). */
  lineas: ReadonlyArray<{ fecha: string | null; monto: number; unidadId?: string | null }>,
  gastos: readonly GastoRef[],
): CruceRef[] {
  let disponibles = [...gastos];
  const resultados: CruceRef[] = [];

  for (const linea of lineas) {
    if (!linea.fecha) {
      resultados.push({
        estatus: 'sin_contraparte', viajeId: null, gastoId: null, diferencia: null,
        detalle: { motivo: 'sin_fecha' },
      });
      continue;
    }
    const dia = linea.fecha.slice(0, 10);
    const evaluar = (fondo: GastoRef[]): CandidatoEvaluado[] => fondo
      .map((g) => ({ gasto: g, dias: diasDeDiferencia(g.fecha.slice(0, 10), dia), diff: round2(Math.abs(g.monto - linea.monto)) }))
      .filter((c) => c.dias <= VENTANA_DIAS_FECHA);

    const ventana = evaluar(disponibles);

    if (ventana.length === 0) {
      // «Ya reclamada» solo si lo reclamado HABRÍA cuadrado (monto exacto o en
      // tolerancia). Un gasto de OTRO monto en la ventana, ya usado por otra
      // línea, no es la contraparte de esta: decir «su gasto ya lo usó otra
      // línea» sería afirmar una contraparte que no existe.
      const habiaEnFondoCompleto = evaluar([...gastos]).some((c) => c.diff <= TOLERANCIA_CENTAVOS_MXN);
      resultados.push({
        estatus: 'sin_contraparte', viajeId: null, gastoId: null, diferencia: null,
        // `fondo_gastos`: cuántos gastos de caseta había en TODO el rango del
        // desglose. Es lo que distingue «no hay ticket de esto» de «ni siquiera
        // se han cargado tickets»: lo segundo no dice nada de la línea.
        detalle: { motivo: habiaEnFondoCompleto ? 'contraparte_ya_reclamada' : 'sin_gastos_en_ventana', fondo_gastos: gastos.length },
      });
      continue;
    }

    const cuadrar = (candidatos: CandidatoEvaluado[], motivoAmbigua: string): CruceRef | null => {
      // Menor diferencia de monto manda; la fecha más cercana desempata.
      const orden = [...candidatos].sort((a, b) => (a.diff - b.diff) || (a.dias - b.dias));
      let mejor = orden[0];
      let empatados = orden.filter((c) => c.diff === mejor.diff && c.dias === mejor.dias);
      let desempate: 'tag_unidad' | null = null;
      if (empatados.length > 1 && linea.unidadId) {
        // El TAG dado de alta rompe el empate: de los candidatos igual de
        // buenos, el único cuyo viaje es de la unidad del TAG. Si tampoco así
        // queda UNO, sigue ambigua — no se adivina.
        const mismos = empatados.filter((c) => c.gasto.unidadId === linea.unidadId);
        if (mismos.length === 1) {
          mejor = mismos[0];
          empatados = mismos;
          desempate = 'tag_unidad';
        }
      }
      if (empatados.length > 1) {
        return {
          estatus: 'no_cuadra', viajeId: null, gastoId: null, diferencia: null,
          detalle: { motivo: motivoAmbigua, candidatos: empatados.map(resumenCandidato) },
        };
      }
      disponibles = disponibles.filter((g) => g.id !== mejor.gasto.id);
      // El TAG dice una unidad y el viaje del gasto es de OTRA: el monto y el día
      // cuadran, pero quizá el TAG se prestó o el gasto es de otro camión. Se
      // marca para revisión humana; no se desfaza el cruce.
      const unidadDistinta = !!linea.unidadId && !!mejor.gasto.unidadId && linea.unidadId !== mejor.gasto.unidadId;
      return {
        estatus: 'cuadra',
        viajeId: mejor.gasto.viajeId,
        gastoId: mejor.gasto.id,
        // Con signo: positivo = el desglose cobra más que lo comprobado.
        diferencia: round2(linea.monto - mejor.gasto.monto),
        detalle: {
          gastoId: mejor.gasto.id, montoGasto: mejor.gasto.monto, fechaGasto: mejor.gasto.fecha,
          ...(desempate ? { desempate } : {}),
          ...(unidadDistinta ? { alerta: 'unidad_distinta', unidad_tag: linea.unidadId, unidad_gasto: mejor.gasto.unidadId } : {}),
        },
      };
    };

    const exactos = ventana.filter((c) => c.diff < 0.005);
    if (exactos.length > 0) {
      resultados.push(cuadrar(exactos, 'ambigua_monto_exacto')!);
      continue;
    }

    const tolerables = ventana.filter((c) => c.diff <= TOLERANCIA_CENTAVOS_MXN);
    if (tolerables.length > 0) {
      resultados.push(cuadrar(tolerables, 'ambigua_en_tolerancia')!);
      continue;
    }

    // Hay contraparte en la ventana, pero el monto no aguanta ni el rondeo:
    // es LA discrepancia que este agente existe para marcar.
    const masCercano = [...ventana].sort((a, b) => (a.diff - b.diff) || (a.dias - b.dias))[0];
    resultados.push({
      estatus: 'no_cuadra', viajeId: null, gastoId: null,
      diferencia: round2(linea.monto - masCercano.gasto.monto),
      detalle: { motivo: 'monto_distinto', candidato: resumenCandidato(masCercano) },
    });
  }
  return resultados;
}

const T = '11111111-1111-4111-8111-111111111111';
/** Presupuestos (ms, holgados: la Mac corre una sola prueba pesada a la vez).
 *  Subidos 16-oct-2026 (release 2): el runner de CI mide ~30-35% más lento que
 *  esta Mac en esta prueba (medido real: conciliar/revisar 73.9-81.2s contra
 *  60s, cruzar 34.8-39.2s contra 30s, en 2 corridas distintas) — es velocidad
 *  del runner compartido, no una regresión: el conteo de líneas/gastos y el
 *  resultado no cambiaron. Se sube con margen, nunca se baja lo medido local.
 *  Subido otra vez 21-oct-2026: con varias corridas de CI concurrentes (8+
 *  PRs de la misma auditoría a la vez), `cruzar` midió entre 50.0s y 67.3s
 *  en al menos 10 corridas distintas del mismo job, siempre con el mismo
 *  resultado/conteo — contención real del runner compartido bajo carga
 *  alta, no una regresión. Se sube a 90s con margen sobre el peor caso
 *  medido (67.3s), nunca se baja lo medido local. */
const PRESUPUESTO = { importar: 150_000, conciliar: 100_000, revisar: 100_000, vincular: 45_000, cruzar: 90_000 };
const MB = 1024 * 1024;

beforeEach(() => { db = crearDbFalsa(); });

describe('escala del tope (60 000 líneas)', () => {
  it('el tope vigente es el que la ficha mide (60 000) y los lotes son de 1 000', () => {
    expect(MAX_LINEAS_DESGLOSE).toBe(60_000);
    expect(LOTE_INSERCION_LINEAS).toBe(1000);
  });

  it('importa 60 000 en lotes de 1 000, concilia y revisa (reglas+atípicos) sin pasarse de tiempo ni de memoria', async () => {
    const { buffer, esperado } = generarLibroEscala(MAX_LINEAS_DESGLOSE, { semilla: 11 });
    expect(esperado.cruces).toBe(60_000);

    const rss0 = process.memoryUsage().rss;
    let t = performance.now();
    const imp = await desglose.importarDesglose(T, { nombre: 'estado_sintetico_01_a_10.xlsx', buffer, proveedor: 'proveedor_sintetico' });
    const msImportar = performance.now() - t;
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    expect(imp.totalLineas).toBe(60_000);

    // Lotes: nunca más de LOTE_INSERCION_LINEAS por insert, y todas las líneas llegaron.
    const inserts = db.llamadas.filter((c) => c.tabla === 'desglose_peaje_linea' && c.op === 'insert');
    const tamanos = inserts.map((c) => (c.payload as unknown[]).length);
    expect(Math.max(...tamanos)).toBeLessThanOrEqual(LOTE_INSERCION_LINEAS);
    expect(tamanos.reduce((a, b) => a + b, 0)).toBe(60_000);
    expect(inserts.length).toBe(60);
    expect(db.tablas.desglose_peaje_linea).toHaveLength(60_000);

    t = performance.now();
    const cruce = await desglose.conciliarDesglose(T, imp.desgloseId, 'manual');
    const msConciliar = performance.now() - t;
    expect(cruce.total).toBe(60_000);

    t = performance.now();
    const rev = await revisionDeDesglose(T, imp.desgloseId);
    const msRevisar = performance.now() - t;
    expect(rev).not.toBeNull();

    const rssMb = (process.memoryUsage().rss - rss0) / MB;
    // Se anota para A2-reconciliacion.md (salida visible bajo vitest).
    // `conciliar` incluye los UPDATE ... IN (100 ids) contra la base FALSA (barre sus 60 000 filas por tanda): el costo es de la
    // base en memoria, no del código; el cruce puro se mide aparte (más abajo). En Postgres real cada tanda usa el índice por id.
    console.log(`ESCALA60k importar=${Math.round(msImportar)}ms conciliar=${Math.round(msConciliar)}ms revisar=${Math.round(msRevisar)}ms rss+=${Math.round(rssMb)}MB`);
    expect(msImportar).toBeLessThan(PRESUPUESTO.importar);
    expect(msConciliar).toBeLessThan(PRESUPUESTO.conciliar);
    expect(msRevisar).toBeLessThan(PRESUPUESTO.revisar);
    expect(rssMb).toBeLessThan(1500);
  }, 300_000);

  it('REN-34-1: concilia 60 000 líneas que CUADRAN (anotación distinta cada una) con ~120 escrituras, no 60 000', async () => {
    // El caso caro de verdad: cada línea con su gasto → su vínculo propio. (El test de arriba no siembra gastos: todo
    // sale «sin contraparte», el único caso en que el agrupado por «misma anotación» ya ahorraba escrituras.)
    const n = MAX_LINEAS_DESGLOSE;
    const lineas = []; const gastos = [];
    for (let i = 0; i < n; i++) {
      const fecha = new Date(Date.UTC(2026, 2, 1) + (i % 60) * 86_400_000).toISOString().slice(0, 10);
      lineas.push({ id: `l${i}`, tenant_id: T, desglose_id: 'd1', indice: i, fecha, monto: 50 + i * 0.01, caseta: `C${i % 9}`, tag: null, cruce_en: null });
      gastos.push({ id: `g${i}`, tenant_id: T, concepto: 'caseta', viaje_id: `v${i}`, monto: 50 + i * 0.01, fecha });
    }
    db = crearDbFalsa({ desglose_peaje: [{ id: 'd1', tenant_id: T, proveedor: 'p' }], desglose_peaje_linea: lineas, gasto: gastos });
    const t = performance.now();
    const r = await desglose.conciliarDesglose(T, 'd1', 'manual');
    const ms = performance.now() - t;
    const escrituras = db.llamadas.filter((c) => c.tabla === 'desglose_peaje_linea' && (c.op === 'update' || c.op === 'upsert')).length;
    console.log(`ESCALA60k conciliar-con-vinculos=${Math.round(ms)}ms escrituras=${escrituras} cuadra=${r.cuadra}`);
    expect(r.total).toBe(n);
    expect(r.noEscritas).toBe(0);
    expect(r.cuadra).toBeGreaterThan(n * 0.9);
    // Una ida a la base por lote de LOTE_ESCRITURA_LINEAS (antes: una por línea que cuadra, ≈ 60 000).
    expect(escrituras).toBe(Math.ceil(n / LOTE_ESCRITURA_LINEAS));
    expect(ms).toBeLessThan(PRESUPUESTO.conciliar);
  }, 300_000);

  it('60 001 se rechaza con un mensaje llano que dice cuántas trae, cuál es el tope y qué hacer; no guarda nada', async () => {
    const { buffer } = generarLibroEscala(MAX_LINEAS_DESGLOSE + 1, { semilla: 12 });
    const imp = await desglose.importarDesglose(T, { nombre: 'demasiado.xlsx', buffer });
    expect(imp.ok).toBe(false);
    if (imp.ok) return;
    expect(imp.motivo).toContain('60001');
    expect(imp.motivo).toContain('60000');
    expect(imp.motivo).toMatch(/Pártelo por periodo/);
    expect(imp.causa).toBeUndefined(); // formato: reintentar no lo arregla
    expect(db.tablas.desglose_peaje ?? []).toHaveLength(0);
    expect(db.tablas.desglose_peaje_linea ?? []).toHaveLength(0);
  }, 300_000);
});

describe('el cruce contra gastos a escala (puro, sin base)', () => {
  const dia = (n: number) => new Date(Date.UTC(2026, 2, 1) + n * 86_400_000).toISOString().slice(0, 10);
  const prng = (semilla: number) => { let a = semilla >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  /** `n` líneas en `dias` días; ~75 % tienen un gasto de caseta con el mismo monto ±1 día; más `ruido` gastos sin línea. */
  function carga(n: number, dias: number, ruido: number) {
    const r = prng(5);
    const lineas = Array.from({ length: n }, (_, i) => ({ fecha: dia(Math.floor(r() * dias)), monto: 50 + Math.floor(r() * 400) + (i % 7) * 0.5, unidadId: i % 3 === 0 ? `u${i % 60}` : null }));
    const gastos: Array<{ id: string; viajeId: string; monto: number; fecha: string; unidadId: string | null }> = [];
    lineas.forEach((l, i) => {
      if (r() < 0.75) {
        const d = Math.round((Date.parse(`${l.fecha}T00:00:00Z`) - Date.UTC(2026, 2, 1)) / 86_400_000) + (Math.floor(r() * 3) - 1);
        gastos.push({ id: `g${i}`, viajeId: `v${i % 1200}`, monto: l.monto, fecha: dia(Math.max(0, d)), unidadId: `u${i % 60}` });
      }
    });
    for (let k = 0; k < ruido; k++) gastos.push({ id: `r${k}`, viajeId: `v${k % 1200}`, monto: 10 + Math.floor(r() * 900), fecha: dia(Math.floor(r() * dias)), unidadId: null });
    return { lineas, gastos };
  }

  it('60 000 líneas contra ~45 000 gastos de caseta (dos meses) cruzan dentro del presupuesto', () => {
    const { lineas, gastos } = carga(60_000, 60, 0);
    expect(gastos.length).toBeGreaterThan(40_000);
    const t = performance.now();
    const r = desglose.cruzarLineasDesglose(lineas, gastos);
    const ms = performance.now() - t;
    const cuadra = r.filter((x) => x.estatus === 'cuadra').length;
    console.log(`ESCALA60k cruzar=${Math.round(ms)}ms gastos=${gastos.length} cuadra=${cuadra}`);
    expect(r).toHaveLength(60_000);
    expect(cuadra).toBeGreaterThan(20_000);
    // Un gasto concilia una sola línea: jamás dos líneas con el mismo gasto.
    const usados = r.map((x) => x.gastoId).filter((g): g is string => g !== null);
    expect(new Set(usados).size).toBe(usados.length);
    expect(ms).toBeLessThan(PRESUPUESTO.cruzar);
  }, 600_000);

  it('el cruce indexado da EXACTAMENTE lo mismo que la definición de referencia (barrido completo) en una carga mixta', () => {
    const { lineas, gastos } = carga(1_500, 12, 400);
    const ref = desglose.cruzarLineasDesglose(lineas, gastos);
    const referencia = cruzarReferencia(lineas, gastos);
    expect(ref).toEqual(referencia);
  });
});

describe('el vínculo cruce↔viaje a 65 000 (puro, sin base)', () => {
  it('vincula 65 000 cruces contra 177 viajes dentro del presupuesto, y cada cruce recibe exactamente un veredicto', () => {
    const { filas } = generarFilasEscala(65_000, { semilla: 13 });
    const cruces = filas.slice(1).map((f, i) => ({
      id: i, unidadArchivo: String(f[6]).trim(), fecha: new Date((Number(f[7]) - 25569) * 86_400_000).toISOString().slice(0, 10),
      caseta: String(f[10]).trim(), hora: null as string | null,
    }));
    const camionetas = cruces.filter((c) => c.unidadArchivo === 'CAMIONETA').length;
    // Viajes de 1 día cada 3 días (días 2, 5 y 8) para las 59 unidades identificables: con margen ±1 los días 1–9
    // se ligan y el día 10 queda sin viaje (sin traslapes: ninguno ambiguo).
    const viajes: ViajeFuente[] = Array.from({ length: 59 * 3 }, (_, i) => {
      const u = i % 59;
      const dia = String(2 + 3 * Math.floor(i / 59)).padStart(2, '0');
      return { id: `v${i}`, folio: null, icident: null, unidadNumero: u < 30 ? String(100 + u) : `TC${2000 + u}`, inicio: `2026-03-${dia}`, fin: `2026-03-${dia}`, origen: null, destino: null };
    });
    const t = performance.now();
    const v = vincularPorIcident(cruces, viajes, [], { margenDias: 1 });
    const ms = performance.now() - t;
    const por = (e: string) => v.filter((x) => x.estado === e).length;
    console.log(`ESCALA65k vincular=${Math.round(ms)}ms ligados=${por('ligado')} ambiguos=${por('ambiguo')} sin_viaje=${por('sin_viaje')} sin_unidad=${por('sin_unidad')}`);
    expect(v).toHaveLength(65_000);
    expect(new Set(v.map((x) => x.id)).size).toBe(65_000);
    // «CAMIONETA» no identifica una unidad: jamás se fuerza a un viaje.
    expect(por('sin_unidad')).toBe(camionetas);
    expect(camionetas).toBeGreaterThan(0);
    expect(por('ligado')).toBeGreaterThan(0);
    expect(por('sin_viaje')).toBeGreaterThan(0);
    expect(por('ambiguo')).toBe(0);
    expect(por('ligado') + por('ambiguo') + por('sin_viaje') + por('sin_unidad') + por('conflicto')).toBe(65_000);
    expect(ms).toBeLessThan(PRESUPUESTO.vincular);
  }, 120_000);
});

describe('el cron no pierde un archivo grande si expira (lease)', () => {
  it('el lease de la cola es MAYOR que lo que vive la función: nadie más toma un archivo mientras sigue procesándose', () => {
    const ruta = readFileSync(join(process.cwd(), 'src', 'app', 'api', 'cron', 'peajes', 'route.ts'), 'utf8');
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(ruta)?.[1]);
    const venceEn = Number(/procesarColaPeajes\(\{[^}]*venceEn: Date\.now\(\) \+ ([\d_]+)/.exec(ruta)?.[1]?.replace(/_/g, ''));
    expect(maxDuration).toBeGreaterThan(0);
    // El reloj interno corta ANTES de que la plataforma mate la función (deja margen para el latido)…
    expect(venceEn).toBeLessThan(maxDuration * 1000);
    // …y si igual muere, el lease (300 s) vence DESPUÉS: el siguiente cron lo recupera sin duplicar (el reproceso es idempotente por archivo).
    expect(LEASE_SEGUNDOS * 1000).toBeGreaterThan(maxDuration * 1000);
  });
});

describe('retención (mig. 0562) vs plazo de reclamo de 3 meses', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const retenciones = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => ({ f, sql: readFileSync(join(dir, f), 'utf8') }));

  it('ninguna migración borra desgloses ni líneas por antigüedad: la evidencia dura lo que dure el reclamo', () => {
    const purgaDesglose = retenciones.filter(({ sql }) =>
      /delete\s+from\s+public\.desglose_peaje(_linea)?\b/i.test(sql.replace(/--.*$/gm, '')) && /p_dias|p_meses|interval/i.test(sql));
    expect(purgaDesglose.map((r) => r.f)).toEqual([]);
  });

  it('lo único que purga la 0562 en peajes es el CONTENIDO de archivos FALLIDOS con más de 30 días (sin líneas que reclamar)', () => {
    const sql = readFileSync(join(dir, '0562_retencion_liquidacion_externa_y_peajes.sql'), 'utf8').replace(/--.*$/gm, '');
    const bloque = sql.slice(sql.indexOf('purgar_peaje_archivos_fallidos'));
    expect(bloque).toMatch(/estado\s*=\s*'fallida'/);
    expect(bloque).toMatch(/set contenido = null/);
    expect(bloque).not.toMatch(/desglose_peaje/);
    expect(bloque).toMatch(/p_dias integer default 30/);
    // 30 días de un archivo que NO se importó nunca borra evidencia de un cruce reclamable (plazo ≥ 3 meses).
    expect(30).toBeLessThan(3 * 28);
  });
});
