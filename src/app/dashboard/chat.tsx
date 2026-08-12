'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, ArrowUp, Search, Paperclip, Camera, FileImage } from 'lucide-react';
import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';
import { mxn, litros, numero } from '@/lib/formato';
import { useSearchParams } from 'next/navigation';
import { Logo } from '../logo';
import { Dona, AreaChartSimple } from '../admin/charts';

/**
 * Mismo criterio que admin/chat.tsx: coincidencia de palabras clave contra
 * datos YA calculados en el servidor (`kpis`/`acred`), nunca lenguaje
 * natural a SQL con permisos de servicio. Aquí pesa MÁS que en admin —
 * un tenant real, no solo Javier, podría escribir cualquier cosa en esta
 * caja.
 */
const PREGUNTAS = [
  '¿Cuánto llevo comprobado?',
  '¿Cuántos viajes tengo con diferencia?',
  '¿Cuánto diésel es elegible para el estímulo?',
  '¿Cuál es mi tasa de cuadre?',
  '¿Cuánto llevo de acreditables?',
];

// ── Respuestas con forma (12-ago-2026: "que responda con gráficas, tablas
// y muy visual") — cada respuesta puede traer, además del texto, una pieza
// visual armada con los MISMOS datos ya calculados: una tabla chica, la
// dona de `admin/charts` o una cifra grande. Nada se grafica sin dato real:
// con la flota en cero, la respuesta es el texto honesto de siempre.

type Visual =
  | { tipo: 'tabla'; filas: Array<[string, string]> }
  | { tipo: 'dona'; segmentos: Array<{ etiqueta: string; valor: number }> }
  | { tipo: 'cifra'; valor: string; nota?: string }
  | { tipo: 'serie'; puntos: Array<{ dia: string; valor: number }>; formato: 'mxn' | 'numero' };

interface Respuesta { texto: string; visual?: Visual; visuales?: Visual[] }

/** Los bloques del agente analista (/api/dashboard/chat) → la Respuesta que
 *  esta interfaz ya sabe pintar. El agente manda números crudos; aquí se
 *  formatean con lib/formato — UNA sola fuente de formato, como siempre. */
function respuestaDeBloques(bloques: Array<Record<string, unknown>>): Respuesta {
  const textos: string[] = [];
  const visuales: Visual[] = [];
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
    }
  }
  return { texto: textos.join(' ') || 'Listo.', visuales: visuales.length > 0 ? visuales : undefined };
}

/** Saludos y cortesías se resuelven aquí, gratis — un "hola" no debe gastar
 *  tokens ni arriesgarse a la guardia (pasó en vivo el 12-ago). */
const SALUDO_RE = /^\s*(hola|holi|buenas|buenos?\s*(días|dias|tardes|noches)?|hey|qué tal|que tal|saludos|gracias|ok|va|listo|perfecto)\s*[!.\u{1F44B}]*\s*$/iu;

