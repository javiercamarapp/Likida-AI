import { describe, it, expect } from 'vitest';
import { matrizDeCsvTexto, detectarSeparador, decodificarTexto, matrizDeCsv } from './csv';

describe('detectarSeparador — por el encabezado, no por el contenido', () => {
  it('coma, punto y coma, tab y pipe', () => {
    expect(detectarSeparador('a,b,c\n1,2,3')).toBe(',');
    expect(detectarSeparador('a;b;c\n1;2;3')).toBe(';');
    expect(detectarSeparador('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(detectarSeparador('a|b|c\n1|2|3')).toBe('|');
  });
  it('un «|» dentro de los datos NO le gana a la coma del encabezado', () => {
    expect(detectarSeparador('nombre,alias\nx,a|b|c|d|e\ny,f|g|h|i|j')).toBe(',');
  });
  it('saltos de línea iniciales vacíos y comillas en el encabezado', () => {
    expect(detectarSeparador('\n\n"a;b",c;d;e;f\n')).toBe(';');
  });
  it('sin separador → coma', () => {
    expect(detectarSeparador('solo')).toBe(',');
    expect(detectarSeparador('')).toBe(',');
  });
});

describe('matrizDeCsvTexto', () => {
  it('celdas siempre TEXTO: «189,50» con «;» no se vuelve número', () => {
    expect(matrizDeCsvTexto('a;b\n189,50;1.234,00')).toEqual([['a', 'b'], ['189,50', '1.234,00']]);
  });
  it('comillas, comillas escapadas, separador y salto de línea dentro de comillas', () => {
    expect(matrizDeCsvTexto('a,b\n"x, y","di ""hola""\nmundo"')).toEqual([['a', 'b'], ['x, y', 'di "hola"\nmundo']]);
  });
  it('CRLF, CR suelto y última línea sin salto', () => {
    expect(matrizDeCsvTexto('a,b\r\n1,2\r\n3,4')).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
    expect(matrizDeCsvTexto('a,b\r1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('celdas vacías al final se conservan', () => {
    expect(matrizDeCsvTexto('a,b,c\n1,,')).toEqual([['a', 'b', 'c'], ['1', '', '']]);
  });
  it('comilla sin cerrar no cuelga ni lanza', () => {
    expect(() => matrizDeCsvTexto('a,b\n"sin cerrar,2\n3,4')).not.toThrow();
  });
  it('vacío → sin filas', () => {
    expect(matrizDeCsvTexto('')).toEqual([]);
  });
  it('un archivo grande se lee rápido (100k celdas)', () => {
    const t = ['a,b,c,d,e'].concat(Array.from({ length: 20_000 }, (_, i) => `${i},x,y,z,w`)).join('\n');
    const t0 = Date.now();
    expect(matrizDeCsvTexto(t)).toHaveLength(20_001);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe('decodificarTexto', () => {
  it('UTF-8 con BOM', () => {
    expect(decodificarTexto(Buffer.from('﻿nombre'))).toBe('nombre');
  });
  it('latin1 cuando no es UTF-8 válido', () => {
    expect(decodificarTexto(Buffer.from('Peñón', 'latin1'))).toBe('Peñón');
  });
  it('UTF-8 válido con acentos se respeta', () => {
    expect(decodificarTexto(Buffer.from('Peñón', 'utf8'))).toBe('Peñón');
    expect(matrizDeCsv(Buffer.from('a\nPeñón'))).toEqual([['a'], ['Peñón']]);
  });
});
