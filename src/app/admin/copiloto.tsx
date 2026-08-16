'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ExternalLink, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { mxn, litros, numero } from '@/lib/formato';
import { Logo, LogoIcono } from '../logo';
import { CampoPixeles } from '../dashboard/pixeles';
import { Dona, AreaChartSimple } from './charts';

// ═══════════════════════════════════════════════════════════════════════════
// EL COPILOTO DEL FUNDADOR — la interfaz. Espejo DELIBERADO de
// dashboard/chat.tsx variante hero: puesto junto al chat de un cliente
// tienen que verse como el mismo producto (diseño §6 — si un revisor los
// distingue por el estilo y no por el contenido, está mal hecho). Lo único
// que cambia: el catálogo (compañía, no flota), las sugerencias, y el
// bloque `accion` — la previsualización gateada que aquí se confirma.
//
// LA CONFIRMACIÓN NO ES DEL MODELO: el botón manda un POST aparte con
// `confirmado: true` y el motivo tecleado; el servidor ejecuta la MISMA
// función del ⌘K y la rechaza sin motivo. Sin adjuntos ni historial
// persistente en esta fase (el intercambio 0088 es por tenant) — dicho en
// el reporte, no escondido.
// ═══════════════════════════════════════════════════════════════════════════

const SUGERENCIAS = [
  '¿Qué espera decisión hoy?',
  '¿Cómo va el negocio?',
  '¿Qué agentes están apagados?',
  '¿Por qué subió el costo de IA?',
  'Apaga el agente de cobranza',
];

type Visual =
  | { tipo: 'tabla'; filas: Array<[string, string]> }
  | { tipo: 'dona'; segmentos: Array<{ etiqueta: string; valor: number }> }
  | { tipo: 'cifra'; valor: string; nota?: string }
  | { tipo: 'serie'; puntos: Array<{ dia: string; valor: number }>; formato: 'mxn' | 'numero' };

interface AccionPropuesta {
  accion: string;
  gateo: 'confirma' | 'doble';
  implementada: boolean;
  objetivo: string;
  efecto: string;
  revertir: string;
  motivoSugerido: string | null;
}

interface Respuesta {
  texto: string;
  visuales?: Visual[];
  accion?: AccionPropuesta;
  /** Las pantallas de las tools que respaldaron el turno — la fuente
   *  clicable de cada cifra (§5.2), derivada DETERMINÍSTICAMENTE de qué
   *  tools corrieron, jamás de lo que el modelo diga. */
  fuentes?: Array<{ ruta: string; etiqueta: string }>;
  pendiente?: boolean;
}

/** tool → verbo en español para la secuencia de pensamiento (mismo patrón
 *  ETIQUETA_TOOL del chat del cliente). */
const ETIQUETA_TOOL: Record<string, string> = {
  metrica_negocio: 'Leyendo las métricas del negocio',
  conteos_plataforma: 'Contando la plataforma',
  bandeja: 'Leyendo la bandeja de escalaciones',
  guardia: 'Clasificando la bandeja por severidad',
  metrica_norte: 'Midiendo la métrica norte',
  estado_agentes: 'Consultando el estado de los agentes',
  traza_corrida: 'Abriendo la traza de la corrida',
  pipeline_ventas: 'Leyendo el pipeline de ventas',
  cobranza_saas: 'Revisando la cobranza SaaS',
  costo_por_fase_modelo: 'Desglosando el costo de IA',
  bitacora: 'Leyendo la bitácora de auditoría',
  proponer_accion: 'Armando la previsualización',
  entregar_respuesta_admin: 'Armando la respuesta',
};
const rotuloTool = (t: string) => ETIQUETA_TOOL[t] ?? t.replaceAll('_', ' ');

/** tool → la pantalla que muestra lo mismo. El espejo cliente del mapa del
 *  servidor (copiloto-tools.ts no se importa aquí: arrastra supabaseAdmin
 *  al bundle del navegador). */
