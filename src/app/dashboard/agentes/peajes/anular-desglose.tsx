'use client';

import { useState, useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Ban } from 'lucide-react';
import { DialogoConfirmar } from '@/app/admin/ui/confirmar';
import { AvisoResultado, type ResultadoUI } from '@/app/admin/ui/aviso-resultado';

export type EstadoAnular = { ok?: string; error?: string } | null;
export type AccionAnular = (prev: EstadoAnular, fd: FormData) => Promise<EstadoAnular>;

/**
 * «Anular desglose»: para el archivo subido por error. Pide un MOTIVO (obligatorio:
 * una anulación sin porqué es la que nadie puede defender), lo dice todo en el
 * diálogo —qué deja de contar y que el archivo correcto puede volver a mandarse— y
 * no borra nada: el desglose queda de constancia con quién y por qué.
 */
export function BotonAnular({ anular, desgloseId }: { anular: AccionAnular; desgloseId: string }) {
  const [estado, accion, pendiente] = useActionState(anular, null);
  const [abierto, setAbierto] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (estado?.ok) router.refresh();
  }, [estado, router]);

  return (
    <form action={accion} className="shrink-0" onSubmit={() => setAbierto(false)}>
      <input type="hidden" name="desglose" value={desgloseId} />
      <button type="button" onClick={() => setAbierto(true)}
        title="Para un archivo subido por error: deja de contar, no se borra"
        className="hairline inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors hover:bg-[var(--canvas)]"
        style={{ background: 'var(--surface)', color: 'var(--bad)' }}>
        <Ban width={13} height={13} strokeWidth={2} /> Anular
      </button>
      <DialogoConfirmar
        abierto={abierto} titulo="¿Anular este desglose?" tono="peligro"
        etiquetaConfirmar="Anular desglose" tipoConfirmar="submit" pendiente={pendiente}
        onConfirmar={() => setAbierto(false)} onCancelar={() => setAbierto(false)}
        descripcion={(
          <div className="space-y-2">
            <p>
              Deja de aparecer aquí, de contar en la bitácora RMF 9.1.8, de exportarse y de avisar a la oficina. No se borra:
              queda de constancia con quién lo anuló y por qué. El archivo correcto (o este mismo, ya arreglado) puede volver a mandarse.
            </p>
            <label className="block">
              <span className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>Motivo (obligatorio, hasta 500 caracteres)</span>
              <textarea name="motivo" required maxLength={500} rows={3}
                className="hairline text-[12.5px] px-2.5 py-1.5 rounded-lg w-full mt-0.5"
                style={{ background: 'var(--surface)', color: 'var(--ink)' }} />
            </label>
          </div>
        )}
      />
      <AvisoResultado estado={estado as ResultadoUI} compacto />
    </form>
  );
}
