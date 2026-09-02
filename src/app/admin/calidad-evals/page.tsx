import Link from 'next/link';
import { ClipboardCheck, FlaskConical, Bot, ScanEye } from 'lucide-react';
import { getEstadoEvals } from '@/lib/admin/evals';
import { getCalidadCorridas, getCalidadOcr } from '@/lib/admin/calidad';
import { ahoraMs } from '@/lib/saludo';
import { numero, porcentaje, fechaHoraMx } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../dashboard/resumen-visual';
import { StatusPill, type Estado } from '../ui/kit';

export const dynamic = 'force-dynamic';

/**
 * TABLERO DE CALIDAD (Frente F) — la agregación de lo que YA se mide.
 *
 * Esta página fue un empty-state honesto («Likida no tiene pipeline de
 * evaluación ni tabla de feedback») hasta que dejó de ser verdad por partes:
 *
 *   · EVALOPS (0134) examina al analista y acusa el drift de prompt.
 *   · EVALOPS fase 2 (E.26, 0254) examina al CONTADOR con las 32 preguntas
 *     doradas de 22-evaluacion.md — trampas, inventos y falsa cautela.
 *   · agente_corrida (0102) registra el veredicto de CADA corrida de agente.
 *   · El banco de QA (0239/0246) mide la precisión del OCR campo por campo
 *     contra verdad de terreno etiquetada a mano.
 *
 * Cuatro fuentes medidas. Aquí se JUNTAN — nada se
 * mide nuevo, cada tarjeta enlaza a su pantalla de detalle, y lo que sigue
 * sin fuente (feedback 👍/👎, CSAT, drift de calidad en producción) se sigue
 * diciendo abajo con su razón, no con una gráfica vacía.
 *
 * `requireSuperadmin()` ya lo hizo el layout; aquí solo lecturas. Cada una
 * cae por su lado a null y se DICE — un tablero de calidad que pinta ceros
 * sobre una base caída afirmaría exactamente lo que existe para desmentir.
 */

const DIAS_VENTANA = 7;

/** El veredicto del examen como pill de la casa. */
function estadoDeVeredicto(v: string | null): { estado: Estado; texto: string } {
  if (v === 'paso') return { estado: 'ok', texto: 'pasó' };
  if (v === 'fallo') return { estado: 'bad', texto: 'falló' };
  if (v === 'revisar') return { estado: 'warn', texto: 'en revisión (juez humano)' };
  return { estado: 'neutral', texto: 'sin veredicto' };
}

