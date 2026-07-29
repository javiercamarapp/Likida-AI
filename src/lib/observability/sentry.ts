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
      // Sin trazas: aquí interesan los errores, y el muestreo de performance
      // sobre un webhook de 60s no dice nada que el reloj no diga mejor.
      tracesSampleRate: 0,
      // Nada de PII automática: el enriquecimiento de Sentry adjunta IP y
      // cabeceras, y el pipeline del logger no las ha visto para redactarlas.
      sendDefaultPii: false,
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
 */
export function reportar(nivel: 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (!sentryActivo()) return;
  intento ??= cargar();
  seguir(
    intento.then(async () => {
      try {
        sentry?.captureMessage(msg, { level: nivel === 'error' ? 'error' : 'warning', extra: meta, fingerprint: [msg, nivel] });
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
