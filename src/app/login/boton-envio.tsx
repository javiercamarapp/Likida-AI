'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

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
    <button type="submit" className={className} aria-busy={pending} disabled={pending}>
      {icono}
      <span>{pending ? enVuelo : reposo}</span>
    </button>
  );
}
