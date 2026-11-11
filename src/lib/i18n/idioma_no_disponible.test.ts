import { describe, expect, it } from 'vitest';
import { idiomaServible } from './idioma';

// Con el inglés sin traducción completa, una cookie o preferencia 'en' guardada antes NO sirve un inglés a medias.
describe('idiomaServible', () => {
  it('con el inglés no disponible, sirve español aunque se haya elegido inglés', () => {
    expect(idiomaServible('en', false)).toBe('es');
    expect(idiomaServible('es', false)).toBe('es');
  });
  it('con el inglés disponible, la elección vale', () => {
    expect(idiomaServible('en', true)).toBe('en');
  });
});
