'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Wrench, CircleCheck, Ban, TriangleAlert, CheckCircle2, RotateCcw } from 'lucide-react';

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
  disponible: { etiqueta: 'Marcar disponible', Icono: CircleCheck, tono: 'var(--ok)' },
  taller: { etiqueta: 'Mandar a taller', Icono: Wrench, tono: 'var(--warn)' },
  baja: { etiqueta: 'Dar de baja', Icono: Ban, tono: 'var(--bad)' },
} as const;

type Destino = keyof typeof DESTINOS;

function BotonEstado({ destino }: { destino: Destino }) {
  const { pending } = useFormStatus();
  const { etiqueta, Icono, tono } = DESTINOS[destino];
  return (
    <button type="submit" name="estado" value={destino} disabled={pending}
      className="h-7 px-2.5 rounded-lg hairline text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-70 disabled:opacity-40"
      style={{ color: tono }}>
      <Icono width={12} height={12} strokeWidth={1.75} />
      {pending ? 'Guardando…' : etiqueta}
    </button>
  );
}

function Aviso({ estado }: { estado: ResultadoEstado }) {
  if (!estado) return null;
  return estado.ok ? (
    <div className="flex items-center gap-2 text-[12px] px-3 py-2 rounded-lg mt-2"
      style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
      <CheckCircle2 width={14} height={14} strokeWidth={1.75} />
      {estado.mensaje}
    </div>
  ) : (
    <div className="flex items-start gap-2 text-[12px] px-3 py-2 rounded-lg mt-2"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={14} height={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {estado.error}
    </div>
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
export function AccionesEstadoUnidad({ accion, unidadId, estado }: {
  accion: AccionEstado;
  unidadId: string;
  estado: string;
}) {
  const [resultado, despachar] = useActionState(accion, null);
  const destinos = destinosDesde(estado);
  if (destinos.length === 0) return null;

  return (
    <form action={despachar} className="mt-3">
      <input type="hidden" name="unidadId" value={unidadId} />
      <div className="flex items-center gap-2 flex-wrap">
        {destinos.map((d) => <BotonEstado key={d} destino={d} />)}
      </div>
      <Aviso estado={resultado} />
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
  return (
    <form action={despachar}>
      <input type="hidden" name="unidadId" value={unidadId} />
      <BotonReactivar />
      <Aviso estado={resultado} />
    </form>
  );
}

function BotonReactivar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name="estado" value="disponible" disabled={pending}
      className="h-7 px-2.5 rounded-lg hairline text-[11.5px] font-medium inline-flex items-center gap-1.5 transition-opacity hover:opacity-70 disabled:opacity-40"
      style={{ color: 'var(--ok)' }}>
      <RotateCcw width={12} height={12} strokeWidth={1.75} />
      {pending ? 'Guardando…' : 'Regresó al parque'}
    </button>
  );
}
