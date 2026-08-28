// ═══════════════════════════════════════════════════════════════════════════
// REINTENTO DECLARADO PARA LA SATURACIÓN DE STORAGE — nunca un reintento mudo.
//
// EL INCIDENTE QUE LO PARIÓ (28-ago-2026, corrida 46ad99ca, medido en la base):
// 90 fotos por el carril completo de QA, 80 ok y 10 bad — y las 10 con EXACTA-
// MENTE el mismo error: «Too many connections issued to the database», cada
// fallo con una duración uniforme de ~2.3–2.5 s (el timeout de adquisición del
// pool de Storage API), repartidos por toda la corrida (fotos 4, 13, 17, 20 de
// la pasada 1; 56, 60, 71, 72, 78, 86 de la 2).
//
// LA CAUSA NO ERA EL CARRIL: el carril baja las fotos EN SERIE y con UN solo
// cliente (supabaseAdmin() es singleton). Era el panel: /api/admin/qa/<id>/
// estado firmaba la URL de las ~90 fotos UNA POR UNA en cada poll de ~2.5 s
// (medido en storage_logs: ráfagas de ~90 POST /object/sign en ~4 s, con polls
// traslapados), y cada /object/sign le cuesta a Storage API una conexión de su
// pool contra Postgres. El arreglo REAL es firmar en lote (`firmarRutas`, un
// solo request); este módulo es el segundo cinturón: cuando la saturación de
// todos modos ocurra (otro proceso, otro pico), un blip transitorio no debe
// costar un comprobante ni una foto 'bad'.
//
// LAS REGLAS DE ESTE REINTENTO, y las tres son deliberadas:
//   1. SOLO reintenta la firma de saturación (esSaturacionStorage). Un 404,
//      un bucket inexistente o un permiso negado fallan IGUAL en el segundo
//      intento: reintentarlos solo esconde el error real 1.6 s más.
//   2. Espera EXPONENCIAL (400 ms, 1 200 ms): darle aire al pool saturado es
//      el punto; martillarlo con reintentos inmediatos lo satura más.
//   3. Se DECLARA y se CUENTA: devuelve cuántos reintentos hizo y avisa por
//      `alReintentar` para que el llamador lo escriba donde se vea. Un
//      reintento que nadie ve es una saturación que nadie arregla.
//
// Los errores de supabase-js viajan POR VALOR (regla de la casa), así que el
// predicado mira el RESULTADO, no un throw. Lo que lance `fn` se propaga sin
// reintentar: un throw aquí es un bug o un timeout de `acotada`, no saturación.
// ═══════════════════════════════════════════════════════════════════════════

/** La firma del pool de Storage API saturado. Es el mensaje LITERAL que
 *  storage-api devuelve (statusCode 429) cuando no consigue conexión a la base
 *  del proyecto — el de las 10 fotos del 28-ago, verificado uno por uno. */
export function esSaturacionStorage(mensaje: string | null | undefined): boolean {
  return /too many connections/i.test(mensaje ?? '');
}

/** 2 reintentos = 3 intentos en total. Con la espera exponencial de abajo son
 *  ~1.6 s extra en el peor caso — cabe en la reserva por foto del carril
 *  (medida, no inventada) y en el presupuesto del intake. */
export const REINTENTOS_SATURACION_MAX = 2;

/** Primera espera; la n-ésima es base × 3ⁿ (400 → 1 200). El fallo medido del
 *  28-ago tardaba ~2.4 s en salir del lado de Storage: esperar menos que esto
 *  entre intentos sería reintentar contra el mismo pool aún lleno. */
export const ESPERA_BASE_SATURACION_MS = 400;

export interface Reintentado<T> {
  resultado: T;
  /** Cuántas veces se REPITIÓ el intento (0 = salió a la primera). El llamador
   *  lo escribe en su detalle/log: declarado, jamás mudo. */
  reintentos: number;
}

export interface OpcionesReintento {
  reintentosMax?: number;
  esperaBaseMs?: number;
  /** Inyectable para las pruebas (dormir de verdad en una suite de ~2 900
   *  pruebas sería pagar el backoff en cada corrida de CI). */
  dormir?: (ms: number) => Promise<void>;
  /** Se llama ANTES de cada espera: es el gancho para que el llamador declare
   *  el reintento en su log con su propio contexto (foto, viaje, ruta). */
  alReintentar?: (intento: number, esperaMs: number) => void;
}

const dormirDeVerdad = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/**
 * Ejecuta `fn` y reintenta —con espera exponencial y declarándolo— mientras
 * `esTransitorio(resultado)` diga que el fallo es de los que se curan solos.
 * Devuelve el ÚLTIMO resultado (éxito o el fallo final) y cuántos reintentos
 * costó: el llamador decide qué hacer con el fallo, este módulo solo garantiza
 * que no fue por un blip y que quedó contado.
 */
export async function conReintentoDeSaturacion<T>(
  fn: () => Promise<T>,
  esTransitorio: (resultado: T) => boolean,
  opciones: OpcionesReintento = {},
): Promise<Reintentado<T>> {
  const max = opciones.reintentosMax ?? REINTENTOS_SATURACION_MAX;
  const base = opciones.esperaBaseMs ?? ESPERA_BASE_SATURACION_MS;
  const dormir = opciones.dormir ?? dormirDeVerdad;

  let resultado = await fn();
  let reintentos = 0;
  while (reintentos < max && esTransitorio(resultado)) {
    const esperaMs = base * 3 ** reintentos;
    opciones.alReintentar?.(reintentos + 1, esperaMs);
    await dormir(esperaMs);
    resultado = await fn();
    reintentos += 1;
  }
  return { resultado, reintentos };
}
