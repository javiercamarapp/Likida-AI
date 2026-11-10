'use client';

import { useActionState } from 'react';
import { AvisoResultado, Boton, type AccionDeForma, type ResultadoAccion } from '@/app/ui-v2/componentes';
import './asistencia.css';

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
  clase?: string;
}) {
  const [estado, enviar, pendiente] = useActionState<ResultadoAccion, FormData>(accion, null);
  return (
    <form action={enviar} className="rv-as__boton">
      {Object.entries(campos).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Boton type="submit" variante="secondary" tamano="sm" loading={pendiente} className={clase} title={titulo}>
        {pendiente ? 'Un momento…' : etiqueta}
      </Boton>
      <AvisoResultado estado={estado} />
    </form>
  );
}
