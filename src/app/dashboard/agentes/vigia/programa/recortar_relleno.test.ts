import { describe, it, expect } from 'vitest';
import { recortarRellenoCsv, TOPE_SUBIDA_BYTES } from './recortar_relleno';

describe('A39-A4-02 · recortar el relleno de `;` del programa de despacho', () => {
  it('quita los `;` finales de cada línea y conserva los de en medio', () => {
    expect(recortarRellenoCsv('a;b;;c;;;\r\n;;x;;\n;;;;\n1;;2;;;;')).toBe('a;b;;c\r\n;;x\n\n1;;2');
  });
  it('un archivo de 16,383 columnas casi vacías baja de tamaño en órdenes de magnitud y cabe en la subida', () => {
    const relleno = ';'.repeat(16_380);
    const filas = Array.from({ length: 300 }, (_, i) => `${i};CAJA${i};CLIENTE${relleno}`);
    const grande = filas.join('\n');
    expect(grande.length).toBeGreaterThan(4_000_000);
    const chico = recortarRellenoCsv(grande);
    expect(chico.length).toBeLessThan(TOPE_SUBIDA_BYTES / 20);
    expect(chico.split('\n')[5]).toBe('5;CAJA5;CLIENTE');
  });
  it('no toca lo que está entre comillas (ni un salto de línea ahí)', () => {
    expect(recortarRellenoCsv('a;"x;;\ny;;";;;\nb;;')).toBe('a;"x;;\ny;;"\nb');
  });
  it('texto sin relleno queda idéntico', () => {
    expect(recortarRellenoCsv('a;b\nc;d')).toBe('a;b\nc;d');
    expect(recortarRellenoCsv('')).toBe('');
  });
});
