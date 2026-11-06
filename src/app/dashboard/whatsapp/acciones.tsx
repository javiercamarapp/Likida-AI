'use client';

import { useState } from 'react';
import { Check, Copy, Printer } from 'lucide-react';
import { useNotificar } from '../../admin/ui/notificaciones';

/** Copiar el enlace y imprimir el cartel — los dos gestos de la guía de arranque. */
export function AccionesEnlace({ enlace, esPrueba = false }: { enlace: string; esPrueba?: boolean }) {
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
      <button type="button" onClick={copiar} disabled={esPrueba}
        className="rv-btn rv-btn--secondary">
        {copiado ? <Check aria-hidden width={14} height={14} strokeWidth={2} /> : <Copy aria-hidden width={14} height={14} strokeWidth={1.75} />}
        {copiado ? 'Copiado' : 'Copiar enlace'}
      </button>
      <button type="button" onClick={() => window.print()} disabled={esPrueba}
        className="rv-btn rv-btn--secondary">
        <Printer aria-hidden width={14} height={14} strokeWidth={1.75} />
        Imprimir cartel
      </button>
    </div>
  );
}
