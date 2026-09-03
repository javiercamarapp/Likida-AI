// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento ALTO línea 256 (REND-A4) — `COSTO_ESTIMADO_USD.liquidacion`
// se documentaba a sí mismo como "banda alta de la arquitectura" ($0.05), una
// estimación de diseño que la medición REAL del propio repo contradice 3×
// (`openrouter.ts:938-942`: 72,000 tokens de entrada por liquidación de 21
// comprobantes, con `anthropic/claude-sonnet-5`). Y de esa constante deriva
// `topeDerivadoDelPlan` (`budget.ts:235`) el freno diario de IA de cada flota.
//
// Esta prueba fija el piso: la constante no puede volver a caer por debajo de
// lo que la medición documentada en `openrouter.ts` sostiene, calculado aquí
// desde los MISMOS insumos citados ahí (72,000 tokens de entrada, precio real
// de `anthropic/claude-sonnet-5`, el rescate de caché limitado al system de
// ~1,560 tokens, y ~600 tokens de salida × 8 rondas) — no compara la
// constante consigo misma.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { COSTO_ESTIMADO_USD } from './models';

// Insumos citados textualmente en openrouter.ts:938-942 y el comentario de
// models.ts junto a LIQUIDACION_USD — no inventados aquí.
const TOKENS_ENTRADA_MEDIDOS = 72_000;
const TOKENS_SYSTEM_CACHEADO = 1_560;
const RONDAS = 8;
const TOKENS_SALIDA_POR_RONDA = 600;
const PRECIO_ENTRADA_SONNET_USD_POR_M = 2; // openrouter.ts PRICES['anthropic/claude-sonnet-5']
const PRECIO_SALIDA_SONNET_USD_POR_M = 10;
const DESCUENTO_CACHE = 0.9; // Anthropic cobra la lectura de caché al 10% (openrouter.ts:944)

describe('AUD25 rendimiento ALTO L256: COSTO_ESTIMADO_USD.liquidacion no está por debajo de lo medido', () => {
  it('la constante alcanza el costo calculado desde la medición documentada en openrouter.ts', () => {
    const entradaSola = (TOKENS_ENTRADA_MEDIDOS * PRECIO_ENTRADA_SONNET_USD_POR_M) / 1e6;
    // El rescate de caché cubre solo el system, y solo en las rondas 2-8.
    const rescateCache = ((RONDAS - 1) * TOKENS_SYSTEM_CACHEADO * DESCUENTO_CACHE * PRECIO_ENTRADA_SONNET_USD_POR_M) / 1e6;
    const entradaNeta = entradaSola - rescateCache;
    const salida = (TOKENS_SALIDA_POR_RONDA * RONDAS * PRECIO_SALIDA_SONNET_USD_POR_M) / 1e6;
    const costoMedido = entradaNeta + salida;

    // Control: el propio cálculo debe caer cerca de los ~$0.17 que el audit
    // documentó (no una constante inventada aquí).
    expect(costoMedido).toBeGreaterThan(0.15);
    expect(costoMedido).toBeLessThan(0.2);

    expect(COSTO_ESTIMADO_USD.liquidacion).toBeGreaterThanOrEqual(costoMedido);
  });

  it('viajeCompleto sigue derivándose de liquidacion + fotosPorViaje × comprobanteOcr', () => {
    const esperado = Number((COSTO_ESTIMADO_USD.liquidacion + COSTO_ESTIMADO_USD.fotosPorViaje * COSTO_ESTIMADO_USD.comprobanteOcr).toFixed(6));
    expect(COSTO_ESTIMADO_USD.viajeCompleto).toBe(esperado);
  });
});
