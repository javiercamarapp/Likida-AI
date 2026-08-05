import { describe, it, expect } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL BUG DE `cc2d6b8`, CERRADO PARA TODA LA CLASE, NO SOLO PARA UN MODELO.
//
// `FALLBACK` se indexa por slug: `FALLBACK[model] ?? null` da `null` en
// silencio para cualquier modelo AISLADO — ni tiene su propia entrada en
// `FALLBACK`, ni es el destino de la de otro modelo (esos ya son el plan B
// de alguien y ahí la cadena termina a propósito). Pasó el 4-ago-2026 con
// `google/gemini-3.1-flash-lite` —el modelo que YA corre en producción vía
// `CUADRA_MODEL_OCR`— y el mismo commit (`53492a3`) dejó otros tres modelos
// igual de aislados sin que hoy sean el override activo:
// `google/gemini-2.5-flash-lite`, `google/gemini-2.5-flash`,
// `google/gemini-3-flash-preview`.
//
// Arreglar uno a la vez deja el mismo bug dormido en el próximo modelo que se
// pruebe por variable de entorno. Esta prueba enumera TODA `PRICES` y falla
// si algún slug queda aislado de la red de respaldo — así el hueco se cierra
// una vez, no modelo por modelo. No exige que CADA modelo tenga su propia
// entrada: `anthropic/claude-haiku-4.5`, `openai/gpt-5.6-luna` y
// `openai/gpt-5.6-terra` nunca son el default de ningún rol (ver
// `models.ts`), solo el destino al que otros caen — encadenar un fallback
// de su fallback no tiene fin, y no es el bug que esto vigila.
// ═══════════════════════════════════════════════════════════════════════════
process.env.OPENROUTER_API_KEY = 'test-key';
const { modelosAisladosDeFallback } = await import('./openrouter');

describe('FALLBACK cubre a todos los modelos de PRICES', () => {
  it('ningún modelo con precio queda aislado de la red de respaldo cross-provider', () => {
    expect(modelosAisladosDeFallback()).toEqual([]);
  });
});
