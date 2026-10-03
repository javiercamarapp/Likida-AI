import { logger } from '@/lib/logger';
import { appUrl } from '@/lib/env';
import { avisarOficina, parametrosAvisoOficina } from '@/lib/meta/aviso_oficina';
import { claimMessage, completarMessageClaim, releaseMessageClaim, crearMessageLeaseOwner } from './conv';

// ═══════════════════════════════════════════════════════════════════════════
// E1-B (M5) · UN AVISO AL DUEÑO, NO UNO POR VIAJE.
//
// Mientras la flota no conteste «Tarjetas a nombre de la empresa» y «Quién paga
// en la bomba», cada viaje con diésel pagado con tarjeta cae en `tarjeta_sin_declarar`
// (ruta 'panel': ya no pide decisión por WhatsApp). La causa es una sola y la
// resuelve el dueño en el perfil, no el viaje: se le avisa UNA vez por flota con
// la instrucción, no una por cada cierre.
//
// «Una vez» sin columna nueva: se reclama una llave de idempotencia por flota
// (`wa_mensaje_procesado`, el mismo claim del webhook). Esa tabla se purga a los
// 30 días (cron purgar), así que si la flota sigue sin contestar, el recordatorio
// vuelve como máximo una vez al mes — a propósito: es un pendiente fiscal, no spam.
// El claim se libera si el envío falla, para que el siguiente cierre lo reintente.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAvisoPerfil = 'enviado' | 'ya_avisado' | 'fallo' | 'indeterminado';

export const claveAvisoPerfilTarjetas = (tenantId: string) => `aviso-perfil-tarjetas:${tenantId}`;

export function textoAvisoPerfilTarjetas(folio: string, liga: string): string {
  return [
    `Falta contestar 2 preguntas del perfil de tu flota (ej. el viaje ${folio}):`,
    '• «Tarjetas a nombre de la empresa»',
    '• «Quién paga en la bomba»',
    'Mientras no estén contestadas, el diésel pagado con tarjeta o monedero no acredita litros del estímulo (LIF 20-A fr. IV) y esos viajes quedan en revisión. No hace falta decidir viaje por viaje: con tus respuestas se resuelve para todos.',
    liga,
  ].join('\n');
}

export async function avisarPerfilTarjetasUnaVez(args: { tenantId: string; telefonoDinero: string; folio: string; operador: string }): Promise<ResultadoAvisoPerfil> {
  const clave = claveAvisoPerfilTarjetas(args.tenantId);
  const owner = crearMessageLeaseOwner();
  const c = await claimMessage(clave, owner, true);
  if (c.status === 'duplicado' || c.status === 'en_curso') return 'ya_avisado';
  // Sin poder reclamar no se manda: ante la duda se calla (un aviso de menos se reintenta con el siguiente cierre).
  if (c.status !== 'nuevo') return 'indeterminado';

  const liga = `${appUrl()}/dashboard/onboarding`;
  const r = await avisarOficina(args.telefonoDinero, textoAvisoPerfilTarjetas(args.folio, liga), {
    parametros: parametrosAvisoOficina(args.operador, 'Faltan 2 preguntas del perfil (tarjetas del diésel)', liga),
    contexto: { tenantId: args.tenantId, evento: 'perfil_tarjetas' },
  });
  // Encolado en el outbox = ya va en camino: no se suelta el claim ni se reenvía.
  if (!r.ok && !r.encolado) {
    logger.warn('cierre.aviso_perfil_tarjetas_fallo', { tenant: args.tenantId, motivo: r.motivo });
    await releaseMessageClaim(clave, c.token, owner);
    return 'fallo';
  }
  await completarMessageClaim(clave, c.token, owner);
  return 'enviado';
}
