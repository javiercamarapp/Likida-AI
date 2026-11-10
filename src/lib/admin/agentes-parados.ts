// ═══════════════════════════════════════════════════════════════════════════
// AGENTES PARADOS — «¿por qué no corre?» (auditoría admin, 10-nov-2026, P0).
//
// 49 agentes con `runner_habilitado` y solo 1 despachado por vuelta: el
// dueño no tenía dónde ver CUÁLES estaban parados ni por qué. Este lector
// cruza tres cosas, todas reales:
//   · `agente_definicion` (vivo + runner_habilitado),
//   · la última `agente_corrida` de cada uno,
//   · `cron_latido.runner.detalle.saltados` (lo que `evaluarLatidoRunner`
//     deja en cada vuelta: agente, causa y motivo).
//
// TOLERANTE A FALLOS, y NUNCA con ceros que parezcan medición:
//   · si no se pudo leer el catálogo o las corridas → devuelve `null`
//     («sin dato»), no una lista vacía que diría «nadie está parado»;
//   · si solo el latido del runner no se pudo leer, la lista sale con
//     `motivo: null` en cada fila («no sé por qué»), no con un motivo inventado.
// ═══════════════════════════════════════════════════════════════════════════

import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { logger } from '@/lib/logger';
import { leerLatido } from './salud';

/** Horas sin correr a partir de las cuales un agente habilitado cuenta como parado. */
export const HORAS_PARADO_POR_OMISION = 72;

export interface AgenteParado {
  agente: string;
  nombre: string | null;
  /** ISO de la última corrida (cualquier estado), o `null` = NUNCA ha corrido. */
  ultimaCorrida: string | null;
  /** Horas desde la última corrida; `null` si nunca corrió. */
  horasSinCorrer: number | null;
  /** Por qué se saltó en la ÚLTIMA vuelta del runner; `null` = sin dato. */
  motivo: string | null;
  causa: string | null;
}

export interface AgentesParados {
  parados: AgenteParado[];
  /** Cuántos agentes vivos con runner habilitado se evaluaron. */
  habilitados: number;
  umbralHoras: number;
  /** ISO del último latido del runner de donde salen los motivos, o `null` si no se pudo leer. */
  latidoDelRunner: string | null;
}

export interface DefinicionAgente { id: string; nombre: string | null }
export interface SaltoDeLatido { agente: string; causa: string | null; motivo: string | null }

/** Extrae los saltados del detalle del latido del runner. Pura y defensiva: un detalle raro da `[]`. */
export function saltosDeLatido(detalle: unknown): SaltoDeLatido[] {
  if (detalle === null || typeof detalle !== 'object') return [];
  const s = (detalle as Record<string, unknown>).saltados;
  if (!Array.isArray(s)) return [];
  const out: SaltoDeLatido[] = [];
  for (const x of s) {
    if (x && typeof x === 'object' && typeof (x as Record<string, unknown>).agente === 'string') {
      const o = x as Record<string, unknown>;
      out.push({
        agente: o.agente as string,
        causa: typeof o.causa === 'string' ? o.causa : null,
        motivo: typeof o.motivo === 'string' ? o.motivo : null,
      });
    }
  }
  return out;
}

/** Pura. Dado el catálogo, la última corrida de cada uno y los saltos del runner, arma la lista de parados (los que más llevan, primero). */
export function armarParados(
  defs: ReadonlyArray<DefinicionAgente>,
  ultimas: ReadonlyMap<string, string>,
  saltos: ReadonlyArray<SaltoDeLatido>,
  ahoraMs: number,
  umbralHoras: number = HORAS_PARADO_POR_OMISION,
): AgenteParado[] {
  const saltoDe = new Map(saltos.map((s) => [s.agente, s]));
  const filas: AgenteParado[] = [];
  for (const d of defs) {
    const ultima = ultimas.get(d.id) ?? null;
    const horas = ultima === null ? null : Math.max(0, (ahoraMs - Date.parse(ultima)) / 3_600_000);
    if (horas !== null && horas < umbralHoras) continue;
    const s = saltoDe.get(d.id);
    filas.push({
      agente: d.id, nombre: d.nombre, ultimaCorrida: ultima,
      horasSinCorrer: horas === null ? null : Math.round(horas),
      motivo: s?.motivo ?? null, causa: s?.causa ?? null,
    });
  }
  // Nunca corridos primero (peor caso), luego por horas descendente.
  return filas.sort((a, b) => {
    if (a.horasSinCorrer === null && b.horasSinCorrer !== null) return -1;
    if (b.horasSinCorrer === null && a.horasSinCorrer !== null) return 1;
    return (b.horasSinCorrer ?? 0) - (a.horasSinCorrer ?? 0) || a.agente.localeCompare(b.agente);
  });
}

/** La lectura. NUNCA lanza: `null` = no se pudo saber. */
export async function getAgentesParados(
  ahoraMs: number = Date.now(),
  umbralHoras: number = HORAS_PARADO_POR_OMISION,
): Promise<AgentesParados | null> {
  try {
    const { data, error } = await acotada(
      supabaseAdmin().from('agente_definicion').select('id, nombre')
        .eq('estado', 'vivo').eq('runner_habilitado', true).order('id'),
      'agentesParados.definiciones',
    );
    if (error) throw new Error(error.message);
    const defs = (data ?? []) as DefinicionAgente[];

    const ultimas = new Map<string, string>();
    await Promise.all(defs.map(async (d) => {
      const r = await acotada(
        supabaseAdmin().from('agente_corrida').select('inicio').eq('agente', d.id)
          .order('inicio', { ascending: false }).limit(1),
        `agentesParados.corrida/${d.id}`,
      );
      if (r.error) throw new Error(`${d.id}: ${r.error.message}`);
      const inicio = ((r.data ?? [])[0] as { inicio?: string } | undefined)?.inicio;
      if (inicio) ultimas.set(d.id, inicio);
    }));

    let saltos: SaltoDeLatido[] = [];
    let latidoDelRunner: string | null = null;
    try {
      const l = await leerLatido('runner');
      if (l) { saltos = saltosDeLatido(l.detalle); latidoDelRunner = l.ultimoLatido; }
    } catch (e) {
      logger.warn('agentes_parados.latido_ilegible', { err: e instanceof Error ? e.message : String(e) });
    }

    return { parados: armarParados(defs, ultimas, saltos, ahoraMs, umbralHoras), habilitados: defs.length, umbralHoras, latidoDelRunner };
  } catch (e) {
    logger.warn('agentes_parados.sin_dato', { err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}
