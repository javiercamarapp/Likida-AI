import { describe, it, expect } from 'vitest';
import { emparejarPorMonto, emparejarPendiente, emparejarXmlConTicket, type CodigoPendiente } from './emparejar';
import type { Gasto } from '@/types/likida';

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

// ═══════════════════════════════════════════════════════════════════════════
// EL XML QUE LLEGA DESPUÉS DE LA FOTO — el duplicado más caro.
//
// Un ticket de gasolinera NO es factura y NO trae UUID. La secuencia normal es:
// el operador fotografía el ticket (gasto sin UUID) y después la oficina manda
// el XML timbrado. Si el emparejamiento solo mira el UUID, no encuentra nada y
// CREA UN SEGUNDO GASTO: el mismo consumo se cuenta dos veces, con su IVA y su
// IEPS encima.
//
// Y un unique(tenant_id, cfdi_uuid) NO lo arregla: el del ticket es NULL, y NULL
// no colisiona con nada.
// ═══════════════════════════════════════════════════════════════════════════
const ticket = (id: string, monto: number, fecha?: string, uuid?: string): Gasto => ({
  id, concepto: 'diesel', monto, fecha, ...(uuid ? { cfdiUuid: uuid } : {}),
});

describe('emparejarXmlConTicket', () => {
  it('encuentra el ticket sin factura del mismo monto', () => {
    const gastos = [ticket('t1', 4812, '2026-05-01'), ticket('t2', 1206.9, '2026-05-01')];
    expect(emparejarXmlConTicket({ total: 4812, fecha: '2026-05-01' }, gastos)?.id).toBe('t1');
  });

  it('IGNORA los gastos que ya tienen UUID: esos ya son facturas', () => {
    const gastos = [ticket('ya', 4812, '2026-05-01', 'uuid-previo')];
    expect(emparejarXmlConTicket({ total: 4812, fecha: '2026-05-01' }, gastos)).toBeNull();
  });

  it('tolera el centavo de redondeo', () => {
    expect(emparejarXmlConTicket({ total: 4812, fecha: '2026-05-01' }, [ticket('t1', 4812.004, '2026-05-01')])?.id).toBe('t1');
  });

  it('con la misma fecha desempata entre dos tickets del mismo monto', () => {
    // Dos cargas de $4,812 en días distintos es plausible en un viaje largo.
    const gastos = [ticket('t1', 4812, '2026-05-01'), ticket('t2', 4812, '2026-05-03')];
    expect(emparejarXmlConTicket({ total: 4812, fecha: '2026-05-03' }, gastos)?.id).toBe('t2');
  });

  it('si ni la fecha desempata, NO adivina', () => {
    const gastos = [ticket('t1', 4812, '2026-05-01'), ticket('t2', 4812, '2026-05-01')];
    expect(emparejarXmlConTicket({ total: 4812, fecha: '2026-05-01' }, gastos)).toBeNull();
  });

  it('sin fecha en el XML, empareja solo si hay un único candidato por monto', () => {
    expect(emparejarXmlConTicket({ total: 4812 }, [ticket('t1', 4812, '2026-05-01')])?.id).toBe('t1');
    expect(emparejarXmlConTicket({ total: 4812 }, [ticket('t1', 4812), ticket('t2', 4812)])).toBeNull();
  });

  it('sin total en el XML no empareja nada: no se adivina sobre dinero', () => {
    expect(emparejarXmlConTicket({ fecha: '2026-05-01' }, [ticket('t1', 4812, '2026-05-01')])).toBeNull();
  });

  it('sin tickets previos devuelve null y el XML crea su gasto', () => {
    expect(emparejarXmlConTicket({ total: 4812, fecha: '2026-05-01' }, [])).toBeNull();
  });
});
