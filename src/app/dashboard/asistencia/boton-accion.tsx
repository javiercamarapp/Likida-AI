'use client';

import { useActionState } from 'react';
import { Aviso, type AccionDeForma, type ResultadoAccion } from '../../admin/ui/forma';

// A37-S16-06: «Tomar el control» y «Subir a nivel N» devolvían `void` y solo dejaban un warn en el log: si otra persona ya tenía el
// control o la base fallaba, la pantalla seguía diciendo «NADIE la ha tomado» y nadie sabía por qué. Aquí el resultado de la
// acción llega a la pantalla (mismo `Aviso` que ya usa «Cerrar con nota»).

export function BotonAccionMesa({
  accion, campos, etiqueta, titulo, clase,
}: {
  accion: AccionDeForma;
  /** Campos ocultos del formulario (id de la incidencia, nivel). */
  campos: Record<string, string | number>;
  etiqueta: string;
  titulo: string;
  clase: string;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="flex flex-col gap-1.5 items-end">
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <button type="submit" disabled={pendiente} className={`${clase} disabled:opacity-60`} title={titulo}>
        {pendiente ? 'Un momento…' : etiqueta}
      </button>
      <Aviso estado={estado} />
    </form>
  );
}
