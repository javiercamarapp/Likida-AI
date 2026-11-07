import type { Ref } from 'react';
import { CheckDibujado } from './check-dibujado';

// La etiqueta junto al elemento real: «Haz clic aquí: X», «Aquí: X» o «Hecho». Su posición la escribe la capa por CSSOM (--lab-x/y)
// y el lado por atributo; aquí solo el contenido. Decorativa: lo mismo se dice en la tarjeta (región con nombre y `aria-live`).
export type EstadoEtiqueta = 'accion' | 'aqui' | 'hecho';

export function EtiquetaObjetivo({ texto, estado, refEtiqueta }: { texto: string; estado: EstadoEtiqueta; refEtiqueta?: Ref<HTMLDivElement> }) {
  return (
    <div ref={refEtiqueta} className="rv-onb-etiqueta" data-estado={estado} aria-hidden="true">
      <span className="rv-onb-etiqueta__in">
        {estado === 'hecho'
          ? <><CheckDibujado tamano={14} />Hecho</>
          : <>
            <svg className="rv-onb-etiqueta__flecha" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></svg>
            {estado === 'accion' ? `Haz clic aquí: ${texto}` : `Aquí: ${texto}`}
          </>}
      </span>
    </div>
  );
}
