// ═══════════════════════════════════════════════════════════════════════════
// CONSUMO DE IA POR AGENTE + INSIGHTS — /admin/consumo (16-ago-2026, pedido
// de Javier: "a dónde y por qué se me está yendo el dinero, claro y visual").
//
// LOS INSIGHTS SON DETERMINISTAS: cada uno es una REGLA con su dato citado
// (jamás un LLM opinando de dinero). Tres cubetas honestas: `insights`
// (lecturas del gasto), `recomendaciones` (una acción concreta) y
// `problemas` (algo está mal HOY). Una regla sin dato no se dispara.
//
// Dos fuentes que NO se mezclan y se dicen aparte:
//  · `llm_costo` (por tenant/fase/modelo) — el gasto de PRODUCTO (clientes).
//  · `agente_corrida.costo_usd` (0123) — el gasto del BACK OFFICE de Likida
//    (redactor/runner). El copiloto va al log, y eso también se dice.
// ═══════════════════════════════════════════════════════════════════════════
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { round2 } from '@/lib/formato';
import { modelosAisladosDeFallback } from '@/lib/llm/openrouter';

export interface ConsumoAgente {
  agente: string;
  nombre: string;
  estado: string;
  runnerHabilitado: boolean;
  techoDiaUsd: number | null;
  gastado30dUsd: number;
  gastadoHoyUsd: number;
  corridas30d: number;
  fallos30d: number;
  /** % del techo de HOY consumido — null sin techo declarado. */
  pctTechoHoy: number | null;
}

export interface Insight {
  tipo: 'insight' | 'recomendacion' | 'problema';
  titulo: string;
  detalle: string;
}

export interface ConsumoPorAgente {
  agentes: ConsumoAgente[];
  insights: Insight[];
}

/** LANZA si la base no responde — un panel de gasto vacío por error
 *  afirmaría "la IA salió gratis". */
export async function getConsumoPorAgente(ahoraMs: number): Promise<ConsumoPorAgente> {
  const hace30d = new Date(ahoraMs - 30 * 86_400_000).toISOString();
  const hoyMx = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date(ahoraMs));
  const inicioHoy = new Date(`${hoyMx}T00:00:00-06:00`).toISOString();

  const [{ data: defs, error: e1 }, { data: corridas, error: e2 }] = await Promise.all([
    acotada(supabaseAdmin().from('agente_definicion')
      .select('id, nombre, estado, runner_habilitado, presupuesto_dia_usd')
      .order('id'), 'consumo.definiciones'),
    acotada(supabaseAdmin().from('agente_corrida')
      .select('agente, estado, inicio, costo_usd')
      .gte('inicio', hace30d)
      .limit(5000), 'consumo.corridas'),
  ]);
  if (e1) throw new Error(`getConsumoPorAgente.definiciones: ${e1.message}`);
  if (e2) throw new Error(`getConsumoPorAgente.corridas: ${e2.message}`);

  const filas = (corridas ?? []) as Array<{ agente: string; estado: string; inicio: string; costo_usd: unknown }>;
  const porAgente = new Map<string, { g30: number; hoy: number; n: number; fallos: number }>();
  for (const c of filas) {
    const a = porAgente.get(c.agente) ?? { g30: 0, hoy: 0, n: 0, fallos: 0 };
    const costo = Number(c.costo_usd ?? 0);
    a.n += 1;
    a.g30 += costo;
    if (c.inicio >= inicioHoy) a.hoy += costo;
    if (c.estado === 'fallo') a.fallos += 1;
    porAgente.set(c.agente, a);
  }

  const agentes: ConsumoAgente[] = ((defs ?? []) as Array<{ id: string; nombre: string; estado: string; runner_habilitado: boolean; presupuesto_dia_usd: number | null }>)
    .map((d) => {
      const a = porAgente.get(d.id) ?? { g30: 0, hoy: 0, n: 0, fallos: 0 };
      const techo = d.presupuesto_dia_usd;
      return {
        agente: d.id, nombre: d.nombre, estado: d.estado,
        runnerHabilitado: d.runner_habilitado,
        techoDiaUsd: techo,
        gastado30dUsd: round2(a.g30),
        gastadoHoyUsd: Math.round(a.hoy * 10_000) / 10_000,
        corridas30d: a.n,
        fallos30d: a.fallos,
        pctTechoHoy: techo && techo > 0 ? Math.min(100, Math.round((a.hoy / techo) * 100)) : null,
      };
    })
    .sort((x, y) => y.gastado30dUsd - x.gastado30dUsd);

  // ── Las reglas — cada una con su dato, o no se dispara ───────────────────
  const insights: Insight[] = [];

  for (const a of agentes) {
    if (a.pctTechoHoy !== null && a.pctTechoHoy >= 80) {
      insights.push({
        tipo: 'problema',
        titulo: `${a.nombre} al ${a.pctTechoHoy}% de su techo de HOY`,
        detalle: `Gastó $${a.gastadoHoyUsd.toFixed(4)} de $${a.techoDiaUsd} USD — al llegar al 100% el runner lo salta hasta mañana. Si es ritmo esperado, sube presupuesto_dia_usd; si no, revisa sus corridas.`,
      });
    }
    if (a.fallos30d > 0 && a.corridas30d > 0) {
      const pct = Math.round((a.fallos30d / a.corridas30d) * 100);
      insights.push({
        tipo: pct >= 25 ? 'problema' : 'insight',
        titulo: `${a.nombre}: ${a.fallos30d} de ${a.corridas30d} corridas en fallo (30d)`,
        detalle: 'Las corridas en fallo también gastan modelo — el detalle vive en la ficha del agente y en Corridas.',
      });
    }
    if (a.estado === 'vivo' && a.runnerHabilitado && (a.techoDiaUsd === null || a.techoDiaUsd <= 0)) {
      insights.push({
        tipo: 'problema',
        titulo: `${a.nombre} habilitado para el runner SIN techo declarado`,
        detalle: 'El runner no lo corre (nace acotado): declara presupuesto_dia_usd en agente_definicion o deshabilítalo.',
      });
    }
  }

  const aislados = modelosAisladosDeFallback();
  if (aislados.length > 0) {
    insights.push({
      tipo: 'recomendacion',
      titulo: `${aislados.length} modelo${aislados.length === 1 ? '' : 's'} sin red de respaldo`,
      detalle: `${aislados.join(', ')} — si un override de env apunta ahí, el plan B entre proveedores se apaga EN SILENCIO (gotcha del 4-ago). Se cablea en FALLBACK de openrouter.ts.`,
    });
  }

  const sinCorridas = agentes.filter((a) => a.estado === 'vivo' && a.corridas30d === 0);
  if (sinCorridas.length > 0) {
    insights.push({
      tipo: 'insight',
      titulo: `${sinCorridas.length} agente${sinCorridas.length === 1 ? '' : 's'} vivo${sinCorridas.length === 1 ? '' : 's'} sin corridas en 30 días`,
      detalle: `${sinCorridas.map((a) => a.agente).join(', ')} — sin clientes operando es esperado; con clientes, sería la señal de un cron muerto.`,
    });
  }

  insights.push({
    tipo: 'insight',
    titulo: 'Lo que este panel NO ve, dicho',
    detalle: 'El gasto del COPILOTO va al log (copiloto.costo), no a una tabla — exige tenant y el copiloto es de Likida. Y las corridas anteriores a la 0123 no traen costo medido (NULL, no $0).',
  });

  return { agentes, insights };
}
