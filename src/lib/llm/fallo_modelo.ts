// ═══════════════════════════════════════════════════════════════════════════
// POR QUÉ FALLÓ UNA LLAMADA AL MODELO — clase + detalle corto y SEGURO.
//
// El investigador (`enriquecedor`) descartaba la excepción y dejaba en la
// bitácora un texto fijo («El modelo no pudo extraer el dossier.»): 127 fallos
// en 10 días y NADIE podía decir si era la llave, el crédito o el proveedor.
// Esto vuelve ese motivo diagnosticable sin filtrar nada:
//
//   · SOLO sale una clase de un vocabulario cerrado, un status HTTP y un
//     fragmento corto (≤ 80 caracteres) ya limpiado.
//   · NUNCA salen llaves, cabeceras ni cuerpos de respuesta: el SDK de OpenAI
//     a veces mete un fragmento de la llave en el mensaje del 401
//     («Incorrect API key provided: sk-or-…abcd»), así que todo token con pinta
//     de secreto se tapa ANTES de recortar.
//
// Módulo PURO y sin imports a propósito: lo usan pruebas que mockean el logger
// y el cliente del modelo, y no debe depender de ninguno de los dos.
// ═══════════════════════════════════════════════════════════════════════════

export type ClaseFalloModelo = 'auth' | 'credito' | 'limite' | 'modelo_no_disponible' | 'formato' | 'red' | 'desconocido';

export interface FalloModelo {
  clase: ClaseFalloModelo;
  /** Status HTTP si la excepción (o su cadena de `cause`) lo trae. */
  status: number | null;
  /** Detalle corto y limpio (≤ 80 caracteres) para la bitácora. */
  detalle: string;
  /** Mensaje de la excepción limpio y recortado a 200 caracteres, para el log. */
  mensaje: string;
}

/** Tapa lo que parezca secreto: llaves `sk-…`, `Bearer …`, cabeceras de
 *  autorización, pares `key=valor` y cualquier cadena larga sin espacios que
 *  mezcle letras y dígitos (un token). */
export function limpiarMensajeSeguro(texto: string): string {
  return texto
    .replace(/\bBearer\s+\S+/gi, 'Bearer [oculto]')
    .replace(/\b(authorization|api[-_ ]?key|x-api-key|token|secret)\s*[:=]\s*\S+/gi, '$1=[oculto]')
    .replace(/\bsk-[A-Za-z0-9_\-*.…]+/g, '[llave oculta]')
    .replace(/\b(?=[A-Za-z0-9_\-]*\d)(?=[A-Za-z0-9_\-]*[A-Za-z])[A-Za-z0-9_\-]{28,}\b/g, '[token oculto]')
    .replace(/\s+/g, ' ')
    .trim();
}

function statusDe(err: unknown): number | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const o = cur as { status?: unknown; statusCode?: unknown; cause?: unknown; response?: { status?: unknown } };
    for (const v of [o.status, o.statusCode, o.response?.status]) {
      const n = typeof v === 'string' ? Number(v) : v;
      if (typeof n === 'number' && Number.isInteger(n) && n >= 100 && n <= 599) return n;
    }
    cur = o.cause;
  }
  return null;
}

function textoDe(err: unknown): string {
  const partes: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur instanceof Error) partes.push(cur.message);
    else if (typeof cur === 'string') partes.push(cur);
    const code = (cur as { code?: unknown })?.code;
    if (typeof code === 'string') partes.push(code);
    cur = (cur as { cause?: unknown })?.cause;
  }
  return [...new Set(partes)].join(' · ');
}

function nombresDe(err: unknown): string[] {
  const out: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const n = (cur as { name?: unknown }).name;
    if (typeof n === 'string') out.push(n);
    cur = (cur as { cause?: unknown }).cause;
  }
  return out;
}

export function clasificarFalloModelo(err: unknown): FalloModelo {
  const status = statusDe(err);
  const bruto = textoDe(err);
  const mensaje = limpiarMensajeSeguro(bruto).slice(0, 200);
  const t = bruto.toLowerCase();
  const nombres = nombresDe(err);

  let clase: ClaseFalloModelo;
  if (status === 401 || status === 403 || /api[ _-]?key|unauthori[sz]ed|forbidden|invalid.{0,20}key|no auth|authentication|no está configurada|no esta configurada/.test(t)) {
    clase = 'auth';
  } else if (status === 402 || /insufficient|credit|billing|payment required|out of funds|balance/.test(t)) {
    clase = 'credito';
  } else if (status === 429 || /rate.?limit|too many requests/.test(t)) {
    clase = 'limite';
  } else if (status === 404 || /no endpoints found|model.{0,40}(not found|not available|unavailable|does not exist)|is not a valid model/.test(t)) {
    clase = 'modelo_no_disponible';
  } else if (nombres.some((n) => /^(Structured|Truncated)Error$/.test(n)) && /json parse|validaci[oó]n fall|truncad|finish_reason|length/.test(t)) {
    clase = 'formato';
  } else if (
    nombres.some((n) => /^APIConnection(Timeout)?Error$/.test(n)) ||
    (status !== null && (status >= 500 || status === 408)) ||
    /enotfound|econn|etimedout|eai_again|fetch failed|connection error|socket|timeout|timed out/.test(t)
  ) {
    clase = 'red';
  } else {
    clase = 'desconocido';
  }

  const detalle = status !== null
    ? `HTTP ${status}`
    : clase === 'desconocido'
      ? (mensaje.slice(0, 80) || 'sin detalle')
      : (mensaje.slice(0, 60) || 'sin detalle');
  return { clase, status, detalle, mensaje };
}
