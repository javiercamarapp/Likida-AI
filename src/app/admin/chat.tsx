'use client';

import { useState } from 'react';
import type { ResumenNegocio } from '@/lib/admin/negocio';
import { usd, numero } from '@/lib/utils';

// Chat "seguro": coincidencia de palabras clave contra el resumen YA
// calculado en el servidor, no una traducción de lenguaje natural a SQL
// corriendo con permisos de superadmin. Eso es un vector real de inyección
// —el mismo riesgo que la skill `review` de este repo audita en cada
// diff— y no es lo que esta vuelta necesita: las preguntas de negocio de
// hoy caben en un puñado de respuestas fijas. Cuando haga falta responder
// algo que esta lista no cubre, se agranda la lista o se diseña la
// traducción con cuidado — no se abre un cuadro de texto directo a SQL.
const PREGUNTAS = [
  '¿Cuánto llevo gastado en IA?',
  '¿Cuántas flotas tengo?',
  '¿Qué fase de IA cuesta más?',
  '¿Cuántos viajes ha procesado Likida?',
];

function responder(pregunta: string, r: ResumenNegocio): string {
  const q = pregunta.toLowerCase();
  if (q.includes('gastad') || q.includes('cost') || q.includes('gasto')) {
    return `Llevas ${usd(r.costoIaUsd)} gastados en IA en total (${numero(r.tokensIn)} tokens de entrada, ${numero(r.tokensOut)} de salida).`;
  }
  if (q.includes('flota') || q.includes('tenant') || q.includes('cliente')) {
    return r.tenants <= 1
      ? `Tienes ${r.tenants} flota dada de alta — todavía es la del demo. Likida no tiene clientes reales todavía.`
      : `Tienes ${r.tenants} flotas dadas de alta.`;
  }
  if (q.includes('fase') || q.includes('agente') || q.includes('cara') || q.includes('cuesta más')) {
    const top = r.porFase[0];
    return top
      ? `La fase que más cuesta es "${top.fase}": ${usd(top.costoUsd)} en ${top.n} llamadas.`
      : 'Todavía no hay costo de IA registrado.';
  }
  if (q.includes('viaje') || q.includes('procesa')) {
    return `Likida ha procesado ${numero(r.viajesProcesados)} viajes en total.`;
  }
  return 'Todavía no sé responder eso — pregúntame sobre costo de IA, tokens, flotas o viajes procesados.';
}

export default function ChatNegocio({ resumen }: { resumen: ResumenNegocio }) {
  const [historial, setHistorial] = useState<Array<{ q: string; a: string }>>([]);
  const [texto, setTexto] = useState('');

  function preguntar(q: string) {
    if (!q.trim()) return;
    setHistorial((h) => [...h, { q, a: responder(q, resumen) }]);
    setTexto('');
  }

  return (
    <div className="card p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>
        Pregunta a tus datos
      </h2>

      {historial.length > 0 && (
        <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
          {historial.map((h, i) => (
            <div key={i} className="text-sm">
              <div className="font-medium">{h.q}</div>
              <div style={{ color: 'var(--muted)' }}>{h.a}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        {PREGUNTAS.map((p) => (
          <button key={p} type="button" onClick={() => preguntar(p)}
            className="text-xs px-3 py-1.5 rounded-full hairline hover:opacity-70">
            {p}
          </button>
        ))}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); preguntar(texto); }} className="flex gap-2">
        <input value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Pregunta sobre costo, flotas, viajes…"
          className="flex-1 text-sm px-3.5 py-2.5 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
        <button type="submit"
          className="text-sm px-4 py-2.5 rounded-lg font-medium" style={{ background: 'var(--ink)', color: 'white' }}>
          Preguntar
        </button>
      </form>
    </div>
  );
}
