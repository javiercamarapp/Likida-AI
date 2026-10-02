'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { numero } from '@/lib/formato';
import { leerRespuesta, PREGUNTAS_OPERACION, textoDeBloques, type BloqueVista } from './respuesta';
import { Dona, Serie } from './graficas';

/**
 * La caja de preguntas del asistente DENTRO de la pantalla de viajes en vivo: el jefe de tráfico le pregunta a la
 * operación sin pasar por la pestaña de dinero. Habla con `/api/dashboard/chat` (el MISMO asistente, con las
 * herramientas que su rol ve): aquí no hay lógica de datos, solo escribir, mandar y pintar bloques simples.
 * Lo delicado el asistente lo deriva a una persona (aparece abajo, en «Tareas del asistente»: la caja pide el tablero de nuevo al terminar cada respuesta).
 */
export function PreguntaAlAsistente({ tenantParam }: { tenantParam: string | null }) {
  const router = useRouter();
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [historial, setHistorial] = useState<Array<{ rol: 'usuario' | 'asistente'; texto: string }>>([]);
  const [bloques, setBloques] = useState<BloqueVista[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function preguntar(pregunta: string) {
    const q = pregunta.trim();
    if (!q || ocupado) return;
    setOcupado(true); setError(null); setBloques(null);
    const mensajes = [...historial, { rol: 'usuario' as const, texto: q }].slice(-12);
    try {
      const resp = await fetch(`/api/dashboard/chat${tenantParam ? `?tenant=${encodeURIComponent(tenantParam)}` : ''}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensajes }),
      });
      if (!resp.ok) throw new Error(resp.status === 429 ? 'Demasiadas preguntas seguidas; espera un momento.' : 'No se pudo consultar al asistente.');
      const r = leerRespuesta(await resp.text());
      if (r.ok) {
        setBloques(r.bloques);
        setHistorial([...mensajes, { rol: 'asistente' as const, texto: textoDeBloques(r.bloques) }].slice(-12));
        setTexto('');
        // Si el asistente dejó una tarea para una persona, ya está en la base: se pide el tablero de nuevo para que aparezca en
        // «Tareas del asistente» sin recargar a mano. `refresh` conserva lo que está en pantalla (la respuesta y el historial).
        router.refresh();
      } else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar al asistente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <section aria-label="Pregúntale al asistente sobre la operación" className="card p-4 space-y-3">
      <h2 className="text-[13px] font-medium">Pregúntale al asistente</h2>
      <div className="flex flex-wrap gap-1.5">
        {PREGUNTAS_OPERACION.map((p) => (
          <button key={p} type="button" disabled={ocupado} onClick={() => void preguntar(p)} className="hairline rounded-full px-2.5 py-1 text-[12px]">{p}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void preguntar(texto); }} className="flex gap-2">
        <input
          value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500} placeholder="Ej. ¿cómo va la terminal de Guadalajara?"
          aria-label="Tu pregunta" className="hairline rounded-lg px-3 h-9 text-[13px] flex-1 outline-none focus:border-[var(--muted)]"
        />
        <button type="submit" disabled={ocupado || !texto.trim()} className="hairline rounded-lg px-3 h-9 text-[13px] font-medium">{ocupado ? 'Consultando…' : 'Preguntar'}</button>
      </form>
      {error && <p role="alert" className="text-[12.5px]" style={{ color: 'var(--bad)' }}>{error}</p>}
      {bloques && (
        <div className="space-y-2 text-[13px]" aria-live="polite">
          {bloques.map((b, i) => b.tipo === 'texto'
            ? <p key={i}>{b.texto}</p>
            : b.tipo === 'cifra'
              ? <div key={i} className="card px-3 py-2 inline-block"><div className="cifra-mono text-[20px] font-medium">{numero(b.valor)}</div>{b.nota && <div className="text-[11px]" style={{ color: 'var(--faint)' }}>{b.nota}</div>}</div>
              : b.tipo === 'dona' ? <Dona key={i} b={b} />
              : b.tipo === 'serie' ? <Serie key={i} b={b} />
              : (
                <div key={i} className="card p-1.5 overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]"><tbody>
                    {b.filas.map(([k, v]) => <tr key={k} className="border-b last:border-b-0" style={{ borderColor: 'var(--line2)' }}><td className="px-2 py-1" style={{ color: 'var(--muted)' }}>{k}</td><td className="px-2 py-1 text-right">{v}</td></tr>)}
                  </tbody></table>
                </div>
              ))}
        </div>
      )}
      <p className="text-[11px]" style={{ color: 'var(--faint)' }}>El asistente solo lee y, si algo es delicado, deja una tarea para una persona; no decide ni mueve nada por su cuenta.</p>
    </section>
  );
}
