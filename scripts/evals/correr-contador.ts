// ═══════════════════════════════════════════════════════════════════════════
// EL EXAMEN DEL CONTADOR (E.26, fase 2 de EVALOPS 0134) — llamadas REALES de
// pago; se corre A MANO al cambiar prompt/modelo/corpus (la regla de
// re-examen de 22-evaluacion.md; /admin/evals acusa el drift si se olvida):
//
//   npx tsx scripts/evals/correr-contador.ts               examen completo
//   npx tsx scripts/evals/correr-contador.ts --limite 5    los primeros 5
//   npx tsx scripts/evals/correr-contador.ts --sabotaje    prompt saboteado
//
// --sabotaje existe por la regla «un examen que siempre saca 100 no mide
// nada»: corre el banco contra un contador SIN corpus y con la orden de
// contestar todo con seguridad. Si la calificación no se derrumba, el roto
// es el examen. La corrida queda marcada en notas — no es calificación del
// agente y no debe leerse como tal.
//
// JUECES (juez-contador.ts): J1 determinista (citas contra el libro mayor),
// J2 de rúbrica (LLM con el CRITERIO ESCRITO del banco como única vara), y
// el juez humano en /admin/evals para todo 'revisar' — una trampa jamás se
// da por pasada en automático. El agregado es binario con escalamiento
// (veredictoAgregado): una trampa fallada tumba la corrida completa.
//
// Presupuesto: propósito 'fondo' SIEMPRE — el examen jamás toca la reserva
// del camino interactivo del chofer (mig. 0244).
// ═══════════════════════════════════════════════════════════════════════════
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { BANCO_CONTADOR, esperaDeCaso, type CasoContador } from '../../src/lib/evals/banco-contador';
import {
  j1VerificarCitas, mensajeJuez, SYSTEM_JUEZ, SchemaDictamenJuez,
  veredictoDelCaso, calificar, resumenCalificacion,
  type Dictamen, type FilaCalificacion,
} from '../../src/lib/evals/juez-contador';
import { ejecutarContador, promptContador, promptContadorSaboteado, hashPromptContador } from '../../src/lib/agents/contador';
import { generateStructured } from '../../src/lib/llm/openrouter';
import { createLlmBudget } from '../../src/lib/llm/budget';
import { veredictoAgregado } from '../../src/lib/admin/evals';

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TENANT = process.env.DEMO_TENANT_ID ?? '11111111-1111-1111-1111-111111111111';
if (!URL || !KEY) throw new Error('faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source .env.local)');
const db = createClient(URL, KEY);

const SABOTAJE = process.argv.includes('--sabotaje');
const iLimite = process.argv.indexOf('--limite');
const LIMITE = iLimite >= 0 ? Number(process.argv[iLimite + 1]) : null;
if (iLimite >= 0 && (!Number.isInteger(LIMITE) || LIMITE! <= 0)) throw new Error('--limite exige un entero positivo');

