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
async function reservarPisoRedis(evento: string, ahora: number, pisoMs: number): Promise<boolean | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', `${PREFIJO_PISO}${evento}`, String(ahora), 'PX', pisoMs, 'NX']),
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

/** El piso entre dos correos del MISMO evento: `PISO_ALERTA_MS` por omisión
 *  (una hora), o el que pase el llamador — ver `alertarHuecoConfiguracion`,
 *  que usa uno mucho más largo. Redis si contesta, el Map de la instancia si
 *  no. */
async function reservarPiso(evento: string, ahora: number, pisoMs: number = PISO_ALERTA_MS): Promise<boolean> {
  const redis = await reservarPisoRedis(evento, ahora, pisoMs);
  if (redis !== null) {
    // El Map se mantiene al día igual: si Redis se cae a media hora, el
    // respaldo no arranca de cero en esta instancia.
    if (redis) ultimaAlerta.set(evento, ahora);
    return redis;
  }
  const anterior = ultimaAlerta.get(evento);
  if (anterior !== undefined && ahora - anterior < pisoMs) return false;
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

// ── EL HUECO DE CONFIGURACIÓN NO ES UNA REGRESIÓN (auditoría prod 29-ago-2026) ──
//
// `descarga-sat` sin `LIKIDA_SAT_PROVEEDOR` reporta 'parcial' con un motivo
// que se explica solo: "falta LIKIDA_SAT_PROVEEDOR... lo destraba Javier". Es
// honesto y correcto. El problema era `/api/health`: cada vez que un monitor
// externo pegaba al endpoint (cada 1-5 min) y el cron seguía sin ese hueco
// resuelto, disparaba `alertarOperador('cron.estado_no_ok', ...)` — con el
// piso de una hora de ESE evento, eso es un correo "Urgente" por hora, para
// siempre, mientras Javier no contrate el PAC. Ocho en doce horas,
// indistinguibles del cron que sí se rompió.
//
// La diferencia real: una regresión es información nueva cada vez (algo que
// funcionaba dejó de hacerlo, y HOY sigue roto). Un hueco de configuración ya
// declarado es la MISMA información repetida — el propio proceso no sabe
// nada que no supiera hace una hora. Alertar sobre la primera es urgente;
// alertar sobre la segunda cada hora es enseñar a Javier a ignorar el correo,
// que es exactamente el vicio que esta misma auditoría corrigió esa noche en
// otro sitio (agentes de ingeniería escalando huecos conocidos).

/** El piso para un hueco de configuración YA declarado por el propio proceso:
 *  una semana, no una hora. Es tiempo de sobra para que Javier lo vea sin que
 *  el canal se aprenda a ignorar. */
export const PISO_ALERTA_CONFIG_MS = 7 * 24 * 60 * 60 * 1000;

/** Huella corta y estable de un texto: la LLAVE del piso incluye esta huella
 *  del `motivo`, así que si el motivo CAMBIA (Javier resolvió una cosa y
 *  apareció otra) es información nueva y sí avisa, aunque el piso de la
 *  semana anterior siga vigente para el motivo viejo. No es criptográfica —
 *  es un identificador de deduplicación, no un secreto. */
function huella(texto: string): string {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (Math.imul(31, h) + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Como `alertarOperador`, pero para un HUECO DE CONFIGURACIÓN que el propio
 * proceso YA declaró en prosa (`esHuecoDeConfiguracion` en `admin/salud.ts`
 * decide cuándo aplica): falta una variable de entorno, un contrato, una
 * credencial. No es una regresión —nada se rompió, algo nunca se terminó de
 * contratar o configurar— así que no merece el tono "urgente" ni el piso de
 * una hora de un cron que sí estaba sano y dejó de estarlo.
 *
 * El piso vive bajo su PROPIA llave (`evento` + huella del `motivo`) y dura
 * `PISO_ALERTA_CONFIG_MS`. Mientras la razón no cambie, sale UN correo por
 * semana en vez de uno por hora para siempre.
 */
export async function alertarHuecoConfiguracion(evento: string, motivo: string, detalle: Record<string, unknown> = {}): Promise<void> {
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
    const llave = `${evento}:${huella(motivo)}`;
    if (!(await reservarPiso(llave, ahora, PISO_ALERTA_CONFIG_MS))) return;

    const datos: Array<[string, string]> = [
      ['Evento', evento],
      ['Cuándo', fechaHoraMx(new Date(ahora).toISOString())],
      ['Motivo', redactarTexto(motivo).slice(0, 300)],
      ...Object.entries(detalle).map(([k, v]) => [k, redactarTexto(String(v)).slice(0, 300)] as [string, string]),
    ];

    const r = await enviarCorreo(para, {
      asunto: `[Likida] Pendiente de configurar: ${evento}`,
      avance: 'Nada se rompió: sigue pendiente un hueco de configuración ya conocido.',
      titulo: `Pendiente de configurar: ${evento}`,
      parrafos: [
        'Esto NO es una falla: el propio proceso ya sabe exactamente qué le falta y lo dice abajo, en el campo "Motivo". Mientras tanto no hace nada a propósito — nunca simula ni adivina.',
        'De este mismo pendiente no va a llegar otro correo en varios días aunque siga sin resolverse; si lo que falta CAMBIA, este correo vuelve a salir porque eso sí es información nueva.',
      ],
      datos,
      boton: { texto: 'Ver salud del sistema', href: `${APP}/admin/salud-sistema` },
      tono: 'atencion',
      porQueLoRecibes: 'Recibes esto porque ALERTA_EMAIL apunta a esta dirección: es el canal del operador del sistema, no de una flota.',
    });
    if (!r.ok) logger.warn('alerta.no_salio', { evento, motivo: r.motivo });
  } catch (e) {
    logger.warn('alerta.fallo', { evento, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Un contador de fallos CONSECUTIVOS (auditoría prod 22-ago-2026, RES-3 /
 * RES-16).
 *
 * Para lo que falla "a veces" y se tolera —un OCR, una subida a Storage— y que
 * sin esto se degradaba en silencio: cada fallo era un `warn` que nadie lee y
 * el mismo issue viejo de Sentry. N seguidos ya no es "a veces": es el
 * proveedor caído, la llave vencida o el bucket ausente.
 *
 * ES PURO A PROPÓSITO: cuenta y contesta si toca gritar; QUIÉN grita lo decide
 * el llamador con su propio `alertarOperador`. Así el aviso se ve desde las
 * pruebas del módulo que falla, y este archivo no queda como un canal indirecto
 * que hay que adivinar. El contador vive por instancia (mejor esfuerzo); el
 * piso de una hora ya es global, en Redis.
 */
export function contadorDeFallos(umbral: number) {
  let seguidos = 0;
  return {
    get seguidos() { return seguidos; },
    /** Suma uno y dice si ya toca avisar. */
    fallo(): boolean {
      seguidos += 1;
      return seguidos >= umbral;
    },
    exito(): void { seguidos = 0; },
  };
}
