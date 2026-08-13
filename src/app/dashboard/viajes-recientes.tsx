'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { TablaViajes, TituloSeccion, type FilaViaje } from './resumen-visual';

/**
 * La tarjeta "Viajes recientes" con su botón de abrir (pedido del 12-ago):
 * colapsada enseña 6; el botón despliega TODOS los viajes ya cargados (el
 * tope de 100 de getViajes) ahí mismo — real hoy, sin esperar a que exista
 * la página de Viajes. Cuando esa página se rehaga, este botón puede
 * volverse el link "Ver todo".
 */
export function ViajesRecientes({ filas, sufijo }: { filas: FilaViaje[]; sufijo: string }) {
  const [abierto, setAbierto] = useState(false);
  const visibles = abierto ? filas : filas.slice(0, 6);

  return (
    <div className="card p-3 mt-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <TituloSeccion>Viajes recientes</TituloSeccion>
        {filas.length > 6 && (
          <button type="button" onClick={() => setAbierto((v) => !v)}
            className="hairline inline-flex items-center gap-1 text-[12px] font-medium px-2.5 h-7 rounded-lg transition-colors hover:bg-[var(--canvas)] shrink-0">
            {abierto
              ? <>Ver menos <ChevronUp width={13} height={13} strokeWidth={2} /></>
              : <>Ver los {filas.length} <ChevronDown width={13} height={13} strokeWidth={2} /></>}
          </button>
        )}
      </div>
      {/* Abierta, la lista NO estira la tarjeta: scrollea adentro con el
          encabezado pegado (sticky en TablaViajes). */}
      <div className={abierto ? 'max-h-[300px] overflow-y-auto pr-1' : ''}>
        <TablaViajes viajes={visibles} sufijo={sufijo} />
      </div>
    </div>
  );
}
