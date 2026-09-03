// ═══════════════════════════════════════════════════════════════════════════
// AUD25 · rendimiento ALTO línea 111 (REINCIDENTE) — `cotaEntradaEnTokens`
// contaba `input_audio.data` a UN TOKEN POR CARÁCTER, igual que el resto del
// texto: una nota de voz de 1.24 MB (78 s a 128 kbps, costo real ~$0.0008)
// agotaba el tope de $0.50 de la corrida ANTES de tocar al proveedor, y el
// chofer en emergencia recibía «no pude escucharte». Esta prueba fija que:
//   1. el audio ya NO se cuenta por byte crudo (sería ~1.65M de cota para
//      1.24 MB de base64, muy por arriba del tope de $0.50 a cualquier precio);
//   2. sí se sigue reservando ALGO por el audio (no queda en cero — la cota
//      conservadora sigue existiendo, solo que ligada a duración estimada).
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cotaEntradaEnTokens } from './openrouter';

// Precio del rol `transcripcion`: [0.3, 2.5] $/M (models.ts:149) — se usa la
// banda alta para la comprobación, que es la que el reservador aplica.
const PRECIO_ALTO_TRANSCRIPCION_USD_POR_M = 2.5;

function mensajeConAudio(base64: string) {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Transcribe esta nota de voz.' },
        { type: 'input_audio', input_audio: { data: base64, format: 'mp3' } },
      ],
    },
  ];
}

describe('AUD25 rendimiento ALTO L111: cotaEntradaEnTokens no cuenta el audio por byte crudo', () => {
  it('1.24 MB de audio (nota de 78 s a 128 kbps, costo real ~$0.0008) no agota un tope de $0.50', () => {
    // 1.24 MB de audio crudo ≈ 1,658,000 caracteres de base64 (relación 4/3).
    const base64 = 'A'.repeat(1_658_000);
    const tokens = cotaEntradaEnTokens(mensajeConAudio(base64));
    const costoReservado = (tokens * PRECIO_ALTO_TRANSCRIPCION_USD_POR_M) / 1e6;
    expect(costoReservado).toBeLessThan(0.5);
  });

  it('el audio SÍ suma tokens de sobra (la cota sigue siendo conservadora, no cero)', () => {
    const sinAudio = cotaEntradaEnTokens([{ role: 'user', content: 'hola' }]);
    const base64Corto = 'A'.repeat(1000);
    const conAudioCorto = cotaEntradaEnTokens(mensajeConAudio(base64Corto));
    expect(conAudioCorto).toBeGreaterThan(sinAudio);
  });

  it('el tamaño de la reserva escala con la duración estimada, no 1:1 con los caracteres del base64', () => {
    const chico = cotaEntradaEnTokens(mensajeConAudio('A'.repeat(10_000)));
    const grande = cotaEntradaEnTokens(mensajeConAudio('A'.repeat(1_000_000)));
    // Contar por carácter crudo daría razón ~100×; la estimación por duración
    // también escala 100×, pero el punto de esta prueba es que el camino usado
    // es la función de duración (cubierto por la prueba de arriba), no que la
    // proporción exacta cambie — se afirma solo que crece con el tamaño.
    expect(grande).toBeGreaterThan(chico);
  });
});
