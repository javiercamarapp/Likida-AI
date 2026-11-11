import { describe, expect, it } from 'vitest';
import { atribucionDe, atribucionDeUrl, canalDe } from './atribucion';

describe('atribucionDeUrl', () => {
  it('toma utm_*, click id, referrer y ruta; descarta lo demás', () => {
    expect(atribucionDeUrl('?utm_source=instagram&utm_medium=social&x=1&fbclid=Z', 'https://l.instagram.com/', '/calculadora'))
      .toEqual({ utm_source: 'instagram', utm_medium: 'social', fbclid: 'Z', referrer: 'https://l.instagram.com/', ruta: '/calculadora' });
  });
  it('sin marcas devuelve null', () => {
    expect(atribucionDeUrl('', '', '')).toBeNull();
    expect(atribucionDeUrl('?otra=1')).toBeNull();
  });
  it('acota cada valor a 300 caracteres', () => {
    expect(atribucionDe({ utm_source: 'a'.repeat(500) })?.utm_source).toHaveLength(300);
  });
});

describe('canalDe', () => {
  it('mismo criterio que el formulario de la landing', () => {
    expect(canalDe(null)).toBe('landing');
    expect(canalDe({ fbclid: '1' })).toBe('ads-meta');
    expect(canalDe({ gclid: '1', utm_source: 'facebook' })).toBe('ads-google');
    expect(canalDe({ utm_source: 'YouTube' })).toBe('ads-google');
    expect(canalDe({ msclkid: '1' })).toBe('campana');
    expect(canalDe({ referrer: 'https://x', ruta: '/' })).toBe('landing');
  });
});
