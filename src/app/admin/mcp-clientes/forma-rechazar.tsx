'use client';

import { useActionState } from 'react';
import { Aviso, type AccionDeForma } from '../ui/forma';
import { BotonConfirmar } from '../ui/confirmar';

// ═══════════════════════════════════════════════════════════════════════════
// «RECHAZAR» un cliente MCP pendiente — auditoría adversarial, HALLAZGO ALTO #2.
//
// `decidirCliente(..., 'rechazado', ...)` revoca EN EL ACTO todos los tokens
// OAuth vivos (acceso y refresco) de ese cliente — irreversible, con efecto
// potencial cross-tenant (cualquier flota que ya le haya dado consentimiento
// pierde el acceso)— y antes salía con un solo clic y CERO diálogo. Se envuelve
// con el ÚNICO sistema de confirmación del repo (`admin/ui/confirmar`,
// DESIGN.md §3: nunca un `confirm()` nuevo), mismo molde que `FormaRevocar`
// (llaves-api) y `FormaCortar` (sesiones-mcp): la misma clase de acto sobre la
// misma clase de credencial.
// ═══════════════════════════════════════════════════════════════════════════

export function FormaRechazarCliente({ accion, clientId, nombre }: {
  accion: AccionDeForma;
  clientId: string;
  /** Para que el diálogo diga A QUIÉN se rechaza, no «¿estás seguro?» a secas. */
  nombre: string;
}) {
  const [estado, despachar] = useActionState(accion, null);
  return (
    <form action={despachar} className="flex flex-col gap-3">
      <input type="hidden" name="cliente" value={clientId} />
      <Aviso estado={estado} />
      <div>
        <BotonConfirmar
          etiqueta="Rechazar" tono="peligro" etiquetaConfirmar="Sí, rechazar y revocar"
          titulo={`Rechazar a ${nombre}`}
          descripcion="Revoca en el acto todos los tokens OAuth vivos (acceso y refresco) de este cliente MCP. Es irreversible, y el efecto puede alcanzar a cualquier flota que ya le haya dado consentimiento."
          className="text-sm font-medium rounded-lg px-4 py-2 w-full md:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'var(--badbg)', color: 'var(--bad)', border: '1px solid var(--bad)' }}
        />
      </div>
    </form>
  );
}
