import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { Bug } from 'lucide-react';
import { getEstadoEvals, veredictoAgregado, type AgenteExaminado, type EstadoEvals } from '@/lib/admin/evals';
import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { fechaHoraMx, numero } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '@/app/dashboard/resumen-visual';
import { EstadoVacio } from '../ui/kit';

export const dynamic = 'force-dynamic';

/** El JUEZ HUMANO del diseño (22-evaluacion.md): las trampas quedan en
 *  'revisar' a propósito y aquí se marcan. Al marcar, el veredicto de la
 *  CORRIDA se recalcula con la misma regla binaria (una trampa fallada
 *  tumba todo). */
async function marcarResultado(fd: FormData) {
  'use server';
  await requireSuperadmin();
  const id = String(fd.get('id') ?? '');
  const corridaId = String(fd.get('corridaId') ?? '');
  const veredicto = String(fd.get('veredicto') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(corridaId)) return;
  if (veredicto !== 'paso' && veredicto !== 'fallo') return;
  const admin = supabaseAdmin();
  // Solo lo que sigue en revisión se marca — un veredicto emitido no se
  // reescribe en silencio (el WHERE es el candado).
  //
  // ADM-14 (auditoría 24, MEDIO): las TRES escrituras de aquí abajo
  // descartaban su `error` — el juez humano hacía clic en "pasó" creyendo
  // que quedó registrado y podía no ser cierto. `redirect('?error=marcar')`
  // en vez de un `return` mudo: el clic tiene que decir si de verdad pegó.
  const { data, error: errMarcar } = await admin.from('eval_resultado')
    .update({ veredicto, detalle: `juez humano: ${veredicto}` })
    .eq('id', id).eq('veredicto', 'revisar').select('id');
  if (errMarcar) {
    logger.error('evals.marcar_no_escrito', { id, err: errMarcar.message });
    redirect('/admin/evals?error=marcar');
  }
  if (!data?.length) return; // ya no estaba en 'revisar' (otro juez lo marcó primero) — no es un error
  const { data: todos, error: errLeer } = await admin.from('eval_resultado')
    .select('veredicto').eq('corrida_id', corridaId);
  if (errLeer) {
    logger.error('evals.recalculo_no_leido', { corridaId, err: errLeer.message });
    redirect('/admin/evals?error=marcar');
  }
  if (todos) {
    const { error: errAgregado } = await admin.from('eval_corrida')
      .update({ veredicto: veredictoAgregado(todos.map((t) => t.veredicto as 'paso' | 'fallo' | 'revisar')) })
      .eq('id', corridaId);
    if (errAgregado) {
      logger.error('evals.veredicto_corrida_no_escrito', { corridaId, err: errAgregado.message });
      redirect('/admin/evals?error=marcar');
    }
  }
  revalidatePath('/admin/evals');
}

const AGENTES: ReadonlyArray<{ agente: AgenteExaminado; titulo: string; comando: string }> = [
  { agente: 'analista', titulo: 'El analista (chat del panel)', comando: 'npx tsx scripts/evals/correr-analista.ts' },
  // E.26 (fase 2 de EVALOPS): las 32 preguntas doradas de 22-evaluacion.md.
  // El hash del contador cubre reglas + CORPUS (corpus_texto.ts): cambiar una
  // ficha de normas/ también acusa drift, como exige la regla de re-examen.
  { agente: 'contador', titulo: 'El contador (examen fiscal de 32 preguntas doradas)', comando: 'npx tsx scripts/evals/correr-contador.ts' },
];

interface PorCaso { id: string; veredicto: string; detalle: string | null; pregunta: string; tipo: string; clave: string | null }

const COLOR: Record<string, string> = { paso: 'var(--ok)', fallo: 'var(--bad)', revisar: '#d97706' };

/**
 * EVALOPS (0134 + 0254) — el estado del examen de CADA agente examinado y la
 * REGLA DE RE-EXAMEN con cara: si el prompt vivo no es el examinado, esta
 * página lo acusa en grande. Los exámenes se corren a mano (cuestan llamadas
 * reales); el comando de cada uno está en su tarjeta.
 */
