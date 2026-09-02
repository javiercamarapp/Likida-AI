'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { TriangleAlert } from 'lucide-react';

/**
 * El botón de cortar accesos MCP. Mismo molde que `FormaRevocar` de
 * llaves-api, y por la misma razón: son la misma clase de acto sobre la misma
 * clase de credencial.
 */

export type ResultadoForma =
  | { ok: true; mensaje: string }
  | { ok: false; error: string }
  | null;
export type AccionForma = (previo: ResultadoForma, fd: FormData) => Promise<ResultadoForma>;

function AvisoError({ error }: { error: string }) {
  return (
    <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
      style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
      <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
      {error}
    </div>
  );
}

/**
 * Confirmación en DOS pasos pero SIN `confirm()`: el diálogo nativo bloquea
 * headless y no se puede mirar en un screenshot (mismo criterio que
 * llaves-api). Un `<details>` deja el botón real detrás de un clic explícito y
 * funciona sin JavaScript.
 *
 * `cuantos` va en el texto porque el botón corta TODAS las conexiones de esa
 * persona de un tiro —es lo que hace `revocar_mcp_oauth_usuario` (0265)— y un
 * rótulo que no lo dijera prometería una precisión que la función no tiene.
 */
export function FormaCortar({ accion, usuarioId, quien, cuantos }: {
  accion: AccionForma;
  usuarioId: string;
  quien: string;
  cuantos: number;
}) {
  const [estado, despachar] = useActionState(accion, null);

  return (
    <details className="min-w-[15rem]">
      <summary className="cursor-pointer text-[12px] font-medium select-none list-none inline-flex items-center gap-1"
        style={{ color: 'var(--bad)' }}>
        Cortar {cuantos === 1 ? 'el acceso' : `los ${cuantos} accesos`}
      </summary>
      <div className="pt-2 space-y-2">
        <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {cuantos === 1
            ? `El cliente MCP de ${quien} deja de leer en ese instante.`
            : `Los ${cuantos} clientes MCP de ${quien} dejan de leer en ese instante.`}{' '}
          No hay deshacer: para volver a conectar, {quien} tiene que autorizar de nuevo
          desde su cliente.
        </p>
        {estado && !estado.ok && <AvisoError error={estado.error} />}
        {estado?.ok && (
          <p className="text-[11.5px]" style={{ color: 'var(--ok)' }}>{estado.mensaje}</p>
        )}
        <form action={despachar}>
          <input type="hidden" name="usuarioId" value={usuarioId} />
          <BotonCortar />
        </form>
      </div>
    </details>
  );
}

function BotonCortar() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="h-8 px-3 rounded-lg text-[12px] font-medium inline-flex items-center gap-1.5 hairline transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ color: 'var(--bad)', background: 'var(--badbg)' }}>
      {pending ? 'Cortando…' : 'Sí, cortar el acceso'}
    </button>
  );
}
