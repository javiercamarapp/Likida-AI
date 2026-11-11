'use client';

import { useState, type ReactNode } from 'react';
import { SegmentedControl } from '../../../ui-v2/componentes/segmented';

export interface SeccionFicha { valor: string; etiqueta: string; contenido: ReactNode }

/**
 * Las secciones de la ficha 360 (SegmentedControl, no pestañas: la ficha no es un hub). El servidor ya leyó y pintó TODAS las secciones
 * (una sola pasada); aquí solo se muestra una. La elegida viaja en `?seccion=` (history.replaceState, sin recargar) para que un enlace
 * de una alerta caiga en la sección correcta; `inicial` la decide el servidor leyendo esa misma URL.
 */
export function SeccionesFicha({ secciones, inicial }: { secciones: readonly SeccionFicha[]; inicial: string }) {
  const [activa, setActiva] = useState(secciones.some((s) => s.valor === inicial) ? inicial : secciones[0]?.valor ?? '');
  const elegir = (v: string) => {
    setActiva(v);
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('seccion', v);
      window.history.replaceState(window.history.state, '', u);
    } catch { /* sin historial (previa): la selección sigue funcionando */ }
  };
  return (
    <>
      <SegmentedControl etiqueta="Sección de la ficha" opciones={secciones.map((s) => ({ valor: s.valor, etiqueta: s.etiqueta }))} valor={activa} onChange={elegir} />
      {secciones.map((s) => (
        <section key={s.valor} aria-label={s.etiqueta} hidden={s.valor !== activa} className="rv-ficha__seccion">{s.contenido}</section>
      ))}
    </>
  );
}
