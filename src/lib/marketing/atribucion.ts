// ═══════════════════════════════════════════════════════════════════════════
// ATRIBUCIÓN DE UN LEAD — de dónde llegó. La comparten `/api/lead` (el formulario de la landing) y
// `/api/marketing/prospecto` (la calculadora): antes la calculadora fijaba `'landing'` y todo lead pagado que pasaba
// por ella se contaba como orgánico (F16, LOOPRELIEF #2). Vive aquí y no en una ruta porque Next valida los exports
// de un `route.ts`.
// ═══════════════════════════════════════════════════════════════════════════

/** Lo único que se guarda de la URL. Lo que no está aquí se descarta. */
export const CLAVES_ATRIBUCION = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'fbclid', 'gclid', 'msclkid', 'referrer', 'ruta',
] as const;

/** Texto de formulario: se recorta y se acota. `''` cuenta como ausente. */
export function textoAcotado(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t.length ? t : null;
}

/** Se queda solo con las claves conocidas, ya recortadas. `{}` → null. */
export function atribucionDe(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const src = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of CLAVES_ATRIBUCION) {
    const t = textoAcotado(src[k], 300);
    if (t) out[k] = t;
  }
  return Object.keys(out).length ? out : null;
}

/** Las claves de atribución presentes en una query string (`?utm_source=…`), más el referrer y la ruta. Para el cliente. */
export function atribucionDeUrl(search: string, referrer = '', ruta = ''): Record<string, string> | null {
  const q = new URLSearchParams(search);
  const crudo: Record<string, string> = {};
  for (const k of CLAVES_ATRIBUCION) {
    const v = q.get(k);
    if (v) crudo[k] = v;
  }
  if (referrer) crudo.referrer = referrer;
  if (ruta) crudo.ruta = ruta;
  return atribucionDe(crudo);
}

export type CanalLead = 'landing' | 'ads-meta' | 'ads-google' | 'campana';

/**
 * EL CANAL, que es lo que se agrupa en el tablero de adquisición.
 *
 * `fuente` se mantiene como un conjunto CHICO Y CERRADO a propósito: si cada `utm_source` inventara su propio valor, la
 * gráfica de adquisición se fragmentaría en cincuenta rebanadas de una fila y dejaría de contestar "¿de dónde vienen
 * mis prospectos?". El detalle fino vive en `atribucion`.
 *
 * Un `fbclid`/`gclid` es prueba dura de clic pagado —lo pega la plataforma, no el que armó la URL—, así que manda sobre
 * el `utm_source`, que cualquiera puede escribir a mano.
 */
export function canalDe(atr: Record<string, string> | null): CanalLead {
  if (!atr) return 'landing';
  // Los click id PRIMERO, los dos, antes de mirar un solo utm_*. Mezclados en el mismo `if` que el texto, un `gclid` que
  // llegara con `utm_source=facebook` —una URL mal armada, o armada a propósito— se contaría como Meta.
  if (atr.fbclid) return 'ads-meta';
  if (atr.gclid) return 'ads-google';
  const s = (atr.utm_source ?? '').toLowerCase();
  if (/facebook|instagram|meta|\bfb\b/.test(s)) return 'ads-meta';
  if (/google|youtube|adwords/.test(s)) return 'ads-google';
  // Trae marcas de campaña pero no se sabe de quién: 'campana', no 'ads'. Decir "ads" de un correo etiquetado con utm
  // sería inventar un gasto.
  if (atr.utm_source || atr.utm_campaign || atr.msclkid) return 'campana';
  return 'landing';
}
