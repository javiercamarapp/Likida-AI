'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Boton, BotonConfirmar, clasesBoton, useNotificarResultado, type AccionDeForma, type ResultadoAccion } from '@/app/ui-v2/componentes';

// Una acción de FILA del directorio de emergencia (verificar, quitar). Su resultado llega a la pantalla con el aviso del sistema —el
// error no se va solo—, y lo que quita algo del directorio pasa por un diálogo que dice qué se pierde. Antes eran botones que
// devolvían `void`: un fallo se quedaba en el registro y quitar a un proveedor o a un contacto salía de un clic.

function Enviar({ etiqueta, titulo }: { etiqueta: string; titulo?: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" tamano="sm" variante="secondary" loading={pending} title={titulo}>
      {etiqueta}
    </Boton>
  );
}

export function AccionFila({ accion, id, etiqueta, titulo, tono = 'normal', confirmar }: {
  accion: AccionDeForma;
  id: string;
  etiqueta: string;
  /** Aclaración corta del botón (hover y lectores de pantalla). */
  titulo?: string;
  tono?: 'normal' | 'peligro';
  /** Con esto el botón abre primero un diálogo que dice el alcance. */
  confirmar?: { titulo: string; descripcion: React.ReactNode; etiquetaConfirmar: string };
}) {
  const [estado, despachar] = useActionState<ResultadoAccion, FormData>(accion, null);
  useNotificarResultado(estado);
  return (
    <form action={despachar}>
      <input type="hidden" name="id" value={id} />
      {confirmar ? (
        <BotonConfirmar
          etiqueta={etiqueta} tono={tono}
          titulo={confirmar.titulo} descripcion={confirmar.descripcion} etiquetaConfirmar={confirmar.etiquetaConfirmar}
          className={clasesBoton(tono === 'peligro' ? 'danger' : 'secondary', 'sm')}
        />
      ) : (
        <Enviar etiqueta={etiqueta} titulo={titulo} />
      )}
    </form>
  );
}
