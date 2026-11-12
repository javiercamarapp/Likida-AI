'use client';

import { useState, type ReactNode } from 'react';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import './agentes.css';

/**
 * Zona de soltar de Rovaq (`FL`): caja punteada que envuelve a un `CampoArchivo`. Arrastrar un archivo encima lo pone en el
 * <input type="file"> REAL del interior (el mismo que viaja en el FormData) y avisa con un `change`, así que el formulario no
 * cambia de contrato. Sin arrastre sigue funcionando el botón «Seleccionar archivo». Un solo archivo si el input no es `multiple`.
 */
export function ZonaSoltar({ children }: { children: ReactNode }) {
  const { t } = useT('agentes', agentesEs);
  const [encima, setEncima] = useState(false);
  return (
    <div
      className="rv-ag-soltar"
      data-encima={encima || undefined}
      onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        setEncima(false);
        const entrada = e.currentTarget.querySelector<HTMLInputElement>('input[type="file"]');
        const archivos = e.dataTransfer.files;
        if (!entrada || entrada.disabled || archivos.length === 0) return;
        const dt = new DataTransfer();
        for (const f of [...archivos].slice(0, entrada.multiple ? archivos.length : 1)) dt.items.add(f);
        entrada.files = dt.files;
        entrada.dispatchEvent(new Event('change', { bubbles: true }));
      }}
    >
      {children}
      <span className="rv-ag-soltar__pista">{t('f26d4.soltar.pista')}</span>
    </div>
  );
}
