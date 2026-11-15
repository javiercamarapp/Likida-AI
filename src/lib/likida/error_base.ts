// ═══════════════════════════════════════════════════════════════════════════
// «NO PUDE PREGUNTAR» NO ES «LA RESPUESTA ES NO».
//
// Cuando Supabase cambia de cómputo o el borde (Cloudflare) devuelve un 5xx,
// supabase-js entrega como `error.message` la PÁGINA HTML completa y sin
// `code`. Dos consecuencias medidas el 14-nov-2026 (~19:00 UTC): el arranque
// afirmó «FALTA la migración 0132…» sin que faltara nada, y el aviso de
// interruptores pegó la página HTML entera en el correo al dueño.
//
// Este módulo decide, en un solo sitio, si un error significa «la base no
// contestó» (transitorio) y resume el texto para que un HTML nunca llegue a un
// log ni a un correo.
// ═══════════════════════════════════════════════════════════════════════════

interface ErrorDeBase { code?: string | null; message?: string | null; status?: number }

const RE_RED = /fetch failed|sin respuesta|tope de consulta|network|timeout|timed out|abort|ECONN|EAI_AGAIN|socket|UND_ERR/i;
const RE_HTML = /<\s*!doctype|<\s*html|<\s*head|<\s*body|cloudflare|bad gateway|gateway time-?out|service unavailable|web server is (down|returning)|error code 5\d\d/i;
/** Códigos que dicen «la base está ocupada o no está»: no dicen nada del esquema. */
const RE_CODIGO_TRANSITORIO = /^(57014|57P0[123]|53\d{3}|08\d{3}|40001|40P01|PGRST00[0-3])$/;

/** ¿El texto es una página HTML (respuesta de un proxy, no de PostgREST)? */
export function esRespuestaHtml(texto: unknown): boolean {
  return typeof texto === 'string' && RE_HTML.test(texto);
}

/** ¿El error dice «no pude preguntar» en vez de «eso no existe»? */
export function errorDeBaseSinRespuesta(error: ErrorDeBase): boolean {
  const codigo = error.code ?? '';
  if (codigo) return RE_CODIGO_TRANSITORIO.test(codigo);
  if (typeof error.status === 'number' && error.status >= 500) return true;
  const mensaje = error.message ?? '';
  return RE_RED.test(mensaje) || esRespuestaHtml(mensaje);
}

/** Texto corto y sin HTML para logs y correos. */
export function resumirErrorDeBase(mensaje: unknown, max = 200): string {
  const texto = typeof mensaje === 'string' ? mensaje : String(mensaje ?? '');
  if (esRespuestaHtml(texto)) {
    const titulo = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(texto)?.[1]?.trim();
    const codigo = /error code:?\s*(\d{3})|\b(5\d\d)\b/i.exec(texto);
    const num = codigo?.[1] ?? codigo?.[2];
    return `La base respondió con una página HTML del proxy${num ? ` (HTTP ${num})` : ''}${titulo ? `: ${titulo}` : ''}; no es una respuesta de la base.`;
  }
  return texto.length > max ? `${texto.slice(0, max)}…` : texto;
}
