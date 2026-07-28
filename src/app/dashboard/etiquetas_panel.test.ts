import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { etiquetaConcepto } from '@/lib/cuadra/cuadre/engine';

// ═══════════════════════════════════════════════════════════════════════════
// EL PAPEL DECÍA "COMBUSTIBLE MAGNA" Y LA PANTALLA "DIÉSEL", DEL MISMO TICKET.
//
// Tercera vez que las etiquetas de concepto divergen (auditoría 5,
// arquitectura, ALTO 1). `etiquetas_sincronizadas.test.ts` comparaba el mapa
// literal del panel contra `label()` del motor —idénticos, verde— pero el PDF
// dejó de usar `label()`: usa `etiquetaConcepto`, que para combustible se salta
// el mapa entero y devuelve el producto impreso en el ticket. La rama que sí se
// ejecuta no la miraba ninguna assert.
//
// Este test mira la SALIDA, no la forma: la cadena que el panel pinta para un
// gasto tiene que ser la misma que el PDF imprime para ese mismo gasto. Por eso
// la única defensa posible es que las dos superficies llamen a la MISMA función
// con los MISMOS datos — y el dato que faltaba era `ocr_extra`, que el select
// del detalle no pedía (cubierto en `analytics.test.ts`).
// ═══════════════════════════════════════════════════════════════════════════

const fuentePanel = readFileSync(new URL('./[id]/page.tsx', import.meta.url), 'utf8');
const fuentePdf = readFileSync(new URL('../../lib/cuadra/liquidacion/pdf.ts', import.meta.url), 'utf8');

describe('el renglón del panel dice lo mismo que el renglón del PDF', () => {
  it('las dos superficies etiquetan con la función del motor, no con un mapa propio', () => {
    expect(fuentePdf, 'el PDF dejó de usar etiquetaConcepto').toContain('etiquetaConcepto(');
    expect(fuentePanel, 'el panel volvió a etiquetar con su mapa literal').toContain('etiquetaConcepto(');
  });

  it('el panel le pasa el `ocrExtra` del gasto, que es de donde sale el producto', () => {
    // Sin `ocrExtra` la llamada compila y devuelve "Combustible" a secas: el
    // fallo se vería en la sala, no aquí.
    expect(fuentePanel).toMatch(/etiquetaConcepto\([^)]*ocrExtra/);
  });

  it('un ticket de MAGNA no puede salir como "Diésel" en la pantalla', () => {
    // Importa por dinero, no por estética: el estímulo de IEPS es SOLO diésel
    // (LIF 20-A fr. IV). Etiquetar gasolina como diésel invita a acreditar algo
    // que no aplica.
    expect(etiquetaConcepto('diesel', { producto: 'MAGNA' })).toBe('Combustible Magna');
    expect(etiquetaConcepto('diesel', { producto: 'PLUS' })).toBe('Combustible Plus');
    expect(etiquetaConcepto('diesel', undefined)).toBe('Combustible');
    expect(etiquetaConcepto('diesel', { producto: 'DIESEL' })).toBe('Diésel');
  });
});
