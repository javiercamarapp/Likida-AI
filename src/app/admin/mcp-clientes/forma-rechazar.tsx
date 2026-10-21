'use client';

import { useActionState } from 'react';
import { Aviso, type AccionDeForma } from '../ui/forma';
import { BotonConfirmar } from '../ui/confirmar';

// ═══════════════════════════════════════════════════════════════════════════
// «RECHAZAR» un cliente MCP pendiente — auditoría adversarial, DOS HALLAZGOS
// ALTOS del mismo botón.
//
// `decidirCliente(..., 'rechazado', ...)` revoca EN EL ACTO todos los tokens
// OAuth vivos (acceso y refresco) de ese cliente — irreversible, con efecto
// potencial cross-tenant (cualquier flota que ya le haya dado consentimiento
// pierde el acceso)— y antes salía con un solo clic y CERO diálogo
// (HALLAZGO #2). Se envuelve con el ÚNICO sistema de confirmación del repo
// (`admin/ui/confirmar`, DESIGN.md §3: nunca un `confirm()` nuevo), mismo
// molde que `FormaRevocar` (llaves-api) y `FormaCortar` (sesiones-mcp): la
// misma clase de acto sobre la misma clase de credencial.
//
// HALLAZGO #1: aun con el diálogo, «revoca todos los tokens vivos» sin decir
// A CUÁNTOS no es una confirmación de verdad (la regla de `confirmar.tsx`
// dice textual: «el diálogo DICE lo que va a pasar y a cuántos afecta»).
// `tokensVivos` lo cuenta `listarClientesPendientes` ANTES de esta pantalla
// (decidir ya es irreversible) y aquí se declara el número exacto, con su
// singular/plural y su caso cero — nunca «todos» sin cifra.
// ═══════════════════════════════════════════════════════════════════════════

function descripcionTokens(tokensVivos: number): string {
  if (tokensVivos === 0) return 'Este cliente no tiene ningún token OAuth vivo en este momento.';
  const sujeto = tokensVivos === 1
    ? 'el único token OAuth vivo (acceso o refresco)'
    : `los ${tokensVivos} tokens OAuth vivos (acceso y refresco)`;
  return `Revoca en el acto ${sujeto} de este cliente MCP.`;
}

export function FormaRechazarCliente({ accion, clientId, nombre, tokensVivos }: {
  accion: AccionDeForma;
  clientId: string;
  /** Para que el diálogo diga A QUIÉN se rechaza, no «¿estás seguro?» a secas. */
  nombre: string;
  /** Cuántos tokens OAuth vivos tiene el cliente AHORA — el diálogo lo dice
   *  explícito (HALLAZGO ALTO #1), no «todos los tokens» sin cifra. */
  tokensVivos: number;
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
          descripcion={`${descripcionTokens(tokensVivos)} Es irreversible, y el efecto puede alcanzar a cualquier flota que ya le haya dado consentimiento.`}
          className="text-sm font-medium rounded-lg px-4 py-2 w-full md:w-auto disabled:opacity-60 disabled:cursor-not-allowed"
          style={{ background: 'var(--badbg)', color: 'var(--bad)', border: '1px solid var(--bad)' }}
        />
      </div>
    </form>
  );
}
