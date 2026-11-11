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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileText, MessageCircle } from 'lucide-react';
import { fechaHoraMx, usd4 } from '@/lib/formato';
import { TituloSeccion } from '../../../dashboard/resumen-visual';
import { BotonEnlace, EstadoError, MarcoPagina } from '@/app/ui-v2/componentes';
import '../qa.css';
import { StatusPill, type Estado } from '../../ui/kit';
import { pillCorrida } from '../pantalla';
import { escenarioPorId } from '@/lib/admin/qa-escenarios';
import type { CorridaQA, EstadoPaso } from '@/lib/admin/qa-tipos';
import type { ResumenPrecisionCorrida } from '@/lib/admin/qa-verdad';
import { MedicionCorrida } from './medicion-corrida';
import { useT } from '@/lib/i18n/proveedor';
import { admin_sistema as admin_sistemaEs } from '@/lib/i18n/es/admin_sistema';
import { type TSistema, T_SISTEMA_ES } from '@/lib/i18n/sistema_tr';
import { rico } from '@/lib/i18n/rico';

export interface FotoFirmada { id: string; etiqueta: string; url: string | null }
export interface PdfFirmado { path: string; url: string | null }

const pillPaso = (tx: TSistema = T_SISTEMA_ES): Record<EstadoPaso, { estado: Estado; etiqueta: string }> => ({
  pendiente: { estado: 'neutral', etiqueta: tx('qa_corrida_viva.pendiente') },
  corriendo: { estado: 'neutral', etiqueta: tx('qa_corrida_viva.corriendo') },
  ok: { estado: 'ok', etiqueta: 'ok' },
  warn: { estado: 'warn', etiqueta: 'warn' },
  bad: { estado: 'bad', etiqueta: 'bad' },
});

const pillOraculo = (tx: TSistema = T_SISTEMA_ES): Record<'ok' | 'fallo' | 'no_verificado', { estado: Estado; etiqueta: string }> => ({
  ok: { estado: 'ok', etiqueta: 'ok' },
  fallo: { estado: 'bad', etiqueta: tx('qa_corrida_viva.fallo') },
  no_verificado: { estado: 'warn', etiqueta: tx('qa_corrida_viva.no_verificado') },
});

const TERMINALES = new Set(['ok', 'parcial', 'fallo', 'abortada']);

function json(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
}

