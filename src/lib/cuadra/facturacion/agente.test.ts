import { describe, it, expect } from 'vitest';
import { pideCaptcha } from './agente';

describe('pideCaptcha — la señal que saca un ticket de la cola automática', () => {
  it('true SOLO cuando el portal lo pide', () => {
    expect(pideCaptcha({ requiereCaptcha: true })).toBe(true);
    expect(pideCaptcha({ requiereCaptcha: false })).toBe(false);
  });
  it('false si la respuesta no trae el campo (no se asume)', () => {
    expect(pideCaptcha({})).toBe(false);
  });
});
