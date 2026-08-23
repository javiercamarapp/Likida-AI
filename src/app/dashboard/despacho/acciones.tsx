'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send, UserPlus, RefreshCw } from 'lucide-react';
import { ComboCatalogo, type BuscarCatalogo } from '../combo-catalogo';

export type AccionDespacho = (
  prev: { error?: string } | null,
  fd: FormData,
) => Promise<{ error?: string } | null>;

function BotonEnviar({ texto, pendienteTexto, Icono }: { texto: string; pendienteTexto: string; Icono: typeof Send }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-opacity hover:opacity-85 disabled:opacity-50 shrink-0"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
      <Icono width={13} height={13} strokeWidth={2} />
      {pending ? pendienteTexto : texto}
    </button>
  );
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
      <form action={accion} className="flex items-start gap-2">
        <input type="hidden" name="viajeId" value={viajeId} />
        <div className="flex-1 min-w-0">
          <ComboCatalogo tipo="operador" name="operadorId" buscar={buscarCatalogo} requerido
            aria-label="Operador" etiquetaVacia="Escribe el nombre del chofer…"
            total={totalOperadores}
            className="w-full min-w-0 text-[12.5px] px-2.5 py-1.5 rounded-lg hairline"
            estilo={{ background: 'var(--surface)' }}
          />
        </div>
        <BotonEnviar texto="Asignar y avisar" pendienteTexto="Asignando…" Icono={Send} />
      </form>
      {estado?.error && <p className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
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
      <form action={accion} className="flex items-start gap-1.5">
        <input type="hidden" name="viajeId" value={viajeId} />
        <div className="min-w-0">
          <ComboCatalogo tipo="unidad" name="unidadId" buscar={buscarCatalogo}
            aria-label="Unidad" etiquetaVacia="Sin unidad"
            valorInicial={unidadId} textoInicial={unidadEco ?? ''} total={totalUnidades}
            className="w-full min-w-0 text-[11.5px] px-2 py-1 rounded-lg hairline cifra-mono"
            estilo={{ background: 'var(--surface)' }}
          />
        </div>
        <BotonAsignarUnidad texto={unidadId ? 'Cambiar' : 'Asignar'} />
      </form>
      {estado?.error && <p className="text-[11px] mt-0.5" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
    </div>
  );
}

function BotonAsignarUnidad({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title="Amarrar la unidad al viaje"
      aria-label={`${texto} la unidad del viaje`}
      className="hairline inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg transition-colors hover:bg-[var(--canvas)] disabled:opacity-50 shrink-0"
      style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
      {pending ? 'Asignando…' : texto}
    </button>
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
    <div className="text-right">
      <form action={accion} className="inline">
        <input type="hidden" name="viajeId" value={viajeId} />
        <BotonInsistir texto={yaAvisado ? 'Reavisar' : 'Avisar'} />
      </form>
      {estado?.error && <p className="text-[11px] mt-0.5" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
    </div>
  );
}

function BotonInsistir({ texto }: { texto: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} title="Mandar el aviso por WhatsApp"
      aria-label={`${texto} al chofer por WhatsApp`}
      className="hairline inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg transition-colors hover:bg-[var(--canvas)] disabled:opacity-50"
      style={{ background: 'var(--surface)', color: 'var(--ink2)' }}>
      <RefreshCw width={11} height={11} strokeWidth={2} className={pending ? 'animate-spin' : ''} />
      {pending ? 'Enviando…' : texto}
    </button>
  );
}

/** Alta rápida de operador — nombre y WhatsApp, sin brincar de página a
 *  media captura. La validación fuerte (lada 52, duplicados ENTRE flotas)
 *  vive en el servidor y sus mensajes se enseñan tal cual. */
export function AltaOperador({ altaOperador }: { altaOperador: AccionDespacho }) {
  const [estado, accion] = useActionState(altaOperador, null);
  return (
    <form action={accion} className="space-y-2">
      <input name="nombre" required placeholder="Nombre del operador"
        aria-label="Nombre del operador"
        className="w-full text-[12.5px] px-3 py-2 rounded-lg hairline" style={{ background: 'var(--surface)' }} />
      <div className="flex items-center gap-2">
        <input name="telefono" required placeholder="WhatsApp (10 dígitos)" inputMode="tel"
          aria-label="WhatsApp del operador"
          className="flex-1 min-w-0 text-[12.5px] px-3 py-2 rounded-lg hairline cifra-mono" style={{ background: 'var(--surface)' }} />
        <BotonEnviar texto="Dar de alta" pendienteTexto="Guardando…" Icono={UserPlus} />
      </div>
      {estado?.error && <p className="text-[12px]" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
    </form>
  );
}
