'use client';

import { useFormStatus } from 'react-dom';
import { Boton, type VarianteBoton } from '../../ui-v2/componentes/boton';

/** A37-S08-03: botón de formulario que se deshabilita mientras el server action
 *  corre — un doble toque en el teléfono ya no encola dos órdenes. */
export function BotonEnvio({ children, variante = 'secondary' }: { children: React.ReactNode; variante?: VarianteBoton }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante={variante} tamano="sm" disabled={pending} loading={pending} aria-busy={pending}>
      {children}
    </Boton>
  );
}
