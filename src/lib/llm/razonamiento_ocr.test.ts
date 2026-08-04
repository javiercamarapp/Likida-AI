import { describe, it, expect, afterEach } from 'vitest';
import { calcCost } from './openrouter';

// ═══════════════════════════════════════════════════════════════════════════
// LA PALANCA DE COSTO DEL OCR, Y POR QUÉ VIENE APAGADA.
//
// MEDIDO el 4-ago-2026 sobre las 57 llamadas de OCR en producción: 4,076 tokens
// de entrada y 1,536 de SALIDA, con 51 de 57 entre 1,015 y 1,976 — una sola
// joroba. Si fueran reintentos habría grupos separados; no los hay. Es
// razonamiento del modelo, que se cobra como salida y a 5× el precio de la
// entrada.
//
// Este archivo fija la ARITMÉTICA del ahorro, no el interruptor: lo que no se
// puede probar sin tickets reales etiquetados es si apagarlo empeora la lectura,
// y en un documento fiscal un monto mal leído cuesta más que cualquier ahorro.
// ═══════════════════════════════════════════════════════════════════════════

const OCR = 'google/gemini-3.6-flash';

describe('de dónde sale el costo del OCR', () => {
  it('la salida domina: 1,536 tokens de salida cuestan más que 4,076 de entrada', () => {
    const entrada = calcCost(OCR, 4076, 0);
    const salida = calcCost(OCR, 0, 1536);
    expect(salida).toBeGreaterThan(entrada);
    // Y el total reproduce lo medido en producción ($0.0176 por llamada).
    expect(calcCost(OCR, 4076, 1536)).toBeCloseTo(0.0176, 4);
  });

  it('sin razonamiento el JSON son ~100 tokens y la llamada baja ~61%', () => {
    const hoy = calcCost(OCR, 4076, 1536);
    const sinRazonar = calcCost(OCR, 4076, 100);
    const ahorro = 1 - sinRazonar / hoy;
    expect(ahorro).toBeGreaterThan(0.55);
    expect(ahorro).toBeLessThan(0.70);
  });
});

describe('el interruptor', () => {
  afterEach(() => { delete process.env.LLM_RAZONAMIENTO_OCR; });

  it('SIN la variable no cambia nada — no se toca el OCR por accidente', async () => {
    // El default tiene que ser el comportamiento de hoy: encender esto sin haber
    // medido exactitud contra un conjunto dorado es cambiar dinero por riesgo.
    const { default: fs } = await import('node:fs');
    const src = fs.readFileSync(new URL('./openrouter.ts', import.meta.url), 'utf8');
    // El caso por defecto devuelve un objeto vacío (no manda `reasoning`).
    expect(src).toMatch(/function opcionesDeRazonamiento[\s\S]{0,600}return \{\};\s*\n\}/);
  });

  it('solo aplica al rol ocr, no al cuadre ni al chat', async () => {
    const { default: fs } = await import('node:fs');
    const src = fs.readFileSync(new URL('./openrouter.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(role !== 'ocr'\) return \{\};/);
  });
});
