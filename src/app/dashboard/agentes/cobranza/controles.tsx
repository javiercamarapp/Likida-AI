'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Play, Pause, Send } from 'lucide-react';
import type { ResultadoCobranza } from '@/lib/likida/agentes/cobranza';

export type AccionSimple = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

export type EstadoEjecutar = { error?: string; resultado?: ResultadoCobranza } | null;
export type AccionEjecutar = (prev: EstadoEjecutar, fd: FormData) => Promise<EstadoEjecutar>;

/**
 * "Ejecutar ahora" con confirmación en dos pasos: manda WhatsApp REAL a
 * todos los de la cola, y un botón que dispara mensajes de un clic es un
 * accidente esperando turno. La corrida ignora la ventana (el humano que
 * confirma ES la autorización), pero un agente pausado no corre ni a mano —
 * el motor lo dice y aquí se muestra tal cual.
 */
export function BotonEjecutar({ ejecutarAhora, enCola, activo }: {
  ejecutarAhora: AccionEjecutar;
  enCola: number;
  activo: boolean;
}) {
  const [estado, accion] = useActionState(ejecutarAhora, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  // Tras una corrida, la cola y la bitácora del servidor ya cambiaron: se
  // refresca la página completa conservando el resumen local. El cierre del
  // paso de confirmación NO vive aquí (setState en un efecto encadena
  // renders): lo hace el onSubmit, que es evento del usuario.
  useEffect(() => {
    if (estado?.resultado) router.refresh();
  }, [estado, router]);

  const r = estado?.resultado;

  return (
    <div className="text-right shrink-0">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="inline-flex items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            ¿Mandar WhatsApp a {enCola} {enCola === 1 ? 'chofer' : 'choferes'} ahora?
          </span>
          <BotonConfirmar />
          <button type="button" onClick={() => setConfirmando(false)}
            className="hairline text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
            style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            Cancelar
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirmando(true)}
          disabled={!activo || enCola === 0}
          title={!activo ? 'El agente está pausado' : enCola === 0 ? 'No hay a quién contactar' : 'Correr la cobranza ahora, sin esperar la ventana'}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-40"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          <Send width={13} height={13} strokeWidth={2} /> Ejecutar ahora
        </button>
      )}

      {estado?.error && <p className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
      {r && !confirmando && (
        <div className="text-[12px] mt-1.5 space-y-0.5">
          {r.omitido ? (
            <p style={{ color: 'var(--warn)' }}>El agente no corrió: {r.omitido}.</p>
          ) : (
            <p style={{ color: 'var(--muted)' }}>
              Contactó a <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{r.contactados}</span> de{' '}
              <span className="cifra-mono">{r.revisados}</span>
              {r.sinTelefono > 0 && <> · {r.sinTelefono} sin teléfono</>}
              {r.fallos.length > 0 && <span style={{ color: 'var(--bad)' }}> · {r.fallos.length} fallos</span>}
            </p>
          )}
          {/* FE-14: el reloj de corte (25 s) puede dejar folios sin tocar
              en una cola grande — se dice, para que el humano sepa que hay
              que volver a apretar "Ejecutar ahora" en vez de asumir que ya
              se contactó a todos. */}
          {r.cortadosPorReloj > 0 && (
            <p style={{ color: 'var(--warn)' }}>
              El reloj cortó la corrida — {r.cortadosPorReloj} sin tocar todavía. Vuelve a apretar &quot;Ejecutar ahora&quot; para seguir.
            </p>
          )}
          {r.fallos.map((f, i) => (
            <p key={i} style={{ color: 'var(--bad)' }}>{f}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function BotonConfirmar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Send width={13} height={13} strokeWidth={2} className={pending ? 'animate-pulse' : ''} />
      {pending ? 'Mandando…' : 'Sí, mandar'}
    </button>
  );
}

/** Pausar / reanudar — separado de "guardar estrategia" a propósito: editar
 *  las palabras del mensaje no debe despausar al agente en silencio. */
export function BotonPausa({ alternarPausa, activo }: { alternarPausa: AccionSimple; activo: boolean }) {
  const [estado, accion] = useActionState(alternarPausa, null);
  return (
    <div className="text-right shrink-0">
      <form action={accion} className="inline">
        <BotonPausaInterno activo={activo} />
      </form>
      {estado?.error && <p className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
    </div>
  );
}

function BotonPausaInterno({ activo }: { activo: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      title={activo ? 'El agente deja de contactar hasta que lo reanudes' : 'El agente vuelve a contactar en su ventana'}
      className="hairline inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)] disabled:opacity-50"
      style={{ background: 'var(--surface)', color: activo ? 'var(--ink2)' : 'var(--ok)' }}>
      {activo
        ? <><Pause width={13} height={13} strokeWidth={2} /> {pending ? 'Pausando…' : 'Pausar agente'}</>
        : <><Play width={13} height={13} strokeWidth={2} /> {pending ? 'Reanudando…' : 'Reanudar agente'}</>}
    </button>
  );
}
