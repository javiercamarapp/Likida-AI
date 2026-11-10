import { describe, expect, it } from 'vitest';
import { emojis, medirEmojis, problemasDeTrinquete } from './medir';
import { BASE_EMOJIS } from './base';

// Guarda `sin_emojis_en_producto` (Fase 0, K3): el producto (src/app y src/lib, sin pruebas) no usa emoji. La interfaz usa iconos del
// sistema; los mensajes serios no llevan caritas. Base = lo medido hoy, por archivo; solo baja. Un archivo nuevo debe nacer sin emoji.
describe('sin_emojis_en_producto', () => {
  it('el detector marca emoji gráficos y no símbolos de texto', () => {
    expect(emojis('Listo \u{1F680}')).toBe(1);
    expect(emojis('Atención ⚠️')).toBe(1);
    expect(emojis('✅ hecho')).toBe(1);
    expect(emojis('Likida™ © → ✓ • —')).toBe(0);
  });
  it('ningún archivo suma emoji respecto de la base', () => {
    expect(problemasDeTrinquete(medirEmojis(), BASE_EMOJIS)).toEqual([]);
  });
});
