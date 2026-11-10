import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { ahoraMs } from '@/lib/saludo';

// ═══════════════════════════════════════════════════════════════════════════
// ANOTACIONES DE DESPLIEGUE PARA LAS GRÁFICAS (F14-A, PLAN-MAESTRO §10.1).
//
// Solo LECTURA de `despliegue_visto` (0234), el registro de qué SHA ha visto
// correr este servidor. Es el único historial de despliegues que existe en la
// base.
//
// LA HONESTIDAD DEL RELOJ (misma advertencia que `ingenieria.ts`): Vercel no
// expone la hora del despliegue dentro de la función. `primera_vista` es la
// primera corrida del agente `releases` que vio ese SHA — puede ir un ciclo de
// cron DESPUÉS del despliegue real. Por eso cada anotación es de tipo
// `primera_vista`, jamás «desplegado a las…», y la marca lleva esa etiqueta.
//
// Estados (tres, nunca confundidos):
//   · `ok`         hay anotaciones.
//   · `no_medido`  la tabla se leyó y no hay filas en la ventana: «No medido».
//   · `error`      no se pudo leer: eso NO es «sin despliegues».
// ═══════════════════════════════════════════════════════════════════════════

export interface AnotacionDespliegue {
  sha: string;
  shaCorto: string;
  entorno: string;
  /** `null` = la rama no consta (no se rellena con «master»). */
  rama: string | null;
  /** ISO de `primera_vista` (NO la hora del despliegue). */
  instante: string;
  /** Cuántas corridas de `releases` han visto este SHA. */
  vistas: number;
  etiqueta: string;
}

export type LecturaAnotaciones =
  | { estado: 'ok'; anotaciones: AnotacionDespliegue[]; nota: string }
  | { estado: 'no_medido'; anotaciones: []; nota: string }
  | { estado: 'error'; anotaciones: []; nota: string };

export const NOTA_RELOJ = 'Hora = primera vez que el servidor vio ese SHA; el despliegue real pudo ser anterior.';

const TOPE_FILAS = 100;

/** PURA. Convierte una fila de `despliegue_visto` en anotación; `null` si la
 *  fila es incoherente (sin SHA o con fecha ilegible) — se omite, no se inventa. */
export function anotacionDeFila(f: Record<string, unknown>): AnotacionDespliegue | null {
  const sha = typeof f.sha === 'string' ? f.sha.trim().toLowerCase() : '';
  const instante = typeof f.primera_vista === 'string' ? f.primera_vista : '';
  if (!/^[0-9a-f]{7,40}$/.test(sha) || !Number.isFinite(Date.parse(instante))) return null;
  const entorno = typeof f.entorno === 'string' && f.entorno.trim() !== '' ? f.entorno : 'desconocido';
  const rama = typeof f.rama === 'string' && f.rama.trim() !== '' ? f.rama : null;
  const vistas = Number(f.vistas);
  const shaCorto = sha.slice(0, 7);
  return {
    sha, shaCorto, entorno, rama, instante, vistas: Number.isFinite(vistas) ? vistas : 0,
    etiqueta: `${shaCorto} · ${entorno}${rama ? ` · ${rama}` : ''} (primera vista)`,
  };
}

/** PURA. Las anotaciones que caen dentro del rango de una gráfica, de la más
 *  antigua a la más reciente. */
export function anotacionesEnRango(
  anotaciones: readonly AnotacionDespliegue[], desdeMs: number, hastaMs: number,
): AnotacionDespliegue[] {
  return anotaciones
    .filter((a) => { const t = Date.parse(a.instante); return t >= desdeMs && t <= hastaMs; })
    .sort((a, b) => Date.parse(a.instante) - Date.parse(b.instante));
}

export async function getAnotacionesDespliegue(opts: { dias?: number; entorno?: string } = {}): Promise<LecturaAnotaciones> {
  const dias = opts.dias ?? 30;
  const desde = new Date(ahoraMs() - dias * 86_400_000).toISOString();
  try {
    let q = supabaseAdmin()
      .from('despliegue_visto')
      .select('sha, entorno, rama, primera_vista, vistas')
      .gte('primera_vista', desde);
    if (opts.entorno) q = q.eq('entorno', opts.entorno);
    const { data, error } = await acotada(
      q.order('primera_vista', { ascending: false }).limit(TOPE_FILAS),
      'anotaciones_despliegue',
    );
    if (error) throw new Error(error.message);
    const anotaciones = ((data ?? []) as Array<Record<string, unknown>>)
      .map(anotacionDeFila).filter((a): a is AnotacionDespliegue => a !== null);
    if (anotaciones.length === 0) {
      return { estado: 'no_medido', anotaciones: [], nota: `No medido: sin despliegues registrados en los últimos ${dias} días.` };
    }
    return { estado: 'ok', anotaciones, nota: NOTA_RELOJ };
  } catch (e) {
    return { estado: 'error', anotaciones: [], nota: `No se pudo leer despliegue_visto: ${e instanceof Error ? e.message : String(e)}` };
  }
}
