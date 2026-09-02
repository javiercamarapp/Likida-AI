import { describe, it, expect } from 'vitest';
import { emparejarXmlConTicket } from './emparejar';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · WA-5 (MEDIO) — el XML 1:1 que llega DESPUÉS de la foto de su
// ticket solo se emparejaba si el monto coincidía AL CENTAVO. Con el acuse sin
// botón a partir de 0.9 de confianza, un ticket de $2,890.50 leído como
// $2,890.00 es corriente: el XML entraba como gasto NUEVO `xml_verificado`, el
// motor no los unía (llaves disjuntas) y el reembolso al chofer salía DOBLE.
// ═══════════════════════════════════════════════════════════════════════════

const g = (p: Partial<Gasto> & { id: string; monto: number }): Gasto => ({
  concepto: 'diesel', fecha: '2026-08-14', ...p,
} as Gasto);

describe('emparejarXmlConTicket — el centavo, y cuando el centavo no alcanza', () => {
  it('el caso de siempre: cuadra al centavo y se pega', () => {
    const t = g({ id: 'a', monto: 2890.5 });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [t])).toBe(t);
  });

  it('EL FALLO: $2,890.00 leído contra un CFDI de $2,890.50 del mismo día ahora empareja', () => {
    const t = g({ id: 'a', monto: 2890 });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [t])).toBe(t);
  });

  it('y una carga DISTINTA no se traga: $3,200 contra $2,890 son dos gastos', () => {
    const t = g({ id: 'a', monto: 2890 });
    expect(emparejarXmlConTicket({ total: 3200, fecha: '2026-08-14' }, [t])).toBeNull();
  });

  it('justo en el borde del 2 % entra; pasado el borde, no', () => {
    const dentro = g({ id: 'a', monto: 9800 });   // 2 % de 10,000 = 200
    expect(emparejarXmlConTicket({ total: 10000, fecha: '2026-08-14' }, [dentro])).toBe(dentro);
    const fuera = g({ id: 'a', monto: 9700 });
    expect(emparejarXmlConTicket({ total: 10000, fecha: '2026-08-14' }, [fuera])).toBeNull();
  });

  it('SIN fecha en el XML no se aproxima: adivinar por monto parecido en un viaje de cinco días es lo que este archivo se niega a hacer', () => {
    const t = g({ id: 'a', monto: 2890 });
    expect(emparejarXmlConTicket({ total: 2890.5 }, [t])).toBeNull();
  });

  it('otro día tampoco, aunque el monto se parezca', () => {
    const t = g({ id: 'a', monto: 2890, fecha: '2026-08-13' });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [t])).toBeNull();
  });

  it('DOS parecidos del mismo día no se desempatan: el XML se queda aparte, visible y corregible', () => {
    const a = g({ id: 'a', monto: 2890 });
    const b = g({ id: 'b', monto: 2891 });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [a, b])).toBeNull();
  });

  it('un gasto ya timbrado no entra a la segunda pasada: esos se emparejan por UUID', () => {
    const t = g({ id: 'a', monto: 2890, cfdiUuid: 'UUID-1' });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [t])).toBeNull();
  });

  it('la coincidencia EXACTA sigue mandando sobre la aproximada', () => {
    const exacto = g({ id: 'exacto', monto: 2890.5 });
    const parecido = g({ id: 'parecido', monto: 2890 });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [parecido, exacto])).toBe(exacto);
  });

  it('un gasto en 0 (el huérfano del OCR caído) no se lleva el XML de una carga real', () => {
    const t = g({ id: 'a', monto: 0 });
    expect(emparejarXmlConTicket({ total: 2890.5, fecha: '2026-08-14' }, [t])).toBeNull();
  });
});
