import { describe, expect, it } from 'vitest';
import { PAYLOADS_HOSTILES } from '@/lib/pruebas/cargas_hostiles_csv';
import { celdaCsvSegura, filaCsvSegura, INICIO_FORMULA, neutralizarFormula } from './csv_seguro';

describe('neutralizarFormula', () => {
  it.each(PAYLOADS_HOSTILES)('antepone apóstrofo a %j', (p) => {
    const s = neutralizarFormula(p);
    expect(s.startsWith("'")).toBe(true);
    expect(INICIO_FORMULA.test(s)).toBe(false);
    expect(s.slice(1)).toBe(p);
  });
  it('no toca un número, aunque sea negativo (una nota de crédito sigue siendo número)', () => {
    expect(neutralizarFormula(-250.5)).toBe('-250.5');
    expect(neutralizarFormula(0)).toBe('0');
  });
  it('no toca texto inocuo ni vacío; null y undefined son celda vacía', () => {
    expect(neutralizarFormula('Diésel Pemex')).toBe('Diésel Pemex');
    expect(neutralizarFormula('')).toBe('');
    expect(neutralizarFormula(null)).toBe('');
    expect(neutralizarFormula(undefined)).toBe('');
  });
  it('un «=» o «-» en medio del texto no es fórmula', () => {
    expect(neutralizarFormula('A=B')).toBe('A=B');
    expect(neutralizarFormula('Monterrey - Saltillo')).toBe('Monterrey - Saltillo');
  });
  it('un texto con importe plano se respeta solo si se pide (numerosEnTexto); una fórmula nunca', () => {
    expect(neutralizarFormula('-12.50')).toBe("'-12.50");
    expect(neutralizarFormula('-12.50', { numerosEnTexto: true })).toBe('-12.50');
    expect(neutralizarFormula('-12.50+1', { numerosEnTexto: true })).toBe("'-12.50+1");
    expect(neutralizarFormula('=12', { numerosEnTexto: true })).toBe("'=12");
  });
});

describe('celdaCsvSegura / filaCsvSegura', () => {
  it('entrecomilla cuando hay separador, comillas o saltos y duplica las comillas', () => {
    expect(celdaCsvSegura('a,b')).toBe('"a,b"');
    expect(celdaCsvSegura('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(celdaCsvSegura('x\ny')).toBe('"x\ny"');
    expect(celdaCsvSegura('a;b', { separador: ';' })).toBe('"a;b"');
    expect(celdaCsvSegura('a;b')).toBe('a;b');
  });
  it('la carga hostil sale neutralizada Y bien entrecomillada', () => {
    expect(celdaCsvSegura('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(celdaCsvSegura('\t=1+1')).toBe("'\t=1+1");
  });
  it('siempreComillas entrecomilla todo, también lo neutralizado', () => {
    expect(celdaCsvSegura('=1', { siempreComillas: true })).toBe(`"'=1"`);
    expect(celdaCsvSegura(5, { siempreComillas: true })).toBe('"5"');
  });
  it('una fila une celdas seguras con el separador', () => {
    expect(filaCsvSegura(['V-1', '=2+2', -5, null, 'a,b'])).toBe(`V-1,'=2+2,-5,,"a,b"`);
    expect(filaCsvSegura(['a', '@x'], { separador: '\t' })).toBe("a\t'@x");
  });
});
