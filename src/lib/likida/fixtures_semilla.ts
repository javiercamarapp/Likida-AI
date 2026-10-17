// Generador determinista para fixtures sintéticos (convención: docs/operacion/fixtures-sinteticos.md).
// Misma semilla => misma secuencia, en cualquier máquina y orden de pruebas.
// Sin Math.random ni Date.now: un fixture que cambia entre corridas no es un fixture.

/** PRNG mulberry32: devuelve una función que produce números en [0, 1). */
export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneradorFixture {
  /** Entero en [min, max] (ambos incluidos). */
  entero(min: number, max: number): number;
  /** Importe con 2 decimales en [min, max]. */
  importe(min: number, max: number): number;
  /** Unidad inventada `TC` + 4 dígitos en el rango 9000–9999. */
  unidad(): string;
  /** Teléfono sintético de 10 dígitos con la marca `28999`. */
  telefono(): string;
  /** Correo sintético en el dominio reservado `.invalid`. */
  correo(prefijo?: string): string;
  /** Elemento al azar de una lista no vacía. */
  elegir<T>(lista: readonly T[]): T;
}

export function generadorFixture(semilla: number): GeneradorFixture {
  const azar = mulberry32(semilla);
  const entero = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));
  return {
    entero,
    importe: (min, max) => Math.round((min + azar() * (max - min)) * 100) / 100,
    unidad: () => `TC${entero(9000, 9999)}`,
    telefono: () => `28999${String(entero(0, 99999)).padStart(5, '0')}`,
    correo: (prefijo = 'usuario') => `${prefijo}${entero(1, 999)}@demo.invalid`,
    elegir: (lista) => lista[entero(0, lista.length - 1)],
  };
}
