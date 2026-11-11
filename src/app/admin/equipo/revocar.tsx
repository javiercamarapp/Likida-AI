'use client';

import { useActionState } from 'react';
import { BotonConfirmar } from '../../ui-v2/componentes/confirmar';
import { clasesBoton } from '../../ui-v2/componentes/boton';
import type { AccionDeForma, ResultadoAccion } from '../ui/forma';

/** «Revocar» (Rovaq CF «Equipo»): el botón de PELIGRO de la fila. Cierra el acceso de la persona (baja de la cuenta), así que pide una
 *  confirmación que dice la consecuencia; la acción de servidor (`accionDarDeBajaUsuario`) re-gatea y deja su asiento en la bitácora. */
export function Revocar({ id, nombre, accion, etiqueta, titulo, descripcion, confirmar }: {
  id: string; nombre: string; accion: AccionDeForma; etiqueta: string; titulo: string; descripcion: string; confirmar: string;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="adm-rol-celda" aria-label={`${etiqueta} ${nombre}`}>
      <input type="hidden" name="id" value={id} />
      <BotonConfirmar etiqueta={etiqueta} titulo={titulo} descripcion={descripcion} etiquetaConfirmar={confirmar} deshabilitado={pendiente}
        className={clasesBoton('danger', 'sm')} />
      {estado?.error ? <span role="alert" className="adm-rol-aviso" data-error="">{estado.error}</span> : null}
    </form>
  );
}
