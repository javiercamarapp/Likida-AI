'use client';

import { useState, useActionState, useEffect } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import type { ResumenBarrido } from '@/lib/likida/intake/consolidado';

export type EstadoBarrer = { error?: string; resumen?: ResumenBarrido } | null;
export type AccionBarrer = (prev: EstadoBarrer, fd: FormData) => Promise<EstadoBarrer>;

/**
 * "Ejecutar ahora" con confirmación en dos pasos — el mismo patrón que el
 * Agente de Cobranza (`cobranza/controles.tsx`). Aquí no sale ningún WhatsApp:
 * el barrido re-corre el cruce sobre las líneas pendientes contra los gastos
 * que llegaron DESPUÉS del estado de cuenta, y escribe solo lo que amarra. La
 * confirmación se conserva igual porque escribe conciliaciones fiscales, y un
 * botón que escribe de un clic es un accidente esperando turno.
 *
 * NO se deshabilita con la cola en cero: el conteo de la página puede estar
 * viejo (un gasto pudo llegar hace un segundo), y con cero de verdad el acuse
 * lo dice tal cual en vez de mentir con un botón muerto.
 */
export function BotonEjecutar({ ejecutarAhora, pendientes }: {
  ejecutarAhora: AccionBarrer;
  /** Lo que la página alcanzó a leer. `null` = la cola no se pudo leer. */
  pendientes: number | null;
}) {
  const [estado, accion] = useActionState(ejecutarAhora, null);
  const [confirmando, setConfirmando] = useState(false);
  const router = useRouter();

  // Tras un barrido, la cola y los KPIs del servidor ya cambiaron: se
  // refresca la página completa conservando el acuse local. El cierre del
  // paso de confirmación NO vive aquí (setState en un efecto encadena
  // renders): lo hace el onSubmit, que es evento del usuario.
  useEffect(() => {
    if (estado?.resumen) router.refresh();
  }, [estado, router]);

  const r = estado?.resumen;

  return (
    <div className="shrink-0">
      {confirmando ? (
        <form action={accion} onSubmit={() => setConfirmando(false)} className="inline-flex items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
            {pendientes === null
              ? '¿Barrer las líneas pendientes contra los gastos de hoy?'
              : `¿Barrer ${pendientes === 1 ? 'la línea pendiente' : `las ${pendientes} líneas pendientes`} contra los gastos de hoy?`}
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
          title="Volver a cruzar las líneas pendientes contra los gastos que llegaron después"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85"
          style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
          <RefreshCw width={13} height={13} strokeWidth={2} /> Ejecutar ahora
        </button>
      )}

      {estado?.error && <p className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
      {r && !confirmando && (
        <p className="text-[12px] mt-1.5" style={{ color: 'var(--muted)' }}>
          {r.revisadas === 0 ? (
            'No había nada pendiente que barrer.'
          ) : (
            <>
              Revisé <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{r.revisadas}</span>{' '}
              {r.revisadas === 1 ? 'línea pendiente' : 'líneas pendientes'}; amarré{' '}
              <span className="cifra-mono font-medium" style={{ color: 'var(--ink)' }}>{r.conciliadas}</span> contra
              gastos nuevos; refresqué candidatos de <span className="cifra-mono">{r.candidatosRefrescados}</span>;
              {' '}{r.siguenPendientes === 1 ? 'sigue' : 'siguen'} <span className="cifra-mono">{r.siguenPendientes}</span>.
            </>
          )}
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
      {pending ? 'Barriendo…' : 'Sí, barrer'}
    </button>
  );
}
