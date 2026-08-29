import { Lock, MessageSquare } from 'lucide-react';
import { fechaHoraMx } from '@/lib/formato';
import type { MensajeHilo } from '@/lib/likida/soporte';

// ═══════════════════════════════════════════════════════════════════════════
// EL HILO DE UN TICKET, pintado igual en los dos paneles.
//
// Vive en `admin/ui` —de donde /dashboard ya importa `kit` y `forma`— porque
// la conversación es UNA: si el cliente y el equipo la vieran con dos
// componentes distintos, el día que uno cambie de orden o de formato de fecha
// los dos lados dejarían de estar mirando lo mismo, y "yo te escribí el
// martes" se volvería indiscutible.
//
// LA NOTA INTERNA SE PINTA DISTINTA, Y SOLO LLEGA AQUÍ CUANDO DEBE. Este
// componente NO decide qué se ve: `getHilo(..., { verInternas })` ya excluyó
// las internas de la consulta del cliente (0268 y `lib/likida/soporte.ts`).
// El candado de aquí es para que quien SÍ las ve —el equipo— no confunda una
// nota consigo mismo hablándole al cliente. Ése es el error que hace que
// alguien escriba en el hilo público lo que iba a decir de la flota.
// ═══════════════════════════════════════════════════════════════════════════

export function HiloSoporte({
  mensajes,
  vacio,
}: {
  mensajes: MensajeHilo[];
  /** Qué decir cuando el hilo no tiene un solo mensaje. Lo escribe cada panel:
   *  para el cliente es "todavía no te han contestado"; para el equipo es
   *  "nadie ha contestado". No es la misma frase ni el mismo lector. */
  vacio: React.ReactNode;
}) {
  if (mensajes.length === 0) {
    return (
      <p className="text-[12.5px] py-2" style={{ color: 'var(--muted)' }}>
        {vacio}
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-2 py-1">
      {mensajes.map((m) => (
        <li
          key={m.id}
          className="rounded-lg px-3 py-2.5"
          style={{
            background: m.interna ? 'var(--warnbg)' : 'var(--canvas)',
            border: `1px solid ${m.interna ? 'var(--warn)' : 'var(--line2)'}`,
          }}
        >
          <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--muted)' }}>
            {m.interna ? (
              <Lock width={13} height={13} strokeWidth={1.9} style={{ color: 'var(--warn)' }} />
            ) : (
              <MessageSquare width={13} height={13} strokeWidth={1.75} />
            )}
            {/* El nombre puede faltar (la cuenta se dio de baja: la FK es
                `on delete set null`). Se dice "—", no se inventa un autor. */}
            <span className="font-medium" style={{ color: 'var(--ink)' }}>
              {m.autorNombre ?? '—'}
            </span>
            <span>{m.deLikida ? 'Likida' : 'la flota'}</span>
            <span>·</span>
            <span className="tabular">{fechaHoraMx(m.creadoEn)}</span>
            {m.interna && (
              <span className="font-medium" style={{ color: 'var(--warn)' }}>
                Nota interna — el cliente NO la ve
              </span>
            )}
          </div>
          <p className="text-[13px] mt-1.5 whitespace-pre-wrap">{m.cuerpo}</p>
        </li>
      ))}
    </ol>
  );
}
