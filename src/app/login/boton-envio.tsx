'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';
import { Boton } from '../ui-v2/componentes/boton';

/**
 * Botón de envío de /login con estado en vuelo (`aria-busy`, deshabilitado, texto «Solicitando…» / «Abriendo
 * Google…»), como Vexa. Solo lee `useFormStatus`: la server action, los límites y las respuestas sin oráculo no
 * se tocan. El icono (Google / glifo) lo pasa el llamador como elemento.
 */
export function BotonEnvio({
  className,
  reposo,
  enVuelo,
  icono,
}: {
  className: string;
  reposo: string;
  enVuelo: string;
  icono?: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" className={className} loading={pending} icono={icono}>
      <span>{pending ? enVuelo : reposo}</span>
    </Boton>
  );
}
