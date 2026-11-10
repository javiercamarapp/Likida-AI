'use client';

import { useActionState } from 'react';
import '../conductores.css';
import { Boton } from '@/app/ui-v2/componentes';
import { Aviso, type AccionSitio } from './formas';

/**
 * Archivar / reactivar un sitio (A37-S13-06). Antes era un `<form action>` que descartaba el resultado: si la base fallaba o el
 * sitio ya no existía, la fila seguía igual y sin mensaje, y el jefe creía haber apagado una geocerca que seguía validando llegadas.
 */
export function FormaEstadoSitio({ accion, id, activa }: { accion: AccionSitio; id: string; activa: boolean }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="rv-cd__pila--s">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activa" value={activa ? 'no' : 'si'} />
      <Boton type="submit" variante="ghost" tamano="sm">{activa ? 'Archivar' : 'Reactivar'}</Boton>
      {estado && !estado.ok && <Aviso r={estado} />}
    </form>
  );
}
