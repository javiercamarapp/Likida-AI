'use client';

import { useState } from 'react';
import { Send } from 'lucide-react';
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

/** `compacto`: la versión del panel lateral (ancho fijo ~260px) — mismas
 *  respuestas, sin la tarjeta ni el título grande de la página propia.
 *
 *  En la versión expandida (no-compacto) el historial es lo que crece y
 *  hace scroll (`flex-1 overflow-y-auto min-h-0`) y la caja de texto vive
 *  FUERA de esa zona, como último hijo `shrink-0` del `flex flex-col` de
 *  altura completa — así el input queda anclado abajo como cualquier chat
 *  normal, en vez de aparecer pegado arriba con un hueco vacío debajo
 *  cuando el historial es corto (lo que pasaba antes: todo el bloque —
 *  historial, sugerencias e input— vivía suelto dentro de un contenedor
 *  con scroll, así que ocupaba solo el espacio de su contenido). */
export default function ChatNegocio({ resumen, compacto = false }: { resumen: ResumenNegocio; compacto?: boolean }) {
  const [historial, setHistorial] = useState<Array<{ q: string; a: string }>>([]);
  const [texto, setTexto] = useState('');

  function preguntar(q: string) {
    if (!q.trim()) return;
    setHistorial((h) => [...h, { q, a: responder(q, resumen) }]);
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
      Pregúntame sobre costo, tokens, flotas o viajes.
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
          style={{ background: 'var(--ink)', color: 'white' }}>
          <Send width={15} height={15} strokeWidth={2} />
        </button>
      </form>
    </>
  );

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
