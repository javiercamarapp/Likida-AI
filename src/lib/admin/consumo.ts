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
import { round2, hoyMx } from '@/lib/formato';
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
  const diaHoy = hoyMx(new Date(ahoraMs));
  const inicioHoy = new Date(`${diaHoy}T00:00:00-06:00`).toISOString();

  const [{ data: defs, error: e1 }, { data: consumo, error: e2 }] = await Promise.all([
    acotada(supabaseAdmin().from('agente_definicion')
      .select('id, nombre, estado, runner_habilitado, presupuesto_dia_usd')
      .order('id'), 'consumo.definiciones'),
    // ── FE-8 · EL DINERO NO SE MUESTREA ──────────────────────────────────
    //
    // Esto era `.select(...).gte('inicio', hace30d).limit(5000)` y sumaba en
    // JS. Dos cosas mal a la vez:
    //   1. PostgREST recorta a `max_rows` = 1,000 EN SILENCIO, así que el
    //      límite real nunca fue 5,000.
    //   2. SIN `order`, esas 1,000 filas son las que la base devolvió
    //      primero — un conjunto ARBITRARIO. El panel decía "gastó $X en 30
    //      días" sobre una muestra que nadie eligió, y con el crecimiento la
    //      cifra no se iba a poner imprecisa: se iba a congelar en la
    //      primera página.
    // `consumo_agentes()` (mig. 0162) agrupa en la base y cruza la red un
    // arreglo del tamaño del CATÁLOGO de agentes (seis), no del historial.
    acotada(supabaseAdmin().rpc('consumo_agentes', {
      p_desde: hace30d,
      p_inicio_hoy: inicioHoy,
    }), 'consumo.corridas'),
  ]);
  if (e1) throw new Error(`getConsumoPorAgente.definiciones: ${e1.message}`);
  if (e2) throw new Error(`getConsumoPorAgente.corridas: ${e2.message}`);

  // Fallar cerrado también ante la FORMA: si la 0162 no está aplicada, `data`
  // llega como cualquier otra cosa y cada `?? 0` de abajo pintaría "gastó
  // $0.00" — que en un panel de gasto se lee como "la IA salió gratis".
  if (!Array.isArray(consumo)) {
    throw new Error(
      'getConsumoPorAgente.corridas: consumo_agentes devolvió otra forma (¿migración 0162 sin aplicar?). '
      + 'No se pinta un panel de gasto a medias.',
    );
  }
  const porAgente = new Map<string, { g30: number; hoy: number; n: number; fallos: number }>();
  for (const f of consumo as Array<Record<string, unknown>>) {
    const agente = typeof f.agente === 'string' ? f.agente : '';
    if (!agente) continue;
    porAgente.set(agente, {
      // `n` y `fallos` son conteos; `g30`/`hoy` son `numeric` sumados en la
      // base — `Number(...)` porque un numeric grande puede llegar como texto.
      n: Number(f.n ?? 0),
      fallos: Number(f.fallos ?? 0),
      g30: Number(f.g30 ?? 0),
      hoy: Number(f.hoy ?? 0),
    });
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

// ═══════════════════════════════════════════════════════════════════════════
// D.23 (frente de escala) — EL PRESUPUESTO POR PROPÓSITO, VISIBLE.
//
// El techo diario dejó de ser una sola bolsa (mig. 0244): 'interactivo' (el
// chofer y los chats), 'ocr_lote' (visión en fondo) y 'fondo' (back office),
// con una reserva que solo el camino interactivo puede tocar. Esta lectura
// alimenta /admin/consumo: cuánto lleva HOY cada (flota, propósito) y dónde
// está el techo — sin esta puerta, la reserva sería una regla que nadie ve.
// ═══════════════════════════════════════════════════════════════════════════

import { topesPresupuestoIa, type PropositoIa } from '@/lib/llm/budget';

export interface GastoProposito {
  tenantId: string;
  tenantNombre: string;
  proposito: PropositoIa;
  /** Costo real ya liquidado hoy. */
  liquidadoUsd: number;
  /** Reservas vivas (no vencidas) que aún no liquidan — dinero comprometido. */
  reservadoVivoUsd: number;
  n: number;
}

export interface PresupuestoPorProposito {
  filas: GastoProposito[];
  /** El techo diario por flota y la reserva del camino interactivo, los VIGENTES. */
  topeTenantDiaUsd: number;
  reservaInteractivoUsd: number;
  fraccionReserva: number;
}

/** LANZA si la base no responde o la 0244 no está aplicada — un panel de
 *  presupuesto en ceros por error afirmaría "hoy nadie gastó". */
export async function getPresupuestoPorProposito(): Promise<PresupuestoPorProposito> {
  const { data, error } = await acotada(
    supabaseAdmin().rpc('presupuesto_ia_por_proposito', {}),
    'consumo.presupuestoProposito',
  );
  if (error) throw new Error(`getPresupuestoPorProposito: ${error.message}`);
  if (!Array.isArray(data)) {
    throw new Error('getPresupuestoPorProposito: presupuesto_ia_por_proposito devolvió otra forma (¿migración 0244 sin aplicar?).');
  }
  const filas: GastoProposito[] = (data as Array<Record<string, unknown>>).map((f, i) => {
    const proposito = f.proposito;
    if (proposito !== 'interactivo' && proposito !== 'ocr_lote' && proposito !== 'fondo') {
      throw new Error(`getPresupuestoPorProposito: la fila ${i} trae un propósito fuera del dominio (${String(proposito)}).`);
    }
    return {
      tenantId: String(f.tenantId ?? ''),
      tenantNombre: String(f.tenantNombre ?? ''),
      proposito,
      liquidadoUsd: Number(f.liquidadoUsd ?? 0),
      reservadoVivoUsd: Number(f.reservadoVivoUsd ?? 0),
      n: Number(f.n ?? 0),
    };
  });
  const topes = topesPresupuestoIa();
  return { filas, ...topes };
}
