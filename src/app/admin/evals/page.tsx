import { revalidatePath } from 'next/cache';
import { Bug } from 'lucide-react';
import { getEstadoEvals, veredictoAgregado } from '@/lib/admin/evals';
import { requireSuperadmin } from '@/lib/auth/guard';
import { supabaseAdmin } from '@/lib/supabase/admin';
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
  const { data } = await admin.from('eval_resultado')
    .update({ veredicto, detalle: `juez humano: ${veredicto}` })
    .eq('id', id).eq('veredicto', 'revisar').select('id');
  if (!data?.length) return;
  const { data: todos } = await admin.from('eval_resultado')
    .select('veredicto').eq('corrida_id', corridaId);
  if (todos) {
    await admin.from('eval_corrida')
      .update({ veredicto: veredictoAgregado(todos.map((t) => t.veredicto as 'paso' | 'fallo' | 'revisar')) })
      .eq('id', corridaId);
  }
  revalidatePath('/admin/evals');
}

/**
 * EVALOPS (0134) — el estado del examen del agente y la REGLA DE RE-EXAMEN
 * con cara: si el prompt vivo no es el examinado, esta página lo acusa en
 * grande. El examen se corre a mano (cuesta llamadas reales):
 * `npx tsx scripts/evals/correr-analista.ts`.
 */
export default async function Evals() {
  let estado: Awaited<ReturnType<typeof getEstadoEvals>> | null = null;
  let corridas: Array<{ id: string; veredicto: string | null; iniciada_en: string; casos: number | null; costo_usd: number | null; prompt_hash: string }> = [];
  let porCaso: Array<{ id: string; veredicto: string; detalle: string | null; pregunta: string; tipo: string }> = [];
  try {
    estado = await getEstadoEvals('analista');
    const admin = supabaseAdmin();
    const r = await admin.from('eval_corrida')
      .select('id, veredicto, iniciada_en, casos, costo_usd, prompt_hash')
      .order('iniciada_en', { ascending: false }).limit(8);
    corridas = r.data ?? [];
    if (estado.ultima) {
      const rr = await admin.from('eval_resultado')
        .select('id, veredicto, detalle, eval_caso(pregunta, tipo)')
        .eq('corrida_id', estado.ultima.id).order('creado_en');
      porCaso = (rr.data ?? []).map((f) => {
        const caso = f.eval_caso as unknown as { pregunta: string; tipo: string } | null;
        return { id: f.id, veredicto: f.veredicto, detalle: f.detalle, pregunta: caso?.pregunta ?? '—', tipo: caso?.tipo ?? '—' };
      });
    }
  } catch { estado = null; }

  const COLOR: Record<string, string> = { paso: 'var(--ok)', fallo: 'var(--bad)', revisar: '#d97706' };

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina icono={<Bug width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />} titulo="Evals — el examen del agente" />
        <div className="px-5 py-5 flex-1 space-y-4">
          {estado === null && (
            <EstadoVacio icono={<Bug width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
              No se pudo leer el estado del examen — que no es lo mismo que «todo pasó».
            </EstadoVacio>
          )}
          {estado !== null && (
            <>
              {/* ── EL GATE, con cara ── */}
              {estado.driftDePrompt ? (
                <div className="card p-4" style={{ borderLeft: '3px solid var(--bad)' }}>
                  <p className="text-[14px] font-semibold" style={{ color: 'var(--bad)' }}>
                    El prompt del analista cambió desde el último examen{estado.ultima ? '' : ' (nunca se ha examinado)'} — re-examina antes de desplegar cambios del agente.
                  </p>
                  <p className="text-[12.5px] mt-1" style={{ color: 'var(--muted)' }}>
                    Regla de 22-evaluacion.md. Corre: <code className="tabular">npx tsx scripts/evals/correr-analista.ts</code> (llamadas reales, se corre a mano).
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

              <div className="card p-4">
                <TituloSeccion>Última corrida — caso por caso</TituloSeccion>
                <div className="mt-2">
                  {porCaso.length === 0 && (
                    <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                      Aún no hay corrida registrada. El examen son {numero(estado.casosActivos)} casos (fácticas, trampas y conducta) sembrados en eval_caso.
                    </p>
                  )}
                  {porCaso.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 py-1.5 text-[12.5px]" style={{ borderBottom: '1px solid var(--line)' }}>
                      <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: COLOR[c.veredicto] ?? 'var(--muted)' }} />
                      <div className="min-w-0 flex-1">
                        <p style={{ color: 'var(--ink)' }}>{c.pregunta}</p>
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

              <div className="card p-4">
                <TituloSeccion>Corridas</TituloSeccion>
                <div className="mt-2">
                  {corridas.length === 0 && <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>Ninguna todavía.</p>}
                  {corridas.map((c) => (
                    <div key={c.id} className="flex items-center gap-3 py-1 text-[12px]" style={{ borderBottom: '1px solid var(--line)' }}>
                      <span className="font-medium" style={{ color: COLOR[c.veredicto ?? ''] ?? 'var(--muted)' }}>{c.veredicto ?? 'en curso'}</span>
                      <span style={{ color: 'var(--muted)' }}>{c.casos ?? '—'} casos</span>
                      <span className="tabular" style={{ color: 'var(--faint)' }}>{c.prompt_hash.slice(0, 10)}…</span>
                      <span className="ml-auto tabular" style={{ color: 'var(--muted)' }}>{fechaHoraMx(c.iniciada_en)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
