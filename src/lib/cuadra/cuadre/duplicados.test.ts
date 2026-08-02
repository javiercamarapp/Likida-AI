import { describe, it, expect } from 'vitest';
import { copiasDeComprobante } from './engine';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// UN CERO DE MÁS NO ES UN TICKET DISTINTO. 1-ago-2026.
//
// `copiasDeComprobante` deduplicaba por `concepto|folio|monto` con el folio
// CRUDO, ignorando `folioNorm` — que existe exactamente para esto y que el
// intake ya calcula y persiste (`folio_norm`).
//
// Encontrado con un fajo real de 17 comprobantes que un operador mandó de
// golpe: el mismo folio salía como `286188` en una foto y como `059286188` en
// otra. Llaves distintas, así que no se veían como copias y el consumo entraba
// DOS VECES al total comprobado.
//
// No es cosmético: cada copia que no se detecta es dinero que la empresa cree
// que el operador gastó.
// ═══════════════════════════════════════════════════════════════════════════

const g = (): Gasto => ({
  id: 'x', concepto: 'diesel', monto: 400, folio: '286188', folioNorm: '286188',
} as unknown as Gasto);

describe('copias por folio con ceros a la izquierda', () => {
  it('EL FALLO: `05461` y `5461` son el mismo ticket', () => {
    const copias = copiasDeComprobante([
      { ...g(), id: 'a', concepto: 'alimentacion', monto: 45, folio: '05461', folioNorm: '5461' },
      { ...g(), id: 'b', concepto: 'alimentacion', monto: 45, folio: '5461', folioNorm: '5461' },
    ] as Gasto[]);
    expect(copias.get('b'), 'la segunda es copia de la primera').toBe('a');
    expect(copias.size).toBe(1);
  });

  it('la PRIMERA aparición es el original y sobrevive al total', () => {
    const copias = copiasDeComprobante([
      { ...g(), id: 'a', folio: '0059', folioNorm: '59' },
      { ...g(), id: 'b', folio: '59', folioNorm: '59' },
    ] as Gasto[]);
    expect(copias.has('a')).toBe(false);
  });

  it('folios de verdad distintos NO se colapsan', () => {
    const copias = copiasDeComprobante([
      { ...g(), id: 'a', folio: '286188', folioNorm: '286188' },
      { ...g(), id: 'b', folio: '059286188', folioNorm: '59286188' },
    ] as Gasto[]);
    expect(copias.size, '59286188 no es 286188: son dos tickets').toBe(0);
  });

  it('mismo folio y distinto MONTO no son copias', () => {
    const copias = copiasDeComprobante([
      { ...g(), id: 'a', monto: 400, folio: '05461', folioNorm: '5461' },
      { ...g(), id: 'b', monto: 500, folio: '5461', folioNorm: '5461' },
    ] as Gasto[]);
    expect(copias.size).toBe(0);
  });

  it('sin folioNorm cae al folio crudo, como antes', () => {
    const copias = copiasDeComprobante([
      { ...g(), id: 'a', folio: 'ABC', folioNorm: undefined },
      { ...g(), id: 'b', folio: 'ABC', folioNorm: undefined },
    ] as Gasto[]);
    expect(copias.get('b')).toBe('a');
  });

  it('el UUID sigue mandando sobre el folio', () => {
    const copias = copiasDeComprobante([
      { ...g(), id: 'a', cfdiUuid: 'U-1', folio: '1' },
      { ...g(), id: 'b', cfdiUuid: 'u-1', folio: '9' },
    ] as Gasto[]);
    expect(copias.get('b')).toBe('a');
  });
});