async function main() {
  // ── 1 · Sincronizar el banco congelado → eval_caso (upsert idempotente
  //        sobre el índice único de la 0254; jamás un `if` previo). ─────────
  const filasCaso = BANCO_CONTADOR.map((c) => ({
    agente: 'contador', clave: c.clave, pregunta: c.pregunta,
    espera: esperaDeCaso(c), tipo: c.tipo, activo: true,
  }));
  const { data: sembrados, error: eS } = await db.from('eval_caso')
    .upsert(filasCaso, { onConflict: 'agente,clave' }).select('id, clave');
  if (eS || !sembrados?.length) throw new Error(`no se pudo sincronizar el banco: ${eS?.message ?? 'cero filas'}`);
  const idPorClave = new Map(sembrados.map((s) => [s.clave as string, s.id as string]));

  // ── 2 · Abrir la corrida, anclada al hash del prompt EXACTO examinado. ───
  const system = SABOTAJE ? promptContadorSaboteado() : promptContador();
  const hash = hashPromptContador(system);
  const { data: corrida, error: eC } = await db.from('eval_corrida')
    .insert({ agente: 'contador', prompt_hash: hash }).select('id').single();
  if (eC || !corrida) throw new Error(`no se pudo abrir la corrida: ${eC?.message}`);

  const casos: readonly CasoContador[] = LIMITE ? BANCO_CONTADOR.slice(0, LIMITE) : BANCO_CONTADOR;
  const veredictos: Array<'paso' | 'fallo' | 'revisar'> = [];
  const filas: FilaCalificacion[] = [];
  let costo = 0;
  let modelo = '';
  let seCayo: string | null = null;

  // ── 3 · Caso por caso: contador → J1 → J2 → veredicto. ──────────────────
  for (const caso of casos) {
    process.stdout.write(`\n── ${caso.clave} (${caso.tipo}) ${caso.pregunta.slice(0, 90)}\n`);
    let veredicto: 'paso' | 'fallo' | 'revisar';
    let detalle: string;
    let dictamen: Dictamen | null = null;
    let respuesta: Record<string, unknown> | null = null;
    let desconocidas: string[] = [];
    try {
      const r = await ejecutarContador({
        pregunta: caso.pregunta, system,
        budget: createLlmBudget(TENANT, randomUUID(), 'fondo'),
      });
      costo += r.costoUsd;
      modelo = r.modelo;
      const j1 = j1VerificarCitas(r.texto);
      desconocidas = j1.desconocidas;
      try {
        const j2 = await generateStructured({
          role: 'qa', system: SYSTEM_JUEZ,
          messages: [{ role: 'user', content: mensajeJuez(caso, r.texto) }],
          schema: SchemaDictamenJuez, schemaName: 'dictamen_juez',
          maxTokens: 2000,
          budget: createLlmBudget(TENANT, randomUUID(), 'fondo'),
        });
        costo += j2.cost;
        dictamen = j2.data.dictamen;
        const v = veredictoDelCaso(caso.tipo, dictamen, desconocidas, caso.fichaEnCorpus);
        veredicto = v.veredicto;
        detalle = `${v.detalle} · ${j2.data.razones}`.slice(0, 400);
      } catch (eJuez) {
        // El juez caído NO es un paso ni un fallo del examinado: es un caso
        // sin dictamen automático — se escala al juez humano, con la causa.
        veredicto = 'revisar';
        detalle = `J2 no pudo dictaminar (${eJuez instanceof Error ? eJuez.message : String(eJuez)}) — juez humano`.slice(0, 400);
      }
      respuesta = { texto: r.texto, modelo: r.modelo, j1, dictamen, costoUsd: r.costoUsd };
    } catch (e) {
      veredicto = 'fallo';
      detalle = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    }
    veredictos.push(veredicto);
    filas.push({ clave: caso.clave, tipo: caso.tipo, severidad: caso.severidad, dictamen, citasDesconocidas: desconocidas.length, fichaEnCorpus: caso.fichaEnCorpus });
    console.log(`   → ${veredicto.toUpperCase()}${dictamen ? ` (J2: ${dictamen})` : ''}  ${detalle.slice(0, 120)}`);
    const { error: eR } = await db.from('eval_resultado').insert({
      corrida_id: corrida.id, caso_id: idPorClave.get(caso.clave), veredicto, respuesta, detalle,
    });
    if (eR) { seCayo = `no se pudo escribir el resultado de ${caso.clave}: ${eR.message}`; break; }
  }

  // ── 4 · Cerrar la corrida: agregado binario + calificación en notas. ─────
  // null NO es 0: lo que no se corrió (por --limite o por caída) se reporta
  // como SIN CORRER, y una corrida caída a la mitad queda como PARCIAL sin
  // veredicto, jamás como resultado.
  const sinCorrer: FilaCalificacion[] = BANCO_CONTADOR
    .filter((c) => !filas.some((f) => f.clave === c.clave))
    .map((c) => ({ clave: c.clave, tipo: c.tipo, severidad: c.severidad, dictamen: null, citasDesconocidas: 0, fichaEnCorpus: c.fichaEnCorpus }));
  const cal = calificar([...filas, ...sinCorrer]);
  const etiqueta = SABOTAJE ? 'SABOTAJE — prueba de que el examen puede reprobar; NO es calificación del agente' : 'examen real';
  const parcial = seCayo !== null;
  const agregado = parcial ? null : veredictoAgregado(veredictos);
  const notas = `${parcial ? `PARCIAL (${seCayo}) — no es calificación · ` : ''}${resumenCalificacion(cal, etiqueta)}`;
  await db.from('eval_corrida').update({
    terminada_en: new Date().toISOString(), veredicto: agregado,
    casos: filas.length, costo_usd: costo, modelo, notas: notas.slice(0, 1500),
  }).eq('id', corrida.id);

  console.log(`\n═══ ${parcial ? 'CORRIDA PARCIAL (sin veredicto)' : `VEREDICTO: ${agregado!.toUpperCase()}`} · ${filas.length}/${BANCO_CONTADOR.length} casos · $${costo.toFixed(4)} · prompt ${hash.slice(0, 12)}…`);
  console.log(`    ${resumenCalificacion(cal, etiqueta)}`);
  console.log('Las trampas y desacuerdos quedaron en REVISAR: léelos en /admin/evals y marca a mano.');
  if (parcial) process.exitCode = 1;
}

void main();
