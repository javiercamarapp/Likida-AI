'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Wrench, CircleCheck, Ban, RotateCcw } from 'lucide-react';
import { Boton, BotonConfirmar, Icono, clasesBoton, useNotificarResultado } from '@/app/ui-v2/componentes';
import './unidades.css';

export type ResultadoEstado = { ok: true; mensaje: string } | { ok: false; error: string } | null;
export type AccionEstado = (previo: ResultadoEstado, fd: FormData) => Promise<ResultadoEstado>;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EL DISPARADOR QUE FALTABA (auditoría 20, H4).
 *
 * `cambiarEstadoUnidad` existía desde la 0047 sin un solo llamador, y
 * `unidades/vista.tsx` ya pintaba la etiqueta "Dada de baja" esperando algo
 * que la encendiera. Resultado: un camión vendido o siniestrado se quedaba
 * "disponible" para siempre — el despacho lo ofrecía y el rótulo mentía.
 *
 * BOTONES Y NO UN `<select>`: son tres destinos, cada uno con una consecuencia
 * distinta que hay que poder leer ANTES de hacer clic. Un desplegable esconde
 * las tres detrás de una flecha y hace que "baja" se elija por accidente al
 * estar pegada a "taller".
 *
 * `en_ruta` NO tiene botón: ese estado lo mueve el viaje, no una persona.
 * Ofrecerlo aquí dejaría a una unidad "en ruta" sin ningún viaje detrás — un
 * rótulo que no es verdad, que es exactamente lo que este cambio vino a
 * cerrar.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const DESTINOS = {
  disponible: { etiqueta: 'Marcar disponible', Glifo: CircleCheck },
  taller: { etiqueta: 'Mandar a taller', Glifo: Wrench },
  baja: { etiqueta: 'Dar de baja', Glifo: Ban },
} as const;

type Destino = keyof typeof DESTINOS;

function BotonEstado({ destino, numeroEconomico }: { destino: Destino; numeroEconomico?: string }) {
  const { pending } = useFormStatus();
  const { etiqueta, Glifo } = DESTINOS[destino];
  // La BAJA pide confirmación (W2): es el único destino que saca a la unidad del
  // parque —no se ofrece para viajes nuevos y sale del conteo de papeles— y
  // antes salía de un clic. Taller y «disponible» se deshacen con otro clic.
  if (destino === 'baja') {
    return (
      <BotonConfirmar
        etiqueta={etiqueta} icono={<Icono icono={Glifo} tam={14} />}
        nombreConfirmar="estado" valorConfirmar="baja" deshabilitado={pending}
        titulo={`Dar de baja ${numeroEconomico ? `la unidad ${numeroEconomico}` : 'la unidad'}`}
        descripcion="Deja de ofrecerse para viajes nuevos y sale del conteo de papeles. Su historial de viajes y de taller se conserva completo; puedes devolverla al parque cuando quieras."
        etiquetaConfirmar="Sí, dar de baja"
        className={clasesBoton('danger', 'sm')}
      />
    );
  }
  return (
    <Boton type="submit" name="estado" value={destino} variante="secondary" tamano="sm" loading={pending} icono={<Icono icono={Glifo} tam={14} />}>
      {pending ? 'Guardando…' : etiqueta}
    </Boton>
  );
}

/**
 * Los destinos posibles desde el estado actual — nunca el que ya tiene. Un
 * botón "Marcar disponible" en una unidad que YA está disponible es un botón
 * que no hace nada, y el usuario que lo aprieta aprende a desconfiar del
 * resto.
 */
function destinosDesde(estado: string): Destino[] {
  if (estado === 'baja') return ['disponible'];
  if (estado === 'taller') return ['disponible', 'baja'];
  // `disponible` y `en_ruta`: de las dos se puede salir a taller o a baja.
  return ['taller', 'baja'];
}

/** La botonera de una unidad EN el parque. */
export function AccionesEstadoUnidad({ accion, unidadId, estado, numeroEconomico }: {
  accion: AccionEstado;
  unidadId: string;
  estado: string;
  /** Para decir CUÁL unidad en el diálogo de la baja. */
  numeroEconomico?: string;
}) {
  const [resultado, despachar] = useActionState(accion, null);
  // Una acción de FILA no tiene campos al lado donde enseñar el resultado: se
  // avisa con un toast (el error no se va solo). El inline es de los formularios.
  useNotificarResultado(resultado);
  const destinos = destinosDesde(estado);
  if (destinos.length === 0) return null;

  return (
    <form action={despachar} className="rv-un__acciones">
      <input type="hidden" name="unidadId" value={unidadId} />
      {destinos.map((d) => <BotonEstado key={d} destino={d} numeroEconomico={numeroEconomico} />)}
    </form>
  );
}

/**
 * El regreso: la única acción de una unidad dada de baja. Va aparte porque la
 * sección de bajas de la vista no repite los papeles ni las órdenes de taller
 * —ya no aplican— y aquí basta un botón.
 */
export function ReactivarUnidad({ accion, unidadId }: { accion: AccionEstado; unidadId: string }) {
  const [resultado, despachar] = useActionState(accion, null);
  useNotificarResultado(resultado);
  return (
    <form action={despachar}>
      <input type="hidden" name="unidadId" value={unidadId} />
      <BotonReactivar />
    </form>
  );
}

function BotonReactivar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" name="estado" value="disponible" variante="secondary" tamano="sm" loading={pending} icono={<Icono icono={RotateCcw} tam={14} />}>
      {pending ? 'Guardando…' : 'Regresó al parque'}
    </Boton>
  );
}
