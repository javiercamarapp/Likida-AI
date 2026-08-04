import { describe, it, expect } from 'vitest';
import { costoReal, calcCost } from './openrouter';

// ═══════════════════════════════════════════════════════════════════════════
// EL COSTO LO DICE EL PROVEEDOR, NO NUESTRA TABLA.
//
// `calcCost` multiplica tokens por tarifa de lista, y eso es CIEGO a todo lo que
// el proveedor descuenta. Medido el 4-ago-2026 contra OpenRouter, mismo system
// de 9,567 tokens tres veces seguidas:
//
//     llamada 1  cache_write_tokens 9567   cost $0.023970
//     llamada 2  cached_tokens      9567   cost $0.002002   (-92%)
//     llamada 3  cached_tokens      9567   cost $0.002002
//
// La tabla decía lo mismo en las tres. O sea que la caché de prompt del cuadre
// SÍ funcionaba y el contador no podía verla: se habría reportado "0% de ahorro"
// sobre una optimización que ahorra el 92%, y lo razonable habría sido
// revertirla. Un número que no puede bajar tampoco puede probar una mejora.
// ═══════════════════════════════════════════════════════════════════════════

const SONNET = 'anthropic/claude-sonnet-5';

describe('costoReal', () => {
  it('usa el costo del PROVEEDOR cuando viene, aunque no cuadre con la tabla', () => {
    // El caso de la caché: mismos tokens, costo real 12× menor.
    const conCache = costoReal({ cost: 0.002002 }, SONNET, 9567, 6);
    expect(conCache).toBe(0.002002);
    expect(conCache).toBeLessThan(calcCost(SONNET, 9567, 6));
  });

  it('cae a la tabla solo si el proveedor NO manda costo', () => {
    expect(costoReal(undefined, SONNET, 1000, 100)).toBe(calcCost(SONNET, 1000, 100));
    expect(costoReal({}, SONNET, 1000, 100)).toBe(calcCost(SONNET, 1000, 100));
  });

  it('un costo basura del proveedor no se cuela', () => {
    // NaN, negativo o no numérico → se recalcula. Un costo de $0 sí es válido
    // (modelos gratuitos), pero uno imposible no puede tumbar la contabilidad.
    expect(costoReal({ cost: NaN }, SONNET, 1000, 100)).toBe(calcCost(SONNET, 1000, 100));
    expect(costoReal({ cost: -1 }, SONNET, 1000, 100)).toBe(calcCost(SONNET, 1000, 100));
    expect(costoReal({ cost: 0 }, SONNET, 1000, 100)).toBe(0);
  });

  it('la petición pide el desglose de consumo — sin eso no llega el costo', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(fileURLToPath(new URL('./openrouter.ts', import.meta.url)), 'utf8');
    expect(src).toMatch(/usage:\s*\{\s*include:\s*true\s*\}/);
  });
});
