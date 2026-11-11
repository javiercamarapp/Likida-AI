'use client';

import { useActionState } from 'react';
import { AvisoResultado, BotonConfirmar, clasesBoton } from '@/app/ui-v2/componentes';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

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
  const { t } = useT('resto', restoEs);
  const [estado, despachar] = useActionState(accion, null);

  return (
    <form action={despachar} className="rv-mcp__forma">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <BotonConfirmar
        etiqueta={cuantos === 1 ? t('cfg.cortar_el_acceso') : t('cfg.cortar_los_n_accesos', { cuantos })} tono="peligro"
        etiquetaConfirmar={t('cfg.si_cortar_el_acceso')}
        titulo={cuantos === 1 ? t('cfg.cortar_el_acceso_de', { quien }) : t('cfg.cortar_los_accesos_de', { cuantos, quien })}
        descripcion={cuantos === 1 ? t('cfg.mcp_cortar_uno', { quien }) : t('cfg.mcp_cortar_varios', { cuantos, quien })}
        className={clasesBoton('danger', 'sm')}
      />
      {estado && !estado.ok && <AvisoError error={estado.error} />}
      {estado?.ok && (
        <p role="status" className="rv-mcp__ok">{estado.mensaje}</p>
      )}
    </form>
  );
}
