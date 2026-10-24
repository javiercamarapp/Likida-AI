'use client';

import { useActionState } from 'react';
import { Aviso, type AccionSitio } from './formas';

/**
 * Archivar / reactivar un sitio (A37-S13-06). Antes era un `<form action>` que descartaba el resultado: si la base fallaba o el
 * sitio ya no existía, la fila seguía igual y sin mensaje, y el jefe creía haber apagado una geocerca que seguía validando llegadas.
 */
export function FormaEstadoSitio({ accion, id, activa }: { accion: AccionSitio; id: string; activa: boolean }) {
  const [estado, enviar] = useActionState(accion, null);
  return (
    <form action={enviar} className="inline-flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activa" value={activa ? 'no' : 'si'} />
      <button type="submit" className="underline text-left" style={{ color: 'var(--muted)' }}>{activa ? 'Archivar' : 'Reactivar'}</button>
      {estado && !estado.ok && <Aviso r={estado} />}
    </form>
  );
}