const PANTALLA_UI: Record<string, { ruta: string; etiqueta: string }> = {
  metrica_negocio: { ruta: '/admin', etiqueta: 'Consola' },
  conteos_plataforma: { ruta: '/admin', etiqueta: 'Consola' },
  bandeja: { ruta: '/admin/escalaciones', etiqueta: 'Escalaciones' },
  guardia: { ruta: '/admin/escalaciones', etiqueta: 'Escalaciones' },
  metrica_norte: { ruta: '/admin', etiqueta: 'Consola' },
  estado_agentes: { ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' },
  traza_corrida: { ruta: '/admin/corridas', etiqueta: 'Corridas' },
  pipeline_ventas: { ruta: '/admin/vendedores', etiqueta: 'Vendedores' },
  cobranza_saas: { ruta: '/admin/cobranza', etiqueta: 'Cobranza' },
  costo_por_fase_modelo: { ruta: '/admin/costos-facturacion', etiqueta: 'Costos' },
  bitacora: { ruta: '/admin/compliance', etiqueta: 'Compliance' },
};

const FASES_PENSANDO: Array<[number, string]> = [
  [0, 'Pensando…'],
  [3000, 'Leyendo la operación…'],
  [9000, 'Cruzando cifras…'],
  [17000, 'Armando la respuesta…'],
  [30000, 'Esto está tardando más de lo normal…'],
];

/** Los bloques del copiloto → la Respuesta que esta interfaz pinta. Números
 *  crudos del agente; el formato aquí, con lib/formato — una sola fuente. */
function respuestaDeBloques(bloques: Array<Record<string, unknown>>): Respuesta {
  const textos: string[] = [];
  const visuales: Visual[] = [];
  let accion: AccionPropuesta | undefined;
  for (const b of bloques) {
    if (b.tipo === 'texto' && typeof b.texto === 'string') textos.push(b.texto);
    else if (b.tipo === 'cifra' && typeof b.valor === 'number') {
      const f = b.formato === 'mxn' ? mxn : b.formato === 'litros' ? litros : numero;
      visuales.push({ tipo: 'cifra', valor: f(b.valor), nota: typeof b.nota === 'string' ? b.nota : undefined });
    } else if (b.tipo === 'tabla' && Array.isArray(b.filas)) {
      visuales.push({ tipo: 'tabla', filas: (b.filas as Array<[string, string | number]>).map(([k, v]) => [k, typeof v === 'number' ? numero(v) : v]) });
    } else if (b.tipo === 'dona' && Array.isArray(b.segmentos)) {
      visuales.push({ tipo: 'dona', segmentos: b.segmentos as Array<{ etiqueta: string; valor: number }> });
    } else if (b.tipo === 'serie' && Array.isArray(b.puntos)) {
      visuales.push({ tipo: 'serie', puntos: b.puntos as Array<{ dia: string; valor: number }>, formato: b.formato === 'mxn' ? 'mxn' : 'numero' });
    } else if (b.tipo === 'accion' && typeof b.accion === 'string') {
      accion = b as unknown as AccionPropuesta;
    }
  }
  return { texto: textos.join(' ') || 'Listo.', visuales: visuales.length > 0 ? visuales : undefined, accion };
}

function VisualRespuesta({ v }: { v: Visual }) {
  if (v.tipo === 'cifra') {
    return (
      <div className="card px-4 py-3 mt-2 inline-block">
        <div className="font-display text-[22px] leading-tight font-semibold tabular">{v.valor}</div>
        {v.nota && <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{v.nota}</p>}
      </div>
    );
  }
  if (v.tipo === 'dona') return <div className="card p-3 mt-2"><Dona segmentos={v.segmentos} /></div>;
  if (v.tipo === 'serie') {
    return (
      <div className="card p-3 mt-2">
        <AreaChartSimple datos={v.puntos} etiquetaValor={v.formato === 'mxn' ? mxn : numero} />
      </div>
    );
  }
  return (
    <div className="card p-1.5 mt-2">
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          {v.filas.map(([k, val]) => (
            <tr key={k} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}>
              <td className="px-2.5 py-1.5" style={{ color: 'var(--muted)' }}>{k}</td>
              <td className="cifra-mono px-2.5 py-1.5 text-right">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** La previsualización de una acción gateada — el mockup del diseño §6:
 *  efecto, cómo se revierte, motivo OBLIGATORIO y dos botones. La 🔴 y la
 *  no implementada se dicen, sin botón de ejecutar. */
function TarjetaAccion({ a, onEjecutada }: {
  a: AccionPropuesta;
  onEjecutada: (mensaje: string, ok: boolean) => void;
}) {
  const [motivo, setMotivo] = useState(a.motivoSugerido ?? '');
  const [estado, setEstado] = useState<'lista' | 'ejecutando' | 'hecha' | 'cancelada'>('lista');
  const [error, setError] = useState<string | null>(null);

  if (!a.implementada) {
    return (
      <div className="card p-3.5 mt-2" style={{ borderColor: 'var(--warn)' }}>
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <ShieldAlert width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />
          {a.accion} — todavía no está implementada desde el copiloto
        </div>
        <p className="text-[12.5px] mt-1.5" style={{ color: 'var(--muted)' }}>{a.efecto}</p>
        <p className="text-[12px] mt-1" style={{ color: 'var(--faint)' }}>Hoy se hace desde su pantalla del panel.</p>
      </div>
    );
  }
  if (estado === 'hecha' || estado === 'cancelada') {
    return (
      <div className="card p-3 mt-2 text-[13px]" style={{ color: 'var(--muted)' }}>
        {estado === 'hecha' ? 'Acción ejecutada — el resultado quedó abajo.' : 'Acción cancelada. La palanca no se movió.'}
      </div>
    );
  }

  async function ejecutar() {
    if (!motivo.trim()) { setError('El motivo es obligatorio: sin nota, en tres semanas nadie sabe si ya se puede encender.'); return; }
    setEstado('ejecutando');
    setError(null);
    try {
      const resp = await fetch('/api/admin/copiloto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: { id: a.accion, objetivo: a.objetivo, motivo: motivo.trim() },
          confirmado: true,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d?.ok) {
        setEstado('lista');
        setError(typeof d?.error === 'string' ? d.error : 'No se pudo ejecutar. Inténtalo de nuevo.');
        return;
      }
      setEstado('hecha');
      onEjecutada(String(d.mensaje ?? 'Hecho.'), true);
    } catch {
      setEstado('lista');
      setError('No se pudo ejecutar. Inténtalo de nuevo.');
    }
  }

  return (
    <div className="card p-3.5 mt-2" style={{ borderColor: 'var(--warn)' }}>
      <div className="text-[13px] font-medium">
        Voy a {a.accion === 'apagar_agente' ? 'apagar' : 'ejecutar'} <span className="cifra-mono">{a.objetivo}</span>
      </div>
      <label className="block mt-2.5 text-[12px]" style={{ color: 'var(--muted)' }}>
        Motivo (obligatorio)
        <input value={motivo} onChange={(e) => setMotivo(e.target.value)}
          className="mt-1 w-full text-[13px] px-2.5 py-2 rounded-lg hairline" style={{ background: 'var(--surface)', color: 'var(--ink)' }}
          placeholder="Por qué se apaga — queda en la bitácora" />
      </label>
      <p className="text-[12px] mt-2" style={{ color: 'var(--muted)' }}><b>Efecto:</b> {a.efecto}</p>
      <p className="text-[12px] mt-0.5" style={{ color: 'var(--muted)' }}><b>Revertir:</b> {a.revertir}</p>
      {error && <p className="text-[12px] mt-2" style={{ color: 'var(--bad)' }}>{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-3">
        <button type="button" onClick={() => setEstado('cancelada')}
          className="text-[12.5px] font-medium px-3 py-1.5 rounded-full hairline hover:opacity-70 transition-opacity">
          Cancelar
        </button>
        <button type="button" onClick={() => void ejecutar()} disabled={estado === 'ejecutando'}
          className="text-[12.5px] font-medium px-3.5 py-1.5 rounded-full transition-opacity hover:opacity-85 disabled:opacity-50"
          style={{ background: 'var(--ink)', color: 'var(--surface)' }}>
          {estado === 'ejecutando' ? 'Apagando…' : 'Apagar'}
        </button>
      </div>
    </div>
  );
}

export default function Copiloto() {
  const [historial, setHistorial] = useState<Array<{ q: string; r: Respuesta }>>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [fasePensando, setFasePensando] = useState('Pensando…');
  const [pasosVivos, setPasosVivos] = useState<Array<{ tool: string; listo: boolean }>>([]);
  const finConversacion = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finConversacion.current?.scrollIntoView({ block: 'end' });
  }, [historial.length]);

  function preguntar(q: string) {
    if (!q.trim() || ocupado) return;
    setTexto('');
    void preguntarCopiloto(q);
  }

  async function preguntarCopiloto(q: string) {
    setOcupado(true);
    setFasePensando('Pensando…');
    setPasosVivos([]);
    setHistorial((h) => [...h, { q, r: { texto: 'Pensando…', pendiente: true } }]);
    let ticks = 0;
    const relojFases = setInterval(() => {
      ticks += 1;
      const t = ticks * 700;
      const fase = [...FASES_PENSANDO].reverse().find(([desde]) => t >= desde);
      if (fase) setFasePensando(fase[1]);
    }, 700);
    try {
      const previos = historial.flatMap((h) => [
        { rol: 'usuario' as const, texto: h.q },
        { rol: 'asistente' as const, texto: h.r.texto },
      ]);
      const resp = await fetch('/api/admin/copiloto', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: [...previos, { rol: 'usuario', texto: q }] }),
        signal: AbortSignal.timeout(75_000),
      });
      let d: Record<string, unknown> | null = null;
      if (resp.ok && resp.body && (resp.headers.get('content-type') ?? '').includes('ndjson')) {
        const lector = resp.body.getReader();
        const dec = new TextDecoder();
        let resto = '';
        for (;;) {
          const { done, value } = await lector.read();
          if (done) break;
          resto += dec.decode(value, { stream: true });
          let salto;
          while ((salto = resto.indexOf('\n')) >= 0) {
            const linea = resto.slice(0, salto).trim();
            resto = resto.slice(salto + 1);
            if (!linea) continue;
            let ev: Record<string, unknown> | null = null;
            try { ev = JSON.parse(linea) as Record<string, unknown>; } catch { continue; }
            if (ev.t === 'paso' && typeof ev.tool === 'string') {
              const tool = ev.tool;
              if (ev.fase === 'inicio') {
                setPasosVivos((p) => [...p, { tool, listo: false }]);
              } else {
                setPasosVivos((p) => {
                  let idx = -1;
                  for (let i = p.length - 1; i >= 0; i--) {
                    if (p[i].tool === tool && !p[i].listo) { idx = i; break; }
                  }
                  if (idx >= 0) return p.map((x, i) => (i === idx ? { ...x, listo: true } : x));
                  return [...p, { tool, listo: true }];
                });
              }
            } else if (ev.t === 'fin' || ev.t === 'error') {
              d = ev;
            }
          }
        }
      } else {
        d = await resp.json().catch(() => null);
      }
      let r: Respuesta;
      if (resp.ok && d && Array.isArray(d.bloques)) {
        r = respuestaDeBloques(d.bloques as Array<Record<string, unknown>>);
        // La fuente clicable de cada cifra: derivada de qué tools CORRIERON
        // (dato del servidor), deduplicada por pantalla.
        if (Array.isArray(d.toolsUsadas)) {
          const vistas = new Set<string>();
          r.fuentes = (d.toolsUsadas as string[])
            .map((t) => PANTALLA_UI[t])
            .filter((p): p is { ruta: string; etiqueta: string } => Boolean(p))
            .filter((p) => (vistas.has(p.ruta) ? false : (vistas.add(p.ruta), true)));
        }
      } else {
        r = { texto: 'El copiloto no pudo responder en este momento — inténtalo de nuevo.' };
      }
      setHistorial((h) => [...h.slice(0, -1), { q, r }]);
    } catch {
      setHistorial((h) => [...h.slice(0, -1), { q, r: { texto: 'El copiloto no pudo responder en este momento — inténtalo de nuevo.' } }]);
    } finally {
      clearInterval(relojFases);
      setPasosVivos([]);
      setOcupado(false);
    }
  }

  const caja = (
    <form
      onSubmit={(e) => { e.preventDefault(); preguntar(texto); }}
      className="relative w-full rounded-2xl px-4 pt-3.5 pb-3 transition-shadow focus-within:shadow-lg"
      style={{ background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-card)' }}
    >
      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Pregunta sobre la compañía, o pide una acción…"
        aria-label="Pregunta al copiloto"
        className="w-full bg-transparent border-0 outline-none text-[15px] leading-relaxed"
      />
      <div className="flex items-center justify-end mt-3">
        <button
          type="submit"
          aria-label="Enviar"
          disabled={!texto.trim() || ocupado}
          className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-opacity disabled:cursor-default"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)', opacity: texto.trim() && !ocupado ? 1 : 0.35 }}
        >
          <ArrowUp width={15} height={15} strokeWidth={2.5} />
        </button>
      </div>
    </form>
  );

  const vacio = historial.length === 0;

  if (!vacio) {
    return (
      <div className="min-h-full w-full flex-1 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 flex flex-col px-4 pt-4">
            <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col">
              <div className="flex-1 space-y-4 py-2">
                {historial.map((h, i) => (
                  <div key={i}>
                    <div className="flex justify-end">
                      <div className="hairline rounded-2xl rounded-br-md px-3.5 py-2 text-sm max-w-[85%]" style={{ background: 'var(--surface)' }}>
                        {h.q}
                      </div>
                    </div>
                    <div className="mt-2.5 text-sm max-w-[85%]">
                      {h.r.pendiente ? (
                        <div className="flex items-start gap-2.5">
                          <span className="likida-respira shrink-0 mt-0.5"><LogoIcono alto="h-[16px]" /></span>
                          <div>
                            <div style={{ color: 'var(--muted)' }}>{fasePensando}</div>
                            {pasosVivos.length > 0 && (
                              <div className="mt-2 space-y-1.5">
                                {pasosVivos.map((p, j) => (
                                  <div key={j} className="flex items-center gap-2 text-[12.5px]"
                                    style={{ color: p.listo ? 'var(--faint)' : 'var(--ink)' }}>
                                    {p.listo
                                      ? <Check width={12} height={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--muted)' }} />
                                      : <span className="skeleton inline-block w-2.5 h-2.5 rounded-full shrink-0" />}
                                    {rotuloTool(p.tool)}{p.listo ? '' : '…'}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div>{h.r.texto}</div>
                      )}
                      {h.r.visuales?.map((v, j) => <VisualRespuesta key={j} v={v} />)}
                      {h.r.accion && (
                        <TarjetaAccion a={h.r.accion}
                          onEjecutada={(mensaje) => {
                            setHistorial((prev) => [...prev, { q: '(acción confirmada)', r: { texto: mensaje } }]);
                          }} />
                      )}
                      {h.r.fuentes && h.r.fuentes.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <span className="text-[11px]" style={{ color: 'var(--faint)' }}>Fuentes:</span>
                          {h.r.fuentes.map((f) => (
                            <Link key={f.ruta} href={f.ruta}
                              className="hairline inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full hover:opacity-70 transition-opacity"
                              style={{ background: 'var(--surface)' }}>
                              {f.etiqueta} <ExternalLink width={10} height={10} strokeWidth={1.75} />
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={finConversacion} />
              </div>
              <div className="sticky bottom-0 shrink-0 pt-3 pb-4" style={{ background: 'var(--g1)' }}>
                {caja}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex-1 flex">
      <div className="relative flex-1 min-w-0 flex flex-col">
        <CampoPixeles />
        <div className="relative z-10 w-full flex-1 flex flex-col items-center justify-center px-4 py-10">
          <div className="w-full max-w-2xl flex flex-col items-center">
            <Logo alto="h-7" className="mb-6" />
            <h1 className="text-[26px] leading-tight font-medium tracking-tight text-center">
              El copiloto del fundador
            </h1>
            <p className="mt-2 mb-8 text-sm text-center max-w-md" style={{ color: 'var(--muted)' }}>
              La compañía entera, con la cifra que ya calculó el motor — y las acciones
              gateadas que hoy exigen recorrer pantallas.
            </p>

            {caja}

            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {SUGERENCIAS.map((pq) => (
                <button
                  key={pq}
                  type="button"
                  onClick={() => preguntar(pq)}
                  className="text-xs px-3 py-1.5 rounded-full hairline transition-opacity hover:opacity-70"
                  style={{ color: 'var(--ink2)', background: 'var(--surface)' }}
                >
                  {pq}
                </button>
              ))}
            </div>

            <p className="mt-8 text-[11px] leading-relaxed text-center max-w-lg" style={{ color: 'var(--faint)' }}>
              Toda cifra sale de una consulta real y trae su pantalla fuente. Las acciones se
              previsualizan y TÚ confirmas — el modelo nunca ejecuta. No traduce preguntas
              libres a consultas de base de datos, a propósito.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
