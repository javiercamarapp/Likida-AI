import { evaluarSlosEnQuema, type EvaluacionQuema, type NivelQuema } from './slo-quema';
import { getAnotacionesDespliegue } from './anotaciones-despliegue';
import { agruparAlertas, lineaDeGrupo } from './agrupar-alertas';

// ═══════════════════════════════════════════════════════════════════════════
// LOS PASOS DE MEJORA CONTINUA DE LA GUARDIA (F14-A). Sin cron nuevo: los llama `/api/cron/guardia`. Nunca lanzan: lo que no
// se pudo leer viaja como `null` («sin medir»), jamás como «todo bien».
// ═══════════════════════════════════════════════════════════════════════════

export type QuemaCompacta = Record<string, NivelQuema>;

/** El último despliegue o palanca visto, en una línea (para el aviso). `null` = no se pudo o no hay. */
export async function ultimoCambioVisto(): Promise<string | null> {
  try {
    const r = await getAnotacionesDespliegue({ dias: 3 });
    return r.estado === 'ok' && r.anotaciones.length > 0 ? r.anotaciones[0].etiqueta : null;
  } catch { return null; }
}

/** Evalúa la quema; `null` si la lectura entera falló. */
export async function evaluarQuemaSegura(): Promise<EvaluacionQuema[] | null> {
  try { return await evaluarSlosEnQuema(); } catch { return null; }
}

export function quemaCompacta(ev: ReadonlyArray<EvaluacionQuema>): QuemaCompacta {
  return Object.fromEntries(ev.map((e) => [e.clave, e.nivel]));
}

/** Lo previo guardado en el latido, sin confiar en su forma. */
export function quemaDeDetalle(detalle: unknown): QuemaCompacta {
  const q = detalle && typeof detalle === 'object' ? (detalle as Record<string, unknown>).quema : null;
  if (!q || typeof q !== 'object') return {};
  const out: QuemaCompacta = {};
  for (const [k, v] of Object.entries(q as Record<string, unknown>)) {
    if (v === 'pagina' || v === 'ticket' || v === 'ninguna' || v === 'sin_medir') out[k] = v;
  }
  return out;
}

/** Avisa solo la TRANSICIÓN a página: la misma quema sostenida no vuelve a sonar en cada pasada de 5 min. */
export function lineasDeQuemaNueva(ev: ReadonlyArray<EvaluacionQuema>, previo: QuemaCompacta, ultimoCambio?: string | null): string[] {
  const nuevas = ev.filter((e) => e.nivel === 'pagina' && previo[e.clave] !== 'pagina');
  return agruparAlertas({ items: [], ciegas: [], quema: nuevas }).map((g) => lineaDeGrupo(g, ultimoCambio));
}

export const resumenQuema = (n: number): string => `${n} grupo(s) de quema del presupuesto de error`;

// ── F14-C: diagnóstico de solo lectura (APAGADO por omisión: DIAGNOSTICO_ALERTAS=encendido) ─────────────────────────────
import { claveDeItem, huellaDeClave, type ItemClasificado } from './guardia';
import { diagnosticoEncendido, type ResultadoDiagnostico } from './diagnostico';

const TOPE_HUELLAS = 50;

export function diagnosticadasDeDetalle(detalle: unknown): string[] {
  const v = detalle && typeof detalle === 'object' ? (detalle as Record<string, unknown>).diagnosticadas : null;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, TOPE_HUELLAS) : [];
}

export function estadoDiagnosticoDeDetalle(detalle: unknown): string | null {
  const d = detalle && typeof detalle === 'object' ? (detalle as Record<string, unknown>).diagnostico : null;
  const e = d && typeof d === 'object' ? (d as Record<string, unknown>).estado : null;
  return typeof e === 'string' ? e : null;
}

/** Corre el diagnóstico de las S1/S2 nuevas. Nunca lanza. Apagado: no carga el proveedor ni toca la base. */
export async function correrDiagnostico(
  nuevos: readonly ItemClasificado[], detallePrevio: unknown,
): Promise<{ resultado: ResultadoDiagnostico; diagnosticadas: string[] } | null> {
  if (!diagnosticoEncendido()) return null;
  try {
    const [{ diagnosticarAlertas }, { puertosReales }] = await Promise.all([import('./diagnostico'), import('./diagnostico-puertos')]);
    const previas = diagnosticadasDeDetalle(detallePrevio);
    const resultado = await diagnosticarAlertas(nuevos, previas, puertosReales());
    return { resultado, diagnosticadas: [...new Set([...resultado.diagnosticados, ...previas])].slice(0, TOPE_HUELLAS) };
  } catch {
    return null;
  }
}

export const huellaDeAlerta = (i: ItemClasificado): string => huellaDeClave(claveDeItem(i));

export const avisoTopeDiagnostico = (gasto: number | null, tope: number): string =>
  `El diagnóstico automático llegó a su tope mensual de IA (US$${gasto === null ? '?' : gasto.toFixed(2)} de US$${tope.toFixed(2)}) y dejó de llamar al modelo hasta el mes siguiente.`;
