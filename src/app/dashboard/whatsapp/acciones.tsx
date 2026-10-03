'use client';

import { useState } from 'react';
import { Check, Copy, Printer } from 'lucide-react';
import { useNotificar } from '../../admin/ui/notificaciones';

/** Copiar el enlace y imprimir el cartel — los dos gestos de la guía de arranque. */
export function AccionesEnlace({ enlace }: { enlace: string }) {
  const [copiado, setCopiado] = useState(false);
  const { notificar } = useNotificar();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(enlace);
      setCopiado(true);
      notificar({ tono: 'ok', mensaje: 'Enlace copiado. Pégalo en el grupo de tus choferes.' });
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Sin permiso de portapapeles (navegador, iframe): se dice, y el enlace
      // sigue visible arriba para seleccionarlo a mano.
      notificar({ tono: 'aviso', mensaje: 'Tu navegador no dejó copiar. Selecciona el enlace y cópialo a mano.' });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={copiar}
        className="hairline inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]">
        {copiado ? <Check aria-hidden width={14} height={14} strokeWidth={2} /> : <Copy aria-hidden width={14} height={14} strokeWidth={1.75} />}
        {copiado ? 'Copiado' : 'Copiar enlace'}
      </button>
      <button type="button" onClick={() => window.print()}
        className="hairline inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition-colors hover:bg-[var(--canvas)]">
        <Printer aria-hidden width={14} height={14} strokeWidth={1.75} />
        Imprimir cartel
      </button>
    </div>
  );
}
