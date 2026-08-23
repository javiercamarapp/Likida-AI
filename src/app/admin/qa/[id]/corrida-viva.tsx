'use client';

// ═══════════════════════════════════════════════════════════════════════════
// LA CORRIDA EN VIVO + EL VEREDICTO — /admin/qa/<id> (Fase A).
//
// Polling corto (2.5 s, diseño §2.b) contra /api/admin/qa/<id>/estado
// mientras la corrida sigue viva; para al llegar a un estado terminal. El
// veredicto usa el formato de tabla del diseño del ejército
// (INVARIANTE / ESTADO / SEVERIDAD) con cada fila expandible: esperado vs
// real —el mismo patrón esperado/real de sobre_politica—, la conversación
// como burbujas de solo lectura, las fotos y el PDF con URL firmada.
//
// Fallar cerrado en la lectura: si el polling no puede leer, se dice; si el
// motor lleva >90 s sin latido y sigue "corriendo", se dice que pudo haber
// muerto sin escribir su aborto — nunca un spinner eterno con cara de avance.
// ═══════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Bug, Camera, FileText, MessageCircle } from 'lucide-react';
import { fechaHoraMx, usd4 } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../../dashboard/resumen-visual';
import { StatusPill, type Estado } from '../../ui/kit';
import { PILL_CORRIDA } from '../pantalla';
import type { CorridaQA, EstadoPaso } from '@/lib/admin/qa-tipos';

export interface FotoFirmada { id: string; etiqueta: string; url: string | null }
export interface PdfFirmado { path: string; url: string | null }

const ICONO = { width: 15, height: 15, strokeWidth: 1.75 } as const;

const PILL_PASO: Record<EstadoPaso, { estado: Estado; etiqueta: string }> = {
  pendiente: { estado: 'neutral', etiqueta: 'pendiente' },
  corriendo: { estado: 'neutral', etiqueta: 'corriendo…' },
  ok: { estado: 'ok', etiqueta: 'ok' },
  warn: { estado: 'warn', etiqueta: 'warn' },
  bad: { estado: 'bad', etiqueta: 'bad' },
};

const PILL_ORACULO: Record<'ok' | 'fallo' | 'no_verificado', { estado: Estado; etiqueta: string }> = {
  ok: { estado: 'ok', etiqueta: '✅ ok' },
  fallo: { estado: 'bad', etiqueta: '❌ fallo' },
  no_verificado: { estado: 'warn', etiqueta: '⚠️ no verificado' },
};

const TERMINALES = new Set(['ok', 'parcial', 'fallo', 'abortada']);

function json(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
}

