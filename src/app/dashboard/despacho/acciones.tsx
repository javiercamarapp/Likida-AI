'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send, UserPlus, RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AvisoCompacto, Boton, CampoTexto, Icono } from '@/app/ui-v2/componentes';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';
import './despacho.css';

export type AccionDespacho = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

function BotonEnviar({ texto, pendienteTexto, icono }: { texto: string; pendienteTexto: string; icono: LucideIcon }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" disabled={pending} icono={<Icono icono={icono} tam={16} />}>
      {pending ? pendienteTexto : texto}
    </Boton>
  );
}

function ErrorDeAccion({ estado }: { estado: { error?: string } | null }) {
  return estado?.error ? <AvisoCompacto tono="error" resumen={estado.error} /> : null;
}

/** Una fila de "Por asignar": elegir operador y asignar+avisar en un paso.
 *  La acción vive en el servidor (re-verifica sesión/rol/tenant); aquí solo
 *  se pinta el par buscador+botón con su error inline.
 *
 *  FE-2 (22-ago-2026): era un `<select>` con el catálogo COMPLETO de choferes
 *  POR FILA — doce filas × 7,500 `<option>` ≈ 1.5-2 MB de HTML en cada carga
 *  del despacho, y recortado a 1,000 en silencio por PostgREST encima. Ahora
 *  cada fila trae un buscador que pide 20 al servidor cuando se usa: la
 *  página arranca con cero opciones en el HTML. */
export function AsignarFila({ viajeId, buscarCatalogo, totalOperadores, asignarYAvisar }: {
  viajeId: string;
  buscarCatalogo: BuscarCatalogo;
  /** Cuántos choferes activos hay — solo para la pista "20 de N"; `null` si
   *  no se pudo contar, y entonces no se enseña ninguna cifra. */
  totalOperadores: number | null;
  asignarYAvisar: AccionDespacho;
}) {
  const [estado, accion] = useActionState(asignarYAvisar, null);
  return (
    <div>
      <form action={accion} className="rv-dsp__fila-accion">
        <input type="hidden" name="viajeId" value={viajeId} />
        <div className="rv-dsp__crece">
          <ComboCatalogo tipo="operador" name="operadorId" buscar={buscarCatalogo} requerido
            aria-label="Operador" etiquetaVacia="Escribe el nombre del chofer…"
            total={totalOperadores} className="rv-ctl" />
        </div>
        <BotonEnviar texto="Asignar y avisar" pendienteTexto="Asignando…" icono={Send} />
      </form>
      <ErrorDeAccion estado={estado} />
    </div>
  );
}

/** El gemelo de `AsignarFila`, para la unidad, en "En curso": el viaje ya
 *  tiene chofer y le falta (o se le cambia) el tractocamión. El select
 *  arranca en la unidad ACTUAL — un control que siempre dijera "sin unidad"
 *  sobre un viaje que sí la trae sería un rótulo falso. La opción vacía
 *  desasigna: `viaje.unidad_id` es nullable y quitar una unidad mal puesta
 *  es una corrección legítima. */
export function AsignarUnidadFila({ viajeId, unidadId, unidadEco, buscarCatalogo, totalUnidades, asignarUnidadViaje }: {
  viajeId: string;
  /** La unidad que el viaje trae HOY, o `null`. */
  unidadId: string | null;
  /** Su número económico — viene con el viaje (`ViajeRow.unidadEco`), así que
   *  el control arranca diciendo la verdad sin pedirle nada al catálogo. */
  unidadEco: string | null;
  buscarCatalogo: BuscarCatalogo;
  totalUnidades: number | null;
  asignarUnidadViaje: AccionDespacho;
}) {
  const [estado, accion] = useActionState(asignarUnidadViaje, null);
  return (
    <div>
      <form action={accion} className="rv-dsp__fila-accion">
        <input type="hidden" name="viajeId" value={viajeId} />
        <div className="rv-dsp__crece">
          <ComboCatalogo tipo="unidad" name="unidadId" buscar={buscarCatalogo}
            aria-label="Unidad" etiquetaVacia="Sin unidad"
            valorInicial={unidadId} textoInicial={unidadEco ?? ''} total={totalUnidades}
            className="rv-ctl" />
        </div>
        <BotonAsignarUnidad texto={unidadId ? 'Cambiar' : 'Asignar'} />
      </form>
      <ErrorDeAccion estado={estado} />
    </div>
  );
}

function BotonAsignarUnidad({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" tamano="sm" disabled={pending} title="Amarrar la unidad al viaje" aria-label={`${texto} la unidad del viaje`}>
      {pending ? 'Asignando…' : texto}
    </Boton>
  );
}

/** Mandar (o re-mandar) el aviso de WhatsApp a un chofer que no ha
 *  aceptado. El primer aviso manda el sello y un reaviso no lo reinicia —
 *  el rótulo distingue los dos casos: "Avisar" cuando nunca salió (el fallo
 *  silencioso al crear el viaje), "Reavisar" cuando se insiste. */
export function BotonReenviar({ viajeId, yaAvisado, reenviarAviso }: {
  viajeId: string;
  yaAvisado: boolean;
  reenviarAviso: AccionDespacho;
}) {
  const [estado, accion] = useActionState(reenviarAviso, null);
  return (
    <div className="rv-dsp__der">
      <form action={accion}>
        <input type="hidden" name="viajeId" value={viajeId} />
        <BotonInsistir texto={yaAvisado ? 'Reavisar' : 'Avisar'} />
      </form>
      <ErrorDeAccion estado={estado} />
    </div>
  );
}

function BotonInsistir({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" tamano="sm" disabled={pending} title="Mandar el aviso por WhatsApp" aria-label={`${texto} al chofer por WhatsApp`}
      icono={<Icono icono={RefreshCw} tam={16} />}>
      {pending ? 'Enviando…' : texto}
    </Boton>
  );
}

/** Alta rápida de operador — nombre y WhatsApp, sin brincar de página a
 *  media captura. La validación fuerte (lada 52, duplicados ENTRE flotas)
 *  vive en el servidor y sus mensajes se enseñan tal cual. */
export function AltaOperador({ altaOperador }: { altaOperador: AccionDespacho }) {
  const [estado, accion] = useActionState(altaOperador, null);
  return (
    <form action={accion} className="rv-forma">
      <CampoTexto etiqueta="Nombre del operador" name="nombre" required />
      <div className="rv-forma__fila">
        <CampoTexto etiqueta="WhatsApp (10 dígitos)" name="telefono" required inputMode="tel" className="rv-forma__crece" />
        <BotonEnviar texto="Dar de alta" pendienteTexto="Guardando…" icono={UserPlus} />
      </div>
      <ErrorDeAccion estado={estado} />
    </form>
  );
}
