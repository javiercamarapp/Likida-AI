// Rate limiting simple (ventana deslizante en memoria por instancia). Suficiente
// para el demo: un atacante golpea una instancia y queda limitado. Para escala
// multi-instancia, cambiar el backend a Upstash (ya en .env) sin tocar el API.
//
// El CAP DE BODY (abajo) es por-request y siempre aplica (defensa DoS principal).

const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000; // backstop de memoria

/** Devuelve true si la petición se PERMITE, false si excede el límite. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = buckets.get(key) ?? [];
  const vivos = prev.filter((t) => now - t < windowMs);
  if (vivos.length >= limit) {
    buckets.set(key, vivos);
    return false;
  }
  vivos.push(now);
  buckets.set(key, vivos);
  if (buckets.size > MAX_KEYS) {
    // poda simple: borrar el primer cuarto de las llaves más viejas
    let i = 0;
    for (const k of buckets.keys()) { buckets.delete(k); if (++i > MAX_KEYS / 4) break; }
  }
  return true;
}

/** IP del cliente desde las cabeceras de proxy (Vercel: x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return (xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip')) || 'desconocida';
}

/** true si el body excede el tope (por content-length), ANTES de leerlo. */
export function bodyExcede(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get('content-length') || 0);
  return len > maxBytes;
}
