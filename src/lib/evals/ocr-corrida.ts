import { COSTO_ESTIMADO_USD } from '@/lib/llm/models';
import type { CasoOcr, LecturaOcr } from './ocr-contrato';
import { calcularMetricas, evaluarCompuerta, informeCalibracion, type InformeCalibracion, type LineaBase, type MetricasOcr, type VeredictoCompuerta } from './ocr-metricas';
import { lecturaDoble, type PerfilDoble } from './ocr-doble';

// ═══════════════════════════════════════════════════════════════════════════
// EL CORREDOR DEL EXAMEN (F17 d): un solo camino para el doble y para el
// proveedor real. Lo único que cambia es el `Lector` que se le inyecta.
//
// EL TOPE EN USD ES DURO: se revisa ANTES de cada lectura con el costo ya
// gastado más lo estimado de la siguiente; si no cabe, la corrida se detiene,
// lista lo pendiente y su veredicto es «revisar» (una corrida incompleta no
// certifica). Un costo no medido NO es cero: se carga la estimación.
// ═══════════════════════════════════════════════════════════════════════════

export interface LecturaConCosto { lectura: LecturaOcr; costoUsd?: number | null; noMedido?: boolean }
export type Lector = (caso: CasoOcr) => Promise<LecturaConCosto>;

export interface OpcionesCorrida {
  lector: Lector;
  casos: readonly CasoOcr[];
  /** Tope duro en USD. `undefined` = sin gasto (solo válido con lectores que no cuestan: dobles). */
  maxUsd?: number;
  /** Lo que se supone que cuesta UNA lectura antes de saberlo. */
  costoEstimadoUsd?: number;
}

export interface ResultadoCorrida {
  lecturas: Record<string, LecturaOcr>;
  gastadoUsd: number;
  detenidoPorTope: boolean;
  pendientes: string[];
  /** Cuántas lecturas se cobraron con la estimación porque el proveedor no devolvió su costo. */
  costosNoMedidos: number;
}

export async function correrLector(o: OpcionesCorrida): Promise<ResultadoCorrida> {
  const estimado = o.costoEstimadoUsd ?? COSTO_ESTIMADO_USD.comprobanteOcr;
  const lecturas: Record<string, LecturaOcr> = {};
  let gastado = 0;
  let noMedidos = 0;
  const pendientes: string[] = [];
  let detenido = false;
  for (const caso of o.casos) {
    if (detenido) { pendientes.push(caso.id); continue; }
    if (o.maxUsd !== undefined && gastado + estimado > o.maxUsd + 1e-12) { detenido = true; pendientes.push(caso.id); continue; }
    const r = await o.lector(caso);
    lecturas[caso.id] = r.lectura;
    if (o.maxUsd !== undefined) {
      if (r.noMedido || r.costoUsd == null || !Number.isFinite(r.costoUsd)) { gastado += estimado; noMedidos += 1; } else gastado += r.costoUsd;
    } else if (r.costoUsd != null && Number.isFinite(r.costoUsd)) gastado += r.costoUsd;
  }
  return { lecturas, gastadoUsd: Number(gastado.toFixed(6)), detenidoPorTope: detenido, pendientes, costosNoMedidos: noMedidos };
}

export const lectorDoble = (perfil: PerfilDoble): Lector => async (c) => ({ lectura: lecturaDoble(c, perfil), costoUsd: 0 });

export interface InformeExamen {
  origen: 'doble' | 'sintetico_real' | 'real_redactado';
  muestra: number;
  metricas: MetricasOcr;
  calibracion: InformeCalibracion;
  compuerta: VeredictoCompuerta;
  gastadoUsd: number;
  detenidoPorTope: boolean;
  pendientes: string[];
}

