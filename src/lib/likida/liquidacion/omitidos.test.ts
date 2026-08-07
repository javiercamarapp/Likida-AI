import { describe, it, expect } from 'vitest';
import { resumenOmitidos } from './omitidos';
import type { Gasto } from '@/types/likida';

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

// ═══════════════════════════════════════════════════════════════════════════
// LA INVARIANTE DEL PAPEL: los renglones impresos DEBEN sumar el total impreso.
//
// El PDF recorría `liq.gastos` completo e imprimía cada uno con su monto —
// incluidos los DUPLICADOS. Pero `totalComprobado` los excluye. Resultado: el
// documento no cuadraba consigo mismo, y es el que se archiva.
// ═══════════════════════════════════════════════════════════════════════════
import { filasImprimibles } from './omitidos';
import type { Liquidacion } from '@/types/likida';

const liq = (gastos: Gasto[], diferencias: Liquidacion['diferencias'], total: number) => ({
  viajeId: 'v', totalComprobado: total, totalAnticipo: total, diferencia: 0,
  estatus: 'cuadrada' as const, gastos, diferencias,
  totalDeducible: total, totalNoDeducible: 0, totalPorConfirmar: 0,
  iepsAcreditable: 0, ivaAcreditable: 0, peajeAcreditable: 0,
});

describe('filasImprimibles', () => {
  // EL FIXTURE LLEVA FOLIO, y antes no. Sin folio ni UUID el motor NO puede
  // marcar un duplicado —su llave es `concepto|folio|monto`— así que estas
  // pruebas afirmaban sobre un estado que el sistema nunca produce. Pasaban
  // porque `filasImprimibles` se creía la diferencia en vez de mirar los gastos.
  //
  // Cuando la diferencia `duplicado` pasó a apuntar al ORIGINAL (1-ago), la
  // tabla del PDF empezó a imprimir LAS DOS COPIAS y a esconder el original, y
  // estas pruebas siguieron verdes. Un fixture imposible no protege nada.
  const a = { id: 'a', concepto: 'caseta' as const, monto: 300, folio: 'CA-1' };
  const b = { id: 'b', concepto: 'caseta' as const, monto: 300, folio: 'CA-1' }; // copia de `a`
  const c = { id: 'c', concepto: 'diesel' as const, monto: 1000, folio: 'DS-9' };

  it('el duplicado NO se imprime como renglón con monto', () => {
    const r = filasImprimibles(liq([a, b, c], [{ tipo: 'duplicado', concepto: 'caseta', monto: 300, nota: 'x', gastoId: 'b' }], 1300));
    expect(r.filas.map((f) => f.id)).toEqual(['a', 'c']);
    expect(r.duplicados).toBe(1);
  });

  it('los renglones suman EXACTAMENTE el total comprobado', () => {
    const r = filasImprimibles(liq([a, b, c], [{ tipo: 'duplicado', concepto: 'caseta', monto: 300, nota: 'x', gastoId: 'b' }], 1300));
    expect(r.filas.reduce((s, f) => s + f.monto, 0)).toBe(1300);
  });

  it('sin duplicados, se imprime todo', () => {
    const r = filasImprimibles(liq([a, c], [], 1300));
    expect(r.filas).toHaveLength(2);
    expect(r.duplicados).toBe(0);
  });

  it('los montos inválidos tampoco se imprimen: no suman al total', () => {
    const malo = { id: 'm', concepto: 'otro' as const, monto: -50 };
    const r = filasImprimibles(liq([a, malo], [], 300));
    expect(r.filas.map((f) => f.id)).toEqual(['a']);
    expect(r.filas.reduce((s, f) => s + f.monto, 0)).toBe(300);
  });
});
