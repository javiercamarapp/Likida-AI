'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { CheckCircle2, TriangleAlert } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LAS ACCIONES DEL JEFE SOBRE UN HITO (0385) — capturar a mano, validar, marcar atendido.
//
// El motivo es obligatorio y queda en la bitácora con quién y cuándo; la hora de una
// captura es HORA DE MÉXICO. El permiso de verdad lo comprueba el servidor
// (`ejecutarAccionOficina`): ocultar el botón no es un control de acceso, es cortesía.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoOficina = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionOficinaServidor = (previo: ResultadoOficina, fd: FormData) => Promise<ResultadoOficina>;
export type ModoAccion = 'capturar' | 'validar' | 'atender';

const CAMPO = 'hairline rounded-lg px-2.5 h-8 text-[12.5px] outline-none focus:border-[var(--muted)]';

const TITULO: Record<ModoAccion, string> = { capturar: 'Capturar a mano', validar: 'Validar', atender: 'Marcar atendido' };
const BOTON: Record<ModoAccion, string> = { capturar: 'Guardar captura', validar: 'Validar hito', atender: 'Marcar atendido' };
const AYUDA: Record<ModoAccion, string> = {
  capturar: 'El chofer no avisó y tú lo confirmaste por otro medio. Queda marcado como captura de oficina.',
  validar: 'Confirmas que el aviso del chofer es correcto (p. ej. lo verificaste con el cliente).',
  atender: 'Ya hablaste con el chofer o con el patio: el agente deja de insistir por este viaje.',
};

function Enviar({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-8 px-3 rounded-lg text-[12.5px] font-medium transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      {pending ? 'Guardando…' : texto}
    </button>
  );
}

function Resultado({ r }: { r: ResultadoOficina }) {
  if (!r) return null;
  return r.ok ? (
    <p role="status" className="flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--ok)' }}>
      <CheckCircle2 width={13} height={13} strokeWidth={1.75} />{r.mensaje}
    </p>
  ) : (
    <p role="alert" className="flex items-start gap-1.5 text-[12px]" style={{ color: 'var(--bad)' }}>
      <TriangleAlert width={13} height={13} strokeWidth={1.75} className="mt-0.5 shrink-0" />{r.error}
    </p>
  );
}

function FormaAccion({ modo, accion, hitoId, viajeId }: { modo: ModoAccion; accion: AccionOficinaServidor; hitoId: string | null; viajeId: string }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <details className="text-[12px]">
      <summary className="cursor-pointer select-none underline-offset-2 hover:underline" style={{ color: 'var(--muted)' }}>{TITULO[modo]}</summary>
      <form action={enviar} className="mt-2 space-y-2 max-w-[44ch]">
        <input type="hidden" name="tipo" value={modo} />
        {modo === 'atender' ? <input type="hidden" name="viajeId" value={viajeId} /> : <input type="hidden" name="hitoId" value={hitoId ?? ''} />}
        <p className="text-[11px]" style={{ color: 'var(--faint)' }}>{AYUDA[modo]}</p>
        {modo === 'capturar' && (
          <label className="block">
            <span className="block text-[11px] font-medium mb-1">Hora del hito (hora de México)</span>
            <input type="datetime-local" name="hora" required className={`${CAMPO} w-full`} />
          </label>
        )}
        <label className="block">
          <span className="block text-[11px] font-medium mb-1">Motivo (queda en la bitácora con tu nombre)</span>
          <input type="text" name="motivo" required minLength={5} maxLength={200} placeholder="p. ej. avisó por radio" className={`${CAMPO} w-full`} />
        </label>
        <div className="flex items-center gap-2 flex-wrap">
          <Enviar texto={BOTON[modo]} />
          <Resultado r={estado} />
        </div>
      </form>
    </details>
  );
}

/** Las acciones disponibles para un hito (o, con `atender`, para el viaje). Sin modos no pinta nada. */
export function AccionesHito({ accion, modos, hitoId, viajeId }: {
  accion: AccionOficinaServidor; modos: ModoAccion[]; hitoId: string | null; viajeId: string;
}) {
  if (modos.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1.5">
      {modos.map((m) => <FormaAccion key={m} modo={m} accion={accion} hitoId={hitoId} viajeId={viajeId} />)}
    </div>
  );
}