/** Califica unas lecturas contra el corpus. Una corrida detenida por tope NUNCA pasa: se degrada a «revisar». */
export function calificarCorrida(
  casos: readonly CasoOcr[], res: ResultadoCorrida, origen: InformeExamen['origen'], base?: LineaBase | null,
): InformeExamen {
  const pares = casos.filter((c) => c.id in res.lecturas).map((caso) => ({ caso, lectura: res.lecturas[caso.id] }));
  const metricas = calcularMetricas(pares);
  const calibracion = informeCalibracion(pares);
  let compuerta = evaluarCompuerta(metricas, calibracion, base);
  if (res.detenidoPorTope) {
    compuerta = {
      veredicto: compuerta.veredicto === 'fallo' ? 'fallo' : 'revisar',
      hallazgos: [...compuerta.hallazgos, { veredicto: 'revisar', regla: 'tope', detalle: `Corrida detenida al llegar al tope: ${res.pendientes.length} caso(s) sin leer. No certifica.` }],
    };
  }
  return { origen, muestra: pares.length, metricas, calibracion, compuerta, gastadoUsd: res.gastadoUsd, detenidoPorTope: res.detenidoPorTope, pendientes: res.pendientes };
}

// ── El informe de calibración, listo para pegar ─────────────────────────────

const f = (x: number | null, d = 3) => (x === null ? 'sin medir' : x.toFixed(d));
const p = (x: number | null) => (x === null ? 'sin medir' : `${(x * 100).toFixed(1)} %`);

export function informeTexto(i: InformeExamen): string {
  const l: string[] = [];
  const etiqueta = i.origen === 'doble'
    ? 'DOBLE (guion): prueba el arnés, NO mide al modelo real'
    : i.origen === 'sintetico_real' ? 'corpus SINTÉTICO leído por el proveedor real' : 'corpus REAL REDACTADO leído por el proveedor real';
  l.push(`EXAMEN DEL OCR — origen: ${etiqueta}`);
  l.push(`Muestra: ${i.muestra} comprobante(s). Veredicto: ${i.compuerta.veredicto.toUpperCase()}. Gasto: $${i.gastadoUsd.toFixed(4)} USD.`);
  l.push('');
  l.push('Campo        n  exactitud  «no sé»  errores  inventos  0-por-null');
  for (const c of i.metricas.campos) {
    l.push(`${c.campo.padEnd(11)} ${String(c.n).padStart(3)}  ${p(c.exactitud).padStart(9)}  ${p(c.tasaNoSe).padStart(7)}  ${String(c.error).padStart(7)}  ${String(c.invento).padStart(8)}  ${String(c.ceroPorNull).padStart(10)}`);
  }
  l.push('');
  l.push(`Fotos ilegibles detectadas: ${p(i.metricas.ilegiblesDetectadas)} · «no sé» a nivel caso: ${p(i.metricas.tasaNoSeCaso)} · volteos día/mes: ${i.metricas.volteosDiaMes}`);
  l.push(`Inyecciones obedecidas: ${i.metricas.inyeccionesObedecidas} de ${i.metricas.inyecciones} · tipo de papel acertado: ${p(i.metricas.exactitudDocumento)}`);
  const c = i.calibracion;
  l.push('');
  l.push(`CALIBRACIÓN de la confianza (umbral del motor ${c.umbral}): ${c.muestra} lecturas contestadas, ${c.correctas} correctas, ${c.incorrectas} incorrectas.`);
  l.push(`AUC: ${f(c.auc)} · confianza media correctas ${f(c.confianzaMediaCorrectas)} / incorrectas ${f(c.confianzaMediaIncorrectas)}`);
  l.push(`Errores que pasan la puerta (≥ ${c.umbral}): ${c.erroresQuePasan}${c.fraccionErroresQuePasan === null ? '' : ` (${p(c.fraccionErroresQuePasan)} de los errores)`} · correctas retenidas a revisión: ${c.correctasRetenidas}`);
  for (const t of c.tramos) l.push(`  confianza [${t.desde.toFixed(2)}, ${t.hasta.toFixed(2)}): n=${t.n}, acierto ${p(t.tasa)}`);
  l.push(`¿Separa? ${c.separa}${c.proponerEscalacion ? ' → proponer a F21 la escalación por desacuerdo de dos lectores (importe, fecha, RFC, litros)' : ''}`);
  for (const n of c.notas) l.push(`  · ${n}`);
  if (i.compuerta.hallazgos.length) { l.push(''); l.push('HALLAZGOS:'); for (const h of i.compuerta.hallazgos) l.push(`  [${h.veredicto}] ${h.regla}: ${h.detalle}`); }
  if (i.detenidoPorTope) l.push(`\nDETENIDA POR TOPE: pendientes ${i.pendientes.join(', ')}`);
  return l.join('\n');
}
