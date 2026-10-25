import { describe, expect, it } from 'vitest';
import { CampoInvalido, texto } from './campos_cuerpo';

describe('A37-S64-09: texto() no convierte enteros no seguros en folios imprecisos', () => {
  it('rechaza un folio numérico mayor a 2^53 y pide mandarlo como texto', () => {
    expect(() => texto({ folio: 1234567890123456789 }, 'folio', { max: 40 })).toThrow(CampoInvalido);
    expect(() => texto({ folio: 1234567890123456789 }, 'folio', { max: 40 })).toThrow(/como texto/);
  });
  it('el mismo folio como string conserva todos los dígitos', () => {
    expect(texto({ folio: '1234567890123456789' }, 'folio', { max: 40 })).toBe('1234567890123456789');
  });
  it('los números seguros siguen valiendo como folio', () => {
    expect(texto({ folio: 9007199254740991 }, 'folio', { max: 40 })).toBe('9007199254740991');
    expect(texto({ folio: 8801 }, 'folio', { max: 40 })).toBe('8801');
  });
});
