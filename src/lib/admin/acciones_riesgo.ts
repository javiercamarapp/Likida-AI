import { anotarBitacora, type EntidadBitacora } from '@/lib/likida/bitacora_escritura';
import { exigirStepUpAccion, type AccionRiesgo } from '@/lib/auth/stepup';

// ═══════════════════════════════════════════════════════════════════════════
// DOS PIEZAS COMUNES de las acciones de /admin que mueven dinero o accesos
// (planes, mensualidades, conciliación, altas y bajas de personas):
//
//  1. `pasoExtraSuperadmin` — la confirmación extra (step-up) REUTILIZANDO la de
//     `lib/auth/stepup.ts`, no una paralela. Esa guarda solo alcanza a los roles
//     `flota_admin` y `contador` (`ROLES_ESCALONADOS`); el superadmin tiene su
//     propia puerta (MFA de entrada a /admin, `requireSuperadmin`). Para pedirle
//     TAMBIÉN el segundo factor reciente en las acciones de riesgo se evalúa su
//     sesión como la de un `flota_admin`: mismo veredicto, mismo tope de
//     `LIKIDA_MFA_TOPE_SESION_MIN`, mismo mensaje, misma huella `step_up_rechazado`.
//     HEREDA LA PALANCA: con `LIKIDA_TOTP_ESCALONADO` apagada (decisión D8 del
//     dueño, apagada por omisión) devuelve `null` sin tocar Supabase, así que hoy
//     el comportamiento de /admin no cambia. Encenderla es de Javier.
//  2. `anotarAccionAdmin` — la huella en `bitacora_auditoria` del acto: quién
//     (el superadmin), sobre qué flota, qué cambió. Sin datos personales ni
//     secretos. `anotarBitacora` nunca lanza: devuelve false si no pudo escribir,
//     y quien llama lo DICE en pantalla (`AVISO_SIN_BITACORA`) — el acto de dinero
//     ya ocurrió y no se deshace, pero tampoco se finge que quedó registrado.
// ═══════════════════════════════════════════════════════════════════════════

export interface ActorAdmin {
  userId: string;
  email?: string | null;
}

/** `null` si pasa; el texto para la pantalla si falta el segundo factor. */
export async function pasoExtraSuperadmin(
  accion: AccionRiesgo,
  actor: ActorAdmin,
  tenantId: string | null = null,
  opts: Parameters<typeof exigirStepUpAccion>[3] = {},
): Promise<string | null> {
  return exigirStepUpAccion('flota_admin', accion, { tenantId, userId: actor.userId }, opts);
}

export const AVISO_SIN_BITACORA =
  ' OJO: el acto ya se hizo, pero NO se pudo escribir en la bitácora de auditoría; avísale a quien administra la base para que lo asiente a mano.';

export async function anotarAccionAdmin(p: {
  actor: ActorAdmin;
  tenantId: string | null;
  accion: string;
  entidad: EntidadBitacora;
  entidadId: string;
  detalle?: Record<string, unknown>;
}): Promise<boolean> {
  return anotarBitacora(
    {
      tenantId: p.tenantId,
      actor: { id: p.actor.userId, email: p.actor.email ?? null },
      accion: p.accion,
      entidad: p.entidad,
      entidadId: p.entidadId,
      detalle: p.detalle ?? null,
    },
    { evento: 'admin.bitacora_no_escribio', contexto: { entidad: p.entidad, entidadId: p.entidadId } },
  );
}
