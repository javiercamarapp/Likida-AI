// ═══════════════════════════════════════════════════════════════════════════
// LLAVE DEL PROVEEDOR CAÍDA: ALERTA AL PRIMER FALLO + CIRCUITO + SONDA (CT-IA-05).
//
// HECHO: la llave de OpenRouter estuvo muerta del 18 al 23 de octubre (401) sin
// que nadie lo supiera. `esFalloDeCredencial` ya cortaba los reintentos, pero
// nadie AVISABA, y cada mensaje seguía gastando una ida a la red para recibir
// el mismo 401.
//
// Aquí, para los tres caminos (`generateResponse`, `generateStructured`,
// `generateWithTools`; todos pasan por `conBreaker`):
//   1. El PRIMER 401/402/403 avisa al operador (clase: llave inválida / sin
//      saldo / sin permiso), con el piso por hora de `alertarOperador`.
//   2. Un 401/402 REPETIDO dentro de la ventana abre el circuito de credencial:
//      las llamadas siguientes fallan al instante (sin red) con un error que
//      `esFalloDeCredencial` reconoce, o sea, el llamador degrada igual que
//      ante el 401 real. Pasado el lapso se deja pasar una sonda.
//      Un 403 NO abre el circuito: puede ser de UN modelo o de UNA petición
//      (moderación, modelo no permitido), no de toda la llave.
//   3. `sondearLlave` consulta GET /api/v1/key (sin costo, no genera tokens)
//      para saber el estado de la llave antes de que un usuario lo descubra; si
//      está bien, cierra el circuito.
//
// Por proceso a propósito (igual que el breaker): sin tabla. NUNCA lanza hacia
// el llamador por culpa del aviso. Sin llave NI secretos en mensajes ni logs.
// ═══════════════════════════════════════════════════════════════════════════

export const VENTANA_CREDENCIAL_MS = 60_000;
export const ABIERTO_CREDENCIAL_MS = 60_000;
export const FALLOS_PARA_ABRIR_CREDENCIAL = 2;

export type ClaseCredencial = 'llave_invalida' | 'sin_saldo' | 'sin_permiso';

