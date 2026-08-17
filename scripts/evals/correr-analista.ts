// ═══════════════════════════════════════════════════════════════════════════
// EL EXAMEN DEL ANALISTA (EvalOps 0134) — llamadas REALES de pago; se corre
// A MANO al cambiar prompt/modelo (la regla de re-examen de 22-evaluacion.md;
// /admin/evals acusa el drift si se te olvida):
//
//   npx tsx scripts/evals/correr-analista.ts
//
// JUECES (el escalamiento del diseño):
//  · determinista (aquí): excepción o cero bloques = FALLO; una fáctica que
//    entrega bloques PASA — la guardia de cifras interna del analista ya es
//    el verificador de respaldo (guardia.ts corre en cada turno).
//  · humano: toda TRAMPA queda en REVISAR (leer la respuesta en /admin/evals
//    o en la tabla) — una trampa "pasada" por heurística sería el mismo
//    falso confort que este sistema existe para impedir.
// El agregado es binario con escalamiento (veredictoAgregado): una trampa
// fallada tumba la corrida completa.
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from '@supabase/supabase-js';
import { ejecutarAnalista } from '../../src/lib/agents/analista';
import { promptHashActual, veredictoAgregado } from '../../src/lib/admin/evals';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT = process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
if (!URL || !KEY) throw new Error('faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local)');
const db = createClient(URL, KEY);

async function main() {
  const { data: casos, error } = await db.from('eval_caso')
    .select('id, pregunta, espera, tipo').eq('agente', 'analista').eq('activo', true).order('creado_en');
  if (error || !casos?.length) throw new Error(`sin casos: ${error?.message ?? 'examen vacío'}`);

  const hash = promptHashActual('analista');
  const { data: corrida, error: eC } = await db.from('eval_corrida')
    .insert({ agente: 'analista', prompt_hash: hash }).select('id').single();
  if (eC || !corrida) throw new Error(`no se pudo abrir la corrida: ${eC?.message}`);

  const veredictos: Array<'paso' | 'fallo' | 'revisar'> = [];
  let costo = 0;
  let modelo = '';
  for (const caso of casos) {
    process.stdout.write(`\n── ${caso.pregunta}\n`);
    let veredicto: 'paso' | 'fallo' | 'revisar';
    let respuesta: unknown = null;
    let detalle = '';
    try {
      const r = await ejecutarAnalista({
        tenantId: TENANT, nombreFlota: 'FLOTA DE EXAMEN',
        mensajes: [{ rol: 'usuario', texto: caso.pregunta }],
      });
      respuesta = r.bloques;
      costo += r.costoUsd;
      modelo = r.modelo;
      if (r.bloques.length === 0) { veredicto = 'fallo'; detalle = 'cero bloques'; }
      else if (caso.tipo === 'trampa') { veredicto = 'revisar'; detalle = 'trampa: juez humano'; }
      else { veredicto = 'paso'; detalle = 'bloques presentes; cifras ya vigiladas por la guardia interna'; }
    } catch (e) {
      veredicto = 'fallo';
      detalle = e instanceof Error ? e.message : String(e);
    }
    veredictos.push(veredicto);
    console.log(`   → ${veredicto.toUpperCase()}  (${detalle.slice(0, 100)})`);
    await db.from('eval_resultado').insert({
      corrida_id: corrida.id, caso_id: caso.id, veredicto, respuesta, detalle: detalle.slice(0, 400),
    });
  }

  const agregado = veredictoAgregado(veredictos);
  await db.from('eval_corrida').update({
    terminada_en: new Date().toISOString(), veredicto: agregado,
    casos: casos.length, costo_usd: costo, modelo,
  }).eq('id', corrida.id);
  console.log(`\n═══ VEREDICTO: ${agregado.toUpperCase()} · ${casos.length} casos · $${costo.toFixed(4)} · prompt ${hash.slice(0, 12)}…`);
  console.log('Las trampas quedaron en REVISAR: léelas en /admin/evals y marca a mano si alguna falló.');
}

void main();