function responder(pregunta: string, kpis: DashboardKpis | null, acred: Acreditables | null): Respuesta {
  const q = pregunta.toLowerCase();
  if (SALUDO_RE.test(pregunta)) {
    return { texto: '¡Hola! Soy el analista de tu operación. Pregúntame por tu gasto, tu cuadre, tus rutas o tu motor fiscal — o abre el catálogo con el botón Consulta.' };
  }
  const sinLiq = { texto: 'Todavía no hay liquidaciones para calcular esto.' };
  if (q.includes('comprobad') || q.includes('monto')) {
    if (!kpis) return sinLiq;
    return {
      texto: `Llevas ${mxn(kpis.montoComprobado)} comprobados en ${kpis.viajesLiquidados} viaje${kpis.viajesLiquidados === 1 ? '' : 's'}.`,
      visual: {
        tipo: 'tabla',
        filas: [
          ['Monto comprobado', mxn(kpis.montoComprobado)],
          ['Viajes liquidados', numero(kpis.viajesLiquidados)],
          ['Con diferencias', numero(kpis.conDiferencias)],
          ['Por revisar', numero(kpis.porRevisar)],
          ['Dinero observado', mxn(kpis.diferenciaDetectada)],
        ],
      },
    };
  }
  if (q.includes('diferencia') || q.includes('revisar')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return {
      texto: `${kpis.conDiferencias + kpis.porRevisar} liquidaciones tienen diferencia o están por revisar, de ${kpis.viajesLiquidados} en total.`,
      visual: kpis.viajesLiquidados > 0
        ? { tipo: 'dona', segmentos: [
            { etiqueta: 'Sin diferencias', valor: limpias },
            { etiqueta: 'Con diferencias', valor: kpis.conDiferencias },
            { etiqueta: 'Por revisar', valor: kpis.porRevisar },
          ] }
        : undefined,
    };
  }
  if (q.includes('diesel') || q.includes('diésel') || q.includes('litro')) {
    if (!acred) return { texto: 'Todavía no hay datos de diésel este periodo.' };
    return {
      texto: `${litros(acred.litrosDiesel)} elegibles para el estímulo este periodo.`,
      visual: { tipo: 'cifra', valor: litros(acred.litrosDiesel), nota: 'LIF 2026, Art. 20-A — el estímulo en pesos lo fija la cuota DOF de cada semana.' },
    };
  }
  if (q.includes('tasa') || q.includes('cuadre') || q.includes('cuadra')) {
    if (!kpis) return sinLiq;
    const limpias = Math.max(0, kpis.viajesLiquidados - kpis.conDiferencias - kpis.porRevisar);
    return {
      texto: `Tu tasa de cuadre es ${kpis.tasaCuadre}% — liquidaciones sin diferencias sobre el total.`,
      visual: kpis.viajesLiquidados > 0
        ? { tipo: 'dona', segmentos: [
            { etiqueta: 'Sin diferencias', valor: limpias },
            { etiqueta: 'Con diferencias o por revisar', valor: kpis.conDiferencias + kpis.porRevisar },
          ] }
        : undefined,
    };
  }
  if (q.includes('iva') || q.includes('peaje') || q.includes('caseta') || q.includes('acreditable')) {
    if (!acred) return { texto: 'Todavía no hay datos de acreditables este periodo.' };
    return {
      texto: q.includes('iva')
        ? `${mxn(acred.iva)} de IVA acreditable este periodo (LIVA, Art. 5).`
        : q.includes('peaje') || q.includes('caseta')
          ? `${mxn(acred.peaje)} de peaje acreditable (50%) este periodo — sujeto a elegibilidad.`
          : 'Esto es lo que llevas de acreditables este periodo:',
      visual: {
        tipo: 'tabla',
        filas: [
          ['IVA acreditable', mxn(acred.iva)],
          ['Peaje acreditable (50%)', mxn(acred.peaje)],
          ['Diésel elegible', litros(acred.litrosDiesel)],
        ],
      },
    };
  }
  return { texto: 'Todavía no sé responder eso — pregúntame sobre lo comprobado, diferencias, diésel, IVA, peaje o tu tasa de cuadre.' };
}

/** La pieza visual de una respuesta — tabla chica, dona o cifra grande,
 *  con los mismos componentes del resto del panel (nunca una segunda
 *  librería). */
