import { describe, it, expect } from 'vitest';
import { importeDeNota } from './importe_nota';

describe('A37-S15-09 importeDeNota', () => {
  it.each([['1234,50'], ['1234,5'], ['12,50'], ['1,234,50']])('rechaza la coma decimal %s (no la lee como 100 veces más)', (t) => {
    expect(importeDeNota(t).ok).toBe(false);
  });
  it.each([['1234.50', 1234.5], ['1,234.50', 1234.5], ['$ 12,345', 12345], ['1,234,567.89', 1234567.89], ['500', 500]])('acepta %s', (t, v) => {
    expect(importeDeNota(t)).toEqual({ ok: true, monto: v });
  });
  it('basura no es número', () => { expect(importeDeNota('abc').ok).toBe(false); });
});
