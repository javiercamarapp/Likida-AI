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
