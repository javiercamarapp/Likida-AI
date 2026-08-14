'use client';

import { useEffect } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';

export type AccionSubir = (
  prev: { error?: string; resumen?: { totalLineas: number; conciliadas: number; porConciliar: number } } | null,
  fd: FormData,
) => Promise<{ error?: string; resumen?: { totalLineas: number; conciliadas: number; porConciliar: number } } | null>;

/**
 * El XML del consolidado, por pantalla. El cruce corre en el servidor
 * (guardarYConciliarConsolidado — el mismo del camino de WhatsApp) y el
 * resultado se dice con sus tres números; tras un cruce, la página completa
 * se refresca para que KPIs y bitácora cuenten lo nuevo.
 */
export function SubirDesglose({ subirDesglose }: { subirDesglose: AccionSubir }) {
  const [estado, accion] = useActionState(subirDesglose, null);
  const router = useRouter();

  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  return (
    <div>
      <form action={accion} className="flex items-center gap-2 flex-wrap">
        <input type="file" name="archivo" accept=".xml,text/xml,application/xml" required
          aria-label="XML del CFDI consolidado"
          className="text-[12.5px] file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:text-[12.5px] file:font-medium file:cursor-pointer"
          style={{ color: 'var(--muted)' }} />
        <BotonSubir />
      </form>
      {estado?.error && <p className="text-[12px] mt-2" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
      {estado?.resumen && (
        <p className="text-[12px] mt-2" style={{ color: 'var(--muted)' }}>
          Cruce corrido: <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{estado.resumen.conciliadas}</span> de{' '}
          <span className="cifra-mono">{estado.resumen.totalLineas}</span> líneas conciliadas solas
          {estado.resumen.porConciliar > 0 && <> · {estado.resumen.porConciliar} esperan a un humano en la mesa</>}.
        </p>
      )}
    </div>
  );
}

function BotonSubir() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Upload width={13} height={13} strokeWidth={2} className={pending ? 'animate-pulse' : ''} />
      {pending ? 'Cruzando…' : 'Cruzar contra los viajes'}
    </button>
  );
}
