// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT BREAKER DEL CAMINO LLM (A37-L-06) — por proceso y por rol.
//
// Con OpenRouter degradado SIN 5xx (solo lento), cada mensaje consumía 30-90 s
// de timeouts apilados y el fallback —que sale por el MISMO gateway— no llegaba
// a tiempo: la invocación se agotaba antes de degradar y Meta (que ya recibió su
// 200) no reintenta. Aquí, tras UMBRAL_FALLOS timeouts/caídas seguidos dentro de
// la VENTANA, el rol queda «abierto» ABIERTO_MS: las llamadas siguientes fallan
// AL INSTANTE con un error transitorio y el llamador salta directo a su
// degradado (cuadre determinístico, etc.). Pasado ese lapso se deja pasar una
// sonda: si sale bien se cierra; si falla, se vuelve a abrir.
//
// Memoria por proceso a propósito: sin tabla ni migración. En serverless cada
// instancia aprende por su cuenta, y eso basta para no apilar timeouts.
// Módulo PURO (sin imports): lo prueban sin red.
// ═══════════════════════════════════════════════════════════════════════════

export const UMBRAL_FALLOS = 3;
export const VENTANA_MS = 60_000;
export const ABIERTO_MS = 45_000;

interface EstadoRol { fallos: number[]; abiertoHasta: number }
const estados = new Map<string, EstadoRol>();

export class CircuitoLlmAbiertoError extends Error {
  constructor(public rol: string, public reintentarEnMs: number) {
    super(`Circuit breaker abierto para el rol «${rol}»: el proveedor del modelo no contesta; se omite la llamada (reintento en ${Math.ceil(reintentarEnMs / 1000)} s).`);
    this.name = 'CircuitoLlmAbiertoError';
  }
}

/** Solo cuentan los fallos que indican un proveedor lento o caído (timeout,
 *  conexión, 5xx). Un 401/402, un 429, un abort propio o un JSON malo NO. */
export function esFalloDeProveedor(err: unknown): boolean {
  const e = err as { name?: unknown; status?: unknown; cause?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.name === 'APIUserAbortError' || e.name === 'AbortError' || e.name === 'CircuitoLlmAbiertoError') return false;
  if (typeof e.name === 'string' && /^APIConnection(Timeout)?Error$/.test(e.name)) return true;
  if (typeof e.status === 'number') return e.status >= 500 || e.status === 408;
  const t = [err, e.cause].map((x) => (x instanceof Error ? x.message : '')).join(' ').toLowerCase();
  return /timeout|timed out|fetch failed|econnreset|enotfound|connection error/.test(t);
}

/** Solo el TIMEOUT (la petición salió y el proveedor no contestó a tiempo). */
export function esTimeoutDeProveedor(err: unknown): boolean {
  const e = err as { name?: unknown; cause?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  if (e.name === 'APIConnectionTimeoutError') return true;
  const t = [err, e.cause].map((x) => (x instanceof Error ? x.message : '')).join(' ').toLowerCase();
  return /timeout|timed out/.test(t);
}

/** Lanza si el rol está abierto. Llamar ANTES de reservar presupuesto. */
export function breakerVerificar(rol: string, ahora: number = Date.now()): void {
  const s = estados.get(rol);
  if (s && s.abiertoHasta > ahora) throw new CircuitoLlmAbiertoError(rol, s.abiertoHasta - ahora);
}

export function breakerExito(rol: string): void {
  estados.delete(rol);
}

export function breakerFallo(rol: string, err: unknown, ahora: number = Date.now()): void {
  if (!esFalloDeProveedor(err)) return;
  const s = estados.get(rol) ?? { fallos: [], abiertoHasta: 0 };
  s.fallos = [...s.fallos.filter((t) => ahora - t < VENTANA_MS), ahora];
  if (s.fallos.length >= UMBRAL_FALLOS) { s.abiertoHasta = ahora + ABIERTO_MS; s.fallos = []; }
  estados.set(rol, s);
}

/** Envuelve UNA llamada de red al proveedor. */
export async function conBreaker<T>(rol: string, fn: () => PromiseLike<T>): Promise<T> {
  breakerVerificar(rol);
  try {
    const r = await fn();
    breakerExito(rol);
    return r;
  } catch (e) {
    breakerFallo(rol, e);
    throw e;
  }
}

/** Solo para pruebas. */
export function _reiniciarBreaker(): void { estados.clear(); }
