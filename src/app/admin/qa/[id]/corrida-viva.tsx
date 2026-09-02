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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Bug, Camera, FileText, MessageCircle } from 'lucide-react';
import { fechaHoraMx, usd4 } from '@/lib/formato';
import { BarraPagina, TituloSeccion } from '../../../dashboard/resumen-visual';
import { StatusPill, type Estado } from '../../ui/kit';
import { PILL_CORRIDA } from '../pantalla';
import { escenarioPorId } from '@/lib/admin/qa-escenarios';
import type { CorridaQA, EstadoPaso } from '@/lib/admin/qa-tipos';
import type { ResumenPrecisionCorrida } from '@/lib/admin/qa-verdad';
import { MedicionCorrida } from './medicion-corrida';

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

export function CorridaViva({ corridaInicial, fotosIniciales, pdfsIniciales, medicionInicial = null, medicionErrorInicial = null }: {
  corridaInicial: CorridaQA;
  fotosIniciales: FotoFirmada[];
  pdfsIniciales: PdfFirmado[];
  medicionInicial?: ResumenPrecisionCorrida | null;
  medicionErrorInicial?: string | null;
}) {
  const [corrida, setCorrida] = useState(corridaInicial);
  const [fotos, setFotos] = useState(fotosIniciales);
  const [pdfs, setPdfs] = useState(pdfsIniciales);
  const [medicion, setMedicion] = useState<ResumenPrecisionCorrida | null>(medicionInicial);
  const [medicionError, setMedicionError] = useState<string | null>(medicionErrorInicial);
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
        const cuerpo = await res.json().catch(() => null) as {
          corrida?: CorridaQA; fotos?: FotoFirmada[]; pdfs?: PdfFirmado[];
          medicion?: ResumenPrecisionCorrida | null; medicionError?: string | null; error?: string;
        } | null;
        if (!res.ok || !cuerpo?.corrida) {
          setErrorLectura(cuerpo?.error ?? `no se pudo leer el estado (HTTP ${res.status})`);
          return;
        }
        setErrorLectura(null);
        setCorrida(cuerpo.corrida);
        if (cuerpo.fotos) setFotos(cuerpo.fotos);
        if (cuerpo.pdfs) setPdfs(cuerpo.pdfs);
        // Una medición ya pintada NO se borra por un poll que venga sin ella:
        // sería cambiar una medición por la ausencia de una.
        if (cuerpo.medicion) setMedicion(cuerpo.medicion);
        setMedicionError(cuerpo.medicionError ?? null);
      } catch (e) {
        setErrorLectura(e instanceof Error ? e.message : String(e));
      }
    }, 2_500);
    return () => clearInterval(timer);
  }, [viva, corrida.id]);

  // ═════════════════════════════════════════════════════════════════════════
  // EL CARRIL COMPLETO — esta pantalla es la que EMPUJA las pasadas.
  //
  // Una corrida de 91 fotos no cabe en una invocación, así que avanza en
  // pasadas y alguien tiene que pedir la siguiente. Lo hace aquí y no un cron
  // a propósito: la corrida es una herramienta de QA que se mira mientras
  // corre, y un cron cada N minutos convertiría siete pasadas en media hora de
  // espera. El precio está DICHO en pantalla (si cierras esto, la corrida se
  // queda pausada donde iba, sin perder nada).
  //
  // El candado contra dos empujones a la vez no vive aquí: la ruta toma la
  // corrida con un UPDATE condicional y la segunda llamada responde sin
  // gastar. El `ref` sólo evita el ruido de pedirlo mil veces.
  // ═════════════════════════════════════════════════════════════════════════
  const empujando = useRef(false);
  const [avisoPasada, setAvisoPasada] = useState<string | null>(null);
  const [errorPasada, setErrorPasada] = useState<string | null>(null);

  useEffect(() => {
    if (!viva || corrida.carril !== 'completo') return;
    let montado = true;
    const empujar = async () => {
      if (empujando.current || !montado) return;
      empujando.current = true;
      try {
        const res = await fetch(`/api/admin/qa/${corrida.id}/continuar`, { method: 'POST', cache: 'no-store' });
        const cuerpo = await res.json().catch(() => null) as { motivo?: string; error?: string } | null;
        if (!montado) return;
        if (!res.ok) {
          setErrorPasada(cuerpo?.error ?? `la pasada no pudo correr (HTTP ${res.status})`);
          return;
        }
        setErrorPasada(null);
        setAvisoPasada(cuerpo?.motivo ?? null);
      } catch (e) {
        if (montado) setErrorPasada(e instanceof Error ? e.message : String(e));
      } finally {
        empujando.current = false;
      }
    };
    // El primer empujón sale del `setTimeout` y no del cuerpo del efecto, por
    // la misma razón que el reloj de arriba: la regla `set-state-in-effect`
    // pide que el estado se mueva desde el callback de la fuente externa.
    const t = setTimeout(() => { void empujar(); }, 0);
    const timer = setInterval(() => { void empujar(); }, 5_000);
    return () => { montado = false; clearTimeout(t); clearInterval(timer); };
  }, [viva, corrida.carril, corrida.id]);

  const pill = PILL_CORRIDA[corrida.estado] ?? { estado: 'neutral' as Estado, etiqueta: corrida.estado };
  const sinLatidoS = useMemo(() => {
    if (ahora === null) return null;   // todavía sin reloj del cliente
    const t = new Date(corrida.latidoEn).getTime();
    return Number.isFinite(t) ? Math.round((ahora - t) / 1000) : null;
  }, [corrida.latidoEn, ahora]);
  const enPasada = corrida.pasadaEnVuelo !== null;
  // «Sin señales» sólo alarma cuando de verdad DEBERÍA haberlas: en el carril
  // rápido siempre, y en el completo únicamente mientras una pasada tiene la
  // corrida tomada. Una corrida completa PAUSADA entre pasadas no da señales y
  // eso no es que se haya muerto — pintarlo en rojo enseñaría a ignorar el
  // aviso, que es la peor manera de perder una alarma que sí importa.
  const posiblementeMuerta = viva && sinLatidoS !== null && sinLatidoS > 90
    && (corrida.carril === 'rapido' || enPasada);
  const av = corrida.avance;

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Bug {...ICONO} style={{ color: 'var(--muted)' }} />}
          titulo={`Corrida de QA — ${escenarioPorId(corrida.escenario)?.nombre ?? corrida.escenario} — ${corrida.id.slice(0, 8)}`}
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
              <div className="mt-1 text-sm font-medium">
                {corrida.carril === 'completo' ? 'completo — en varias pasadas' : 'rápido — en proceso, pipeline real'}
              </div>
              {corrida.carril === 'completo' && (
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
                  pasada {corrida.pasadas} · {enPasada ? 'trabajando ahora' : viva ? 'pausada entre pasadas' : 'terminada'}
                </div>
              )}
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

          {/* ── EL AVANCE DEL CARRIL COMPLETO ─────────────────────────────
              Cuántas van, cuántas faltan, y —si se cortó— POR QUÉ y CUÁLES
              quedaron sin turno. Todo medido: cada número sale de una fila de
              `qa_corrida_foto`, ninguno de una resta a ojo. */}
          {corrida.carril === 'completo' && av !== null && (
            <div className="card p-3">
              <TituloSeccion>El avance, foto por foto</TituloSeccion>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <div className="font-display text-[22px] leading-tight font-semibold tabular">
                  {av.ok} <span className="text-[14px] font-normal" style={{ color: 'var(--muted)' }}>de {av.total} fotos procesadas</span>
                </div>
                {av.sinTurno > 0 && (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>· {av.sinTurno} sin turno todavía</span>
                )}
                {av.enVuelo > 0 && (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>· {av.enVuelo} en vuelo</span>
                )}
                {av.bad > 0 && (
                  <span className="text-xs" style={{ color: 'var(--bad)' }}>· {av.bad} con fallo</span>
                )}
                {av.interrumpidas > 0 && (
                  <span className="text-xs" style={{ color: 'var(--warn)' }}>
                    · {av.interrumpidas} INTERRUMPIDA{av.interrumpidas === 1 ? '' : 'S'} (una pasada murió con
                    ellas en vuelo — no se sabe cómo acabaron: ni acierto ni fallo)
                  </span>
                )}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--line2)' }}>
                <div className="h-full" style={{
                  width: `${av.total > 0 ? Math.round(((av.ok + av.bad) / av.total) * 100) : 0}%`,
                  background: 'var(--marca)',
                }} />
              </div>

              {corrida.corte !== null && (
                <p className="text-xs mt-2 m-0" style={{ color: corrida.corte === 'dinero' ? 'var(--bad)' : 'var(--muted)' }}>
                  {corrida.corte === 'dinero'
                    ? '⛔ La última pasada paró por DINERO — la corrida no vuelve a gastar. El motivo de arriba trae la cifra medida.'
                    : '⏱ La última pasada paró por RELOJ. Ninguna foto se pierde: la siguiente continúa desde donde iba y no repite las que ya se midieron.'}
                </p>
              )}

              {av.sinTurnoIds.length > 0 && (
                <details className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <summary className="cursor-pointer">
                    Las {av.sinTurnoIds.length} que no han tenido turno — dichas por su nombre, no contadas nada más
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 max-h-40 overflow-y-auto pr-1">
                    {av.sinTurnoIds.map((fid) => (
                      <li key={fid} className="truncate">
                        · {fotos.find((f) => f.id === fid)?.etiqueta ?? fid}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {viva && (
                <p className="text-[11px] mt-2 m-0" style={{ color: 'var(--faint)' }}>
                  Esta pantalla es la que empuja las pasadas. Si la cierras, la corrida se queda
                  pausada exactamente donde iba —sin perder nada— y sigue al volver a abrirla.
                </p>
              )}
              {avisoPasada && (
                <p className="text-[11px] mt-1 m-0 font-mono" style={{ color: 'var(--faint)' }}>{avisoPasada}</p>
              )}
              {errorPasada && (
                <p className="text-xs mt-1 m-0" style={{ color: 'var(--bad)' }}>
                  La pasada no pudo correr: {errorPasada}
                </p>
              )}
            </div>
          )}

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

          {/* ── La precisión del OCR, medida ──────────────────────────────── */}
          <MedicionCorrida medicion={medicion} error={medicionError} fotos={fotos} viva={viva} />

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
