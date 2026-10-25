'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AvisoResultado, type ResultadoUI } from '@/app/admin/ui/aviso-resultado';

export type EstadoPeriodo = { ok?: string; error?: string } | null;
export type AccionPeriodo = (prev: EstadoPeriodo, fd: FormData) => Promise<EstadoPeriodo>;

/**
 * «Declarar periodo» de un desglose ya importado (A37-A2-12). Los canales automáticos solo conocen el periodo si el NOMBRE del
 * archivo lo dice; sin él, los cobros extemporáneos, el doble entre archivos y el cierre mensual no se aplican. Aquí se declara
 * (o se corrige) sin volver a subir el archivo.
 */
export function DeclararPeriodo({ declarar, desgloseId, desde, hasta }: { declarar: AccionPeriodo; desgloseId: string; desde: string | null; hasta: string | null }) {
  const [estado, accion, pendiente] = useActionState(declarar, null);
  const router = useRouter();
  useEffect(() => {
    if (estado?.ok) router.refresh();
  }, [estado, router]);

  return (
    <form action={accion} className="flex items-center gap-1.5 flex-wrap text-[11.5px]" style={{ color: 'var(--muted)' }}>
      <input type="hidden" name="desglose" value={desgloseId} />
      <span>Periodo oficial del archivo{desde && hasta ? `: ${desde} a ${hasta}` : ': sin declarar'}</span>
      <input type="date" name="periodo_desde" required defaultValue={desde ?? ''} aria-label="Inicio del periodo oficial"
        className="hairline text-[12px] px-2 py-0.5 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--ink)' }} />
      <span>a</span>
      <input type="date" name="periodo_hasta" required defaultValue={hasta ?? ''} aria-label="Fin del periodo oficial"
        className="hairline text-[12px] px-2 py-0.5 rounded-lg" style={{ background: 'var(--surface)', color: 'var(--ink)' }} />
      <button type="submit" disabled={pendiente}
        className="hairline text-[12px] font-medium px-2.5 py-0.5 rounded-lg transition-colors hover:bg-[var(--canvas)] disabled:opacity-50"
        style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
        {pendiente ? 'Guardando…' : 'Declarar periodo'}
      </button>
      <AvisoResultado estado={estado as ResultadoUI} compacto />
    </form>
  );
}