function VisualRespuesta({ v }: { v: Visual }) {
  if (v.tipo === 'cifra') {
    return (
      <div className="card px-4 py-3 mt-2 inline-block">
        <div className="font-display text-[22px] leading-tight font-semibold tabular">{v.valor}</div>
        {v.nota && <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>{v.nota}</p>}
      </div>
    );
  }
  if (v.tipo === 'dona') {
    return <div className="card p-3 mt-2"><Dona segmentos={v.segmentos} /></div>;
  }
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

export default function ChatFlota({
  kpis, acred, compacto = false, variante = 'panel',
}: {
  kpis: DashboardKpis | null;
  acred: Acreditables | null;
  compacto?: boolean;
  /**
   * `panel` — la caja de siempre. La usa el rail del Asistente, que es angosto
   *   y ya vive DENTRO de un recuadro: otro hero ahí saldría apretado.
   * `hero` — la página completa `/dashboard/chat`: composición centrada con un
   *   solo recuadro (el de escribir), al estilo de usehandle.ai.
   * El default es `panel` a propósito: así el rail no cambia de aspecto por
   * un rediseño que solo pidió la página.
   */
  variante?: 'panel' | 'hero';
}) {
  const [historial, setHistorial] = useState<Array<{ q: string; r: Respuesta }>>([]);
  const [texto, setTexto] = useState('');
  // Ingesta REAL de prueba (12-ago): la imagen adjunta viaja a
  // /api/dashboard/ingesta, que corre el MISMO OCR del motor y devuelve lo
  // leído — sin registrar nada. `ocupado` bloquea dobles envíos mientras la
  // visión trabaja.
  const [ocupado, setOcupado] = useState(false);
  const [recomendar, setRecomendar] = useState(false);
  const [menuAdjuntar, setMenuAdjuntar] = useState(false);
  const inputArchivo = useRef<HTMLInputElement>(null);
  const inputImagen = useRef<HTMLInputElement>(null);
  const inputCamara = useRef<HTMLInputElement>(null);
  const finConversacion = useRef<HTMLDivElement>(null);

  // Ancla la vista al último mensaje, como cualquier chat.
  useEffect(() => {
    finConversacion.current?.scrollIntoView({ block: 'end' });
  }, [historial.length]);

  async function leerArchivo(archivo: File) {
    if (ocupado) return;
    if (!archivo.type.startsWith('image/')) {
      // "Adjuntar archivos" acepta más de lo que el OCR lee hoy — decirlo
      // corto en la conversación es mejor que un error críptico del API.
      setHistorial((h) => [...h, { q: `Leer archivo: ${archivo.name}`, r: { texto: 'Por ahora solo leo imágenes de comprobantes — el PDF y el XML del CFDI vienen después.' } }]);
      return;
    }
    setOcupado(true);
    const etiquetaQ = `Leer comprobante: ${archivo.name}`;
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(archivo);
      });
      const resp = await fetch('/api/dashboard/ingesta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagen: dataUrl }),
      });
      const d = await resp.json().catch(() => null);
      if (!resp.ok || !d) {
        setHistorial((h) => [...h, { q: etiquetaQ, r: { texto: d?.error ?? 'No se pudo leer la imagen en este momento.' } }]);
        return;
      }
      if (!d.legible) {
        setHistorial((h) => [...h, { q: etiquetaQ, r: { texto: `El motor no pudo leer este papel${d.motivo ? ` (${d.motivo})` : ''}. Con una foto más cercana y sin reflejos suele salir.` } }]);
        return;
      }
      const filas: Array<[string, string]> = [];
      if (d.campos.concepto) filas.push(['Concepto', String(d.campos.concepto)]);
      if (typeof d.campos.monto === 'number') filas.push(['Monto', mxn(d.campos.monto)]);
      if (d.campos.fecha) filas.push(['Fecha', String(d.campos.fecha)]);
      if (d.campos.folio) filas.push(['Folio', String(d.campos.folio)]);
      if (d.campos.rfcEmisor) filas.push(['RFC emisor', String(d.campos.rfcEmisor)]);
      if (typeof d.campos.litros === 'number') filas.push(['Litros', litros(d.campos.litros)]);
      if (typeof d.campos.confianza === 'number') filas.push(['Confianza del OCR', `${Math.round(d.campos.confianza * 100)}%`]);
      setHistorial((h) => [...h, {
        q: etiquetaQ,
        r: {
          texto: 'Esto fue lo que el motor leyó del papel — lectura de prueba, no se registró ningún gasto.',
          visual: filas.length > 0 ? { tipo: 'tabla', filas } : undefined,
        },
      }]);
    } catch {
      setHistorial((h) => [...h, { q: etiquetaQ, r: { texto: 'No se pudo leer la imagen en este momento.' } }]);
    } finally {
      setOcupado(false);
      if (inputArchivo.current) inputArchivo.current.value = '';
    }
  }

  /** El catálogo de Consulta, por CATEGORÍA y formal (pedido del 12-ago:
   *  al ancho de la caja y con muchas más opciones). SIEMPRE completo: las
   *  respuestas ya degradan con honestidad cuando falta el dato ("todavía
   *  no hay..."), así que esconder categorías solo empobrecía el menú.
   *  Cada frase conserva una palabra clave que `responder` entiende —
   *  verificadas contra sus ramas una por una. */
  const CATALOGO_CONSULTA: Array<{ categoria: string; preguntas: string[] }> = [
    {
      categoria: 'Cuadre y liquidaciones',
      preguntas: [
        'Muéstrame el desglose de lo comprobado a la fecha',
        'Estado de las liquidaciones con diferencia o por revisar',
        '¿Cuántos viajes están por revisar?',
        'Monto observado por el motor en las liquidaciones',
      ],
    },
    {
      categoria: 'Salud del cuadre',
      preguntas: [
        'Tasa de cuadre del periodo',
        '¿Cuántas liquidaciones cerraron sin diferencias?',
        '¿Cuánto llevo comprobado?',
      ],
    },
    {
      categoria: 'Fiscal y acreditables',
      preguntas: [
        'Desglose de acreditables del periodo',
        'IVA acreditable del periodo',
        'Peaje acreditable del periodo',
        'Litros de diésel elegibles para el estímulo',
      ],
    },
  ];

  const spChat = useSearchParams();
  const RESPUESTA_GENERICA = 'Todavía no sé responder eso';

  function preguntar(q: string) {
    if (!q.trim() || ocupado) return;
    setTexto('');
    const local = responder(q, kpis, acred);
    // FAST-PATH GRATIS: si el respondedor de palabras clave tiene la
    // respuesta, ni un token se gasta. Al agente solo va lo que necesita
    // pensar — esa es la primera capa anti-quemadura.
    if (!local.texto.startsWith(RESPUESTA_GENERICA)) {
      setHistorial((h) => [...h, { q, r: local }]);
      return;
    }
    void preguntarAnalista(q);
  }

  async function preguntarAnalista(q: string) {
    setOcupado(true);
    setHistorial((h) => [...h, { q, r: { texto: 'Analizando tu operación…' } }]);
    try {
      const previos = historial.flatMap((h) => [
        { rol: 'usuario' as const, texto: h.q },
        { rol: 'asistente' as const, texto: h.r.texto },
      ]);
      const tenant = spChat.get('tenant');
      const resp = await fetch(`/api/dashboard/chat${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensajes: [...previos, { rol: 'usuario', texto: q }] }),
      });
      const d = await resp.json().catch(() => null);
      const r: Respuesta = resp.ok && d && Array.isArray(d.bloques)
        ? respuestaDeBloques(d.bloques as Array<Record<string, unknown>>)
        : { texto: d?.error ?? 'El analista no está disponible en este momento — las respuestas rápidas del catálogo siguen funcionando.' };
      setHistorial((h) => [...h.slice(0, -1), { q, r }]);
    } catch {
      setHistorial((h) => [...h.slice(0, -1), { q, r: { texto: 'El analista no está disponible en este momento — las respuestas rápidas del catálogo siguen funcionando.' } }]);
    } finally {
      setOcupado(false);
    }
  }

  const historialView = historial.length > 0 ? (
    <div className="space-y-3">
      {historial.map((h, i) => (
        <div key={i} className="text-sm">
          <div className="font-medium">{h.q}</div>
          <div style={{ color: 'var(--muted)' }}>{h.r.texto}</div>
        </div>
      ))}
    </div>
  ) : (
    <p className="text-sm" style={{ color: 'var(--muted)' }}>
      Pregúntame sobre lo comprobado, diferencias, diésel, IVA o peaje.
    </p>
  );

  const pie = (
    <>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {(compacto ? PREGUNTAS.slice(0, 2) : PREGUNTAS).map((p) => (
          <button key={p} type="button" onClick={() => preguntar(p)}
            className="text-xs px-2.5 py-1.5 rounded-full hairline hover:opacity-70 text-left transition-opacity">
            {p}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); preguntar(texto); }} className="flex items-center gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Pregunta algo…"
          className="flex-1 min-w-0 text-sm px-3 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
        <button type="submit" aria-label="Enviar"
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-opacity hover:opacity-85"
          style={{ background: 'var(--marca)', color: 'white' }}>
          <Send width={15} height={15} strokeWidth={2} />
        </button>
      </form>
    </>
  );

  if (variante === 'hero') {
    const vacio = historial.length === 0;

    /* EL recuadro — el mismo en portada y en conversación. Consulta alterna
       el catálogo; el clip pregunta: tomar foto / subir imágenes / adjuntar
       archivos (los tres terminan en el mismo OCR real; `capture` abre la
       cámara del teléfono y en desktop cae al selector). */
    const caja = (
      <form
        onSubmit={(e) => { e.preventDefault(); preguntar(texto); }}
        className="w-full rounded-2xl px-4 pt-3.5 pb-3 transition-shadow focus-within:shadow-lg"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          boxShadow: 'var(--shadow-card)',
        }}
      >
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Pregunta sobre tu operación…"
          aria-label="Pregunta sobre tu operación"
          className="w-full bg-transparent border-0 outline-none text-[15px] leading-relaxed"
        />
        <div className="flex items-center justify-between mt-3 relative">
          <button type="button" onClick={() => setRecomendar((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-opacity hover:opacity-85"
            style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
            <Search width={11} height={11} strokeWidth={2.25} />
            Consulta
          </button>

          <div className="flex items-center gap-1.5">
            <input ref={inputCamara} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
            <input ref={inputImagen} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
            <input ref={inputArchivo} type="file" accept="image/*,application/pdf,.xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void leerArchivo(f); }} />
            {menuAdjuntar && (
              <div className="absolute right-10 bottom-9 card p-1.5 z-30 w-56">
                <button type="button"
                  onClick={() => { setMenuAdjuntar(false); inputCamara.current?.click(); }}
                  className="w-full text-left text-[13px] px-2.5 py-2 rounded-lg transition-colors hover:bg-[var(--canvas)] flex items-center gap-2">
                  <Camera width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                  Tomar foto
                </button>
                <button type="button"
                  onClick={() => { setMenuAdjuntar(false); inputImagen.current?.click(); }}
                  className="w-full text-left text-[13px] px-2.5 py-2 rounded-lg transition-colors hover:bg-[var(--canvas)] flex items-center gap-2">
                  <FileImage width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                  Subir imágenes
                </button>
                <button type="button"
                  onClick={() => { setMenuAdjuntar(false); inputArchivo.current?.click(); }}
                  className="w-full text-left text-[13px] px-2.5 py-2 rounded-lg transition-colors hover:bg-[var(--canvas)] flex items-center gap-2">
                  <Paperclip width={14} height={14} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />
                  Adjuntar archivos
                </button>
              </div>
            )}
            <button type="button" aria-label="Adjuntar comprobante" title="Adjuntar comprobante"
              onClick={() => setMenuAdjuntar((v) => !v)} disabled={ocupado}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)] disabled:opacity-50"
              style={{ color: 'var(--ink2)' }}>
              <Paperclip width={14} height={14} strokeWidth={2} />
            </button>
            <button
              type="submit"
              aria-label="Enviar"
              disabled={!texto.trim() || ocupado}
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-opacity disabled:cursor-default"
              style={{
                background: 'var(--marca)',
                color: 'var(--marca-fg)',
                opacity: texto.trim() && !ocupado ? 1 : 0.35,
              }}
            >
              <ArrowUp width={15} height={15} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </form>
    );

    /* El catálogo de Consulta — al ancho de la caja y SCROLLEABLE (pedido
       del 12-ago): tres columnas de categorías con tope de alto. */
    const panelConsulta = recomendar && (
      <div className="w-full max-h-72 overflow-y-auto grid grid-cols-1 sm:grid-cols-3 gap-2.5 pr-0.5">
        {CATALOGO_CONSULTA.map((c) => (
          <div key={c.categoria} className="card p-3 self-start">
            <div className="etiqueta-mono text-[10px] font-medium uppercase mb-1.5" style={{ color: 'var(--muted)' }}>
              {c.categoria}
            </div>
            {c.preguntas.map((rq) => (
              <button key={rq} type="button"
                onClick={() => { setRecomendar(false); preguntar(rq); }}
                className="w-full text-left text-[13px] px-2 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]">
                {rq}
              </button>
            ))}
          </div>
        ))}
      </div>
    );

    // ── CONVERSACIÓN, tipo ChatGPT/Claude (pedido del 12-ago): al primer
    // mensaje la portada se retira, las burbujas suben y la caja se ancla
    // abajo. Tu pregunta a la derecha; el motor a la izquierda con su
    // tabla/gráfica cuando la trae.
    if (!vacio) {
      return (
        <div className="min-h-full w-full flex-1 flex flex-col px-4 pt-4">
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
                    <div>{h.r.texto}</div>
                    {h.r.visual && <VisualRespuesta v={h.r.visual} />}
                    {h.r.visuales?.map((v, j) => <VisualRespuesta key={j} v={v} />)}
                  </div>
                </div>
              ))}
              <div ref={finConversacion} />
            </div>
            <div className="sticky bottom-0 shrink-0 pt-3 pb-4" style={{ background: 'var(--g1)' }}>
              {panelConsulta}
              <div className={recomendar ? 'mt-3' : ''}>{caja}</div>
            </div>
          </div>
        </div>
      );
    }

    // ── PORTADA (sin mensajes todavía) ──
    return (
      <div className="min-h-full w-full flex-1 flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl flex flex-col items-center">
          <Logo alto="h-7" className="mb-6" />
          <h1 className="text-[26px] leading-tight font-medium tracking-tight text-center">
            Pregunta a tus datos
          </h1>
          <p className="mt-2 mb-8 text-sm text-center max-w-md" style={{ color: 'var(--muted)' }}>
            Lo comprobado, las diferencias, el diésel, el IVA y el peaje — con la cifra que
            ya calculó el motor.
          </p>

          {caja}

          {recomendar ? (
            <div className="w-full mt-4">{panelConsulta}</div>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 mt-4">
              {PREGUNTAS.map((pq) => (
                <button
                  key={pq}
                  type="button"
                  onClick={() => preguntar(pq)}
                  className="text-xs px-3 py-1.5 rounded-full hairline transition-opacity hover:opacity-70"
                  // BLANCO explícito (12-ago): la página hero vive sobre el
                  // lienzo tenue --g1 y un chip transparente se veía gris.
                  style={{ color: 'var(--ink2)', background: 'var(--surface)' }}
                >
                  {pq}
                </button>
              ))}
            </div>
          )}

          {/* El límite va a la vista, pero sin otro recuadro: es una nota, no una
              tarjeta. Quitarlo dejaría creer que la caja consulta la base. */}
          <p className="mt-8 text-[11px] leading-relaxed text-center max-w-lg" style={{ color: 'var(--faint)' }}>
            Responde con cifras ya calculadas en el servidor — en texto, tabla o gráfica según
            la pregunta. No traduce preguntas libres a consultas de base de datos, a propósito.
          </p>
        </div>
      </div>
    );
  }

  if (compacto) {
    return (
      <div>
        {historial.length > 0 && <div className="mb-3 max-h-56 overflow-y-auto">{historialView}</div>}
        {pie}
      </div>
    );
  }

  return (
    <div className="glass-panel p-6 h-full flex flex-col overflow-hidden">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-4 shrink-0" style={{ color: 'var(--muted)' }}>
        Pregunta a tus datos
      </h2>
      <div className="flex-1 min-h-0 overflow-y-auto">{historialView}</div>
      <div className="shrink-0 pt-4">{pie}</div>
    </div>
  );
}