function CuerpoCorrida({ corridaInicial, fotosIniciales, pdfsIniciales, medicionInicial = null, medicionErrorInicial = null }: {
  corridaInicial: CorridaQA;
  fotosIniciales: FotoFirmada[];
  pdfsIniciales: PdfFirmado[];
  medicionInicial?: ResumenPrecisionCorrida | null;
  medicionErrorInicial?: string | null;
}) {
  const { t: tx, idioma } = useT('admin_sistema', admin_sistemaEs);
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
          setErrorLectura(cuerpo?.error ?? tx('qa_corrida_viva.no_se_pudo_leer_el_estado', { status: res.status }));
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
  }, [viva, corrida.id, tx]);

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
          setErrorPasada(cuerpo?.error ?? tx('qa_corrida_viva.la_pasada_no_pudo_correr_http', { status: res.status }));
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
  }, [viva, corrida.carril, corrida.id, tx]);

  const pill = pillCorrida(tx)[corrida.estado] ?? { estado: 'neutral' as Estado, etiqueta: corrida.estado };
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
      <div className="space-y-2.5">
          {/* ── Avisos de lectura (fallar cerrado, dicho) ─────────────────── */}
          {errorLectura && (
            <div className="card p-3 text-sm rv-qa-malo">{tx('qa_corrida_viva.no_se_pudo_leer_el_estado_2', { errorLectura })}</div>
          )}
          {posiblementeMuerta && (
            <div className="card p-3 text-sm rv-qa-malo">{tx('qa_corrida_viva.el_motor_lleva_s_sin_dar', { sinLatidoS, tenantNombre: corrida.tenantNombre })}</div>
          )}

          {/* ── El renglón resumen ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="hairline rounded-lg px-3 py-2.5 rv-qa-fs">
              <div className="text-xs rv-qa-mut">{tx('salud_sistema.estado')}</div>
              <div className="mt-1"><StatusPill estado={pill.estado}>{pill.etiqueta}</StatusPill></div>
              {corrida.motivo && <div className="text-[10px] mt-1 rv-qa-mut">{corrida.motivo}</div>}
            </div>
            <div className="hairline rounded-lg px-3 py-2.5 rv-qa-fs">
              <div className="text-xs rv-qa-mut">{tx('qa_corrida_viva.carril')}</div>
              <div className="mt-1 text-sm font-medium">
                {corrida.carril === 'completo' ? tx('qa_corrida_viva.completo_en_varias_pasadas') : tx('qa_corrida_viva.rapido_en_un_solo_proceso')}
              </div>
              {corrida.carril === 'completo' && (
                <div className="text-[10px] mt-0.5 rv-qa-mut">{tx('qa_corrida_viva.pasada', { pasadas: corrida.pasadas })}{' '}{enPasada ? tx('qa_corrida_viva.trabajando_ahora') : viva ? tx('qa_corrida_viva.pausada_entre_pasadas') : 'terminada'}
                </div>
              )}
            </div>
            <div className="hairline rounded-lg px-3 py-2.5 rv-qa-fs">
              <div className="text-xs rv-qa-mut">{tx('qa_corrida_viva.costo_hasta_ahora_real')}</div>
              <div className="mt-1 text-sm font-medium tabular">{usd4(corrida.costoUsdTotal ?? 0)}</div>
              <div className="text-[10px] mt-0.5 rv-qa-mut">{tx('qa_corrida_viva.costo_registrado_nunca_estimado')}</div>
            </div>
            <div className="hairline rounded-lg px-3 py-2.5 rv-qa-fs">
              <div className="text-xs rv-qa-mut">{tx('qa_corrida_viva.flota_de_prueba')}</div>
              <div className="mt-1 text-xs font-mono break-all">{corrida.tenantNombre}</div>
              <div className="text-[10px] mt-0.5 rv-qa-mut">
                {corrida.inicio ? tx('qa_corrida_viva.inicio', { v: fechaHoraMx(corrida.inicio, idioma) }) : tx('qa_corrida_viva.sin_arrancar')}{corrida.fin ? ` · ${tx('qa_corrida_viva.fin', { v: fechaHoraMx(corrida.fin, idioma) })}` : ''}
              </div>
            </div>
          </div>

          {/* ── EL AVANCE DEL CARRIL COMPLETO ─────────────────────────────
              Cuántas van, cuántas faltan, y —si se cortó— POR QUÉ y CUÁLES
              quedaron sin turno. Todo medido: cada número sale de una fila de
              `qa_corrida_foto`, ninguno de una resta a ojo. */}
          {corrida.carril === 'completo' && av !== null && (
            <div className="card p-3">
              <TituloSeccion>{tx('qa_corrida_viva.el_avance_foto_por_foto')}</TituloSeccion>
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <div className="font-display text-[22px] leading-tight font-semibold tabular">{rico(tx('qa_corrida_viva.e0_de_fotos_procesadas_e0', { ok: av.ok, total: av.total }), { e0: (c) => <span className="text-[14px] font-normal rv-qa-mut">{c}</span> })}</div>
                {av.sinTurno > 0 && (
                  <span className="text-xs rv-qa-mut">{tx('qa_corrida_viva.sin_turno_todavia', { sinTurno: av.sinTurno })}</span>
                )}
                {av.enVuelo > 0 && (
                  <span className="text-xs rv-qa-mut">{tx('qa_corrida_viva.en_vuelo', { enVuelo: av.enVuelo })}</span>
                )}
                {av.bad > 0 && (
                  <span className="text-xs rv-qa-bad">{tx('qa_corrida_viva.con_fallo', { bad: av.bad })}</span>
                )}
                {av.interrumpidas > 0 && (
                  <span className="text-xs rv-qa-warn">{tx(av.interrumpidas === 1 ? 'qa_corrida_viva.interrumpida_una' : 'qa_corrida_viva.interrumpida_varias', { interrumpidas: av.interrumpidas })}{' '}{tx('qa_corrida_viva.una_pasada_murio_con_ellas_en')}</span>
                )}
              </div>
              <div className="mt-1.5 h-1.5 rounded-full overflow-hidden rv-qa-fl2">
                <progress className="rv-qa-barra" value={av.ok + av.bad} max={Math.max(av.total, 1)} aria-label={tx('qa_corrida_viva.avance_de_la_corrida')} />
              </div>

              {corrida.corte !== null && (
                <p className={corrida.corte === 'dinero' ? 'text-xs mt-2 m-0 rv-qa-bad' : 'text-xs mt-2 m-0 rv-qa-mut'}>
                  {corrida.corte === 'dinero'
                    ? tx('qa_corrida_viva.la_ultima_pasada_paro_por_dinero')
                    : tx('qa_corrida_viva.la_ultima_pasada_paro_por_reloj')}
                </p>
              )}

              {av.sinTurnoIds.length > 0 && (
                <details className="mt-2 text-xs rv-qa-mut">
                  <summary className="cursor-pointer">{tx('qa_corrida_viva.las_que_no_han_tenido_turno', { length: av.sinTurnoIds.length })}</summary>
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
                <p className="text-[11px] mt-2 m-0 rv-qa-faint">{tx('qa_corrida_viva.esta_pantalla_es_la_que_empuja')}</p>
              )}
              {avisoPasada && (
                <p className="text-[11px] mt-1 m-0 font-mono rv-qa-faint">{avisoPasada}</p>
              )}
              {errorPasada && (
                <p className="text-xs mt-1 m-0 rv-qa-bad">{tx('qa_corrida_viva.la_pasada_no_pudo_correr', { errorPasada })}</p>
              )}
            </div>
          )}

          {/* ── Los pasos (el ledger en vivo) ─────────────────────────────── */}
          <div className="card p-3">
            <TituloSeccion>{tx('qa_corrida_viva.la_corrida_paso_a_paso')}</TituloSeccion>
            {corrida.pasos.length === 0 ? (
              <p className="text-sm mt-2 rv-qa-mut">{tx('qa_corrida_viva.todavia_no_arranca_el_primer_paso')}{viva ? tx('qa_corrida_viva.esta_pantalla_se_actualiza_sola_cada') : ''}.
              </p>
            ) : (
              <div className="mt-2 space-y-1">
                {corrida.pasos.map((p) => {
                  const pp = pillPaso(tx)[p.estado] ?? pillPaso(tx).pendiente;
                  return (
                    <div key={p.n} className="flex items-start justify-between gap-3 text-sm py-1 border-b rv-qa-bl2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs mr-2 rv-qa-mut">{p.n}.</span>
                        {p.nombre}
                        {p.detalle && <div className="text-xs mt-0.5 rv-qa-mut">{p.detalle}</div>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {p.costoUsd > 0 && <span className="text-xs tabular rv-qa-mut">{usd4(p.costoUsd)}</span>}
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
            <TituloSeccion>{tx('qa_corrida_viva.el_veredicto_el_llm_explora_el')}</TituloSeccion>
            {corrida.veredicto === null ? (
              <p className="text-sm mt-2 rv-qa-mut">
                {viva ? tx('qa_corrida_viva.los_oraculos_corren_al_final_de') : tx('qa_corrida_viva.esta_corrida_termino_sin_veredicto_los')}
              </p>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table aria-label={tx('qa_corrida_viva.veredicto_por_invariante')} className="w-full text-sm">
                  <thead>
                    <tr className="rv-qa-mut text-left">
                      <th scope="col" className="px-2 py-1.5 font-medium">{tx('qa_corrida_viva.invariante')}</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">{tx('salud_sistema.estado')}</th>
                      <th scope="col" className="px-2 py-1.5 font-medium">{tx('trust_safety.severidad')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {corrida.veredicto.map((v, i) => {
                      const pv = pillOraculo(tx)[v.estado];
                      return (
                        <tr key={i} className="border-t align-top rv-qa-bl2">
                          <td className="px-2 py-2">
                            <details>
                              <summary className="cursor-pointer font-medium">{v.invariante}</summary>
                              <div className="mt-2 text-xs space-y-1.5">
                                <div>
                                  <span className="font-semibold">{tx('qa_corrida_viva.esperado')}</span>{' '}
                                  <code className="font-mono break-all">{json(v.esperado)}</code>
                                </div>
                                <div>
                                  <span className="font-semibold">{tx('qa_corrida_viva.real')}</span>{' '}
                                  <code className="font-mono break-all">{json(v.real)}</code>
                                </div>
                                {v.detalle && <div className="rv-qa-mut">{v.detalle}</div>}
                                <div className="font-mono rv-qa-faint">{v.oraculo}</div>
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
              <TituloSeccion>{tx('qa_corrida_viva.la_conversacion_evidencia_solo_lectura')}</TituloSeccion>
              {corrida.turnos.length === 0 ? (
                <p className="text-sm mt-2 rv-qa-mut">
                  {viva ? tx('qa_corrida_viva.los_turnos_aparecen_al_cierre_de') : tx('qa_corrida_viva.no_quedo_conversacion_registrada')}
                </p>
              ) : (
                <div className="mt-2 space-y-1.5 max-h-80 overflow-y-auto pr-1">
                  {corrida.turnos.map((t, i) => (
                    <div key={i} className={`flex ${t.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={t.rol === 'user' ? 'max-w-[85%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap hairline rv-qa-burbuja-user' : 'max-w-[85%] rounded-xl px-3 py-1.5 text-xs whitespace-pre-wrap hairline rv-qa-burbuja-bot'}>
                        <span className="inline-flex items-center gap-1 font-medium text-[10px] opacity-70">
                          <MessageCircle width={10} height={10} strokeWidth={1.75} /> {t.rol === 'user' ? tx('qa_corrida_viva.chofer_sintetico') : 'Likida'}
                        </span>
                        <div>{t.texto}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card p-3">
              <TituloSeccion>{tx('qa_corrida_viva.fotos_y_pdf_de_esta_corrida')}</TituloSeccion>
              <div className="mt-2 space-y-1.5">
                {fotos.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 text-sm py-1 border-b rv-qa-bl2">
                    <span className="inline-flex items-center gap-1.5 min-w-0">
                      <Camera width={13} height={13} strokeWidth={1.75} className="rv-qa-mut" />
                      <span className="truncate text-xs">{f.etiqueta}</span>
                    </span>
                    {f.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer" className="text-xs font-medium px-2 py-0.5 rounded-full hairline hover:opacity-70 shrink-0">{tx('qa_corrida_viva.abrir_firma_60_s')}</a>
                    ) : (
                      <span className="text-xs shrink-0 rv-qa-faint">{tx('qa_corrida_viva.sin_firma')}</span>
                    )}
                  </div>
                ))}
                {(corrida.pdfs ?? []).length === 0 ? (
                  <p className="text-xs pt-1 rv-qa-mut">
                    {viva ? tx('qa_corrida_viva.el_pdf_aparece_si_el_cierre') : tx('qa_corrida_viva.no_quedo_pdf_registrado_en_esta')}
                  </p>
                ) : (
                  pdfs.map((p) => (
                    <div key={p.path} className="flex items-center justify-between gap-2 text-sm py-1">
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <FileText width={13} height={13} strokeWidth={1.75} className="rv-qa-mut" />
                        <span className="truncate text-xs font-mono">{p.path.split('/').pop()}</span>
                      </span>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-medium px-2 py-0.5 rounded-full hairline hover:opacity-70 shrink-0">{tx('qa_corrida_viva.abrir_pdf_firma_60_s')}</a>
                      ) : (
                        <span className="text-xs shrink-0 rv-qa-faint">{tx('qa_corrida_viva.borrado_con_el_tenant_retencion_conservar')}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ── La limpieza, dicha ────────────────────────────────────────── */}
          {corrida.limpieza && (
            <div className="card p-3 text-xs rv-qa-mut">{rico(tx('qa_corrida_viva.e0_limpieza_e0', { limpieza: corrida.limpieza }), { e0: (c) => <span className="font-semibold">{c}</span> })}</div>
          )}
      </div>
  );
}

/** La pantalla de una corrida: UN solo MarcoPagina. Si la lectura de la corrida falló (`errorLectura`), lo dice en lugar del cuerpo: no es que no exista, es que no se pudo mirar. */
export function CorridaViva({ corridaInicial = null, errorLectura = null, ...resto }: {
  corridaInicial?: CorridaQA | null;
  errorLectura?: string | null;
  fotosIniciales?: FotoFirmada[];
  pdfsIniciales?: PdfFirmado[];
  medicionInicial?: ResumenPrecisionCorrida | null;
  medicionErrorInicial?: string | null;
}) {
  const { t: tx } = useT('admin_sistema', admin_sistemaEs);
  return (
    <MarcoPagina
      area={tx('qa_corrida_viva.calidad')}
      titulo={corridaInicial ? tx('qa_corrida_viva.corrida', { v: corridaInicial.id.slice(0, 8) }) : tx('qa_corrida_viva.calidad')}
      apoyo={corridaInicial
        ? tx('qa_corrida_viva.escenario_el_avance_el_veredicto_y', { v: escenarioPorId(corridaInicial.escenario)?.nombre ?? corridaInicial.escenario })
        : tx('qa_corrida_viva.la_corrida_de_pruebas_reales_no')}
      acciones={<BotonEnlace href="/admin/qa" variante="secondary" tamano="sm">{tx('qa_corrida_viva.volver_a_pruebas_reales')}</BotonEnlace>}
    >
      {corridaInicial ? (
        <CuerpoCorrida corridaInicial={corridaInicial} fotosIniciales={resto.fotosIniciales ?? []} pdfsIniciales={resto.pdfsIniciales ?? []} medicionInicial={resto.medicionInicial} medicionErrorInicial={resto.medicionErrorInicial} />
      ) : (
        <EstadoError reintentar>{tx('qa_corrida_viva.no_se_pudo_leer_la_corrida', { v: errorLectura ?? '' })}</EstadoError>
      )}
    </MarcoPagina>
  );
}
