// ═══════════════════════════════════════════════════════════════════════════
// LÍMITE DE TASA — ventana deslizante EN MEMORIA DE CADA INSTANCIA.
//
// Lo que este módulo puede prometer, dicho sin adornos (la cabecera anterior
// prometía dos cosas que la auditoría 5 midió falsas):
//
//  · NO es un límite global. `buckets` vive en el proceso. En Vercel cada
//    instancia concurrente arranca con el suyo vacío, así que el techo real de
//    `acceso:` no es 10 intentos / 5 min: es 10 × (instancias que el atacante
//    consiga abrir en paralelo). Contra fuerza bruta distribuida esto ESTORBA,
//    no cierra. Lo que cierra es que el passcode no sea adivinable, y eso se
//    exige en `auth/passcode.ts`, no aquí.
//    Para un límite de verdad hace falta un backend compartido (Upstash, ya en
//    `.env`), y eso obliga a que `rateLimit` sea `async` — hoy no puede serlo
//    porque `src/app/acceso/page.tsx:20` la llama en un `if` síncrono y un
//    `Promise` ahí es siempre truthy: el límite quedaría apagado en silencio.
//
//  · El CAP DE BODY mira SOLO `content-length`. Una petición sin esa cabecera
//    (`Transfer-Encoding: chunked`) devuelve `false` = "cabe". Ver la nota de
//    `bodyExcede`.
// ═══════════════════════════════════════════════════════════════════════════

/** Sellos de tiempo vivos de una llave, y cuándo deja de importar la llave. */
type Cubeta = { sellos: number[]; expiraEn: number };

const buckets = new Map<string, Cubeta>();
const MAX_KEYS = 5000;              // backstop de memoria
const OBJETIVO_TRAS_PODA = Math.floor(MAX_KEYS * 0.75);

/** Devuelve true si la petición se PERMITE, false si excede el límite. */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const prev = buckets.get(key);
  const vivos = (prev?.sellos ?? []).filter((t) => now - t < windowMs);

  // La cubeta deja de decir nada cuando su sello más nuevo sale de la ventana.
  const guardar = (sellos: number[]) =>
    buckets.set(key, { sellos, expiraEn: (sellos.length ? Math.max(...sellos) : now) + windowMs });

  if (vivos.length >= limit) {
    guardar(vivos);
    return false;
  }
  vivos.push(now);
  guardar(vivos);

  if (buckets.size > MAX_KEYS) podar(now);
  return true;
}

/**
 * Poda por CADUCIDAD, no por orden de alta.
 *
 * La versión anterior borraba «el primer cuarto de las llaves» recorriendo el
 * Map, que conserva el orden de INSERCIÓN — y `set` sobre una llave existente no
 * la mueve al final. O sea: borraba las primeras que se vieron, estuvieran vivas
 * o no. Una llave bloqueada desde hace un minuto podía desaparecer (y con ella
 * su bloqueo) mientras se conservaban cinco mil cubetas ya caducadas.
 *
 * Ahora se tira primero lo que ya no dice nada, y solo si con eso no basta se
 * tira lo que caduca antes.
 */
function podar(now: number): void {
  for (const [k, c] of buckets) {
    if (c.expiraEn <= now) buckets.delete(k);
  }
  if (buckets.size <= MAX_KEYS) return;

  const porCaducidad = [...buckets.entries()].sort((a, b) => a[1].expiraEn - b[1].expiraEn);
  const sobran = buckets.size - OBJETIVO_TRAS_PODA;
  for (let i = 0; i < sobran; i++) buckets.delete(porCaducidad[i][0]);
}

/** Solo para pruebas: el Map es de módulo y se comparte entre casos. */
export function reiniciarLimites(): void {
  buckets.clear();
}

/** IP del cliente desde las cabeceras de proxy (Vercel: x-forwarded-for). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  return (xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip')) || 'desconocida';
}

/**
 * true si el body excede el tope SEGÚN `content-length`, ANTES de leerlo.
 *
 * OJO CON LO QUE ESTO NO ES. Sin `content-length` —`Transfer-Encoding: chunked`—
 * `Number(null || 0)` da 0 y esta función dice "cabe". No es un descuido que se
 * pueda arreglar aquí: la cabecera es lo único que hay antes de leer el cuerpo.
 * Quien llame a esto TIENE que volver a medir después de leer, como hace
 * `webhook/whatsapp/route.ts:44` con `raw.length`. `api/demo/route.ts:30` no lo
 * hace, así que ahí el tope de 64 KB es el de la plataforma, no el de aquí.
 */
export function bodyExcede(req: Request, maxBytes: number): boolean {
  const len = Number(req.headers.get('content-length') || 0);
  return len > maxBytes;
}
