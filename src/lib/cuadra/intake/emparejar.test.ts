import { describe, it, expect } from 'vitest';
import { emparejarPorMonto, emparejarPendiente, type CodigoPendiente } from './emparejar';
import type { Gasto } from '@/types/cuadra';

// A qué comprobante pertenece un acercamiento (foto que solo trae el código).
// El operador NO etiqueta nada, así que hay que inferirlo — y esto vive en el
// camino del dinero: emparejar mal no deja un hueco, mueve el folio de un
// comprobante al de otro. Ante la duda NO se adivina.
const gasto = (id: string, monto: number, extra?: Record<string, unknown>): Gasto => ({
  id,
  concepto: 'otro',
  monto,
  ...(extra ? { ocrExtra: extra } : {}),
});

describe('emparejarPorMonto — a qué gasto pertenece el acercamiento', () => {
  it('lo pega al gasto cuyo total coincide', () => {
    const gastos = [gasto('a', 1200), gasto('b', 4027.1), gasto('c', 300)];
    expect(emparejarPorMonto(4027.1, gastos)?.id).toBe('b');
  });

  it('tolera el centavo de redondeo', () => {
    expect(emparejarPorMonto(4027.1, [gasto('a', 4027.104)])?.id).toBe('a');
  });

  it('si ningún gasto coincide, devuelve null (no lo fuerza al más parecido)', () => {
    expect(emparejarPorMonto(4027.1, [gasto('a', 1200), gasto('b', 300)])).toBeNull();
  });

  it('si DOS gastos tienen el mismo total, no adivina', () => {
    // Dos casetas de $300 el mismo día es de lo más común. Elegir una al azar
    // le colgaría el folio de un comprobante al otro, y ese folio es el que la
    // oficina teclea en el portal para timbrar.
    const gastos = [gasto('a', 300), gasto('b', 300)];
    expect(emparejarPorMonto(300, gastos)).toBeNull();
  });

  it('con dos del mismo total, prefiere el que aún no tiene folio de portal', () => {
    // Aquí sí hay una respuesta correcta: el que ya fue enriquecido tiene su
    // acercamiento; este es el del otro.
    const gastos = [gasto('a', 300, { folioPortal: 'YA-TIENE' }), gasto('b', 300)];
    expect(emparejarPorMonto(300, gastos)?.id).toBe('b');
  });

  it('sin gastos todavía, devuelve null', () => {
    expect(emparejarPorMonto(4027.1, [])).toBeNull();
  });
});

// El sentido CONTRARIO: el acercamiento llegó primero y quedó esperando en la
// bandeja; ahora llega la foto del ticket y hay que ver si alguno de los códigos
// guardados es el suyo.
const pendiente = (monto: number, folioPortal?: string): CodigoPendiente => ({
  id: `p-${monto}-${folioPortal ?? ''}`,
  monto,
  folioPortal,
});

describe('emparejarPendiente — el ticket que llega DESPUÉS del código', () => {
  it('encuentra el código que estaba esperando por ese total', () => {
    const bandeja = [pendiente(1200), pendiente(4027.1, 'FOLIO-OD'), pendiente(300)];
    expect(emparejarPendiente(4027.1, bandeja)?.folioPortal).toBe('FOLIO-OD');
  });

  it('tolera el centavo de redondeo', () => {
    expect(emparejarPendiente(4027.104, [pendiente(4027.1, 'X')])?.folioPortal).toBe('X');
  });

  it('si la bandeja está vacía, devuelve null', () => {
    expect(emparejarPendiente(4027.1, [])).toBeNull();
  });

  it('si ningún código guardado coincide, devuelve null', () => {
    expect(emparejarPendiente(4027.1, [pendiente(300)])).toBeNull();
  });

  it('con DOS códigos guardados del mismo total, no adivina', () => {
    // Mismo razonamiento que en el otro sentido: colgarle a este ticket el folio
    // del otro comprobante es peor que dejarlo sin folio.
    expect(emparejarPendiente(300, [pendiente(300, 'A'), pendiente(300, 'B')])).toBeNull();
  });
});
