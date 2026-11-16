'use client';

import { Play, RotateCcw } from 'lucide-react';
import { Boton, type VarianteBoton } from '../../componentes/boton';
import { useProgresoTour, useTour, useTourOpcional } from './proveedor';
import { useT } from '@/lib/i18n/proveedor';
import { onboarding as onbEs } from '@/lib/i18n/es/onboarding';

/** Botón «Ver recorrido» / «Reanudar recorrido (paso N de M)». Es la ÚNICA forma
 *  de abrir un recorrido: nunca se abre solo. */
export function TourLanzador(props: {
  recorridoId: string;
  variante?: VarianteBoton;
  etiqueta?: string;
}) {
  // Sin proveedor (v2 sin perfil: el layout no monta el motor) no hay recorrido que ofrecer: se degrada a nada.
  if (!useTourOpcional()) return null;
  return <LanzadorConProveedor {...props} />;
}

function LanzadorConProveedor({ recorridoId, variante = 'ghost', etiqueta }: {
  recorridoId: string;
  variante?: VarianteBoton;
  etiqueta?: string;
}) {
  const { t } = useT('onboarding', onbEs);
  const tour = useTour();
  const prog = useProgresoTour(recorridoId);
  if (!tour.existe(recorridoId)) return null;
  const enCurso = prog?.estado === 'en_curso';
  return enCurso ? (
    <Boton variante={variante} tamano="sm" icono={<RotateCcw width={14} height={14} aria-hidden="true" />} onClick={() => tour.reanudar(recorridoId)}>
      {t('ui.lanzador.reanudar', { n: prog.indice + 1, total: prog.total })}
    </Boton>
  ) : (
    <Boton variante={variante} tamano="sm" icono={<Play width={14} height={14} aria-hidden="true" />} onClick={() => tour.reiniciar(recorridoId)}>
      {etiqueta ?? t('ui.lanzador.ver')}
    </Boton>
  );
}
