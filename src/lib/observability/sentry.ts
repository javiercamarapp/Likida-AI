// ═══════════════════════════════════════════════════════════════════════════
// SENTRY — para que un fallo en producción exista fuera de los logs de Vercel.
//
// Sin esto, "si algo se rompe nadie se entera": el fallo queda en un log que
// solo se mira cuando alguien ya se quejó. Con un demo el 6-ago y un webhook que
// responde 200 antes de trabajar —así que Meta no reintenta— un error silencioso
// es un mensaje perdido sin rastro.
//
// DOS DECISIONES QUE IMPORTAN:
//
// 1. Se alimenta del `logger`, que YA redacta RFC y teléfonos y huella los UUID.
//    Lo que sale de aquí va anonimizado por el mismo camino que los logs
//    locales, no por una config aparte que alguien tenga que acordarse de
//    mantener. Por eso `reportarExcepcion` pasa el mensaje y el stack por
//    `redactarTexto` en vez de dárselos crudos al SDK.
//
// 2. Es OPCIONAL y silencioso. Sin `SENTRY_DSN` no se carga el paquete siquiera
//    (import dinámico): en desarrollo y en los tests no estorba, y un fallo al
//    inicializar NUNCA puede tumbar el flujo del operador — la observabilidad no
//    vale una liquidación.
//
// PRIVACIDAD: al cablearlo, Sentry pasa a ser subencargado en el sentido de la
// LFPDPPP. Está anotado en docs/conocimiento/52-anexo-subencargados.md.
// ═══════════════════════════════════════════════════════════════════════════

import { logger, redactarTexto } from '@/lib/logger';

