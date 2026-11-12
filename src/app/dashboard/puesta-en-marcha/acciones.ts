'use server';

import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { enviarCorreo, correoConfigurado } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';
import { getT } from '@/lib/i18n/servidor';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

/** La ruta con la que esta acción pasa por la puerta del perfil (clasificada en visibilidad.ts). */
const RUTA = '/dashboard/puesta-en-marcha';

/** Tres pruebas por usuario cada diez minutos: sobra para «¿me llega?» y no sirve para inundar un buzón. */
const LIMITE_PRUEBAS = 3;
const VENTANA_MS = 10 * 60_000;

export type ResultadoPruebaCorreo =
  | { ok: true; destino: string }
  | { ok: false; error: string };

/** El correo con el que se pasa de «lo configuré» a «lo vi llegar». Sin cifras ni datos de la flota. */
const correoPrueba = (t: TResto = T_RESTO_ES): Correo => ({
  asunto: t('op.likida_prueba_de_correo_puesta_en'),
  avance: t('op.todo_en_orden_es_la_prueba'),
  titulo: t('op.tu_correo_si_recibe_los_avisos'),
  parrafos: [
    t('op.este_correo_confirma_que_los_mensajes'),
  ],
  tono: 'neutral',
  porQueLoRecibes: t('op.recibes_este_correo_porque_pediste_una'),
});

/** «a•••@dominio.mx»: el acuse confirma el destino sin repetir la dirección completa en pantalla. */
function correoEnmascarado(correo: string): string {
  const [local, dominio] = correo.split('@');
  if (!dominio) return '•••';
  return `${local.slice(0, 1)}•••@${dominio}`;
}

/**
 * Manda una prueba de correo SOLO al correo del usuario en sesión (nunca a un destino que venga del formulario: la
 * acción no recibe ninguno) y con freno por usuario. Es una server action, o sea un POST alcanzable sin la página:
 * por eso vuelve a pasar por la puerta del perfil y a comprobar la ruta ella misma.
 *
 * ESQUELETO DEL CARRIL A: firma, puerta, freno y envío. El carril C puede enriquecer el acuse (estados del paso 3 del
 * asistente) sin cambiar la firma.
 */
export async function enviarPruebaCorreo(): Promise<ResultadoPruebaCorreo> {
  const { t } = await getT('resto');
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerRuta(sesion.rol, RUTA)) {
    return { ok: false, error: t('op.tu_cuenta_no_puede_mandar_esta') };
  }

  const permitido = await rateLimit(`puesta-en-marcha:prueba-correo:${sesion.userId}`, LIMITE_PRUEBAS, VENTANA_MS);
  if (!permitido) {
    return { ok: false, error: t('op.ya_mandaste_varias_pruebas_hace_poco') };
  }

  if (!correoConfigurado()) {
    return { ok: false, error: t('op.el_envio_de_correo_todavia_no') };
  }

  let destino: string | null;
  try {
    destino = await emailDeUsuario(sesion.userId);
  } catch (e) {
    logger.error('puesta_en_marcha.prueba_correo_ilegible', { tenantId: sesion.tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: t('op.no_se_pudo_leer_el_correo') };
  }
  if (!destino) {
    return { ok: false, error: t('op.tu_cuenta_no_tiene_correo_capturado') };
  }

  const envio = await enviarCorreo(destino, correoPrueba(t));
  if (!envio.ok) {
    logger.warn('puesta_en_marcha.prueba_correo_no_enviada', { tenantId: sesion.tenantId, motivo: envio.motivo });
    return { ok: false, error: t('op.el_correo_no_salio_intentalo_de') };
  }
  logger.info('puesta_en_marcha.prueba_correo_enviada', { tenantId: sesion.tenantId });
  return { ok: true, destino: correoEnmascarado(destino) };
}
