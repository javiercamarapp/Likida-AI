// T-A1-36 · Mapa de errores del correo del desglose en lenguaje llano + reglas de alerta.
//
// Mismo contrato que `api.ts::motivoDeFallo` (Meta, que queda intacto): un
// código estable y una frase sin nombres de tablas ni cuerpo crudo de Resend.
// El texto crudo (`ultimo_error`) NUNCA cruza a la pantalla ni a /v1.
// Puro: sin base de datos, sin red, sin importar nada del servicio.

export type CodigoErrorCorreo =
  | 'sin_configurar'
  | 'correo_invalido'
  | 'reintentando'
  | 'red'
  | 'rebotada'
  | 'queja'
  | 'sin_confirmar'
  | 'interno';

export const CODIGOS_ERROR_CORREO: readonly CodigoErrorCorreo[] = [
  'sin_configurar', 'correo_invalido', 'reintentando', 'red', 'rebotada', 'queja', 'sin_confirmar', 'interno',
];

/** Frase llana por código: sin tablas, sin cuerpo crudo del proveedor. */
export const FRASE_ERROR_CORREO: Readonly<Record<CodigoErrorCorreo, string>> = {
  sin_configurar: 'El envío de correo todavía no está configurado; el desglose queda en espera y sale solo al configurarlo.',
  correo_invalido: 'El correo del destinatario no es válido o fue rechazado; corrígelo y reenvía el desglose.',
  reintentando: 'El servicio de correo está saturado o con problemas; se reintenta solo en unos minutos.',
  red: 'No hubo respuesta del servicio de correo; se reintenta solo y no se enviará dos veces.',
  rebotada: 'El correo rebotó: la dirección no existe o su buzón no lo acepta; corrígela y reenvía.',
  queja: 'El destinatario marcó el correo como no deseado; no se le vuelve a escribir hasta que lo confirmes.',
  sin_confirmar: 'No se pudo confirmar si el correo llegó; revísalo antes de reenviar para no duplicarlo.',
  interno: 'No se pudo enviar por un problema interno; se reintenta o se puede reintentar desde el panel.',
};

export interface FalloCorreo { codigo: CodigoErrorCorreo; texto: string }

const falla = (codigo: CodigoErrorCorreo): FalloCorreo => ({ codigo, texto: FRASE_ERROR_CORREO[codigo] });

/**
 * Traduce el `ultimo_error` guardado en la entrega (texto interno) y/o el estado
 * de entrega reportado por el proveedor a código + frase. `null` = sin problema.
 */
export function motivoDeFalloCorreo(
  ultimoError: string | null | undefined,
  estadoProveedor?: string | null,
): FalloCorreo | null {
  const estado = (estadoProveedor ?? '').toLowerCase();
  if (estado === 'rebotada' || estado === 'bounced') return falla('rebotada');
  if (estado === 'queja' || estado === 'complained') return falla('queja');
  if (estado === 'sin_confirmar') return falla('sin_confirmar');
  if (!ultimoError) return null;
  const e = ultimoError;
  if (/correo no configurado/i.test(e)) return falla('sin_configurar');
  if (/^ambiguo:/i.test(e) || /\b(timeout|ECONN\w*|ENOTFOUND|fetch failed)\b/i.test(e)) return falla('red');
  const http = /\bHTTP (\d{3})\b/.exec(e);
  const status = http ? Number(http[1]) : undefined;
  if (status === 401 || status === 403) return falla('sin_configurar');
  if (status !== undefined && (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500)) {
    return falla('reintentando');
  }
  if (/^rechazado:/i.test(e) || (status !== undefined && status >= 400)) return falla('correo_invalido');
  if (/sin confirmar/i.test(e)) return falla('sin_confirmar');
  return falla('interno');
}

/** `ana.prueba@ejemplo.test` -> `a***@ejemplo.test`. Para logs: nunca el correo completo. */
export function enmascararCorreoLog(correo: string): string {
  const i = correo.indexOf('@');
  if (i < 1) return '***';
  return `${correo[0]}***${correo.slice(i)}`;
}

/** Eventos de log del frente (nombres estables para buscar). */
export const EVENTOS_LOG_LIQCORREO = [
  'liqcorreo.enviada', 'liqcorreo.fallida', 'liqcorreo.rebotada',
  'liqpull.ok', 'liqpull.parcial', 'liqpull.fallo',
] as const;
export type EventoLogLiqcorreo = (typeof EVENTOS_LOG_LIQCORREO)[number];

/**
 * Campos de log permitidos para un evento de entrega: correo enmascarado, rol,
 * código estable. Sin importes, sin nombre de flota, sin cuerpo crudo.
 */
export function camposLogEntrega(e: { id: string; rol: string; correo: string; ultimoError?: string | null }):
  { entrega: string; rol: string; correo: string; codigo?: CodigoErrorCorreo } {
  const f = motivoDeFalloCorreo(e.ultimoError ?? null);
  return { entrega: e.id, rol: e.rol, correo: enmascararCorreoLog(e.correo), ...(f ? { codigo: f.codigo } : {}) };
}

export const PASADAS_FALLIDAS_PARA_ALERTAR = 3;

/** ¿Alertar al operador de Likida porque el pull falla N pasadas SEGUIDAS? `parcial` y `ok` rompen la racha. */
export function debeAlertarPull(
  historialReciente: ReadonlyArray<'ok' | 'parcial' | 'fallo'>,
  n: number = PASADAS_FALLIDAS_PARA_ALERTAR,
): boolean {
  if (!Number.isInteger(n) || n < 1) return false;
  if (historialReciente.length < n) return false;
  return historialReciente.slice(-n).every((x) => x === 'fallo');
}

/** ¿Alertar por rebotes? Estrictamente mayor que el umbral configurable (umbral <= 0 o inválido = sin alerta). */
export function debeAlertarRebotes(rebotadas: number, umbral: number): boolean {
  if (!Number.isFinite(umbral) || umbral <= 0) return false;
  return rebotadas > umbral;
}
