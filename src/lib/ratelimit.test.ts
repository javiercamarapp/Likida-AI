import { describe, it, expect } from 'vitest';
import { rateLimit, bodyExcede } from './ratelimit';

describe('rateLimit', () => {
  it('permite hasta el límite y luego bloquea', () => {
    const k = 'unit-key-A';
    for (let i = 0; i < 3; i++) expect(rateLimit(k, 3, 60_000)).toBe(true);
    expect(rateLimit(k, 3, 60_000)).toBe(false); // 4to → bloqueado
  });
  it('llaves distintas no interfieren', () => {
    expect(rateLimit('unit-key-B', 1, 60_000)).toBe(true);
    expect(rateLimit('unit-key-C', 1, 60_000)).toBe(true);
    expect(rateLimit('unit-key-B', 1, 60_000)).toBe(false);
  });
});

describe('bodyExcede', () => {
  it('detecta cuerpo grande por content-length', () => {
    const big = new Request('http://x', { method: 'POST', headers: { 'content-length': '999999' } });
    const small = new Request('http://x', { method: 'POST', headers: { 'content-length': '100' } });
    expect(bodyExcede(big, 1000)).toBe(true);
    expect(bodyExcede(small, 1000)).toBe(false);
  });
});
