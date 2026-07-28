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
// 1. Se alimenta del `logger`, que YA redacta RFC, UUID de CFDI y teléfonos. Lo
//    que sale de aquí va anonimizado por el mismo camino que los logs locales,
//    no por una config aparte que alguien tenga que acordarse de mantener.
//
// 2. Es OPCIONAL y silencioso. Sin `SENTRY_DSN` no se carga el paquete siquiera
//    (import dinámico): en desarrollo y en los tests no estorba, y un fallo al
//    inicializar NUNCA puede tumbar el flujo del operador — la observabilidad no
//    vale una liquidación.
//
// PRIVACIDAD: al cablearlo, Sentry pasa a ser subencargado en el sentido de la
// LFPDPPP. Está anotado en docs/conocimiento/52-anexo-subencargados.md.
// ═══════════════════════════════════════════════════════════════════════════

type SentryLike = {
  init: (o: Record<string, unknown>) => void;
  captureException: (e: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (m: string, ctx?: Record<string, unknown>) => void;
};

let sentry: SentryLike | null = null;
let intento: Promise<void> | null = null;

/** `true` si hay DSN configurado. Sin él, todo esto es un no-op. */
export function sentryActivo(): boolean {
  return !!process.env.SENTRY_DSN;
}

/** Carga e inicializa una sola vez. Nunca lanza. */
async function cargar(): Promise<void> {
  if (sentry || !sentryActivo()) return;
  try {
    const mod = (await import('@sentry/nextjs')) as unknown as SentryLike;
    mod.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development',
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
 * Reporta un evento ya REDACTADO por el logger.
 *
 * No se espera al envío: bloquear el turno del operador por telemetría sería
 * cambiar un problema pequeño por uno grande.
 */
export function reportar(nivel: 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void {
  if (!sentryActivo()) return;
  intento ??= cargar();
  void intento.then(() => {
    try {
      sentry?.captureMessage(msg, { level: nivel === 'error' ? 'error' : 'warning', extra: meta });
    } catch { /* la telemetría nunca rompe el flujo */ }
  });
}
