import { describe, it, expect } from 'vitest';
import { resumenOmitidos } from './omitidos';
import type { Gasto } from '@/types/cuadra';

const g = (monto: number): Gasto => ({ id: Math.random().toString(36).slice(2), concepto: 'diesel', monto });

// El PDF cabe en una página y corta la lista de comprobantes con un `break`
// silencioso. El total impreso abajo sigue siendo el TOTAL COMPLETO, así que a
// partir de ~15 comprobantes los renglones impresos no suman el total impreso.
//
// Ese papel es el que se archiva y el que un contralor suma con calculadora
// enfrente de ti. Un documento que no cuadra consigo mismo destruye la
// credibilidad de todo lo demás, aunque la cifra de abajo sea la correcta.
describe('resumenOmitidos', () => {
  it('sin omitidos no dice nada', () => {
    expect(resumenOmitidos([g(100), g(200)], 2)).toBeNull();
  });

  it('cuenta y suma lo que no cupo', () => {
    const gastos = [g(100), g(200), g(300), g(400)];
    const r = resumenOmitidos(gastos, 2)!;
    expect(r.cuantos).toBe(2);
    expect(r.monto).toBe(700); // 300 + 400
  });

  it('el texto dice cuántos faltan, en singular y plural', () => {
    expect(resumenOmitidos([g(1), g(2)], 1)!.texto).toMatch(/1 comprobante más/);
    expect(resumenOmitidos([g(1), g(2), g(3)], 1)!.texto).toMatch(/2 comprobantes más/);
  });

  it('si no cupo ninguno, los cuenta todos', () => {
    const r = resumenOmitidos([g(50), g(50)], 0)!;
    expect(r.cuantos).toBe(2);
    expect(r.monto).toBe(100);
  });

  it('mostrar más de los que hay no rompe', () => {
    expect(resumenOmitidos([g(10)], 5)).toBeNull();
  });

  it('los montos inválidos no ensucian la suma omitida', () => {
    // Un monto ≤ 0 no cuenta en el total comprobado; tampoco debe contar aquí,
    // o el renglón de omitidos no cuadraría contra el total del documento.
    const r = resumenOmitidos([g(100), g(-50), g(200)], 1)!;
    expect(r.cuantos).toBe(2);   // se siguen contando como renglones no impresos
    expect(r.monto).toBe(200);   // pero solo suma el positivo
  });
});
