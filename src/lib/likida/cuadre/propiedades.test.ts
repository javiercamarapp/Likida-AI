import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto, type CuadreInput } from './engine';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// PROPIEDADES DEL MOTOR DE CUADRE — paso 0.2 de la máquina de automejora.
//
// Property testing con PRNG SEMBRADO (mulberry32, el mismo del diseño de QA):
// cada propiedad se afirma sobre 200 entradas generadas, y una falla imprime
// la SEMILLA del caso — reproducible con solo volver a correr. Sin fast-check
// a propósito (una dependencia menos); si el generador se queda corto, el
// paso siguiente del plan es migrar estas mismas propiedades a fast-check.
//
// La regla de la casa aplica también aquí: los montos y folios salen del
// PRNG, jamás de "un número que se ve realista" a mano.
// ═══════════════════════════════════════════════════════════════════════════

function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const POLITICA: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 2500 },
  { concepto: 'caseta', topeMonto: 1000 },
  { concepto: 'factura', requiereCfdi: true },
];
const CONCEPTOS = ['diesel', 'caseta', 'comida', 'factura'] as const;
const RECEPTOR = 'REC010101AA1';

/** Un gasto determinístico a partir del PRNG del caso. */
function gastoAleatorio(rng: () => number, i: number): Gasto {
  const concepto = CONCEPTOS[Math.floor(rng() * CONCEPTOS.length)];
  const monto = Math.round(rng() * 5000 * 100) / 100;
  const conCfdi = rng() < 0.5;
  return {
    id: `g-${i}-${Math.floor(rng() * 1e9)}`,
    concepto,
    monto,
    ocrConfianza: 0.9 + rng() * 0.09,
    folio: `F${Math.floor(rng() * 100000)}`,
    ...(conCfdi ? { cfdiUuid: `uuid-${i}-${Math.floor(rng() * 1e9)}`, rfcReceptor: RECEPTOR } : {}),
  } as Gasto;
}

function casoAleatorio(semilla: number): CuadreInput {
  const rng = mulberry32(semilla);
  const n = 1 + Math.floor(rng() * 8);
  const gastos = Array.from({ length: n }, (_, i) => gastoAleatorio(rng, i));
  return {
    viajeId: `v-${semilla}`,
    anticipo: Math.round(rng() * 12000 * 100) / 100,
    politica: POLITICA,
    gastos,
  };
}

/** Fisher-Yates sembrado — la permutación también es reproducible. */
function permutar<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const CASOS = 200;

describe('propiedades del motor de cuadre (PRNG sembrado, 200 casos c/u)', () => {
  it('P1 · el ORDEN de los gastos no cambia el veredicto (permutación → mismo resultado)', () => {
    for (let s = 1; s <= CASOS; s++) {
      const caso = casoAleatorio(s);
      const base = cuadrarViaje(caso);
      const permutado = cuadrarViaje({ ...caso, gastos: permutar(caso.gastos, mulberry32(s + 7000)) });
      const resumen = (r: typeof base) => ({
        total: r.totalComprobado,
        diferencia: r.diferencia,
        estatus: r.estatus,
        tipos: r.diferencias.map((d) => d.tipo).sort(),
      });
      expect(resumen(permutado), `semilla ${s}`).toEqual(resumen(base));
    }
  });

  it('P2 · el comprobado ES la suma de los montos — ningún gasto se pierde ni se inventa', () => {
    for (let s = 1; s <= CASOS; s++) {
      const caso = casoAleatorio(s + 20000);
      const r = cuadrarViaje(caso);
      const suma = Math.round(caso.gastos.reduce((acc, g) => acc + g.monto, 0) * 100) / 100;
      expect(Math.abs(r.totalComprobado - suma), `semilla ${s + 20000}`).toBeLessThan(0.01);
    }
  });

  it('P3 · la diferencia cierra: anticipo − comprobado, con signo y centavos', () => {
    for (let s = 1; s <= CASOS; s++) {
      const caso = casoAleatorio(s + 40000);
      const r = cuadrarViaje(caso);
      expect(Math.abs(r.diferencia - (caso.anticipo - r.totalComprobado)), `semilla ${s + 40000}`).toBeLessThan(0.01);
    }
  });

  it('P4 · metamórfica: duplicar un gasto (folio+monto) SIEMPRE enciende `duplicado`', () => {
    for (let s = 1; s <= CASOS; s++) {
      const caso = casoAleatorio(s + 60000);
      const rng = mulberry32(s + 60000 + 500);
      const victima = caso.gastos[Math.floor(rng() * caso.gastos.length)];
      const clon: Gasto = { ...victima, id: `${victima.id}-clon` };
      const r = cuadrarViaje({ ...caso, gastos: [...caso.gastos, clon] });
      expect(r.diferencias.some((d) => d.tipo === 'duplicado'), `semilla ${s + 60000}`).toBe(true);
    }
  });

  it('P5 · pureza: dos corridas idénticas dan lo mismo y el input NO se muta', () => {
    for (let s = 1; s <= CASOS; s++) {
      const caso = casoAleatorio(s + 80000);
      const foto = JSON.stringify(caso);
      const a = cuadrarViaje(caso);
      const b = cuadrarViaje(caso);
      expect(JSON.stringify(b), `semilla ${s + 80000} (determinismo)`).toBe(JSON.stringify(a));
      expect(JSON.stringify(caso), `semilla ${s + 80000} (mutación del input)`).toBe(foto);
    }
  });
});
