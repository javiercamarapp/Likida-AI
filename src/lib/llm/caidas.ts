// ═══════════════════════════════════════════════════════════════════════════
// CAÍDAS DEL MODELO — nada cambia de modo ni de proveedor EN SILENCIO (T-A3-68).
//
// Dos clases de caída pasan por aquí:
//   · `modo_json`: el proveedor rechazó el esquema estricto (`response_format: json_schema`, HTTP 400) y la llamada se repitió
//     con `json_object` + el esquema dentro del prompt. La salida igual se valida con zod, del lado nuestro.
//   · `respaldo`: el modelo del rol falló (proveedor caído, 429, tiempo) y la llamada se hizo con el modelo de respaldo.
//
// Cada caída deja un log (`llm.caida`) y suma a un contador del proceso con su motivo. El contador es del proceso (se
// reinicia al desplegar); el rastro durable por documento vive en la bitácora (`escalada`) y en el `meta` de la extracción.
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from '@/lib/logger';

export type TipoCaida = 'modo_json' | 'respaldo';

export interface CaidaLlm {
  tipo: TipoCaida;
  rol: string;
  /** Modelo que falló. */
  de: string;
  /** Modelo (o modo) al que se cayó. En `modo_json` es el mismo modelo. */
  a: string;
  /** Código corto y estable del motivo (se cuenta por él). */
  motivo: 'esquema_estricto_rechazado' | 'modelo_sin_esquema_estricto' | 'proveedor_transitorio';
  /** Texto breve de la causa, sin contenido del documento. */
  detalle?: string;
}

/**
 * Modelos que el 16-oct-2026 respondieron HTTP 400 (INVALID_ARGUMENT) a TODAS las llamadas con el esquema estricto y sí
 * respondieron con `json_object` + el esquema en el prompt (prueba con modelos reales, 30 de 30). Se les pide `json_object`
 * desde la primera llamada, sin gastar un intento en el 400. Un modelo que no esté aquí y reciba el 400 se APRENDE (abajo).
 */
export const MODELOS_SIN_ESQUEMA_ESTRICTO: ReadonlySet<string> = new Set([
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.8-flash',
]);

/** A37-L-10: cuánto dura lo aprendido de un 400. Un 400 genérico («Provider returned error») puede ser transitorio; sin
 *  caducidad apagaba el esquema estricto de ese modelo en TODO el proceso hasta el siguiente cold start. La lista medida
 *  (arriba) no caduca; lo aprendido sí: pasado el plazo se reintenta el modo estricto y, si el 400 era real, se re-aprende. */
export const VIGENCIA_APRENDIDO_MS = 10 * 60 * 1000;

/** modelo → instante (ms) en que lo aprendido caduca. */
const aprendidos = new Map<string, number>();
const contadores = new Map<string, number>();

export const usaEsquemaEstricto = (modelo: string): boolean => {
  if (MODELOS_SIN_ESQUEMA_ESTRICTO.has(modelo)) return false;
  const vence = aprendidos.get(modelo);
  if (vence === undefined) return true;
  if (Date.now() >= vence) { aprendidos.delete(modelo); return true; }
  return false;
};
export const aprenderSinEsquemaEstricto = (modelo: string): void => { aprendidos.set(modelo, Date.now() + VIGENCIA_APRENDIDO_MS); };

/** ¿El proveedor rechazó el ESQUEMA (400 de argumento inválido) y no la autenticación ni el contenido? */
export function esErrorEsquemaRechazado(err: unknown): boolean {
  const e = err as { status?: unknown; message?: unknown; error?: unknown } | null;
  if (!e || typeof e !== 'object' || e.status !== 400) return false;
  const texto = [e.message, typeof e.error === 'string' ? e.error : JSON.stringify(e.error ?? '')].map((x) => (typeof x === 'string' ? x : '')).join(' ').toLowerCase();
  return /invalid[_ ]argument|response_format|json_schema|schema|provider returned error/.test(texto);
}

export function registrarCaida(c: CaidaLlm): void {
  const clave = `${c.tipo}:${c.motivo}:${c.de}`;
  contadores.set(clave, (contadores.get(clave) ?? 0) + 1);
  logger.warn('llm.caida', { ...c });
}

/** Copia del contador: `tipo:motivo:modelo` → veces. */
export function contadoresDeCaidas(): Record<string, number> { return Object.fromEntries(contadores); }

/** Solo para pruebas. */
export function reiniciarCaidas(): void { contadores.clear(); aprendidos.clear(); }
