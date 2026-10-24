'use client';

import { useFormStatus } from 'react-dom';

/** A37-S08-03: botón de formulario que se deshabilita mientras el server action
 *  corre — un doble toque en el teléfono ya no encola dos órdenes. */
export function BotonEnvio({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className ?? ''} disabled:opacity-50`}>
      {children}
    </button>
  );
}
