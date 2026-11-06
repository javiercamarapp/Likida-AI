import { createHash } from 'node:crypto';
import { logger } from '@/lib/logger';
import { enviarCorreo, correoConfigurado } from '@/lib/correo/enviar';
import type { Correo } from '@/lib/correo/plantilla';
import { enmascararCorreo, type EnvioCorreoPuerto } from '../liquidacion_externa/entrega_correo';
import { appUrl } from '@/lib/env';
import type { ConfigCorreoAvisos } from './aviso_correo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CORREO DE PRUEBA DE LOS AVISOS DE PEAJES.
//
// Usa el MISMO canal que el aviso real (`enviarCorreo`, remitente sobrio, un correo por destinatario) y sus mismas salvaguardas:
//   · SOLO a los destinatarios YA GUARDADOS de la flota: nunca a un correo tecleado al vuelo (la prueba no es un buzón abierto).
//   · FAIL-CERRADO: sin el servicio de correo configurado no se intenta nada y se dice con palabras llanas.
//   · IDEMPOTENTE: la llave incluye flota + destinatario + una ventana de 10 minutos; un doble clic no manda dos correos.
//   · El texto es fijo: no lleva importes, unidades, operadores ni nada de los archivos de la flota.
//   · La prueba NO enciende el aviso ni toca la fecha de corte: probar con el aviso apagado es lo normal.
// ═══════════════════════════════════════════════════════════════════════════

/** Ventana de la llave de idempotencia de la prueba. */
export const VENTANA_PRUEBA_MS = 10 * 60_000;

export type ResultadoPruebaCorreo = { ok: true; enviados: number; mensaje: string } | { ok: false; mensaje: string };

export interface DepsPruebaCorreo {
  leerConfig: (tenantId: string) => Promise<ConfigCorreoAvisos>;
  enviar?: EnvioCorreoPuerto;
  /** ¿Está encendido el servicio de correo? Por omisión, el real. */
  configurado?: () => boolean;
  ahora?: () => number;
}

const hash12 = (s: string): string => createHash('sha256').update(s.toLowerCase()).digest('hex').slice(0, 12);

export const MENSAJE_SIN_SERVICIO = 'El envío de correos todavía no está activado en esta cuenta, así que no se mandó la prueba. Avisa a soporte de Likida para que lo active.';

/** El correo de prueba: texto fijo y sobrio, sin datos de la flota. */
export function armarCorreoPrueba(liga: string): Correo {
  return {
    asunto: 'Prueba: aviso de Peajes',
    avance: 'Correo de prueba de los avisos de Peajes',
    titulo: 'Correo de prueba',
    parrafos: [
      'Este es un correo de prueba de los avisos de Peajes. Si lo estás leyendo, tu dirección está bien guardada y recibirás ahí los avisos cuando se enciendan.',
      'No es un aviso real ni habla de ningún cobro.',
    ],
    boton: { texto: 'Abrir Peajes', href: liga },
    porQueLoRecibes: 'Recibes este correo porque tu dirección figura como destinatario de los avisos de Peajes de tu flota en Likida.',
  };
}

export async function enviarPruebaCorreoAvisos(tenantId: string, deps: DepsPruebaCorreo): Promise<ResultadoPruebaCorreo> {
  const enviar = deps.enviar ?? ((para, correo, op) => enviarCorreo(para, correo, op));
  const configurado = deps.configurado ?? correoConfigurado;
  const ahora = deps.ahora ?? (() => Date.now());

  let cfg: ConfigCorreoAvisos;
  try { cfg = await deps.leerConfig(tenantId); } catch (e) {
    logger.error('peajes.aviso_correo_prueba_leer', { tenant: tenantId, err: e instanceof Error ? e.message : String(e) });
    return { ok: false, mensaje: 'No se pudo leer la configuración ahora mismo. Inténtalo de nuevo.' };
  }
  if (cfg.destinatarios.length === 0) return { ok: false, mensaje: 'Primero guarda al menos un destinatario; la prueba se manda a los que estén guardados.' };
  if (!configurado()) return { ok: false, mensaje: MENSAJE_SIN_SERVICIO };

  const correo = armarCorreoPrueba(`${appUrl()}/dashboard/agentes/peajes`);
  const ventana = Math.floor(ahora() / VENTANA_PRUEBA_MS);
  let enviados = 0;
  const fallidos: string[] = [];
  for (const dest of cfg.destinatarios) {
    const r = await enviar(dest, correo, { sobrio: true, idempotencyKey: `peajes:prueba:${tenantId}:${ventana}:${hash12(dest)}`.slice(0, 250) });
    if (r.ok) { enviados++; continue; }
    if (r.motivo === 'sin_configurar') return { ok: false, mensaje: MENSAJE_SIN_SERVICIO };
    logger.warn('peajes.aviso_correo_prueba_fallo', { tenant: tenantId, para: enmascararCorreo(dest), motivo: r.motivo });
    fallidos.push(enmascararCorreo(dest));
  }
  if (enviados === 0) return { ok: false, mensaje: 'No se pudo mandar la prueba. Revisa que las direcciones estén bien escritas e inténtalo en unos minutos.' };
  const resto = fallidos.length > 0 ? ` No se pudo mandar a: ${fallidos.join(', ')}.` : '';
  return { ok: true, enviados, mensaje: `Prueba enviada a ${enviados} ${enviados === 1 ? 'dirección' : 'direcciones'}. Revisa la bandeja (y la carpeta de no deseados).${resto}` };
}
