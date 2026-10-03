// ═══════════════════════════════════════════════════════════════════════════
// MEDIR UNA RUTA (E1-A, E18) — el envoltorio que deja la latencia de una ruta
// en `latencia_muestra` (0700) SIN agregarle riesgo ni costo notable.
//
// Tres decisiones que lo hacen barato y acotado:
//
//  1. MUESTREO. Una ruta de alto tráfico (el webhook de WhatsApp, el chat)
//     escribiría una fila por petición. Aquí solo se escribe una de cada N
//     (`LIKIDA_LATENCIA_MUESTREO`, 0..1; por omisión 0.1 = una de cada diez).
//     El muestreo es UNIFORME — no se escribe «lo lento» a propósito: un
//     percentil calculado sobre muestras sesgadas hacia lo lento es mentira.
//  2. NOMBRES ESTÁTICOS. El nombre lo escribe el desarrollador en la ruta
//     (`webhook.whatsapp`), nunca sale de la URL ni de la petición: la
//     cardinalidad de la métrica no la puede inflar un visitante.
//  3. NUNCA TUMBA LA RUTA. Si medir falla, se loguea y se contesta igual. Y la
//     respuesta (o el error) de la ruta pasa intacta.
//
// Una ruta cuenta como `ok` si contestó menos de 500; si LANZA, se anota como
// fallo y la excepción se re-lanza sin tocarla.
// ═══════════════════════════════════════════════════════════════════════════

import { after } from 'next/server';
import { registrarLatencia } from '@/lib/admin/salud';

/** Tope de espera de la escritura cuando no hay `after()` disponible (fuera de una petición). */
export const TOPE_ESCRITURA_MS = 300;

/**
 * M1 (ronda 19): la escritura de la muestra NO va en el camino crítico de la respuesta. Con la base lenta (justo cuando
 * más pesa) un `await` aquí retrasaba el ack a Meta, el chat y la ingesta hasta ~9.5 s en el 10 % muestreado. Se lanza y
 * se entrega a `after()` (el proyecto ya lo usa en el webhook de WhatsApp): la respuesta sale y la función vive hasta que
 * termine. Fuera de una petición (`after` lanza) se espera como mucho `TOPE_ESCRITURA_MS`.
 */
function fueraDelCaminoCritico(escritura: Promise<void>): Promise<void> | undefined {
  try {
    after(() => escritura);
    return undefined;
  } catch {
    return new Promise<void>((listo) => {
      const t = setTimeout(listo, TOPE_ESCRITURA_MS);
      escritura.then(() => { clearTimeout(t); listo(); }, () => { clearTimeout(t); listo(); });
    });
  }
}

/** La proporción de peticiones que se miden. Un valor fuera de 0..1 o no numérico vuelve al default. */
export function tasaDeMuestreo(env: string | undefined = process.env.LIKIDA_LATENCIA_MUESTREO): number {
  // Bajo vitest no se escribe nada salvo que la prueba lo pida: una muestra al azar rompería el determinismo de los tests de rutas.
  if (env === undefined && process.env.NODE_ENV === 'test') return 0;
  const n = env === undefined || env.trim() === '' ? NaN : Number(env);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.1;
}

export interface OpcionesMedicion {
  /** Inyectable para probar: devuelve un número en [0,1). */
  azar?: () => number;
  /** Inyectable para probar: el reloj en ms. */
  reloj?: () => number;
  /** Inyectable para probar: dónde se escribe la muestra. */
  escribir?: (nombre: string, ms: number, ok: boolean) => Promise<void>;
  tasa?: number;
}

export async function medirRuta(
  nombre: string,
  trabajo: () => Promise<Response>,
  opciones: OpcionesMedicion = {},
): Promise<Response> {
  const reloj = opciones.reloj ?? Date.now;
  const azar = opciones.azar ?? Math.random;
  const escribir = opciones.escribir ?? ((n, ms, ok) => registrarLatencia('ruta', n, ms, ok));
  const tasa = opciones.tasa ?? tasaDeMuestreo();
  const muestrear = tasa > 0 && azar() < tasa;
  const t0 = reloj();
  let respuesta: Response;
  try {
    respuesta = await trabajo();
  } catch (e) {
    if (muestrear) await fueraDelCaminoCritico(escribir(nombre, reloj() - t0, false).catch(() => undefined));
    throw e;
  }
  if (muestrear) await fueraDelCaminoCritico(escribir(nombre, reloj() - t0, respuesta.status < 500).catch(() => undefined));
  return respuesta;
}