export default async function Evals({
  searchParams,
}: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  const admin = supabaseAdmin();
  const secciones: Array<{ agente: AgenteExaminado; titulo: string; comando: string; estado: EstadoEvals | null; porCaso: PorCaso[] }> = [];
  let corridas: Array<{ id: string; agente: string; veredicto: string | null; iniciada_en: string; casos: number | null; costo_usd: number | null; prompt_hash: string }> = [];
  // ADM-14 (auditoría 24, MEDIO): `r.data ?? []` sin comprobar `r.error` —
  // una lectura caída se pintaba idéntica a "ninguna corrida todavía", que
  // es justo lo contrario ("no se sabe" ≠ "no hay"). `corridasError` guarda
  // el porqué para que la pantalla lo diga.
  let corridasError: string | null = null;
  try {
    const r = await admin.from('eval_corrida')
      .select('id, agente, veredicto, iniciada_en, casos, costo_usd, prompt_hash')
      .order('iniciada_en', { ascending: false }).limit(10);
    if (r.error) throw new Error(r.error.message);
    corridas = r.data ?? [];
  } catch (e) {
    corridas = [];
    corridasError = e instanceof Error ? e.message : 'no se pudo leer';
  }

  for (const def of AGENTES) {
    let estado: EstadoEvals | null = null;
    let porCaso: PorCaso[] = [];
    try {
      estado = await getEstadoEvals(def.agente);
      if (estado.ultima) {
        const rr = await admin.from('eval_resultado')
          .select('id, veredicto, detalle, eval_caso(pregunta, tipo, clave)')
          .eq('corrida_id', estado.ultima.id).order('creado_en');
        // ADM-14: mismo hueco — `rr.data ?? []` sin mirar `rr.error` pintaba
        // "Aún no hay corrida registrada" sobre una lectura que en realidad
        // FALLÓ. Se lanza para que el catch de este bloque haga `estado =
        // null` (el mismo camino que ya usa la pantalla para "no se pudo
        // leer el estado del examen").
        if (rr.error) throw new Error(rr.error.message);
        porCaso = (rr.data ?? []).map((f) => {
          const caso = f.eval_caso as unknown as { pregunta: string; tipo: string; clave: string | null } | null;
          return { id: f.id, veredicto: f.veredicto, detalle: f.detalle, pregunta: caso?.pregunta ?? '—', tipo: caso?.tipo ?? '—', clave: caso?.clave ?? null };
        });
      }
    } catch { estado = null; }
    secciones.push({ ...def, estado, porCaso });
  }

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Bug width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Evals — los exámenes de los agentes" />
        <div className="px-5 py-5 flex-1 space-y-4">
          {sp.error === 'marcar' && (
            <p className="text-sm rounded-xl px-4 py-2.5" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              No se pudo registrar el veredicto — la escritura falló. Vuelve a marcarlo.
            </p>
          )}
          {secciones.map(({ agente, titulo, comando, estado, porCaso }) => (
            <section key={agente} className="space-y-3">
              <TituloSeccion>{titulo}</TituloSeccion>
              {estado === null && (
                <EstadoVacio icono={<Bug width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
                  No se pudo leer el estado del examen del {agente} — que no es lo mismo que «todo pasó».
                </EstadoVacio>
              )}
              {estado !== null && (
                <>
                  {/* ── EL GATE, con cara ── */}
                  {estado.driftDePrompt ? (
                    <div className="card p-4" style={{ borderLeft: '3px solid var(--bad)' }}>
                      <p className="text-[14px] font-semibold" style={{ color: 'var(--bad)' }}>
                        El prompt del {agente} cambió desde el último examen{estado.ultima ? '' : ' (nunca se ha examinado)'} — re-examina antes de desplegar cambios del agente.
                      </p>
                      <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>
                        Regla de 22-evaluacion.md{agente === 'contador' ? ' (el hash cubre reglas + corpus de normas/)' : ''}. Corre: <code className="tabular">{comando}</code> (llamadas reales, se corre a mano).
                      </p>
                      <p className="text-[11px] mt-2 tabular" style={{ color: 'var(--faint)' }}>
                        prompt vivo {estado.hashVivo.slice(0, 12)}… · último examinado {estado.ultima ? `${estado.ultima.promptHash.slice(0, 12)}…` : 'ninguno'}
                      </p>
                    </div>
                  ) : (
                    <div className="card p-4" style={{ borderLeft: '3px solid var(--ok)' }}>
                      <p className="text-[14px] font-semibold" style={{ color: 'var(--ok)' }}>
                        El prompt vivo es el examinado — veredicto: {estado.ultima?.veredicto ?? 'sin veredicto'}.
                      </p>
                      <p className="text-[11px] mt-1 tabular" style={{ color: 'var(--faint)' }}>prompt {estado.hashVivo.slice(0, 12)}…</p>
                    </div>
                  )}

                  {/* La calificación desglosada que dejó el runner (trampas,
                      inventos, falsa cautela) — se enseña tal cual, buena o mala. */}
                  {estado.ultima?.notas && (
                    <div className="card p-4">
                      <TituloSeccion>Calificación de la última corrida</TituloSeccion>
                      <p className="text-[12.5px] mt-2" style={{ color: 'var(--ink)' }}>{estado.ultima.notas}</p>
                    </div>
                  )}

                  <div className="card p-4">
                    <TituloSeccion>Última corrida — caso por caso</TituloSeccion>
                    <div className="mt-2">
                      {porCaso.length === 0 && (
                        <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                          Aún no hay corrida registrada. El examen son {numero(estado.casosActivos)} casos sembrados en eval_caso.
                        </p>
                      )}
                      {porCaso.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 py-1.5 text-[12.5px]" style={{ borderBottom: '1px solid var(--line)' }}>
                          <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: COLOR[c.veredicto] ?? 'var(--muted)' }} />
                          <div className="min-w-0 flex-1">
                            <p style={{ color: 'var(--ink)' }}>{c.clave ? `${c.clave} · ` : ''}{c.pregunta}</p>
                            {c.detalle && <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{c.detalle}</p>}
                          </div>
                          <span className="etiqueta-mono text-[10px] uppercase shrink-0" style={{ color: 'var(--muted)' }}>{c.tipo}</span>
                          <span className="text-[11px] font-medium shrink-0" style={{ color: COLOR[c.veredicto] ?? 'var(--muted)' }}>{c.veredicto}</span>
                          {c.veredicto === 'revisar' && estado.ultima && (
                            <span className="flex gap-1 shrink-0">
                              {(['paso', 'fallo'] as const).map((v) => (
                                <form key={v} action={marcarResultado}>
                                  <input type="hidden" name="id" value={c.id} />
                                  <input type="hidden" name="corridaId" value={estado.ultima?.id ?? ''} />
                                  <input type="hidden" name="veredicto" value={v} />
                                  <button className="px-2 py-0.5 rounded-md text-[10.5px] font-medium hairline hover:opacity-70"
                                    style={{ color: v === 'paso' ? 'var(--ok)' : 'var(--bad)' }}>
                                    {v === 'paso' ? '✓ pasó' : '✗ falló'}
                                  </button>
                                </form>
                              ))}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </section>
          ))}

          <div className="card p-4">
            <TituloSeccion>Corridas (todos los agentes)</TituloSeccion>
            <div className="mt-2">
              {corridasError !== null && (
                <p className="text-[12.5px]" style={{ color: 'var(--bad)' }}>
                  No se pudo leer — {corridasError}. Esto NO significa que no haya corridas.
                </p>
              )}
              {corridasError === null && corridas.length === 0 && (
                <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Ninguna todavía.</p>
              )}
              {corridas.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-1 text-[12px]" style={{ borderBottom: '1px solid var(--line)' }}>
                  <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--muted)' }}>{c.agente}</span>
                  <span className="font-medium" style={{ color: COLOR[c.veredicto ?? ''] ?? 'var(--muted)' }}>{c.veredicto ?? 'en curso'}</span>
                  <span style={{ color: 'var(--muted)' }}>{c.casos ?? '—'} casos</span>
                  <span className="tabular" style={{ color: 'var(--faint)' }}>{c.prompt_hash.slice(0, 10)}…</span>
                  <span className="ml-auto tabular" style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.iniciada_en)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
