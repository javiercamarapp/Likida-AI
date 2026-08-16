// ═══════════════════════════════════════════════════════════════════════════
// PRNG DETERMINÍSTICO del ejército de QA — mulberry32, sin dependencias.
//
// Regla dura del repo aplicada aquí: NUNCA inventar una cifra. Todo dato
// sintético de un escenario (monto, folio, fecha, texto) sale de este RNG
// sembrado — jamás de "un número que se ve realista" tecleado a mano.
//
// La semilla es sha256(fecha + nivel + agente + índice) → primeros 4 bytes,
// como especifica 00-DISENO-QA-AUTONOMO.md §7. Misma semilla → mismo
// escenario, byte a byte: si dos corridas con la misma semilla difieren, el
// hallazgo es la falta de determinismo del sistema bajo prueba, no ruido.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

/** Generador: cada llamada devuelve un float en [0, 1). */
export type Rng = () => number;

/** mulberry32 — PRNG de 32 bits, rápido y reproducible entre plataformas. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** sha256(texto) → uint32 (primeros 4 bytes). La semilla canónica del diseño. */
export function semillaDesde(texto: string): number {
  const h = createHash('sha256').update(texto).digest();
  return h.readUInt32BE(0);
}

/** Entero uniforme en [min, max] (ambos incluidos). */
export function entre(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Monto en pesos con centavos, uniforme en [min, max]. */
export function pesos(rng: Rng, min: number, max: number): number {
  return Math.round((rng() * (max - min) + min) * 100) / 100;
}

/** Un elemento del arreglo (no vacío). */
export function elemento<T>(rng: Rng, arr: readonly T[]): T {
  return arr[entre(rng, 0, arr.length - 1)];
}

/** Folio sintético obviamente ZZZ, derivado del RNG. */
export function folioSintetico(rng: Rng, prefijo: string): string {
  return `${prefijo}-${String(entre(rng, 100000, 999999))}`;
}

/** Fecha ISO (YYYY-MM-DD) desplazada `dias` respecto a `base`. */
export function fechaDesplazada(base: Date, dias: number): string {
  const d = new Date(base.getTime() + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}