/** PURA. 401/402/403 en el error o en su cadena de `.cause`; devuelve el status o null. */
export function statusDeCredencial(err: unknown): 401 | 402 | 403 | null {
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    const st = (cur as { status?: unknown }).status;
    if (st === 401 || st === 402 || st === 403) return st;
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

export function claseDeStatus(status: 401 | 402 | 403): ClaseCredencial {
  return status === 401 ? 'llave_invalida' : status === 402 ? 'sin_saldo' : 'sin_permiso';
}

const TEXTO: Record<ClaseCredencial, string> = {
  llave_invalida: 'OpenRouter rechazó la llave (401). Toda la IA está caída: el cuadre degrada y las fotos esperan. Rota o repón OPENROUTER_API_KEY.',
  sin_saldo: 'OpenRouter reporta saldo agotado o llave sin crédito (402). Toda la IA está caída. Recarga el saldo en el panel de OpenRouter.',
  sin_permiso: 'OpenRouter negó la petición (403). Puede ser un modelo no permitido o moderación; si se repite en todas las llamadas, revisa la llave.',
};

export class CredencialLlmCaidaError extends Error {
  /** Para que `esFalloDeCredencial` lo trate como lo que es: un 401/402 del proveedor. */
  status: number;
  constructor(public clase: ClaseCredencial, public reintentarEnMs: number, status: number) {
    super(`Circuito de credencial abierto (${clase}): la llave del proveedor falló; se omite la llamada (reintento en ${Math.ceil(reintentarEnMs / 1000)} s).`);
    this.name = 'CredencialLlmCaidaError';
    this.status = status;
  }
}

interface Estado { fallos: number[]; abiertoHasta: number; clase: ClaseCredencial | null; status: 401 | 402 | null; avisado: boolean }
const nuevo = (): Estado => ({ fallos: [], abiertoHasta: 0, clase: null, status: null, avisado: false });
let estado: Estado = nuevo();

export interface EstadoCredencial { abierto: boolean; clase: ClaseCredencial | null; reintentarEnMs: number; fallosEnVentana: number }

export function estadoCredencial(ahora: number = Date.now()): EstadoCredencial {
  return {
    abierto: estado.abiertoHasta > ahora, clase: estado.clase,
    reintentarEnMs: Math.max(0, estado.abiertoHasta - ahora),
    fallosEnVentana: estado.fallos.filter((t) => ahora - t < VENTANA_CREDENCIAL_MS).length,
  };
}

/** Lanza si el circuito de credencial está abierto. Llamar ANTES de reservar presupuesto. */
export function credencialVerificar(ahora: number = Date.now()): void {
  if (estado.abiertoHasta > ahora && estado.clase && estado.status) {
    throw new CredencialLlmCaidaError(estado.clase, estado.abiertoHasta - ahora, estado.status);
  }
}

export function credencialExito(): void {
  if (estado.avisado || estado.abiertoHasta || estado.fallos.length) estado = nuevo();
}

/** Aviso al operador, sin esperar y sin lanzar. Import dinámico: `alerta.ts` arrastra el correo. */
function avisar(clase: ClaseCredencial, status: number, origen: string): void {
  void (async () => {
    try {
      const { alertarOperador } = await import('@/lib/observability/alerta');
      await alertarOperador('llm.credencial_caida', { clase, status, origen, msg: TEXTO[clase] });
    } catch { /* el aviso nunca tumba la llamada */ }
  })();
}

/** Registra un fallo de la llamada. Devuelve la clase si era de credencial. */
export function credencialFallo(err: unknown, rol: string, ahora: number = Date.now()): ClaseCredencial | null {
  const status = statusDeCredencial(err);
  if (status === null) return null;
  const clase = claseDeStatus(status);
  if (!estado.avisado) { estado.avisado = true; avisar(clase, status, `rol:${rol}`); }
  if (status === 403) return clase;
  estado.fallos = [...estado.fallos.filter((t) => ahora - t < VENTANA_CREDENCIAL_MS), ahora];
  estado.clase = clase; estado.status = status;
  if (estado.fallos.length >= FALLOS_PARA_ABRIR_CREDENCIAL) { estado.abiertoHasta = ahora + ABIERTO_CREDENCIAL_MS; estado.fallos = []; }
  return clase;
}

export type EstadoLlave = 'ok' | 'llave_invalida' | 'sin_saldo' | 'sin_llave' | 'inalcanzable';
export interface ResultadoSonda { estado: EstadoLlave; status?: number; restanteUsd?: number | null }

/**
 * La sonda: GET /api/v1/key de OpenRouter (no genera tokens, no cuesta). `fetchFn` y `llave` son inyectables
 * para la prueba. Llave buena → cierra el circuito; mala → avisa y lo deja abierto para que las llamadas
 * no sigan golpeando la red. NUNCA lanza.
 */
export async function sondearLlave(
  fetchFn: typeof fetch = fetch, llave: string | undefined = process.env.OPENROUTER_API_KEY, ahora: number = Date.now(),
): Promise<ResultadoSonda> {
  if (!llave) { avisar('llave_invalida', 0, 'sonda:sin_llave'); return { estado: 'sin_llave' }; }
  try {
    const r = await fetchFn('https://openrouter.ai/api/v1/key', {
      method: 'GET', headers: { Authorization: `Bearer ${llave}` }, signal: AbortSignal.timeout(8_000),
    });
    if (r.status === 401 || r.status === 402 || r.status === 403) {
      const clase = claseDeStatus(r.status);
      credencialFallo({ status: r.status }, 'sonda', ahora);
      if (r.status !== 403) estado.abiertoHasta = Math.max(estado.abiertoHasta, ahora + ABIERTO_CREDENCIAL_MS);
      return { estado: clase === 'sin_saldo' ? 'sin_saldo' : 'llave_invalida', status: r.status };
    }
    if (!r.ok) return { estado: 'inalcanzable', status: r.status };
    let restante: number | null = null;
    try {
      const j = (await r.json()) as { data?: { limit_remaining?: unknown } };
      const v = j?.data?.limit_remaining;
      restante = typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch { /* cuerpo ilegible: la llave respondió 200, eso basta */ }
    if (restante !== null && restante <= 0) {
      credencialFallo({ status: 402 }, 'sonda', ahora);
      estado.abiertoHasta = Math.max(estado.abiertoHasta, ahora + ABIERTO_CREDENCIAL_MS);
      return { estado: 'sin_saldo', status: 200, restanteUsd: restante };
    }
    credencialExito();
    return { estado: 'ok', status: r.status, restanteUsd: restante };
  } catch {
    return { estado: 'inalcanzable' };
  }
}

/** Solo para pruebas. */
export function _reiniciarCredencial(): void { estado = nuevo(); }
