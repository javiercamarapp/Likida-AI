'use client';

import { useActionState } from 'react';
import { AvisoResultado } from '../../admin/ui/aviso-resultado';
import { BotonConfirmar } from '../../admin/ui/confirmar';

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

/** El error del servidor, VERBATIM, con el aviso único del panel. */
function AvisoError({ error }: { error: string }) {
  return <AvisoResultado estado={{ ok: false, error }} />;
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
    <form action={despachar} className="min-w-[15rem] space-y-2">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <BotonConfirmar
        etiqueta={cuantos === 1 ? 'Cortar el acceso' : `Cortar los ${cuantos} accesos`} tono="peligro"
        etiquetaConfirmar="Sí, cortar el acceso"
        titulo={cuantos === 1 ? `Cortar el acceso de ${quien}` : `Cortar los ${cuantos} accesos de ${quien}`}
        descripcion={`${cuantos === 1
          ? `El cliente MCP de ${quien} deja de leer en ese instante.`
          : `Los ${cuantos} clientes MCP de ${quien} dejan de leer en ese instante.`} No hay deshacer: para volver a conectar, ${quien} tiene que autorizar de nuevo desde su cliente.`}
        className="text-[12px] font-medium select-none inline-flex items-center gap-1 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--bad)' }}
      />
      {estado && !estado.ok && <AvisoError error={estado.error} />}
      {estado?.ok && (
        <p role="status" className="text-[11.5px]" style={{ color: 'var(--ok)' }}>{estado.mensaje}</p>
      )}
    </form>
  );
}
