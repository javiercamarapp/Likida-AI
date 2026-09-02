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
//      arranque lo grita aparte (`SILENCIOSAS` en arranque.ts). Desde la
//      auditoría 24 (OP-P5) hay un segundo canal opcional, `ALERTA_WA`, solo
//      para los eventos de dinero (ver `esEventoDeDinero`).
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

/**
 * OP-A3 (auditoría 22) y su reincidencia (auditoría 24, OP-P5 / PRU-A3): qué
 * hace distinto a un incidente de otro dentro del mismo evento.
 *
 * La versión anterior solo miraba llaves «de identidad» que NINGÚN llamador
 * emite: los ~40 llamadores del repo mandan `{ error, codigo }` y meten al
 * viaje, la reserva o el folio DENTRO de `error`. Medido: doce viajes que
 * fallan al timbrar en la misma hora = un correo, y el contralor sabía de uno.
 *
 * La huella se arma con lo que de verdad viaja: el código, las llaves de
 * identidad que sí existen (`prospectoId`, `interruptor`, `status`, `causa`…)
 * y TODO UUID que aparezca en cualquier valor de texto — un UUID es una
 * identidad (viaje, reserva, folio fiscal) y dos incidentes con UUIDs
 * distintos son dos alarmas. Un timeout que cambia de milisegundos entre
 * reintentos sigue siendo el MISMO incidente: los números sueltos del texto no
 * entran a la huella. Ordenada para que el orden del objeto no fabrique
 * huellas distintas.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function huellaDeDetalle(detalle: Record<string, unknown>): string {
  const SALIENTES = [
    'codigo', 'code', 'viajeId', 'viaje', 'gastoId', 'operadorId', 'tenantId', 'cron', 'uuid', 'uuidFiscal',
    'prospectoId', 'reservaId', 'interruptor', 'status', 'causa', 'cual',
  ];
  const partes = SALIENTES
    .filter((k) => detalle[k] !== undefined && detalle[k] !== null)
    .map((k) => `${k}=${String(detalle[k]).slice(0, 64)}`);
  const ids = new Set<string>();
  for (const v of Object.values(detalle)) {
    if (typeof v !== 'string') continue;
    for (const m of v.match(UUID_RE) ?? []) ids.add(m.toLowerCase());
  }
  if (ids.size > 0) partes.push(`ids=${[...ids].sort().slice(0, 8).join(',')}`);
  return partes.length > 0 ? partes.sort().join('&') : '_';
}

/**
 * PRU-A3 (auditoría 24, reincidente de OP-A2): los llamadores de `timbre.*`
 * meten el folio fiscal DENTRO de `error` («el PAC timbró el uuid …»), y
 * `redactarTexto` lo convertía en `id:33ab7e19c0d1`: el correo decía que
 * existía un CFDI ante el SAT que Likida no podía nombrar. En un evento de
 * timbrado, el UUID que el texto NOMBRA como «uuid» o «folio» es el folio
 * fiscal —un documento, no una persona— y se conserva íntegro; cualquier
 * otro UUID del texto (el viaje, la reserva) y el resto (RFC, teléfonos,
 * CLABE) se redactan igual que siempre.
 */
const EVENTOS_CON_FOLIO_FISCAL = /^timbre\./;
// Alternación en vez de `folio(?:\s+fiscal)?`: un `+` dentro de un `?` es
// altura de estrella 2 y `security/detect-unsafe-regex` lo marca. La rama
// larga va primero para que «folio fiscal» no se quede en «folio».
const FOLIO_NOMBRADO_RE = /\b(uuid|folio\s+fiscal|folio)\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

export function redactarConservandoFolio(texto: string): string {
  const folios: string[] = [];
  const marcado = texto.replace(FOLIO_NOMBRADO_RE, (_m, palabra: string, uuid: string) => {
    folios.push(uuid);
    return `${palabra} \u0000${folios.length - 1}\u0000`;
  });
  return redactarTexto(marcado).replace(/\u0000(\d+)\u0000/g, (_, i: string) => folios[Number(i)] ?? '');
}

// ── OP-P5 (auditoría 24): EL CANAL DE MADRUGADA PARA EL DINERO ──────────────
//
// A las 3 a.m. el único canal era un correo. Un incidente del camino del
// dinero —un CFDI timbrado que Likida no registró, un lote de facturación que
// no salió, una cobranza rechazada en masa— esperaba a que alguien abriera el
// correo. `ALERTA_WA` es el WhatsApp del operador del sistema: opcional, como
// `ALERTA_EMAIL`. Cuando está, los eventos de dinero salen TAMBIÉN por ahí,
// por el mismo `enviarTexto` que usa el producto y bajo el MISMO piso (ya
// reservado arriba: si el correo no sale por piso, el WhatsApp tampoco).
//
// Texto libre y no plantilla: Meta solo lo entrega si hay ventana de 24 h
// abierta con ese número; el operador la abre escribiéndole al número de
// Likida, y si no hay ventana `enviarTexto` lo reporta y lo encola. El cuerpo
// no lleva cifras: el evento, el código y el texto ya redactado.
const EVENTOS_DE_DINERO = /^(timbre\.|finanzas\.|stripe\.|cron\.facturar|cron\.cobranza|wa\.rechazo_masivo)/;

