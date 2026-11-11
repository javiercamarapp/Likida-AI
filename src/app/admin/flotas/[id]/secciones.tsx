'use client';

import { useEffect, type ReactNode } from 'react';

export interface SeccionFicha { valor: string; etiqueta: string; contenido: ReactNode }

/**
 * Las secciones de la ficha 360, APILADAS en una sola página (Rovaq P2b no tiene pestañas ni píldoras de sección): cada una con su título
 * de 13/600 y su ancla `#ficha-<valor>`. El servidor ya leyó y pintó TODAS en una sola pasada. `?seccion=` (enlaces de las alertas) deja de
 * esconder las otras: lleva la vista a esa sección (`inicial`, decidida por el servidor leyendo esa misma URL).
 */
export function SeccionesFicha({ secciones, inicial }: { secciones: readonly SeccionFicha[]; inicial: string }) {
  useEffect(() => {
    if (!inicial || inicial === secciones[0]?.valor) return;
    document.getElementById(`ficha-${inicial}`)?.scrollIntoView({ block: 'start' });
  }, [inicial, secciones]);
  return (
    <>
      {secciones.map((s) => (
        <section key={s.valor} id={`ficha-${s.valor}`} aria-labelledby={`ficha-${s.valor}-t`} className="rv-ficha__seccion adm-ficha-sec adm-forma-fina">
          <h2 id={`ficha-${s.valor}-t`} className="adm-ficha-sec__t">{s.etiqueta}</h2>
          {s.contenido}
        </section>
      ))}
    </>
  );
}
