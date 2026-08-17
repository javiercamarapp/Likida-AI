'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ExternalLink, History, PanelRightClose, PencilLine, Search, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { mxn, litros, numero, fechaCorta } from '@/lib/formato';
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
// función del ⌘K y la rechaza sin motivo. Sin adjuntos en esta fase.
//
// HISTORIAL PERSISTENTE (0121, cierre del pendiente declarado): tablas
// propias porque 0088 exige tenant y el copiloto es de Likida. El cajón es
// el MISMO del chat del cliente. Una acción reabierta del historial se
// muestra ARCHIVADA, sin botón: la previsualización vieja no ejecuta — se
// pide de nuevo y el servidor la re-propone con el estado de hoy.
//
// DOS VARIANTES del diseño §6 ("las dos, y no es indecisión"): `pagina`
// (/admin/copiloto, sesiones largas) y `panel` (el lateral persistente del
// chrome, copiloto-panel.tsx) — un componente, no una copia.
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
  /** Turno reabierto del historial (0121): su acción se muestra archivada,
   *  sin botón de ejecutar. */
  archivada?: boolean;
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
  ficha_cliente: 'Armando la ficha 360 del cliente',
  estado_runner: 'Leyendo el pulso del runner',
  adquisicion: 'Midiendo la adquisición',
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
  cobranza_saas: { ruta: '/admin/costos-facturacion', etiqueta: 'Costos y facturación' },
  costo_por_fase_modelo: { ruta: '/admin/costos-facturacion', etiqueta: 'Costos' },
  bitacora: { ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' },
  ficha_cliente: { ruta: '/admin/flotas', etiqueta: 'Flotas / Clientes' },
  estado_runner: { ruta: '/admin/observabilidad', etiqueta: 'Observabilidad' },
  adquisicion: { ruta: '/admin/crecimiento', etiqueta: 'Crecimiento' },
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

export default function Copiloto({ variante = 'pagina' }: { variante?: 'pagina' | 'panel' }) {
  const [historial, setHistorial] = useState<Array<{ q: string; r: Respuesta }>>([]);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [fasePensando, setFasePensando] = useState('Pensando…');
  const [pasosVivos, setPasosVivos] = useState<Array<{ tool: string; listo: boolean }>>([]);
  const finConversacion = useRef<HTMLDivElement>(null);

  // ── Historial persistente (0121) — el MISMO patrón 0088 del chat ─────────
  // La conversación abierta vive en la base; este id la ancla. `convs` es la
  // lista del panel: null = cargando, 'error' = no se pudo leer (y se DICE —
  // una lista vacía por error afirmaría "no has chateado").
  const [conversacionId, setConversacionId] = useState<string | null>(null);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [convs, setConvs] = useState<Array<{ id: string; titulo: string; actualizadoEn: string }> | 'error' | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  // El ancla sticky marca el tope visible del área del chat; el cajón de la
  // página se mide contra ella AL ABRIR — en el handler, no en un efecto.
  const anclaChat = useRef<HTMLDivElement>(null);
  const [topPanel, setTopPanel] = useState(16);

  const cargarLista = useCallback(() => {
    fetch('/api/admin/copiloto/conversaciones')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setConvs(Array.isArray(d?.conversaciones) ? d.conversaciones : 'error'))
      .catch(() => setConvs('error'));
  }, []);

  // La página carga la lista al montar (el botón trae su conteo real, como
  // el chat); el panel lateral vive en TODAS las pantallas de /admin, así
  // que ahí se carga hasta que el historial se abre — ver abrirHistorial.
  useEffect(() => {
    if (variante !== 'pagina') return;
    cargarLista();
  }, [variante, cargarLista]);

  function abrirHistorial() {
    const r = anclaChat.current?.getBoundingClientRect();
    setTopPanel(Math.max(16, Math.round(r?.top ?? 16)));
    setErrorCarga(null);
    if (convs === null || convs === 'error') cargarLista();
    setHistorialAbierto(true);
  }

  /** Reabre una conversación guardada: sus mensajes bajan al hilo y las
   *  visuales se re-pintan desde los bloques crudos. Las acciones reabren
   *  ARCHIVADAS — la previsualización vieja no ejecuta. */
  async function cargarConversacion(id: string) {
    if (ocupado) return;
    setErrorCarga(null);
    try {
      const resp = await fetch(`/api/admin/copiloto/conversaciones/${id}`);
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d || !Array.isArray(d.mensajes)) throw new Error('respuesta inválida');
      const pares: Array<{ q: string; r: Respuesta }> = [];
      for (const m of d.mensajes as Array<{ rol: string; texto: string; bloques: unknown }>) {
        if (m.rol === 'usuario') {
          pares.push({ q: m.texto, r: { texto: '' } });
        } else if (pares.length > 0) {
          const r = Array.isArray(m.bloques) && m.bloques.length > 0
            ? respuestaDeBloques(m.bloques as Array<Record<string, unknown>>)
            : { texto: m.texto };
          pares[pares.length - 1].r = { ...r, archivada: true };
        }
      }
      setHistorial(pares);
      setConversacionId(id);
      setHistorialAbierto(false);
    } catch {
      setErrorCarga('No se pudo abrir esa conversación — inténtalo de nuevo.');
    }
  }

  function nuevoChat() {
    setHistorial([]);
    setConversacionId(null);
    setTexto('');
    setHistorialAbierto(false);
  }

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
        body: JSON.stringify({ mensajes: [...previos, { rol: 'usuario', texto: q }], conversacionId }),
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
      // El id que el servidor asignó al persistir (0121): anexar aquí los
      // turnos siguientes. Si guardar falló, viene null y no se toca.
      if (resp.ok && d && typeof d.conversacionId === 'string') {
        setConversacionId(d.conversacionId);
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

  // El hilo de la conversación — COMPARTIDO por la página y el panel: un
  // componente, no una copia (la regla de la única librería de UI).
  const hilo = (
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
            {h.r.accion && (h.r.archivada ? (
              // Una acción reabierta del historial NO trae botón: la
              // previsualización vieja describe el estado de AQUEL día —
              // ejecutarla hoy firmaría sobre un efecto que ya no es verdad.
              <div className="card p-3 mt-2 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Propuesta archivada del historial (<span className="cifra-mono">{h.r.accion.objetivo}</span>).
                Para ejecutarla, pídela de nuevo — se re-propone con el estado de hoy.
              </div>
            ) : (
              <TarjetaAccion a={h.r.accion}
                onEjecutada={(mensaje) => {
                  setHistorial((prev) => [...prev, { q: '(acción confirmada)', r: { texto: mensaje } }]);
                }} />
            ))}
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
  );

  // ── HISTORIAL (0121) — el MISMO cajón del chat del cliente (0088) ────────
  const listaFiltrada = Array.isArray(convs)
    ? convs.filter((c) => c.titulo.toLowerCase().includes(busqueda.trim().toLowerCase()))
    : [];

  // El cuerpo de la lista — compartido por el cajón de la página y la vista
  // del panel lateral: búsqueda, estados honestos y las conversaciones.
  const cuerpoLista = (
    <>
      <div className="hairline flex items-center gap-2 px-3 py-2 rounded-full" style={{ background: 'var(--canvas)' }}>
        <Search width={13} height={13} strokeWidth={2} style={{ color: 'var(--muted)' }} />
        <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar chats" aria-label="Buscar chats"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[13px]" />
      </div>

      <div className="etiqueta-mono text-[10px] uppercase px-1 pt-1" style={{ color: 'var(--faint)' }}>
        Recientes
      </div>

      {errorCarga && (
        <p className="text-[12px] px-1" style={{ color: 'var(--bad)' }}>{errorCarga}</p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5">
        {convs === null && (
          <div className="space-y-2 px-1 pt-1">
            <div className="skeleton h-4 rounded" /><div className="skeleton h-4 rounded w-4/5" /><div className="skeleton h-4 rounded w-3/5" />
          </div>
        )}
        {convs === 'error' && (
          <p className="text-[12.5px] px-1" style={{ color: 'var(--muted)' }}>
            No se pudo leer el historial ahora mismo — tus conversaciones siguen
            guardadas; reintenta en un momento.
          </p>
        )}
        {Array.isArray(convs) && listaFiltrada.length === 0 && (
          <p className="text-[12.5px] px-1" style={{ color: 'var(--muted)' }}>
            {convs.length === 0 ? 'Sin chats recientes.' : `Nada coincide con «${busqueda.trim()}».`}
          </p>
        )}
        {listaFiltrada.map((c) => {
          const activa = c.id === conversacionId;
          return (
            <button key={c.id} type="button" onClick={() => void cargarConversacion(c.id)}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[13px] transition-colors ${activa ? 'font-medium' : 'hover:bg-[var(--canvas)]'}`}
              style={activa ? { background: 'var(--g1)', color: 'var(--marca)' } : undefined}>
              <span className="block truncate">{c.titulo}</span>
              <span className="block text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{fechaCorta(c.actualizadoEn)}</span>
            </button>
          );
        })}
      </div>
    </>
  );

  // El pill flotante con el conteo real y el cajón derecho EN FLUJO —
  // mismas medidas, misma curva easeOutQuint y mismo sticky que chat.tsx.
  const pillHistorial = (
    <div ref={anclaChat} className="sticky top-0 z-30 h-0 w-full">
      {!historialAbierto && (
        <button type="button" onClick={abrirHistorial}
          className="absolute top-3 right-4 hairline inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)]"
          style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
          <History width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
          Historial
          {Array.isArray(convs) && (
            <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
              {numero(convs.length)}
            </span>
          )}
        </button>
      )}
    </div>
  );

  const cajonHistorial = (
    <div className="shrink-0 self-start sticky top-4 mt-4 overflow-hidden"
      style={{ width: historialAbierto ? 352 : 0, height: `calc(100dvh - ${topPanel + 32}px)`, transition: 'width 480ms cubic-bezier(0.22, 1, 0.36, 1)' }}>
      <div className="w-[320px] mx-4 h-full rounded-2xl hairline flex flex-col p-3 gap-2.5"
        style={{ background: 'var(--surface)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center justify-between">
          <button type="button" onClick={nuevoChat}
            className="hairline flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]">
            <PencilLine width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
            Nuevo chat
          </button>
          <button type="button" aria-label="Cerrar historial" title="Cerrar historial" onClick={() => setHistorialAbierto(false)}
            className="w-8 h-8 ml-1.5 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)]"
            style={{ color: 'var(--muted)' }}>
            <PanelRightClose width={15} height={15} strokeWidth={1.75} />
          </button>
        </div>
        {cuerpoLista}
      </div>
    </div>
  );

  // ── VARIANTE PANEL (diseño §6: el lateral persistente del chrome) ────────
  // Compacto: sin portada de pixeles ni logo grande — el panel vive junto a
  // la pantalla que Javier está mirando. El historial no cabe al lado en
  // 400px, así que aquí es un CAMBIO DE VISTA, no un cajón.
  if (variante === 'panel') {
    return (
      <div className="h-full min-h-0 flex flex-col px-3 pb-3">
        <div className="flex items-center justify-between gap-1.5 py-2 shrink-0">
          <button type="button" onClick={() => (historialAbierto ? setHistorialAbierto(false) : abrirHistorial())}
            className="hairline inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1.5 rounded-full text-[12.5px] font-medium transition-colors hover:bg-[var(--canvas)]"
            style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
            <History width={13} height={13} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
            Historial
            {Array.isArray(convs) && (
              <span className="cifra-mono text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--muted)' }}>
                {numero(convs.length)}
              </span>
            )}
          </button>
          <button type="button" onClick={nuevoChat} title="Nuevo chat" aria-label="Nuevo chat"
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)]"
            style={{ color: 'var(--muted)' }}>
            <PencilLine width={14} height={14} strokeWidth={1.75} />
          </button>
        </div>

        {historialAbierto ? (
          <div className="flex-1 min-h-0 flex flex-col gap-2.5">{cuerpoLista}</div>
        ) : vacio ? (
          <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-4 px-1">
            <p className="text-sm text-center max-w-[260px]" style={{ color: 'var(--muted)' }}>
              La compañía entera, con la cifra que ya calculó el motor — sin perder
              la pantalla que estás mirando.
            </p>
            <div className="w-full">{caja}</div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGERENCIAS.map((pq) => (
                <button key={pq} type="button" onClick={() => preguntar(pq)}
                  className="text-xs px-3 py-1.5 rounded-full hairline transition-opacity hover:opacity-70"
                  style={{ color: 'var(--ink2)', background: 'var(--surface)' }}>
                  {pq}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto">{hilo}</div>
            <div className="shrink-0 pt-2">{caja}</div>
          </>
        )}
      </div>
    );
  }

  if (!vacio) {
    return (
      <div className="min-h-full w-full flex-1 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          {pillHistorial}
          <div className="flex-1 flex flex-col px-4 pt-4">
            <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col">
              {hilo}
              <div className="sticky bottom-0 shrink-0 pt-3 pb-4" style={{ background: 'var(--g1)' }}>
                {caja}
              </div>
            </div>
          </div>
        </div>
        {cajonHistorial}
      </div>
    );
  }

  return (
    <div className="min-h-full w-full flex-1 flex">
      <div className="relative flex-1 min-w-0 flex flex-col">
        <CampoPixeles />
        {pillHistorial}
        {/* El centrado vive en ESTA capa: con el ancla sticky adentro del
            justify-center, el pill saldría a media pantalla, no arriba. */}
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
      {cajonHistorial}
    </div>
  );
}
