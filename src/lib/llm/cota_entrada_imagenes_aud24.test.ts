// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-5 — `cotaEntradaEnTokens` (openrouter.ts:497-508) tiene que
// cargar `TOKENS_POR_IMAGEN` por cada `image_url` con data-URL: sin ese
// término, la reserva atómica de presupuesto (`reservar_presupuesto_llm`,
// mig. 0244) mide el OCR de una foto por caracteres de texto — casi nada — y
// dejaría pasar llamadas que en el `settle` rebasan el techo diario.
//
// La mutación M7 elimina `+ imagenes * TOKENS_POR_IMAGEN` y ninguna prueba
// existente lo nota: `generate_structured_imagen_budget.test.ts` solo afirma
// un mínimo (`p_reserva_usd > 0.01`) con 40,000 caracteres de TEXTO, no la
// diferencia con/sin imagen. Esta prueba llama a `cotaEntradaEnTokens`
// directo (está exportada) y compara con/sin data-URL.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cotaEntradaEnTokens } from './openrouter';

const TOKENS_POR_IMAGEN = 4_000;

const mensajesSinImagen = [{ role: 'user', content: 'hola' }];
const dataUrl = `data:image/jpeg;base64,${'A'.repeat(100)}`;
const mensajesConImagen = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'hola' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  },
];

describe('PRU-5: cotaEntradaEnTokens carga TOKENS_POR_IMAGEN por cada foto', () => {
  it('una imagen pesa exactamente TOKENS_POR_IMAGEN más que el MISMO mensaje sin data-URL', () => {
    // Misma forma exacta en ambos lados (mismas llaves, mismo largo de texto);
    // la única diferencia es que un `url` empieza con `data:` y el otro no.
    // Así la comparación aísla el término `imagenes * TOKENS_POR_IMAGEN` sin
    // que un cambio de forma del JSON contamine la resta.
    const conImagen = cotaEntradaEnTokens(mensajesConImagen);
    const sinImagenMismaForma = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'hola' },
          { type: 'image_url', image_url: { url: '' } },
        ],
      },
    ];
    const sinImagen = cotaEntradaEnTokens(sinImagenMismaForma);
    expect(conImagen - sinImagen).toBe(TOKENS_POR_IMAGEN);
  });

  it('dos imágenes en el mismo mensaje pesan 2×TOKENS_POR_IMAGEN', () => {
    const dosImagenes = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: dataUrl } },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ];
    const mismaFormaSinDataUrl = [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: '' } },
          { type: 'image_url', image_url: { url: '' } },
        ],
      },
    ];
    const base = cotaEntradaEnTokens(mismaFormaSinDataUrl);
    expect(cotaEntradaEnTokens(dosImagenes) - base).toBe(2 * TOKENS_POR_IMAGEN);
  });

  it('sin ninguna imagen, la cota es simplemente el largo serializado (sin cargo extra)', () => {
    expect(cotaEntradaEnTokens(mensajesSinImagen)).toBe(JSON.stringify(mensajesSinImagen).length);
  });
});
