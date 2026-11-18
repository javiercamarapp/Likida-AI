'use client';

import { useActionState } from 'react';
import { BotonConfirmar, clasesBoton, type AccionDeForma } from '@/app/ui-v2/componentes';
import { Aviso } from '@/app/ui-v2/componentes/forma';
import { useT } from '@/lib/i18n/proveedor';
import { resto } from '@/lib/i18n/es/resto';
import type { TrDe } from '@/lib/i18n/tr_tipos';
import '../control.css';

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

function descripcionTokens(tokensVivos: number, t: TrDe<'resto'>): string {
  if (tokensVivos === 0) return t('ctl.mcp_tokens_cero');
  return tokensVivos === 1 ? t('ctl.mcp_tokens_uno') : t('ctl.mcp_tokens_varios', { n: tokensVivos });
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
  const { t } = useT('resto', resto);
  return (
    <form action={despachar} className="adm-ctl-forma">
      <input type="hidden" name="cliente" value={clientId} />
      <Aviso estado={estado} />
      <div>
        <BotonConfirmar
          etiqueta={t('ctl.mcp_rechazar')} tono="peligro" etiquetaConfirmar={t('ctl.mcp_rechazar_confirmar')}
          titulo={t('ctl.mcp_rechazar_titulo', { nombre })}
          descripcion={`${descripcionTokens(tokensVivos, t)} ${t('ctl.mcp_irreversible')}`}
          className={clasesBoton('danger', 'sm')}
        />
      </div>
    </form>
  );
}
