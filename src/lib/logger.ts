// Logger mínimo con redacción de PII fiscal (RFC, teléfonos) y huella estable de
// identificadores (UUID).
//
// En producción los `warn` y `error` se replican a Sentry — pero SIEMPRE después
// de redactar, y por este mismo camino: así lo que sale del sistema va
// anonimizado por una sola función y no por dos configuraciones que alguien
// tenga que acordarse de mantener sincronizadas. Sin SENTRY_DSN no se carga
// nada (ver observability/sentry.ts).
//
// ═══════════════════════════════════════════════════════════════════════════
// POR QUÉ EL UUID SE HUELLA Y NO SE BORRA  (auditoría 5, CRÍTICO)
//
// Hasta la ronda 5 esta función reemplazaba todo UUID por la cadena `[UUID]`.
// El regex se escribió pensando en el folio fiscal de un CFDI —que es un UUID
// v4—, pero las llaves primarias de Postgres (`tenant.id`, `viaje.id`,
// `gasto.id`, `operador.id`, `liquidacion.id`) tienen EXACTAMENTE la misma
// forma. Resultado medido: un fallo de PDF de la flota A y uno de la flota B
// producían la misma línea, carácter por carácter:
//
//   {"level":"error","msg":"pdf.no_entregado",
//    "meta":{"tenant":"[UUID]","viaje":"[UUID]","pdfGenerado":false,...}}
//
// A las 3 a.m. eso no permite reconstruir nada: el único identificador que
// sobrevivía era el wamid de Meta, y `wa_mensaje_procesado` no lo relaciona con
// ningún tenant ni viaje. El autor de `processor.ts:601` había puesto tenant y
// viaje en el log a propósito; esta función, dos capas más abajo, lo deshacía.
//
// La decisión: **huella corta, estable y derivable** (`id:` + 12 hex de FNV-1a
// 64) en vez de borrado. Se apoya en una asimetría de entropía, no en una
// preferencia de estilo:
//
//   · Un UUID v4 tiene ~122 bits de aleatoriedad. Desde la huella NO se puede
//     recuperar el UUID: no hay diccionario que enumerar. Quien solo tiene el
//     log no puede consultar el folio en el SAT ni identificar a nadie.
//   · Quien SÍ tiene la base (el ingeniero de guardia) hace el camino contrario,
//     que es barato: `huellaId(fila.id)` y compara. Por eso `huellaId` se
//     exporta — es la función con la que se cruza un log contra Postgres.
//   · La huella es estable entre despliegues y máquinas (función pura, sin
//     sal): sin eso no se pueden agrupar dos líneas de la misma flota, que es
//     justo lo que se necesita para ver "todos los fallos del tenant X".
//
// Y por eso mismo el RFC y el teléfono se siguen BORRANDO enteros: su espacio
// es pequeño (un RFC se enumera, un celular de 10 dígitos son 10^10 intentos),
// así que una huella de esos sí sería reversible por fuerza bruta. La regla no
// es "hashear todo", es: se huella lo que no se puede adivinar, se borra lo que
// sí.
// ═══════════════════════════════════════════════════════════════════════════

const UUID = /\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;
const RFC = /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/;
// El wa_id que entrega Meta para México lleva un "1" después del 52
// (`5219993700779`, 13 dígitos) y NO cabía en `\b\+?52\d{10}\b`: el webhook
// emitía el teléfono del operador en claro en `wa.ratelimit`. El `1` opcional lo
// cubre. No se generaliza a "12 o 13 dígitos" a propósito: un epoch en
// milisegundos tiene 13 dígitos y se convertiría en `[TEL]`, que es cómo se
// pierde la hora de un evento.
const PHONE = /\b\+?521?\d{10}\b|\b\d{10}\b/;

// UNA sola pasada con las tres reglas alternadas, no tres `replace` encadenados.
// Encadenar significa que la salida de una regla vuelve a ser entrada de la
// siguiente: una huella que por azar saliera toda en dígitos podía acabar
// redactada como teléfono, y un UUID cuyo último segmento fuera numérico se
// perdía antes de llegar a la regla de UUID. Con una pasada, lo ya sustituido no
// se vuelve a mirar.
const SENSIBLE = new RegExp([UUID.source, RFC.source, PHONE.source].join('|'), 'g');

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/**
 * Huella corta y estable de un identificador. Es lo que aparece en los logs en
 * lugar del UUID crudo.
 *
 * Uso a las 3 a.m.: se tiene la línea `{"tenant":"id:9f2c1a4b77de"}` y la base.
 * `huellaId('<uuid de la fila>')` devuelve esa misma cadena → así se sabe de qué
 * flota, viaje u operador era el fallo. FNV-1a, no SHA: no hace falta resistencia
 * criptográfica (la protección viene de la entropía del UUID, no del algoritmo)
 * y evita depender de `node:crypto`, que no existe en todos los runtimes donde
 * este módulo puede acabar empaquetado.
 */
export function huellaId(uuid: string): string {
  const s = uuid.toLowerCase();
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return `id:${h.toString(16).padStart(16, '0').slice(0, 12)}`;
}

/** Redacta una cadena suelta. Exportada para que Sentry use ESTE camino y no otro. */
export function redactarTexto(s: string): string {
  return s.replace(SENSIBLE, (m) => {
    if (m.includes('-')) return huellaId(m); // UUID: se conserva la traza
    if (/^[A-ZÑ&]/.test(m)) return '[RFC]'; // dato fiscal: se borra
    return '[TEL]'; // dato personal: se borra
  });
}

function redact(v: unknown): unknown {
  if (typeof v === 'string') return redactarTexto(v);
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

// Claves cuyo valor es, por construcción, un hash sin dato personal dentro y que
// el redactor destruiría por parecerse a otra cosa.
//
// `digest` es el de Next: diez dígitos, o sea EXACTAMENTE la forma de un celular
// mexicano sin lada, así que salía como `[TEL]`. Y es el único puente entre lo
// que el contralor ve en pantalla ("Digest: 3155718393") y la línea del log del
// servidor: si se redacta, `onRequestError` y el error boundary del panel dejan
// de servir para lo único que sirven. Lo pone Next, nunca el código de negocio.
const CLAVES_NO_PII = new Set(['digest']);

function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out = redact(meta);
  if (!out || typeof out !== 'object') return out as Record<string, unknown>;
  const obj = out as Record<string, unknown>;
  for (const k of CLAVES_NO_PII) {
    if (typeof meta[k] === 'string') obj[k] = meta[k];
  }
  return obj;
}

type Level = 'debug' | 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const redactado = meta ? redactMeta(meta) : undefined;
  // `t` iba vacío "para no romper determinismo de tests" y ninguna prueba lo
  // usaba: lo que sí pasaba es que dos líneas idénticas tampoco se podían
  // ordenar en el tiempo. Se emite ISO-8601 porque es lo primero que se mira
  // cuando hay que cruzar un log con la hora de un mensaje de WhatsApp.
  const line = { t: new Date().toISOString(), level, msg, ...(redactado ? { meta: redactado } : {}) };
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
