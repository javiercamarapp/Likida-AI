'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Send, UserPlus, RefreshCw } from 'lucide-react';

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
 *  se pinta el par select+botón con su error inline. */
export function AsignarFila({ viajeId, operadores, asignarYAvisar }: {
  viajeId: string;
  operadores: Array<{ id: string; nombre: string }>;
  asignarYAvisar: AccionDespacho;
}) {
  const [estado, accion] = useActionState(asignarYAvisar, null);
  return (
    <div>
      <form action={accion} className="flex items-center gap-2">
        <input type="hidden" name="viajeId" value={viajeId} />
        <select name="operadorId" required aria-label="Operador" defaultValue=""
          className="flex-1 min-w-0 text-[12.5px] px-2.5 py-1.5 rounded-lg hairline"
          style={{ background: 'var(--surface)' }}>
          <option value="" disabled>Elegir operador…</option>
          {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        </select>
        <BotonEnviar texto="Asignar y avisar" pendienteTexto="Asignando…" Icono={Send} />
      </form>
      {estado?.error && <p className="text-[12px] mt-1" style={{ color: 'var(--bad)' }}>{estado.error}</p>}
    </div>
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
