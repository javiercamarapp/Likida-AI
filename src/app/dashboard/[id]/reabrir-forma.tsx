'use client';

import { useActionState, type ReactNode } from 'react';
import { Boton, type AccionDeForma, type ResultadoAccion } from '@/app/ui-v2/componentes';

/**
 * Forma de «Reabrir este viaje». La acción BORRA la liquidación y su PDF, así que usa la variante de peligro (no el primario negro, que en
 * esta pantalla es de «Descargar PDF» y «Aprobar») y el botón queda pegado a la casilla, al ancho de su texto.
 */
export function ReabrirForma({ accion, boton, children }: { accion: AccionDeForma; boton: string; children: ReactNode }) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="rv-liq__reabrir">
      {children}
      {estado?.error ? <p role="alert" className="rv-liq__reabrir-msg" data-tono="bad">{estado.error}</p> : null}
      {estado?.ok ? <p role="status" className="rv-liq__reabrir-msg">{estado.ok}</p> : null}
      <div className="rv-liq__reabrir-pie">
        <Boton type="submit" variante="danger" tamano="sm" disabled={pendiente}>{boton}</Boton>
      </div>
    </form>
  );
}
