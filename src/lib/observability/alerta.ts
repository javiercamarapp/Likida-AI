// ═══════════════════════════════════════════════════════════════════════════
// LA ALERTA AL OPERADOR DEL SISTEMA — el correo que le llega a Javier.
//
// Todos los avisos del repo salen a usuarios DEL TENANT (`agentes/
// notificaciones.ts`, ROLES_AVISABLES no incluye superadmin): un cron que
// truena nueve días seguidos no se lo decía a nadie que pudiera arreglarlo.
// Sentry existe, pero solo notifica cuando NACE un issue — un fallo que cae en
// un issue viejo solo engorda un contador. Este es el canal directo: un correo
// a `ALERTA_EMAIL` cuando un cron falla.
//
// TRES DECISIONES QUE IMPORTAN:
//
//   1. NUNCA lanza. Un fallo del canal de alerta no puede tumbar el cron que
//      está intentando avisar que falló — sería sumarle un fallo al fallo. Todo
//      termina en `logger.warn` y se sigue.
//   2. Rate limit EN MEMORIA por evento: máximo un correo por evento por hora
//      (el mismo piso de `PISO_ENTRE_AVISOS_MS` en notificaciones.ts, y por la
//      misma razón: un cron horario que falla siempre mandaría 24 correos
//      iguales al día, que es cómo se enseña a ignorar el canal). El mapa vive
//      POR INSTANCIA: en serverless cada instancia caliente lleva su propia
//      cuenta y un arranque en frío la resetea, así que el piso es de mejor
//      esfuerzo, no una garantía. El respaldo real contra el duplicado y contra
//      el silencio es Sentry, cuyo fingerprint agrupa entre instancias.
//   3. Sin `ALERTA_EMAIL` no manda y NO es un error: es un canal opcional, como
//      Sentry sin DSN. Se dice una vez por instancia a nivel `info` y el
//      arranque lo grita aparte (`SILENCIOSAS` en arranque.ts).
// ═══════════════════════════════════════════════════════════════════════════

import { appUrl } from '@/lib/env';
import { logger, redactarTexto } from '@/lib/logger';
import { enviarCorreo, correoConfigurado } from '@/lib/correo/enviar';
import { fechaHoraMx } from '@/lib/formato';

/** ¿Puede salir una alerta? Lo lee /admin/salud-sistema para decir la verdad
 *  en vez de pintar un semáforo fijo. */
export function alertaConfigurada(): boolean {
  return !!process.env.ALERTA_EMAIL && correoConfigurado();
}

/** El piso entre dos correos del MISMO evento. Una hora, igual que
 *  `PISO_ENTRE_AVISOS_MS` de notificaciones.ts. */
export const PISO_ALERTA_MS = 60 * 60 * 1000;

/** Última alerta que salió, por evento. Por instancia (ver cabecera). */
const ultimaAlerta = new Map<string, number>();

/** Para decir "sin configurar" UNA vez por instancia, no en cada corrida. */
let avisadoSinConfigurar = false;

const APP = appUrl();

/**
 * Manda UN correo a `ALERTA_EMAIL` diciendo que `evento` falló, con el
 * `detalle` y la hora MX. Respeta el piso de una hora por evento y nunca lanza.
 *
 * El detalle pasa por `redactarTexto` antes de salir: el correo viaja por
 * Resend (un tercero), así que va anonimizado por el mismo camino que los logs
 * — no por una lista aparte que alguien tenga que acordarse de mantener.
 */
export async function alertarOperador(evento: string, detalle: Record<string, unknown>): Promise<void> {
  try {
    const para = process.env.ALERTA_EMAIL;
    if (!para) {
      if (!avisadoSinConfigurar) {
        logger.info('alerta.sin_configurar', { evento });
        avisadoSinConfigurar = true;
      }
      return;
    }

    const ahora = Date.now();
    const anterior = ultimaAlerta.get(evento);
    if (anterior !== undefined && ahora - anterior < PISO_ALERTA_MS) return;
    // La marca se pone ANTES del envío, no después: si el envío falla no se
    // reintenta dentro de la hora (enviar.ts ya decidió no reintentar), y dos
    // corridas casi simultáneas no mandan dos correos.
    ultimaAlerta.set(evento, ahora);

    const datos: Array<[string, string]> = [
      ['Evento', evento],
      ['Cuándo', fechaHoraMx(new Date(ahora).toISOString())],
      // Recortado a 300: un stack completo va en Sentry, no en el cuerpo de
      // un correo que se lee en el teléfono.
      ...Object.entries(detalle).map(([k, v]) => [k, redactarTexto(String(v)).slice(0, 300)] as [string, string]),
    ];

    const r = await enviarCorreo(para, {
      asunto: `[Likida] Falló ${evento}`,
      avance: 'Un proceso de fondo falló y va a reintentarse solo; el detalle va adentro.',
      titulo: `Falló ${evento}`,
      parrafos: [
        'Un proceso de fondo del sistema no completó su corrida. El trabajo se reintenta en la siguiente corrida programada; lo que este correo pide es mirar POR QUÉ falló, porque un cron que falla en silencio puede llevar días fallando.',
        'De este evento no va a llegar otro correo en la próxima hora aunque siga fallando; la serie completa está en Sentry.',
      ],
      datos,
      boton: { texto: 'Ver salud del sistema', href: `${APP}/admin/salud-sistema` },
      tono: 'urgente',
      porQueLoRecibes: 'Recibes esta alerta porque ALERTA_EMAIL apunta a esta dirección: es el canal del operador del sistema, no de una flota.',
    });
    // `enviarCorreo` nunca lanza; devuelve el motivo. Aquí solo se deja
    // constancia — el respaldo si esto no sale es Sentry.
    if (!r.ok) logger.warn('alerta.no_salio', { evento, motivo: r.motivo });
  } catch (e) {
    // Cinturón sobre los tirantes: nada de este canal puede propagar al cron.
    logger.warn('alerta.fallo', { evento, error: e instanceof Error ? e.message : String(e) });
  }
}