export function CorridaViva({ corridaInicial, fotosIniciales, pdfsIniciales }: {
  corridaInicial: CorridaQA;
  fotosIniciales: FotoFirmada[];
  pdfsIniciales: PdfFirmado[];
}) {
  const [corrida, setCorrida] = useState(corridaInicial);
  const [fotos, setFotos] = useState(fotosIniciales);
  const [pdfs, setPdfs] = useState(pdfsIniciales);
  const [errorLectura, setErrorLectura] = useState<string | null>(null);
  // FE-20: `useState(() => Date.now())` se evalúa en el SERVIDOR al pintar el
  // HTML y otra vez en el NAVEGADOR al hidratar, con dos relojes distintos —
  // React reporta mismatch y "lleva Ns sin dar señales" salta a otro número
  // delante de quien lo está leyendo. `null` hasta que el efecto lo llene: en
  // el primer render los dos lados coinciden porque ninguno tiene reloj, y el
  // aviso de "pudo haber muerto" simplemente no se pinta todavía (no afirma
  // nada en falso, que es la regla).
  const [ahora, setAhora] = useState<number | null>(null);

  const viva = !TERMINALES.has(corrida.estado);

  // El primer reloj, ya en el cliente. Va aparte del polling para que también
  // lo tenga una corrida TERMINADA (donde el intervalo no arranca).
  //
  // Dentro de un `setTimeout` y no en el cuerpo del efecto: `setAhora(...)`
  // síncrono ahí dispara un render en cascada y lo prohíbe
  // `react-hooks/set-state-in-effect` — la regla pide que el estado se mueva
  // desde el CALLBACK de la fuente externa, y aquí la fuente externa es el
  // reloj. Cero de retraso: aterriza en el tick inmediatamente posterior a la
  // hidratación, con el HTML ya idéntico al del servidor, que es todo lo que
  // este arreglo necesita.
  useEffect(() => {
    const t = setTimeout(() => setAhora(Date.now()), 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!viva) return;
    const timer = setInterval(async () => {
      setAhora(Date.now());
      try {
        const res = await fetch(`/api/admin/qa/${corrida.id}/estado`, { cache: 'no-store' });
        const cuerpo = await res.json().catch(() => null) as { corrida?: CorridaQA; fotos?: FotoFirmada[]; pdfs?: PdfFirmado[]; error?: string } | null;
        if (!res.ok || !cuerpo?.corrida) {
          setErrorLectura(cuerpo?.error ?? `no se pudo leer el estado (HTTP ${res.status})`);
          return;
        }
        setErrorLectura(null);
        setCorrida(cuerpo.corrida);
        if (cuerpo.fotos) setFotos(cuerpo.fotos);
        if (cuerpo.pdfs) setPdfs(cuerpo.pdfs);
      } catch (e) {
        setErrorLectura(e instanceof Error ? e.message : String(e));
      }
    }, 2_500);
    return () => clearInterval(timer);
  }, [viva, corrida.id]);

  const pill = PILL_CORRIDA[corrida.estado] ?? { estado: 'neutral' as Estado, etiqueta: corrida.estado };
  const sinLatidoS = useMemo(() => {
    if (ahora === null) return null;   // todavía sin reloj del cliente
    const t = new Date(corrida.latidoEn).getTime();
    return Number.isFinite(t) ? Math.round((ahora - t) / 1000) : null;
  }, [corrida.latidoEn, ahora]);
  const posiblementeMuerta = viva && sinLatidoS !== null && sinLatidoS > 90;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Bug {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo={`Corrida de QA — ${corrida.escenario === 'demo_guion' ? 'guion del demo' : 'feliz'} — ${corrida.id.slice(0, 8)}`}
          derecha={
            <Link href="/admin/qa" className="text-xs inline-flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <ArrowLeft width={12} height={12} strokeWidth={1.75} /> Panel de QA
            </Link>
          }
        />

        <div className="px-5 py-5 flex-1 space-y-2.5">
          {/* ── Avisos de lectura (fallar cerrado, dicho) ─────────────────── */}
          {errorLectura && (
            <div className="card p-3 text-sm" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              No se pudo leer el estado de la corrida: {errorLectura}. Lo que ves abajo es la última
              lectura buena — no afirma el estado actual.
            </div>
          )}
          {posiblementeMuerta && (
            <div className="card p-3 text-sm" style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
              El motor lleva {sinLatidoS}s sin dar señales y la corrida sigue marcada «corriendo»:
              pudo haber muerto sin alcanzar a escribir su aborto. Si no avanza, el tenant
              «{corrida.tenantNombre}» puede haber quedado sembrado — revísalo y límpialo a mano.
            </div>
          )}

          {/* ── El renglón resumen ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Estado</div>
              <div className="mt-1"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></div>
              {corrida.motivo && <div className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>{corrida.motivo}</div>}
            </div>
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Carril</div>
              <div className="mt-1 text-sm font-medium">rápido — en proceso, pipeline real</div>
            </div>
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Costo hasta ahora (real)</div>
              <div className="mt-1 text-sm font-medium tabular">{usd4(corrida.costoUsdTotal ?? 0)}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>leído de llm_costo — nunca estimado</div>
            </div>
            <div className="hairline rounded-lg px-3 py-2.5" style={{ background: 'var(--surface)' }}>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Tenant sintético</div>
              <div className="mt-1 text-xs font-mono break-all">{corrida.tenantNombre}</div>
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
                {corrida.inicio ? `inicio ${fechaHoraMx(corrida.inicio)}` : 'sin arrancar'}{corrida.fin ? ` · fin ${fechaHoraMx(corrida.fin)}` : ''}
              </div>
            </div>
          </div>

          {/* ── Los pasos (el ledger en vivo) ─────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>La corrida, paso a paso</TituloSeccion>
            {corrida.pasos.length === 0 ? (
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                Todavía no arranca el primer paso{viva ? ' — esta pantalla se actualiza sola cada 2.5 s' : ''}.
              </p>
            ) : (
              <div className="mt-2 space-y-1">
                {corrida.pasos.map((p) => {
                  const pp = PILL_PASO[p.estado] ?? PILL_PASO.pendiente;
                  return (
                    <div key={p.n} className="flex items-start justify-between gap-3 text-sm py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                      <div className="min-w-0">
                        <span className="font-mono text-xs mr-2" style={{ color: 'var(--muted)' }}>{p.n}.</span>
                        {p.nombre}
                        {p.detalle && <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>{p.detalle}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.costoUsd > 0 && <span className="text-xs tabular" style={{ color: 'var(--muted)' }}>{usd4(p.costoUsd)}</span>}
                        <StatusPill estado={pp.estado}>{pp.etiqueta}</StatusPill>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── El veredicto ──────────────────────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>El veredicto — el LLM explora, el código juzga</TituloSeccion>
            {corrida.veredicto === null ? (
              <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                {viva ? 'Los oráculos corren al final de la corrida.' : 'Esta corrida terminó sin veredicto — los oráculos no alcanzaron a correr (ver el motivo arriba).'}
              </p>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ color: 'var(--muted)' }} className="text-left">
                      <th className="px-2 py-1.5 font-medium">Invariante</th>
                      <th className="px-2 py-1.5 font-medium">Estado</th>
                      <th className="px-2 py-1.5 font-medium">Severidad</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrida.veredicto.map((v, i) => {
                      const pv = PILL_ORACULO[v.estado];
                      return (
                        <tr key={i} className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
                          <td className="px-2 py-2">
                            <details>
                              <summary className="cursor-pointer font-medium">{v.invariante}</summary>
                              <div className="mt-2 text-xs space-y-1.5">
                                <div>
                                  <span className="font-semibold">esperado:</span>{' '}
                                  <code className="font-mono break-all">{json(v.esperado)}</code>
                                </div>
                                <div>
                                  <span className="font-semibold">real:</span>{' '}
                                  <code className="font-mono break-all">{json(v.real)}</code>
                                </div>
                                {v.detalle && <div style={{ color: 'var(--muted)' }}>{v.detalle}</div>}
                                <div className="font-mono" style={{ color: 'var(--faint)' }}>{v.oraculo}</div>
                              </div>
                            </details>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap"><StatusPill estado={pv.estado}>{pv.etiqueta}</StatusPill></td>
                          <td className="px-2 py-2 whitespace-nowrap text-xs">{v.estado === 'ok' ? '—' : v.severidad}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Evidencia clicable ────────────────────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <div className="card p-3">
              <TituloSeccion>La conversación (evidencia, solo lectura)</TituloSeccion>
              {corrida.turnos.length === 0 ? (
                <p className="text-sm mt-2" style={{ color: 'var(--muted)' }}>
                  {viva ? 'Los turnos aparecen al cierre de la corrida.' : 'No quedó conversación registrada.'}
                </p>
              ) : (
                <div className="mt-2 space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {corrida.turnos.map((t, i) => (
                    <div key={i} className={`flex ${t.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className="max-w-[85%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap hairline"
                        style={t.rol === 'user' ? { background: 'var(--marca)', color: 'var(--marca-fg)' } : { background: 'var(--surface)' }}>
                        <span className="inline-flex items-center gap-1 font-medium text-[10px] opacity-70">
                          <MessageCircle width={10} height={10} strokeWidth={1.75} /> {t.rol === 'user' ? 'chofer sintético' : 'Likida'}
                        </span>
                        <div>{t.texto}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-3">
              <TituloSeccion>Fotos y PDF de esta corrida</TituloSeccion>
              <div className="mt-2 space-y-1.5">
                {fotos.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-sm py-1 border-b" style={{ borderColor: 'var(--line2)' }}>
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Camera width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                      <span className="truncate text-xs">{f.etiqueta}</span>
                    </span>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-xs font-medium px-2 py-0.5 rounded-full hairline hover:opacity-70 shrink-0">
                        abrir (firma 60 s)
                      </a>
                    ) : (
                      <span className="text-xs shrink-0" style={{ color: 'var(--faint)' }}>sin firma</span>
                    )}
                  </div>
                ))}
                {(corrida.pdfs ?? []).length === 0 ? (
                  <p className="text-xs pt-1" style={{ color: 'var(--muted)' }}>
                    {viva ? 'El PDF aparece si el cierre lo genera.' : 'No quedó PDF registrado en esta corrida.'}
                  </p>
                ) : (
                  pdfs.map((p) => (
                    <div key={p.path} className="flex items-center justify-between gap-2 text-sm py-1">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <FileText width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                        <span className="truncate text-xs font-mono">{p.path.split('/').pop()}</span>
                      </span>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-medium px-2 py-0.5 rounded-full hairline hover:opacity-70 shrink-0">
                          abrir PDF (firma 60 s)
                        </a>
                      ) : (
                        <span className="text-xs shrink-0" style={{ color: 'var(--faint)' }}>
                          borrado con el tenant (retención «conservar» lo preserva)
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── La limpieza, dicha ────────────────────────────────────────── */}
          {corrida.limpieza && (
            <div className="card p-3 text-xs" style={{ color: 'var(--muted)' }}>
              <span className="font-semibold">Limpieza:</span> {corrida.limpieza}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