/** ¿Este evento toca dinero? Solo esos salen por WhatsApp. */
export function esEventoDeDinero(evento: string): boolean {
  return EVENTOS_DE_DINERO.test(evento);
}

/** Para /admin/salud-sistema: hay un WhatsApp del operador al que avisar.
 *  Un número real en E.164 sin «+» (10 a 15 dígitos); un marcador o un
 *  hueco no cuentan como puesto — mismo criterio que `envPuesta`. */
export function alertaWhatsAppConfigurada(): boolean {
  const v = process.env.ALERTA_WA;
  return typeof v === 'string' && /^\d{10,15}$/.test(v.trim());
}

async function avisarPorWhatsApp(evento: string, datos: Array<[string, string]>): Promise<void> {
  try {
    // Import dinámico: `meta/client` arrastra el outbox y Supabase, y este
    // módulo lo importan crons y el health — no se paga ese árbol si no hay
    // número configurado.
    const { enviarTexto } = await import('@/lib/meta/client');
    const lineas = datos.filter(([k]) => k !== 'Evento').map(([k, v]) => `${k}: ${v.slice(0, 200)}`);
    const cuerpo = [`Likida — falló ${evento}`, ...lineas, `Detalle en ${APP}/admin/salud-sistema`]
      .join('\n').slice(0, 1500);
    const r = await enviarTexto(String(process.env.ALERTA_WA), cuerpo);
    if (!r.ok) logger.warn('alerta.wa_no_salio', { evento, motivo: r.error, status: r.status ?? null });
  } catch (e) {
    logger.warn('alerta.wa_fallo', { evento, error: e instanceof Error ? e.message : String(e) });
  }
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
/**
 * AUDITORÍA 22, OP-A2 (ALTO) — las llaves que NO se redactan en la alerta.
 *
 * `redactarTexto` convierte todo UUID en una huella FNV irreversible. Bien
 * pensado para datos de persona; catastrófico para un FOLIO FISCAL.
 *
 * El escenario: el PAC timbra el CFDI, devuelve el uuid, y el `update
 * {uuid_fiscal}` falla. En ese punto el comprobante existe SOLO ante el SAT —
 * no se escribió en `ccp_timbre` ni en ninguna otra tabla. El correo decía «el
 * PAC timbró el uuid id:33ab7e19c0d1», la consola lo mismo, y Sentry perdía la
 * llave entera. Resultado: un comprobante fiscal vivo que Likida no puede
 * nombrar, y el único camino de vuelta que el comentario proponía —«computa
 * `huellaId(fila.id)` y compara»— exige tener la fila, que es justo lo que no
 * se escribió.
 *
 * Un UUID de CFDI identifica un DOCUMENTO, no a una persona. En una alerta
 * interna de operación es el dato sin el cual no hay reconstrucción posible.
 */
const LLAVES_SIN_REDACTAR = new Set([
  'uuid', 'uuidFiscal', 'uuidCfdi', 'folioFiscal',
]);

export async function alertarOperador(evento: string, detalle: Record<string, unknown>): Promise<void> {
  try {
    const para = process.env.ALERTA_EMAIL;
    const porWhatsApp = alertaWhatsAppConfigurada() && esEventoDeDinero(evento);
    if (!para && !porWhatsApp) {
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
    // ── AUDITORÍA 22, OP-A3 (ALTO): EL PISO ERA POR NOMBRE DE EVENTO ───────
    // `carta_porte_timbre.ts` manda cinco alertas distintas bajo el mismo
    // `evento`, así que el SEGUNDO incidente de la hora se descartaba en
    // silencio. El piso incluye una huella del detalle SALIENTE (ver
    // `huellaDeDetalle`: código, identidades y los UUIDs del texto), así que
    // dos incidentes distintos son dos alarmas y el mismo repitiéndose es una.
    // Sin nada saliente que distinguir, la llave se queda como estaba.
    const huella = huellaDeDetalle(detalle);
    if (!(await reservarPiso(huella === '_' ? evento : `${evento}|${huella}`, ahora))) return;

    // PRU-A3: en un evento de timbrado el UUID que el texto nombra como
    // «uuid»/«folio» es el folio fiscal y se conserva; el resto se redacta igual.
    const conservaFolio = EVENTOS_CON_FOLIO_FISCAL.test(evento);
    const redactar = (v: unknown) => (conservaFolio ? redactarConservandoFolio(String(v)) : redactarTexto(String(v)));
    const datos: Array<[string, string]> = [
      ['Evento', evento],
      ['Cuándo', fechaHoraMx(new Date(ahora).toISOString())],
      // Recortado a 300: un stack completo va en Sentry, no en el cuerpo de
      // un correo que se lee en el teléfono.
      ...Object.entries(detalle).map(([k, v]) => [
        k,
        // OP-A2: un folio fiscal se entrega tal cual — es la única llave para
        // reconstruir un comprobante que ya existe ante el SAT.
        (LLAVES_SIN_REDACTAR.has(k) ? String(v) : redactar(v)).slice(0, 300),
      ] as [string, string]),
    ];

    if (para) {
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
    }
    // OP-P5: el dinero también suena en el teléfono, si hay número.
    if (porWhatsApp) await avisarPorWhatsApp(evento, datos);
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