type SentryLike = {
  init: (o: Record<string, unknown>) => void;
  captureException: (e: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (m: string, ctx?: Record<string, unknown>) => void;
  flush: (timeout?: number) => Promise<boolean>;
};

let sentry: SentryLike | null = null;
let intento: Promise<void> | null = null;

// Envíos en vuelo. En serverless no basta con dispararlos: hay que poder
// esperarlos antes de que la invocación se congele (ver `flushObservabilidad`).
const enVuelo = new Set<Promise<unknown>>();

/** `true` si hay DSN configurado. Sin él, todo esto es un no-op. */
export function sentryActivo(): boolean {
  return !!process.env.SENTRY_DSN;
}

function entorno(): string {
  return process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
}

/** Muestreo acotado: trazas útiles sin convertir datos de negocio en telemetría. */
export function tasaTrazas(): number {
  const valor = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.05');
  return Number.isFinite(valor) ? Math.min(1, Math.max(0, valor)) : 0.05;
}

/** Elimina query, headers, cookies, body, usuario y extras de eventos automáticos. */
export function sanitizarEventoSentry(evento: unknown): unknown {
  if (!evento || typeof evento !== 'object') return evento;
  const salida = { ...(evento as Record<string, unknown>) };
  delete salida.user;
  delete salida.extra;
  // BACKEND-19C2-3 (revisión): un evento de TRANSACCIÓN lleva la query en dos
  // sitios que un evento de error no tiene y que este saneador no tocaba:
  // `spans[].data` y `contexts.trace.data`. La instrumentación de fetch del
  // SDK (@sentry/core `getFetchSpanAttributes`) mete ahí `url`, `http.url`,
  // `url.full` —la URL COMPLETA, query incluida— y `http.query` aparte. O sea:
  // este mismo saneador recortaba `request.url` a origin+path, y la misma URL
  // con `?token=…` o los filtros de PostgREST (`rfc=eq.…`, `tenant_id=eq.…`)
  // salía intacta en los spans de cada fetch a Supabase/Upstash/OpenRouter.
  // Mismo criterio que breadcrumbs: los `data` se tiran enteros; op,
  // description (ya sin query — el SDK la recorta del nombre) y tiempos se
  // quedan, que es lo que hace útil la traza de performance.
  if (Array.isArray(salida.spans)) {
    salida.spans = salida.spans.map((span) => {
      if (!span || typeof span !== 'object') return span;
      const s = { ...(span as Record<string, unknown>) };
      delete s.data;
      return s;
    });
  }
  const contexts = salida.contexts;
  if (contexts && typeof contexts === 'object') {
    const trace = (contexts as Record<string, unknown>).trace;
    if (trace && typeof trace === 'object') {
      const t = { ...(trace as Record<string, unknown>) };
      delete t.data;
      salida.contexts = { ...(contexts as Record<string, unknown>), trace: t };
    }
  }
  const request = salida.request;
  if (request && typeof request === 'object') {
    const r = { ...(request as Record<string, unknown>) };
    const originalUrl = r.url;
    if (typeof originalUrl === 'string') {
      try {
        const url = new URL(originalUrl);
        r.url = `${url.origin}${url.pathname}`;
      } catch {
        r.url = originalUrl.split('?')[0];
      }
    }
    delete r.headers;
    delete r.cookies;
    delete r.data;
    salida.request = r;
  }
  if (Array.isArray(salida.breadcrumbs)) {
    salida.breadcrumbs = salida.breadcrumbs.map((crumb) => {
      if (!crumb || typeof crumb !== 'object') return crumb;
      const c = { ...(crumb as Record<string, unknown>) };
      delete c.data;
      return c;
    });
  }
  return salida;
}

/**
 * Deja constancia en el arranque de si hay observabilidad o no.
 *
 * La causa raíz del hallazgo de la auditoría 5 no fue el cableado —que estaba
 * hecho— sino que `SENTRY_DSN` no llegó nunca al entorno de Vercel y **el
 * sistema no lo dijo**: arrancó igual, sin destino para los errores, y eso solo
 * se descubrió auditando `vercel env ls`. Esta línea aparece en el log de
 * arranque, que es lo único que alguien mira a propósito justo después de un
 * despliegue.
 *
 * Va como `error` a propósito cuando falta en un despliegue real: un `warn` se
 * pierde entre el ruido, y el coste de no tenerlo es que el siguiente fallo no
 * lo oiga nadie. En local no dice nada — ahí los logs se ven en la terminal y el
 * aviso solo sería ruido diario.
 *
 * (No hay recursión: cuando emite `error` es precisamente porque NO hay DSN, así
 * que `logger` no vuelve a entrar a este módulo.)
 */
export function avisarObservabilidad(): void {
  const desplegado = !!process.env.VERCEL_ENV || process.env.NODE_ENV === 'production';
  if (!desplegado) return;
  const meta = { sentry: sentryActivo(), entorno: entorno() };
  if (meta.sentry) logger.info('startup.observabilidad', meta);
  else logger.error('startup.observabilidad', { ...meta, err: 'SENTRY_DSN ausente: los errores solo quedan en el runtime log de Vercel, sin alerta y con retención corta' });
}

/** Carga e inicializa una sola vez. Nunca lanza. */
async function cargar(): Promise<void> {
  if (sentry || !sentryActivo()) return;
  try {
    const mod = (await import('@sentry/nextjs')) as unknown as SentryLike;
    mod.init({
      dsn: process.env.SENTRY_DSN,
      environment: entorno(),
      // Muestreo bajo, configurable y acotado; `sendDefaultPii:false` y
      // `beforeSend` impiden que request context lleve query/cookies/body.
      tracesSampleRate: tasaTrazas(),
      // Nada de PII automática: el enriquecimiento de Sentry adjunta IP y
      // cabeceras, y el pipeline del logger no las ha visto para redactarlas.
      sendDefaultPii: false,
      beforeSend: (evento: unknown) => sanitizarEventoSentry(evento),
      // BACKEND-19C2-3 — el SDK trata `beforeSend`/`beforeSendTransaction`
      // como hooks INDEPENDIENTES: con `tracesSampleRate` > 0 (default 0.05),
      // 1 de cada 20 transacciones de performance salía sin pasar por el
      // saneador — mismo `.request`/`.breadcrumbs`/`.user`/`.extra` que un
      // evento de error, mismo riesgo de fuga (RFC, domicilio, cookies de
      // sesión). `sanitizarEventoSentry` opera genérico sobre esas formas
      // compartidas Y sobre las propias de una transacción (`spans[].data`,
      // `contexts.trace.data` — ver la nota dentro del saneador).
      beforeSendTransaction: (evento: unknown) => sanitizarEventoSentry(evento),
    });
    sentry = mod;
  } catch (e) {
    // Un fallo aquí no puede costar una liquidación. Se avisa por consola —no por
    // `logger`, que llamaría de vuelta a este módulo— y se sigue.
    console.error(JSON.stringify({ level: 'warn', msg: 'sentry.init_fallo', err: String(e) }));
    sentry = null;
  }
}

/**
 * Inicializa por adelantado, desde `instrumentation.ts`.
 *
 * Antes el SDK solo se cargaba en el primer `logger.error`: el arranque no podía
 * fallar ruidoso porque no había nada cargado, y el primer error de cada
 * instancia fría pagaba el import. Al hacerlo en el arranque, un DSN mal escrito
 * se ve en el despliegue y no la primera noche que algo se rompa.
 */
export async function precargar(): Promise<void> {
  if (!sentryActivo()) return;
  intento ??= cargar();
  await intento;
}

function seguir(p: Promise<unknown>): void {
  enVuelo.add(p);
  void p.finally(() => enVuelo.delete(p));
}

/**
 * Vacía la cola de Sentry y espera a los envíos en vuelo.
 *
 * En Vercel el trabajo del webhook corre dentro de `after()` y la invocación se
 * CONGELA en cuanto esa promesa resuelve: sin esto, el evento que más importa
 * —el último error antes de morir— es justo el que menos probabilidad tiene de
 * salir del proceso. Devuelve siempre, nunca lanza: un fallo de telemetría no
 * puede sumarse al fallo que se está reportando.
 */
export async function flushObservabilidad(timeoutMs = 2000): Promise<void> {
  if (!sentryActivo()) return;
  try {
    await Promise.allSettled([...enVuelo]);
    await sentry?.flush(timeoutMs);
  } catch { /* la telemetría nunca rompe el flujo */ }
}

/**
 * Lo que separa un issue de otro ADEMÁS del mensaje y el nivel.
 *
 * Auditoría 3, OP-A1: con `fingerprint: [msg, nivel]` los ~216 fallos del cron
 * (5→14 ago) fueron UN solo issue de Sentry y UNA notificación, la primera
 * madrugada. Sentry solo vuelve a avisar cuando NACE un issue; todo lo que caiga
 * en un issue viejo solo engorda un contador que nadie abre. Agrupar también por
 * tenant y por causa convierte "la flota B también está fallando" y "ahora falla
 * por token vencido, no por el embed" en issues NUEVOS — es decir, en
 * notificaciones que sí llegan a un humano.
 *
 * Se leen las claves que los llamadores del camino del dinero ya emiten:
 *   · `tenant` / `tenantId` — llega aquí ya redactado como huella FNV (`id:…`),
 *     estable entre despliegues y máquinas (logger.ts, `huellaId`): agrupa por
 *     flota sin exponer el UUID.
 *   · `codigo` / `status` — el código de error de la Graph API o el HTTP status:
 *     un 190 (token vencido) y un 131030 (fuera de la lista de pruebas) tienen
 *     arreglos completamente distintos y merecen issues distintos.
 *
 * La cardinalidad queda acotada por construcción: tenants son decenas, códigos
 * de Meta y HTTP status son un puñado. NO se mete `viaje`/`viajeId` a propósito:
 * un issue por viaje sería un issue por fila, y el ruido mata la alarma igual
 * que el silencio.
 */
function discriminadores(meta?: Record<string, unknown>): string[] {
  if (!meta) return [];
  const out: string[] = [];
  const tenant = meta.tenant ?? meta.tenantId;
  if (typeof tenant === 'string' && tenant) out.push(tenant);
  const causa = meta.codigo ?? meta.status;
  if (typeof causa === 'string' || typeof causa === 'number') out.push(String(causa));
  return out;
}

/**
 * Reporta un evento ya REDACTADO por el logger.
 *
 * No se espera al envío: bloquear el turno del operador por telemetría sería
 * cambiar un problema pequeño por uno grande. Pero sí se pide `flush` inmediato
 * dentro del envío —en vez de dejarlo al temporizador del batch del SDK— porque
 * en serverless el proceso puede congelarse antes de que ese temporizador
 * dispare. Quien pueda esperar de verdad, que llame a `flushObservabilidad`.
 *
 * El `fingerprint` lleva el NIVEL además del mensaje. Sentry agrupa por texto
 * del mensaje, y este código reutiliza el mismo `msg` para un estado y su
 * contrario —`startup.migraciones` sale como `error` cuando falta una migración
 * y como `info`/`ok:true` cuando están todas; `costo.vinculado` igual—. Sin
 * esto, el aviso y su desmentido caen en el mismo cubo y el segundo se lee como
 * "ya lo vi". Separarlos aquí, en un solo sitio, evita tener que renombrar
 * mensajes por todo el repo cada vez que aparece una pareja así.
 *
 * Y lleva los `discriminadores` (tenant + causa) por la lección de OP-A1: un
 * fallo persistente y un fallo único producían exactamente la misma molestia a
 * un humano — una notificación, una vez.
 */
export function reportar(nivel: 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (!sentryActivo()) return;
  intento ??= cargar();
  seguir(
    intento.then(async () => {
      try {
        sentry?.captureMessage(msg, { level: nivel === 'error' ? 'error' : 'warning', extra: meta, fingerprint: [msg, nivel, ...discriminadores(meta)] });
        await sentry?.flush(2000);
      } catch { /* la telemetría nunca rompe el flujo */ }
    }),
  );
}

/**
 * Copia anonimizada de un error, conservando nombre, stack y `digest`.
 *
 * El `digest` es el hash con el que Next correlaciona lo que el usuario vio en
 * pantalla con la línea del log del servidor: es literalmente lo único que se le
 * puede preguntar al contralor cuando el panel le muestra "No se pudo cargar".
 */
function anonimizar(err: unknown): Error {
  const original = err instanceof Error ? err : new Error(String(err));
  const copia = new Error(redactarTexto(original.message));
  copia.name = original.name;
  if (original.stack) copia.stack = redactarTexto(original.stack);
  return copia;
}

/** El `digest` que Next cuelga del error, si lo trae. */
export function digestDe(err: unknown): string | undefined {
  const d = (err as { digest?: unknown } | null | undefined)?.digest;
  return typeof d === 'string' ? d : undefined;
}

// Lo que se borra del mensaje antes de derivar el código: un UUID o una cifra
// larga (timestamp, epoch, id numérico) haría que la MISMA causa produjera un
// código distinto en cada corrida — y `discriminadores` convertiría cada
// corrida en un issue nuevo, que es exactamente el ruido que OP-A1 enseñó a no
// generar. Las cifras cortas (un HTTP 500, un código 190 de Meta) se quedan:
// esas sí distinguen causas.
const VARIABLE_EN_MENSAJE = new RegExp(
  `\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b|\\d{4,}`,
  'g',
);

/**
 * Código ESTABLE de la causa de un error, para `meta.codigo` (que
 * `discriminadores` ya lee y suma al fingerprint).
 *
 * Los catch de los cron emitían solo `{error}`, y el mensaje NO entra al
 * fingerprint: dos causas distintas ("token vencido" hoy, "tabla no existe"
 * mañana) caían en el mismo issue viejo de Sentry, que ya no notifica. Esto es
 * el discriminador que faltaba, con dos decisiones:
 *
 *   · Si el error trae `code` (PostgREST '42P01', Node 'ECONNREFUSED', Meta
 *     190), se usa tal cual: ya es el nombre de la causa y se puede buscar.
 *   · Si no, huella FNV del `name:mensaje` NORMALIZADO — mismo algoritmo y
 *     mismo formato que `huellaId` del logger, con prefijo `err:` propio. Dos
 *     corridas con la misma causa dan el mismo código aunque el mensaje
 *     traiga un UUID o un timestamp distinto.
 *
 * NO se usa `digestDe(err)` a propósito: el digest de Next son diez dígitos
 * —la forma exacta de un celular— y el redactor del logger lo convierte en
 * `[TEL]` bajo cualquier clave que no sea `digest`, colapsando todas las
 * causas en un solo literal. El `err:` + hex de aquí no coincide con ninguna
 * regla del redactor, verificado contra `SENSIBLE` en logger.ts.
 */
export function codigoDeError(err: unknown): string {
  const objeto = err as { code?: unknown; name?: unknown; message?: unknown } | null | undefined;
  const code = objeto?.code;
  if ((typeof code === 'string' && code) || typeof code === 'number') return String(code);

  const nombre = typeof objeto?.name === 'string' ? objeto.name : '';
  const mensaje = typeof objeto?.message === 'string' ? objeto.message : String(err ?? '');
  const normalizado = `${nombre}:${mensaje}`.replace(VARIABLE_EN_MENSAJE, '#');

  // FNV-1a 64 bits — el mismo de `huellaId`, no compartido para no exportar
  // del logger un primitivo que invite a huellar fuera de su pipeline.
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < normalizado.length; i++) {
    h ^= BigInt(normalizado.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `err:${h.toString(16).padStart(16, '0').slice(0, 12)}`;
}

/**
 * Reporta una EXCEPCIÓN, con su stack.
 *
 * `reportar` solo sabe de mensajes: en Sentry eso son eventos sin traza, que
 * dicen que algo falló y no dónde. Este es el camino para las excepciones que se
 * atrapan enteras (`onRequestError`), y el único que produce stack traces.
 */
export function reportarExcepcion(err: unknown, contexto?: Record<string, unknown>): void {
  if (!sentryActivo()) return;
  intento ??= cargar();
  const limpio = anonimizar(err);
  const digest = digestDe(err);
  const extra = { ...(contexto ?? {}), ...(digest ? { digest } : {}) };
  seguir(
    intento.then(async () => {
      try {
        sentry?.captureException(limpio, { level: 'error', extra });
        await sentry?.flush(2000);
      } catch { /* la telemetría nunca rompe el flujo */ }
    }),
  );
}