export default async function CalidadEvalsPage() {
  const desdeIso = new Date(ahoraMs() - DIAS_VENTANA * 24 * 3600 * 1000).toISOString();
  const [evals, evalsContador, corridas, ocr] = await Promise.all([
    getEstadoEvals('analista').catch(() => null),
    // E.26 (fase 2): el examen fiscal de 32 preguntas doradas. Se lee aparte
    // y cae aparte — que el analista no se quede sin tarjeta porque el
    // corpus del contador no cargó, ni al revés.
    getEstadoEvals('contador').catch(() => null),
    getCalidadCorridas(desdeIso).catch(() => null),
    getCalidadOcr().catch(() => null),
  ]);

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<ClipboardCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Calidad & Evals"
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          <div className="card p-4">
            <h1 className="text-base font-semibold tracking-tight">La calidad que ya se mide, junta</h1>
            <p className="text-sm mt-1.5 leading-relaxed" style={{ color: 'var(--muted)' }}>
              Cuatro fuentes reales: el examen del analista (EVALOPS), el examen fiscal del contador
              (las 32 preguntas doradas de 22-evaluacion.md), el veredicto de cada corrida de agente,
              y la precisión del OCR contra verdad de terreno etiquetada a mano. Nada aquí se mide nuevo —
              cada tarjeta enlaza a su detalle. Lo que sigue sin fuente está abajo, con su razón.
            </p>
          </div>

          {/* ── 1 · El examen del analista (EVALOPS 0134) ─────────────────── */}
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <FlaskConical width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>El examen del analista</TituloSeccion>
            </div>
            {evals === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--bad)' }}>
                No se pudo leer el estado del examen — esto NO significa que el examen esté bien ni mal.
              </p>
            ) : (
              <>
                {evals.driftDePrompt && (
                  <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'var(--warnbg)' }}>
                    <p className="text-[13px] font-medium m-0" style={{ color: 'var(--warn)' }}>
                      {evals.ultima === null
                        ? 'El examen NUNCA se ha corrido: el prompt vivo no está examinado.'
                        : 'El prompt vivo NO es el examinado — la regla de re-examen (22-evaluacion.md) exige volver a correrlo antes de desplegar cambios del agente.'}
                    </p>
                  </div>
                )}
                <div className="mt-2.5 text-sm flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {evals.ultima === null ? (
                    <span style={{ color: 'var(--muted)' }}>Sin corridas registradas.</span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5">
                        Última corrida:{' '}
                        <StatusPill estado={estadoDeVeredicto(evals.ultima.veredicto).estado}>
                          {estadoDeVeredicto(evals.ultima.veredicto).texto}
                        </StatusPill>
                      </span>
                      <span style={{ color: 'var(--muted)' }}>{fechaHoraMx(evals.ultima.iniciadaEn)}</span>
                      {evals.ultima.casos !== null && (
                        <span style={{ color: 'var(--muted)' }}>{numero(evals.ultima.casos)} caso(s)</span>
                      )}
                    </>
                  )}
                  <span style={{ color: 'var(--muted)' }}>{numero(evals.casosActivos)} caso(s) activos en el banco</span>
                </div>
                <p className="text-xs mt-2 m-0" style={{ color: 'var(--faint)' }}>
                  El detalle y el juez humano viven en <Link href="/admin/evals" className="underline">Evals</Link>.
                  El examen se corre a mano (gasta llamadas reales): <code>npx tsx scripts/evals/correr-analista.ts</code>.
                </p>
              </>
            )}
          </div>

          {/* ── 1b · El examen fiscal del contador (E.26, 0254) ───────────── */}
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <FlaskConical width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>El examen del contador — 32 preguntas doradas</TituloSeccion>
            </div>
            {evalsContador === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--bad)' }}>
                No se pudo leer el estado del examen — esto NO significa que el examen esté bien ni mal.
              </p>
            ) : (
              <>
                {evalsContador.driftDePrompt && (
                  <div className="mt-2 rounded-lg px-3 py-2" style={{ background: 'var(--warnbg)' }}>
                    <p className="text-[13px] font-medium m-0" style={{ color: 'var(--warn)' }}>
                      {evalsContador.ultima === null
                        ? 'El examen NUNCA se ha corrido: el prompt vivo no está examinado.'
                        : 'El prompt vivo NO es el examinado (el hash cubre reglas + corpus de normas/) — re-examina antes de desplegar cambios del agente o de las fichas.'}
                    </p>
                  </div>
                )}
                <div className="mt-2.5 text-sm flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  {evalsContador.ultima === null ? (
                    <span style={{ color: 'var(--muted)' }}>Sin corridas registradas.</span>
                  ) : (
                    <>
                      <span className="flex items-center gap-1.5">
                        Última corrida:{' '}
                        <StatusPill estado={estadoDeVeredicto(evalsContador.ultima.veredicto).estado}>
                          {estadoDeVeredicto(evalsContador.ultima.veredicto).texto}
                        </StatusPill>
                      </span>
                      <span style={{ color: 'var(--muted)' }}>{fechaHoraMx(evalsContador.ultima.iniciadaEn)}</span>
                      {evalsContador.ultima.casos !== null && (
                        <span style={{ color: 'var(--muted)' }}>{numero(evalsContador.ultima.casos)} caso(s)</span>
                      )}
                    </>
                  )}
                  <span style={{ color: 'var(--muted)' }}>{numero(evalsContador.casosActivos)} caso(s) activos en el banco</span>
                </div>
                {/* La calificación desglosada, tal cual la dejó el runner —
                    buena o mala, aquí no se maquilla. */}
                {evalsContador.ultima?.notas && (
                  <p className="text-xs mt-2 m-0" style={{ color: 'var(--muted)' }}>{evalsContador.ultima.notas}</p>
                )}
                <p className="text-xs mt-2 m-0" style={{ color: 'var(--faint)' }}>
                  El detalle y el juez humano viven en <Link href="/admin/evals" className="underline">Evals</Link>.
                  El examen se corre a mano (gasta llamadas reales): <code>npx tsx scripts/evals/correr-contador.ts</code>.
                </p>
              </>
            )}
          </div>

          {/* ── 2 · Los veredictos de las corridas de agentes (0102) ──────── */}
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <Bot width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>Corridas de agentes — últimos {DIAS_VENTANA} días</TituloSeccion>
            </div>
            {corridas === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--bad)' }}>
                No se pudieron leer las corridas — esto NO significa que no haya fallos.
              </p>
            ) : corridas.total === 0 ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>
                Cero corridas en la ventana. Eso no dice que los agentes estén sanos: dice que no corrieron —
                si deberían haber corrido, el lugar para investigarlo es <Link href="/admin/crons" className="underline">Crons</Link>.
              </p>
            ) : (
              <>
                <div className="mt-2.5 text-sm flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="tabular">{numero(corridas.total)} corridas</span>
                  <StatusPill estado="ok">{numero(corridas.ok)} ok</StatusPill>
                  {corridas.parcial > 0 && <StatusPill estado="warn">{numero(corridas.parcial)} parciales</StatusPill>}
                  {corridas.fallo > 0
                    ? <StatusPill estado="bad">{numero(corridas.fallo)} fallos</StatusPill>
                    : <span style={{ color: 'var(--muted)' }}>0 fallos</span>}
                </div>
                {corridas.porAgente.some((a) => a.fallo > 0 || a.parcial > 0) && (
                  <div className="overflow-x-auto mt-2">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left border-b" style={{ borderColor: 'var(--line)' }}>
                          <th className="py-1.5 text-[11px] uppercase font-semibold" style={{ color: 'var(--muted)' }}>Agente con tropiezos</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Ok</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Parciales</th>
                          <th className="py-1.5 text-[11px] uppercase font-semibold text-right" style={{ color: 'var(--muted)' }}>Fallos</th>
                        </tr>
                      </thead>
                      <tbody>
                        {corridas.porAgente.filter((a) => a.fallo > 0 || a.parcial > 0).map((a) => (
                          <tr key={a.agente} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
                            <td className="py-2 cifra-mono">{a.agente}</td>
                            <td className="py-2 text-right tabular">{numero(a.ok)}</td>
                            <td className="py-2 text-right tabular" style={a.parcial > 0 ? { color: 'var(--warn)' } : undefined}>{numero(a.parcial)}</td>
                            <td className="py-2 text-right tabular" style={a.fallo > 0 ? { color: 'var(--bad)' } : undefined}>{numero(a.fallo)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="text-xs mt-2 m-0" style={{ color: 'var(--faint)' }}>
                  El detalle corrida por corrida vive en <Link href="/admin/corridas" className="underline">Corridas</Link>;
                  la ficha de cada agente, en <Link href="/admin/agentes" className="underline">Agentes</Link>.
                </p>
              </>
            )}
          </div>

          {/* ── 3 · La precisión del OCR contra verdad de terreno (0239/0246) ─ */}
          <div className="card p-4">
            <div className="flex items-center gap-2">
              <ScanEye width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
              <TituloSeccion>Precisión del OCR — banco de verdad de terreno</TituloSeccion>
            </div>
            {ocr === null ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--bad)' }}>
                No se pudo leer la medición del OCR — esto NO significa que no haya medición.
              </p>
            ) : ocr.fotosMedidas === 0 ? (
              <p className="text-sm mt-2 m-0" style={{ color: 'var(--muted)' }}>
                El banco existe y ninguna foto tiene medición todavía — la medición se corre
                desde <Link href="/admin/qa" className="underline">QA</Link> y gasta llamadas reales.
              </p>
            ) : (
              <>
                <div className="mt-2.5 text-sm flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span>
                    Precisión de campos:{' '}
                    <span className="tabular font-semibold">
                      {ocr.precisionPct === null ? 'sin medir' : porcentaje(ocr.precisionPct)}
                    </span>
                    {ocr.precisionPct !== null && (
                      <span style={{ color: 'var(--muted)' }}> ({numero(ocr.camposOk)} ok / {numero(ocr.camposOk + ocr.camposMal)} medidos)</span>
                    )}
                  </span>
                  <span className="tabular" style={{ color: 'var(--muted)' }}>{numero(ocr.fotosMedidas)} foto(s) medidas</span>
                  {ocr.alucinaciones > 0
                    ? <StatusPill estado="bad">{numero(ocr.alucinaciones)} alucinación(es)</StatusPill>
                    : <StatusPill estado="ok">0 alucinaciones</StatusPill>}
                  {ocr.camposNoMedidos > 0 && (
                    <span style={{ color: 'var(--muted)' }}>{numero(ocr.camposNoMedidos)} campo(s) sin medir</span>
                  )}
                </div>
                <p className="text-xs mt-2 m-0" style={{ color: 'var(--faint)' }}>
                  Misma aritmética que el panel de <Link href="/admin/qa" className="underline">QA</Link> (ok/(ok+mal), lo
                  no medido fuera del denominador). Última medición: {ocr.ultimaMedicionEn ? fechaHoraMx(ocr.ultimaMedicionEn) : '—'}.
                </p>
              </>
            )}
          </div>

          {/* ── Lo que SIGUE sin fuente — con su razón, no con gráfica vacía ─ */}
          <div className="card p-4">
            <TituloSeccion>Lo que este tablero todavía no puede mostrar</TituloSeccion>
            <ul className="space-y-2 text-sm mt-3">
              {[
                'Feedback 👍/👎 del contralor sobre respuestas del analista — necesita su tabla propia (migración) y el control en la pantalla del chat; no existe y no se finge.',
                'CSAT — necesita encuestas a usuarios reales, que no existen.',
                'Drift de calidad EN PRODUCCIÓN (muestreo de conversaciones reales con juez) — el diseño está en 22-evaluacion.md (J2/J4); hoy solo se examina el banco, no el tráfico.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="w-1 h-1 rounded-full mt-2 shrink-0" style={{ background: 'var(--muted)' }} />
                  <span style={{ color: 'var(--muted)' }}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
