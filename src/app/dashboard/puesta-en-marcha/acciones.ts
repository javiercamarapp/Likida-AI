'use server';

import { requireSessionTenant } from '@/lib/auth/guard';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { emailDeUsuario } from '@/lib/likida/conductor/trabajo';
import { enviarCorreo, correoConfigurado } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import { rateLimit } from '@/lib/ratelimit';
import { logger } from '@/lib/logger';

/** La ruta con la que esta acción pasa por la puerta del perfil (clasificada en visibilidad.ts). */
const RUTA = '/dashboard/puesta-en-marcha';

/** Tres pruebas por usuario cada diez minutos: sobra para «¿me llega?» y no sirve para inundar un buzón. */
const LIMITE_PRUEBAS = 3;
const VENTANA_MS = 10 * 60_000;

export type ResultadoPruebaCorreo =
  | { ok: true; destino: string }
  | { ok: false; error: string };

/** El correo con el que se pasa de «lo configuré» a «lo vi llegar». Sin cifras ni datos de la flota. */
const CORREO_PRUEBA: Correo = {
  asunto: '[Likida] Prueba de correo — puesta en marcha',
  avance: 'Todo en orden: es la prueba que pediste, no un incidente.',
  titulo: 'Tu correo sí recibe los avisos de Likida',
  parrafos: [
    'Este correo confirma que los mensajes de Likida llegan a esta dirección. No hay ningún problema real: pediste la prueba desde «Puesta en marcha» y comprobar la entrega es todo lo que hace.',
  ],
  tono: 'neutral',
  porQueLoRecibes: 'Recibes este correo porque pediste una prueba desde «Puesta en marcha» en Likida. No es recurrente: llega solo cuando tú la pides.',
};

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
  const sesion = await requireSessionTenant(RUTA);
  if (!puedeVerRuta(sesion.rol, RUTA)) {
    return { ok: false, error: 'Tu cuenta no puede mandar esta prueba.' };
  }

  const permitido = await rateLimit(`puesta-en-marcha:prueba-correo:${sesion.userId}`, LIMITE_PRUEBAS, VENTANA_MS);
  if (!permitido) {
    return { ok: false, error: 'Ya mandaste varias pruebas hace poco. Espera unos minutos y vuelve a intentar.' };
  }

  if (!correoConfigurado()) {
    return { ok: false, error: 'El envío de correo todavía no está encendido en esta plataforma, así que la prueba no salió. Avisa a Likida.' };
  }

  let destino: string | null;
  try {
    destino = await emailDeUsuario(sesion.userId);
  } catch (e) {
    logger.error('puesta_en_marcha.prueba_correo_ilegible', { tenantId: sesion.tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, error: 'No se pudo leer el correo de tu cuenta, así que la prueba no salió. Inténtalo de nuevo.' };
  }
  if (!destino) {
    return { ok: false, error: 'Tu cuenta no tiene correo capturado, así que no hay a dónde mandarte la prueba.' };
  }

  const envio = await enviarCorreo(destino, CORREO_PRUEBA);
  if (!envio.ok) {
    logger.warn('puesta_en_marcha.prueba_correo_no_enviada', { tenantId: sesion.tenantId, motivo: envio.motivo });
    return { ok: false, error: 'El correo no salió. Inténtalo de nuevo en unos minutos.' };
  }
  logger.info('puesta_en_marcha.prueba_correo_enviada', { tenantId: sesion.tenantId });
  return { ok: true, destino: correoEnmascarado(destino) };
}
