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
//   2. Rate limit por evento: máximo un correo por evento por hora (el mismo
//      piso de `PISO_ENTRE_AVISOS_MS` en notificaciones.ts, y por la misma
//      razón: un cron horario que falla siempre mandaría 24 correos iguales al
//      día, que es cómo se enseña a ignorar el canal). El piso vive en REDIS
//      (Upstash, `SET NX PX`) para que sea uno entre todas las instancias; sin
//      Redis cae a un mapa por instancia, que es de mejor esfuerzo (RES-17).
//      El respaldo contra el silencio es Sentry, cuyo fingerprint agrupa.
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

/** Última alerta que salió, por evento. Por instancia: es el RESPALDO del
 *  piso en Redis (abajo), no el piso. */
const ultimaAlerta = new Map<string, number>();

// ── EL PISO VIVE EN REDIS (auditoría prod 22-ago-2026, RES-17) ─────────────
//
// El Map de arriba era el único piso, y vive POR INSTANCIA: con N instancias
// calientes en Vercel, un cron que falla en todas mandaba N correos iguales en
// la misma hora, y un arranque en frío lo reseteaba. Upstash ya está
// configurado para `ratelimit.ts`; aquí se usa el MISMO backend con un solo
// comando atómico: `SET llave 1 PX piso NX` — "reserva la hora si nadie la
// tiene". `OK` = esta instancia ganó y manda; `null` = otra ya mandó.
//
// Sin credenciales, o si Redis no contesta (timeout 1.2 s, mismo criterio que
// ratelimit.ts), se cae al Map: mejor esfuerzo, nunca silencio y nunca lanza.
const PREFIJO_PISO = 'likida:alerta:';
const TIMEOUT_REDIS_MS = 1200;

/**
 * ¿Puede salir el correo de `evento` ahora? Reserva el piso si sí.
 * `null` = Redis no pudo decirlo (sin credenciales, red, timeout) — el
 * llamador cae al Map local.
 */
async function reservarPisoRedis(evento: string, ahora: number): Promise<boolean | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', `${PREFIJO_PISO}${evento}`, String(ahora), 'PX', PISO_ALERTA_MS, 'NX']),
      signal: AbortSignal.timeout(TIMEOUT_REDIS_MS),
    });
    const json = (await r.json()) as { result?: unknown; error?: string };
    if (!r.ok || json.error) {
      logger.warn('alerta.piso_redis_fallo', { evento, status: r.status, err: json.error });
      return null;
    }
    return json.result === 'OK';
  } catch (e) {
    logger.warn('alerta.piso_redis_fallo', { evento, err: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/** El piso de una hora: Redis si contesta, el Map de la instancia si no. */
async function reservarPiso(evento: string, ahora: number): Promise<boolean> {
  const redis = await reservarPisoRedis(evento, ahora);
  if (redis !== null) {
    // El Map se mantiene al día igual: si Redis se cae a media hora, el
    // respaldo no arranca de cero en esta instancia.
    if (redis) ultimaAlerta.set(evento, ahora);
    return redis;
  }
  const anterior = ultimaAlerta.get(evento);
  if (anterior !== undefined && ahora - anterior < PISO_ALERTA_MS) return false;
  ultimaAlerta.set(evento, ahora);
  return true;
}

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
    // La marca se pone ANTES del envío, no después: si el envío falla no se
    // reintenta dentro de la hora (enviar.ts ya decidió no reintentar), y dos
    // corridas casi simultáneas —en la misma instancia o en dos— no mandan dos
    // correos: la reserva en Redis es atómica (SET NX).
    if (!(await reservarPiso(evento, ahora))) return;

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
