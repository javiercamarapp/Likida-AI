import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getSystemPrompt } from '@/lib/agents/prompts';

// ═══════════════════════════════════════════════════════════════════════════
// EVALOPS (0134) — el estado del examen y la REGLA DE RE-EXAMEN visible.
//
// 22-evaluacion.md: "cada vez que cambie el prompt, el modelo o el corpus,
// hay que volver a correr el examen completo antes de desplegar". El gate no
// es un deseo: el hash del prompt VIVO se compara contra el de la última
// corrida, y el panel acusa el drift con todas sus letras.
// ═══════════════════════════════════════════════════════════════════════════

/** El hash del prompt EXACTO que corre hoy — con un ctx fijo, para que el
 *  hash mida el TEXTO del prompt y no los datos del tenant. */
export function promptHashActual(agente: 'analista'): string {
  const key = agente === 'analista' ? 'analista_flota' : agente;
  const texto = getSystemPrompt(key, {
    tenantId: '00000000-0000-0000-0000-000000000000',
    nombreFlota: 'HASH', agentName: 'HASH', timezone: 'America/Mexico_City',
  });
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/** El veredicto AGREGADO — binario con escalamiento, jamás un promedio:
 *  un solo 'fallo' tumba la corrida; sin fallos, un 'revisar' la detiene
 *  en revisión humana; 'paso' solo cuando TODO pasó. */
export function veredictoAgregado(porCaso: Array<'paso' | 'fallo' | 'revisar'>): 'paso' | 'fallo' | 'revisar' {
  if (porCaso.length === 0) return 'revisar';
  if (porCaso.includes('fallo')) return 'fallo';
  if (porCaso.includes('revisar')) return 'revisar';
  return 'paso';
}

export interface EstadoEvals {
  agente: string;
  hashVivo: string;
  ultima: {
    id: string; promptHash: string; veredicto: string | null;
    iniciadaEn: string; terminadaEn: string | null; casos: number | null; costoUsd: number | null;
  } | null;
  /** true = el prompt cambió desde el último examen — NO desplegar cambios
   *  del agente sin re-examinar (la regla de 22-evaluacion.md). */
  driftDePrompt: boolean;
  casosActivos: number;
}

export async function getEstadoEvals(agente: 'analista' = 'analista'): Promise<EstadoEvals> {
  const admin = supabaseAdmin();
  const [rCorrida, rCasos] = await Promise.all([
    admin.from('eval_corrida').select('id, prompt_hash, veredicto, iniciada_en, terminada_en, casos, costo_usd')
      .eq('agente', agente).order('iniciada_en', { ascending: false }).limit(1).maybeSingle(),
    admin.from('eval_caso').select('id', { count: 'exact', head: true }).eq('agente', agente).eq('activo', true),
  ]);
  if (rCorrida.error) throw new Error(`getEstadoEvals/corrida: ${rCorrida.error.message}`);
  if (rCasos.error) throw new Error(`getEstadoEvals/casos: ${rCasos.error.message}`);
  const hashVivo = promptHashActual(agente);
  const ultima = rCorrida.data ? {
    id: rCorrida.data.id, promptHash: rCorrida.data.prompt_hash, veredicto: rCorrida.data.veredicto,
    iniciadaEn: rCorrida.data.iniciada_en, terminadaEn: rCorrida.data.terminada_en,
    casos: rCorrida.data.casos, costoUsd: rCorrida.data.costo_usd,
  } : null;
  return {
    agente, hashVivo, ultima,
    // Sin corrida NUNCA corrida = drift también: el examen no se ha hecho.
    driftDePrompt: !ultima || ultima.promptHash !== hashVivo,
    casosActivos: rCasos.count ?? 0,
  };
}
