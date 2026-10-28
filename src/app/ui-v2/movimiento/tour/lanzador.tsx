'use client';

import { Play, RotateCcw } from 'lucide-react';
import { Boton, type VarianteBoton } from '../../componentes/boton';
import { useProgresoTour, useTour } from './proveedor';

/** Botón «Ver recorrido» / «Reanudar recorrido (paso N de M)». Es la ÚNICA forma
 *  de abrir un recorrido: nunca se abre solo. */
export function TourLanzador({ recorridoId, variante = 'ghost', etiqueta = 'Ver recorrido' }: {
  recorridoId: string;
  variante?: VarianteBoton;
  etiqueta?: string;
}) {
  const tour = useTour();
  const prog = useProgresoTour(recorridoId);
  if (!tour.existe(recorridoId)) return null;
  const enCurso = prog?.estado === 'en_curso';
  return enCurso ? (
    <Boton variante={variante} tamano="sm" icono={<RotateCcw width={14} height={14} aria-hidden="true" />} onClick={() => tour.reanudar(recorridoId)}>
      Reanudar recorrido (paso {prog.indice + 1} de {prog.total})
    </Boton>
  ) : (
    <Boton variante={variante} tamano="sm" icono={<Play width={14} height={14} aria-hidden="true" />} onClick={() => tour.reiniciar(recorridoId)}>
      {etiqueta}
    </Boton>
  );
}
