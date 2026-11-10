import { anotarBitacora } from '@/lib/likida/bitacora_escritura';
import { correoConfigurado } from '@/lib/correo/enviar';
import { enviarCorreoDeAcceso, type ResultadoCorreoAcceso } from '@/lib/auth/usuarios_escritura';

// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA Y EL CORREO DE ACCESO DE LA ZONA DE VENDEDORES.
//
// Dos cosas que /vendedor y /admin/vendedores comparten y que no vivían en ningún lado:
//
//  1. Quién movió qué prospecto. El tablero cambia la etapa de una empresa (y de ahí cuelga la comisión) y guarda notas, y hasta hoy
//     solo quedaba la fila final. Cada acción deja una anotación en `bitacora_auditoria` (el ÚNICO escritor, `anotarBitacora`), de
//     plataforma (`tenantId: null`: el vendedor no pertenece a ninguna flota). El detalle lleva ids, etapas y el LARGO de la nota,
//     jamás su texto ni datos de la empresa: la tabla sobrevive a un borrado ARCO.
//  2. La invitación con correo REAL. Antes la pantalla decía «no te llega invitación, pásale tú la liga». Ahora, si el canal está
//     encendido, sale `avisoInvitacion` desde `acceso@`; si no lo está, el alta FALLA CERRADA (no crea la cuenta) y la pantalla
//     dice qué falta, en vez de crear una cuenta a la que nadie avisó.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo que firma una anotación: la sesión que actuó. La sesión no trae correo; el id basta para reconstruir al actor. */
export interface ActorVendedor {
  userId: string;
  rol: string;
}

export type AccionRegistrada = 'prospecto.movido' | 'prospecto.nota' | 'prospecto.asignado' | 'vendedor.invitado';

/**
 * Anota una acción de la zona de vendedores. Best-effort (la acción ya ocurrió; `anotarBitacora` loguea si no pudo escribir) y
 * nunca lanza. `entidadId` es el prospecto, o el usuario invitado.
 */
export async function anotarAccionVendedor(
  actor: ActorVendedor,
  accion: AccionRegistrada,
  entidadId: string,
  detalle: Record<string, unknown>,
): Promise<void> {
  await anotarBitacora(
    {
      tenantId: null,
      actor: { id: actor.userId, email: null },
      accion,
      entidad: accion === 'vendedor.invitado' ? 'app_user' : 'prospecto',
      entidadId,
      detalle: { ...detalle, rol: actor.rol },
    },
    { evento: 'vendedores.bitacora_no_escribio', contexto: { accion } },
  );
}

/** ¿Está encendido el correo saliente? Es la puerta del alta: sin él, el vendedor no recibiría ni el aviso ni el enlace de entrada. */
export function correoDeAccesoDisponible(): boolean {
  return correoConfigurado();
}

export const MENSAJE_SIN_CORREO =
  'No se creó la cuenta: el correo saliente no está configurado (faltan RESEND_API_KEY y RESEND_EMAIL_DOMAIN). '
  + 'Sin él, el vendedor no recibiría la invitación ni el enlace para entrar. Configúralo en Integraciones y vuelve a invitar.';

/** El correo de acceso del vendedor: `avisoInvitacion` con el rol «vendedor», firmado por quien lo invita. */
export function enviarAccesoVendedor(email: string, invitaNombre: string | null): Promise<ResultadoCorreoAcceso> {
  return enviarCorreoDeAcceso(email, 'vendedor', { flotaNombre: 'Likida', invitaNombre });
}
