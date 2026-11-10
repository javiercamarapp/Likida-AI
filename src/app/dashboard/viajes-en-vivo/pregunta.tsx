'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { numero } from '@/lib/formato';
import { leerRespuesta, PREGUNTAS_OPERACION, textoDeBloques, type BloqueVista } from './respuesta';
import { Boton, CampoTexto } from '@/app/ui-v2/componentes';
import { Dona, Serie } from './graficas';
import './en-vivo.css';

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
    <section aria-label="Pregúntale al asistente sobre la operación" className="rv-vv__preg">
      <div className="rv-vv__sugerencias">
        {PREGUNTAS_OPERACION.map((p) => (
          <button key={p} type="button" disabled={ocupado} onClick={() => void preguntar(p)} className="rv-chip">{p}</button>
        ))}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); void preguntar(texto); }} className="rv-vv__forma">
        <CampoTexto
          etiqueta="Tu pregunta" etiquetaOculta value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={500}
          placeholder="Ej. ¿cómo va la terminal de Guadalajara?"
        />
        <Boton type="submit" disabled={ocupado || !texto.trim()}>{ocupado ? 'Consultando…' : 'Preguntar'}</Boton>
      </form>
      {error && <p role="alert" className="rv-vv__sub">{error}</p>}
      {bloques && (
        <div className="rv-vv__resp" aria-live="polite">
          {bloques.map((b, i) => b.tipo === 'texto'
            ? <p key={i}>{b.texto}</p>
            : b.tipo === 'cifra'
              ? <div key={i} className="rv-vv__cifra"><strong>{numero(b.valor)}</strong>{b.nota && <span className="rv-vv__sub" data-tenue>{b.nota}</span>}</div>
              : b.tipo === 'dona' ? <Dona key={i} b={b} />
              : b.tipo === 'serie' ? <Serie key={i} b={b} />
              : (
                <dl key={i} className="rv-vv__datos" aria-label="Datos de la respuesta">
                  {b.filas.flatMap(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v}</dd>])}
                </dl>
              ))}
        </div>
      )}
      <p className="rv-vv__sub" data-tenue>El asistente solo lee y, si algo es delicado, deja una tarea para una persona; no decide ni mueve nada por su cuenta.</p>
    </section>
  );
}
