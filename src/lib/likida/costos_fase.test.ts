import { describe, it, expect } from 'vitest';
import { faseDeModelo } from './costos';

// AUDITORÍA 18 · B18 — `faseDeModelo` sacaba el gasto del chat del universo que
// mira su propio tope: con LIKIDA_MODEL_CHAT=…opus… cada turno se archivaba
// como 'escalacion' y `gastoChatHoyUsd` (.eq('fase','chat')) sumaba $0 para
// siempre. La escalación es un concepto del CUADRE.
describe('faseDeModelo — la escalación solo existe desde el cuadre', () => {
  it('un cuadre en Opus es escalación (como siempre)', () => {
    expect(faseDeModelo('anthropic/claude-opus-5', 'cuadre')).toBe('escalacion');
    expect(faseDeModelo('anthropic/claude-sonnet-5', 'cuadre')).toBe('cuadre');
  });

  it('el chat en Opus SIGUE siendo chat: el tope diario lo tiene que ver', () => {
    expect(faseDeModelo('anthropic/claude-opus-5', 'chat')).toBe('chat');
  });

  it('ninguna otra fase se reclasifica por el slug', () => {
    for (const base of ['ocr', 'router', 'whatsapp'] as const) {
      expect(faseDeModelo('anthropic/claude-opus-5', base)).toBe(base);
    }
  });
});
