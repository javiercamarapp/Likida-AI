// Logger mínimo con redacción de PII fiscal (RFC, UUID CFDI, teléfonos).
//
// En producción los `warn` y `error` se replican a Sentry — pero SIEMPRE después
// de redactar, y por este mismo camino: así lo que sale del sistema va
// anonimizado por una sola función y no por dos configuraciones que alguien
// tenga que acordarse de mantener sincronizadas. Sin SENTRY_DSN no se carga
// nada (ver observability/sentry.ts).

const RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PHONE = /\b\+?52\d{10}\b|\b\d{10}\b/g;

function redact(v: unknown): unknown {
  if (typeof v === 'string') {
    return v.replace(RFC, '[RFC]').replace(UUID, '[UUID]').replace(PHONE, '[TEL]');
  }
  if (v && typeof v === 'object') {
    // try/catch: objetos circulares o no-serializables NO deben romper el log. ME-10.
    try {
      return JSON.parse(redact(JSON.stringify(v)) as string);
    } catch {
      return '[unserializable]';
    }
  }
  return v;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const redactado = meta ? (redact(meta) as Record<string, unknown>) : undefined;
  const line = { t: '', level, msg, ...(redactado ? { meta: redactado } : {}) };
  // t se deja vacío en cliente/serverless para no romper determinismo de tests.
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));

  // A Sentry solo lo que merece atención humana, y ya redactado. El import es
  // perezoso para no arrastrar el paquete en tests ni en el cliente.
  if ((level === 'error' || level === 'warn') && process.env.SENTRY_DSN) {
    void import('./observability/sentry').then((s) => s.reportar(level, msg, redactado));
  }
}

export const logger = {
  debug: (m: string, meta?: Record<string, unknown>) =>
    process.env.NODE_ENV !== 'production' && emit('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => emit('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => emit('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => emit('error', m, meta),
};
