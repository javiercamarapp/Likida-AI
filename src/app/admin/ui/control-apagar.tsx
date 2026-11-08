'use client';

import { useState } from 'react';
import { Boton } from '../../ui-v2/componentes/boton';

/**
 * Palanca encender/apagar en UNA línea (~40 px por fila). Estado normal: [Apagar] o [Encender]. El «Motivo» NO ocupa la fila: aparece
 * SOLO al pulsar «Apagar», con «Confirmar apagado» y «Cancelar». El servidor sigue exigiéndolo (el campo es `required` y el CHECK de
 * la 0110 va detrás): apagar una palanca sin nota es una bomba sin nota, y encender no necesita motivo.
 * Conserva los `name` de siempre (`id`, `operacion`, `motivo`). `enviar` es la acción de un `useActionState` del propio cliente.
 */
export function ControlApagar(props: PropsControlApagar) {
  // `key` por estado real: al cambiar (la acción terminó y la página se revalidó) el motivo vuelve a cerrarse sin efectos.
  return <ControlApagarInterno key={String(props.apagado)} {...props} />;
}

interface PropsControlApagar {
  id: string;
  apagado: boolean;
  pendiente: boolean;
  enviar: (fd: FormData) => void;
  etiquetaMotivo?: string;
}

function ControlApagarInterno({ id, apagado, pendiente, enviar, etiquetaMotivo = 'Motivo (obligatorio)' }: {
  id: string;
  apagado: boolean;
  pendiente: boolean;
  enviar: (fd: FormData) => void;
  etiquetaMotivo?: string;
}) {
  const [pidiendo, setPidiendo] = useState(false);

  return (
    <form action={enviar} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="operacion" value={apagado ? 'encender' : 'apagar'} />
      {apagado ? (
        <Boton type="submit" variante="primary" tamano="sm" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Encender'}</Boton>
      ) : pidiendo ? (
        <>
          <input name="motivo" required autoFocus aria-label="Motivo del apagado" placeholder={etiquetaMotivo} className="rv-ctl" style={{ width: '12rem' }} />
          <Boton type="submit" variante="danger" tamano="sm" disabled={pendiente}>{pendiente ? 'Guardando…' : 'Confirmar apagado'}</Boton>
          <Boton type="button" variante="ghost" tamano="sm" onClick={() => setPidiendo(false)}>Cancelar</Boton>
        </>
      ) : (
        <Boton type="button" variante="danger" tamano="sm" onClick={() => setPidiendo(true)}>Apagar</Boton>
      )}
    </form>
  );
}
