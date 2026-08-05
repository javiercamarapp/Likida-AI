'use client';

import { useState } from 'react';
import { Send, ArrowUp, Search } from 'lucide-react';
import type { DashboardKpis, Acreditables } from '@/lib/cuadra/analytics';
import { mxn, litros } from '@/lib/formato';
import { Logo } from '../logo';

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
];

function responder(pregunta: string, kpis: DashboardKpis | null, acred: Acreditables | null): string {
  const q = pregunta.toLowerCase();
  if (q.includes('comprobad') || q.includes('monto')) {
    return kpis ? `Llevas ${mxn(kpis.montoComprobado)} comprobados en ${kpis.viajesLiquidados} viaje${kpis.viajesLiquidados === 1 ? '' : 's'}.` : 'Todavía no hay liquidaciones para calcular esto.';
  }
  if (q.includes('diferencia') || q.includes('revisar')) {
    return kpis ? `${kpis.conDiferencias + kpis.porRevisar} liquidaciones tienen diferencia o están por revisar, de ${kpis.viajesLiquidados} en total.` : 'Todavía no hay liquidaciones para calcular esto.';
  }
  if (q.includes('diesel') || q.includes('diésel') || q.includes('litro')) {
    return acred ? `${litros(acred.litrosDiesel)} elegibles para el estímulo este periodo (LIF 2026, Art. 20-A).` : 'Todavía no hay datos de diésel este periodo.';
  }
  if (q.includes('tasa') || q.includes('cuadre') || q.includes('cuadra')) {
    return kpis ? `Tu tasa de cuadre es ${kpis.tasaCuadre}% — liquidaciones sin diferencias sobre el total.` : 'Todavía no hay liquidaciones para calcular esto.';
  }
  if (q.includes('iva')) {
    return acred ? `${mxn(acred.iva)} de IVA acreditable este periodo (LIVA, Art. 5).` : 'Todavía no hay datos de IVA este periodo.';
  }
  if (q.includes('peaje') || q.includes('caseta')) {
    return acred ? `${mxn(acred.peaje)} de peaje acreditable (50%) este periodo — sujeto a elegibilidad.` : 'Todavía no hay datos de peaje este periodo.';
  }
  return 'Todavía no sé responder eso — pregúntame sobre lo comprobado, diferencias, diésel, IVA, peaje o tu tasa de cuadre.';
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
  const [historial, setHistorial] = useState<Array<{ q: string; a: string }>>([]);
  const [texto, setTexto] = useState('');

  function preguntar(q: string) {
    if (!q.trim()) return;
    setHistorial((h) => [...h, { q, a: responder(q, kpis, acred) }]);
    setTexto('');
  }

  const historialView = historial.length > 0 ? (
    <div className="space-y-3">
      {historial.map((h, i) => (
        <div key={i} className="text-sm">
          <div className="font-medium">{h.q}</div>
          <div style={{ color: 'var(--muted)' }}>{h.a}</div>
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
    return (
      <div className="h-full w-full flex flex-col items-center justify-center px-4 py-10">
        <div className="w-full max-w-2xl flex flex-col items-center">
          {/* Encabezado. Se retira en cuanto hay respuestas: a partir de ahí lo
              que importa es la conversación, no la portada. */}
          {vacio && (
            <>
              <Logo alto="h-7" className="mb-6" />
              <h1 className="text-[26px] leading-tight font-medium tracking-tight text-center">
                Pregunta a tus datos
              </h1>
              <p className="mt-2 mb-8 text-sm text-center max-w-md" style={{ color: 'var(--muted)' }}>
                Lo comprobado, las diferencias, el diésel, el IVA y el peaje — con la cifra que
                ya calculó el motor.
              </p>
            </>
          )}

          {!vacio && (
            <div className="w-full mb-6 max-h-[46vh] overflow-y-auto space-y-4 text-left">
              {historial.map((h, i) => (
                <div key={i} className="text-sm">
                  <div className="font-medium">{h.q}</div>
                  <div className="mt-0.5" style={{ color: 'var(--muted)' }}>{h.a}</div>
                </div>
              ))}
            </div>
          )}

          {/* EL recuadro — el único de la página. */}
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
            <div className="flex items-center justify-between mt-3">
              {/* Lo que esta caja hace, dicho en la caja. No hay un segundo modo:
                  poner uno apagado prometería algo que no existe. */}
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full"
                style={{ background: 'var(--canvas)', color: 'var(--ink2)' }}
              >
                <Search width={11} height={11} strokeWidth={2.25} />
                Consulta
              </span>
              <button
                type="submit"
                aria-label="Enviar"
                disabled={!texto.trim()}
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-opacity disabled:cursor-default"
                style={{
                  background: 'var(--marca)',
                  color: 'var(--marca-fg)',
                  opacity: texto.trim() ? 1 : 0.35,
                }}
              >
                <ArrowUp width={15} height={15} strokeWidth={2.5} />
              </button>
            </div>
          </form>

          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {PREGUNTAS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => preguntar(p)}
                className="text-xs px-3 py-1.5 rounded-full hairline transition-colors"
                style={{ color: 'var(--ink2)' }}
              >
                {p}
              </button>
            ))}
          </div>

          {/* El límite va a la vista, pero sin otro recuadro: es una nota, no una
              tarjeta. Quitarlo dejaría creer que la caja consulta la base. */}
          <p className="mt-8 text-[11px] leading-relaxed text-center max-w-lg" style={{ color: 'var(--faint)' }}>
            Responde con cifras ya calculadas en el servidor. No traduce preguntas libres a
            consultas de base de datos, a propósito. Todavía no devuelve gráficas ni tablas.
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
