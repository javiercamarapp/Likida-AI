'use client';

import { useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Link2, Trash2 } from 'lucide-react';
import { numero } from '@/lib/formato';

export type AccionHuerfano = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

export interface ViajeVivo { id: string; rotulo: string }

/**
 * Las dos salidas de un huérfano: adjuntar a un viaje VIVO o descartar (con
 * confirmación de dos pasos — descartar saca el comprobante de la vista de
 * todos, chofer incluido). Las acciones viven en el servidor y re-verifican
 * sesión, rol y tenant; aquí solo se pinta.
 *
 * `sinMonto`: un comprobante que el OCR no pudo leer (monto 0) NO ofrece
 * adjuntar — metería una línea de $0.00 en la liquidación. El mismo guardia
 * vive en el server action y en el flujo de WhatsApp; aquí solo se dice.
 */
export function FilaAcciones({ huerfanoId, viajesVivos, sinMonto, cargados, adjuntar, descartar }: {
  huerfanoId: string;
  viajesVivos: ViajeVivo[];
  sinMonto: boolean;
  /** Cuántos viajes recientes cargó la page — el alcance real del selector. */
  cargados: number;
  adjuntar: AccionHuerfano;
  descartar: AccionHuerfano;
}) {
  const [estadoAdj, accionAdj] = useActionState(adjuntar, null);
  const [estadoDesc, accionDesc] = useActionState(descartar, null);
  const [confirmando, setConfirmando] = useState(false);

  return (
    <div className="min-w-[260px]">
      {confirmando ? (
        <form action={accionDesc} onSubmit={() => setConfirmando(false)}
          className="flex items-center gap-2 justify-end">
          <input type="hidden" name="huerfanoId" value={huerfanoId} />
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>¿Descartarlo?</span>
          <BotonConfirmarDescarte />
          <button type="button" onClick={() => setConfirmando(false)}
            className="hairline text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
            style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            No
          </button>
        </form>
      ) : (
        <form action={accionAdj} className="flex items-center gap-2 justify-end">
          <input type="hidden" name="huerfanoId" value={huerfanoId} />
          {sinMonto ? (
            <span className="text-[12px] text-right" style={{ color: 'var(--faint)' }}>
              Sin monto legible no se puede adjuntar (metería $0.00) — pídele al chofer que reenvíe la foto
            </span>
          ) : viajesVivos.length > 0 ? (
            <>
              <select name="viajeId" required aria-label="Viaje al que va" defaultValue=""
                className="flex-1 min-w-0 max-w-[180px] text-[12px] px-2 py-1.5 rounded-lg hairline"
                style={{ background: 'var(--surface)' }}>
                <option value="" disabled>Elegir viaje…</option>
                {viajesVivos.map((v) => <option key={v.id} value={v.id}>{v.rotulo}</option>)}
              </select>
              <BotonAdjuntar />
            </>
          ) : (
            <span className="text-[12px]" style={{ color: 'var(--faint)' }}>Sin viajes abiertos a los cuales adjuntar</span>
          )}
          <button type="button" onClick={() => setConfirmando(true)} title="Descartar el comprobante"
            className="hairline w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--canvas)]"
            style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            <Trash2 width={13} height={13} strokeWidth={1.75} />
          </button>
        </form>
      )}
      {!confirmando && !sinMonto && viajesVivos.length > 0 && (
        <p className="text-[11px] mt-1 text-right" style={{ color: 'var(--faint)' }}>
          El selector ofrece los viajes vivos entre los {numero(cargados)} más recientes.
        </p>
      )}
      {estadoAdj?.error && <p className="text-[11px] mt-1 text-right" style={{ color: 'var(--bad)' }}>{estadoAdj.error}</p>}
      {estadoDesc?.error && <p className="text-[11px] mt-1 text-right" style={{ color: 'var(--bad)' }}>{estadoDesc.error}</p>}
    </div>
  );
}

function BotonAdjuntar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50 shrink-0"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Link2 width={12} height={12} strokeWidth={2} />
      {pending ? 'Adjuntando…' : 'Adjuntar'}
    </button>
  );
}

function BotonConfirmarDescarte() {
  const { pending } = useFormStatus();
  return (
    /* Texto rojo sobre su fondo tenue (tokens existentes) — no se inventa un
       token de contraste para un botón sólido rojo. */
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1 text-[12px] font-medium px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <Trash2 width={12} height={12} strokeWidth={2} />
      {pending ? 'Descartando…' : 'Sí, descartar'}
    </button>
  );
}
