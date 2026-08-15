'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

export type ResumenCruce = {
  total: number;
  cuadra: number;
  noCuadra: number;
  sinContraparte: number;
  noEscritas: number;
};
export type EstadoConciliar = { error?: string; resumen?: ResumenCruce } | null;
export type AccionConciliar = (prev: EstadoConciliar, fd: FormData) => Promise<EstadoConciliar>;

/**
 * «Conciliar» con confirmación en dos pasos — el mismo patrón que el barrido
 * (`controles.tsx`) y por la misma razón: re-corre el cruce COMPLETO del
 * desglose contra los gastos de caseta de hoy y reescribe las tres cubetas,
 * y un botón que reescribe de un clic es un accidente esperando turno. El
 * acuse dice lo que quedó EN LA BASE, incluidas las líneas que no se
 * pudieron escribir.
 */
export function BotonConciliar({ conciliar, desgloseId }: {
  conciliar: AccionConciliar;
  desgloseId: string;
}) {
  const [estado, accion] = useActionState(conciliar, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="shrink-0">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="inline-flex items-center gap-2">
          <input type="hidden" name="desglose" value={desgloseId} />
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            ¿Re-cruzar el desglose completo contra los gastos de caseta de hoy?
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
          title="Volver a cruzar todas las líneas del desglose contra los gastos que hay hoy"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          <RefreshCw width={13} height={13} strokeWidth={2} /> Conciliar
        </button>
      )}

      {estado?.error && <p className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
      {r && !confirmando && (
        <p className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>
          Crucé <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{r.total}</span> líneas:{' '}
          <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{r.cuadra}</span> cuadran,{' '}
          <span className="cifra-mono">{r.noCuadra}</span> con discrepancia,{' '}
          <span className="cifra-mono">{r.sinContraparte}</span> sin contraparte
          {r.noEscritas > 0 && (
            <span style={{ color: 'var(--bad)' }}> · {r.noEscritas} no se pudieron escribir — vuelve a conciliar</span>
          )}.
        </p>
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
      <RefreshCw width={13} height={13} strokeWidth={2} className={pending ? 'animate-spin' : ''} />
      {pending ? 'Cruzando…' : 'Sí, cruzar'}
    </button>
  );
}
