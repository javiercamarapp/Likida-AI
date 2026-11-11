'use client';

import { useActionState, useRef } from 'react';
import { ROLES_INVITABLES } from '@/lib/auth/invitar';
import type { AccionDeForma, ResultadoAccion } from '../ui/forma';

/**
 * El rol de una persona como select de 28 px EN la fila de la tabla (Rovaq CF «Equipo»): elegir otro rol envía el cambio. La acción
 * (`accionCambiarRolUsuario`, con su puerta, su segundo factor y su bitácora) llega por prop; el resultado (o el rechazo) se dice bajo el
 * select en una línea, no se traga.
 */
export function CambiarRol({ id, rol, accion, etiqueta }: { id: string; rol: string; accion: AccionDeForma; etiqueta: string }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  const forma = useRef<HTMLFormElement>(null);
  return (
    <form ref={forma} action={enviar} className="adm-rol-celda">
      <input type="hidden" name="id" value={id} />
      <select name="rol" aria-label={etiqueta} defaultValue={ROLES_INVITABLES.some((r) => r.valor === rol) ? rol : ''} disabled={pendiente}
        className="adm-rol-select" onChange={() => forma.current?.requestSubmit()}>
        <option value="" disabled>—</option>
        {ROLES_INVITABLES.map((r) => <option key={r.valor} value={r.valor}>{r.rotulo}</option>)}
      </select>
      <span aria-live="polite" className="adm-rol-aviso" data-error={estado?.error ? '' : undefined}>{estado?.error ?? estado?.ok ?? ''}</span>
    </form>
  );
}
