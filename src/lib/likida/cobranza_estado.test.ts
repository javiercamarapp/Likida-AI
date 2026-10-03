import { describe, it, expect } from 'vitest';
import { armarEstadoDunning } from './cobranza_estado';
import { tituloToque, toquesDeHoy } from './agentes/exito';
import type { FacturaPorCobrar } from '@/lib/saas/transferencia';
import type { PiezaDunning } from './repo';

const factura = (o: Partial<FacturaPorCobrar> = {}): FacturaPorCobrar => ({
  id: 'f1aaaaaa-0000-0000-0000-000000000001', tenantId: 't1', tenantNombre: 'Flota Demo',
  periodoInicio: '2026-09-01', periodoFin: '2026-09-30', monto: 11600, subtotal: 10000, iva: 1600,
  moneda: 'MXN', estado: 'pendiente', referencia: 'LK202609', cfdiUuid: null, ...o,
});
const pieza = (titulo: string, o: Partial<PiezaDunning> = {}): PiezaDunning =>
  ({ titulo, estado: 'pendiente', enviadoEn: null, creadoEn: '2026-09-10T00:00:00Z', ...o });
const tituloDe = (f: FacturaPorCobrar, hoy: string, hito: number) =>
  tituloToque(toquesDeHoy([f], hoy).find((t) => t.hito === hito)!);

describe('armarEstadoDunning', () => {
  it('sin facturas: 0 por cobrar, sin inventar nada', () => {
    const e = armarEstadoDunning([], [], '2026-10-03');
    expect(e).toMatchObject({ porCobrar: 0, montoPorCobrar: 0, vencidas: 0, toquesSinPropuesta: 0 });
  });

  it('factura de 12 días de vencida: alcanza -3, 0, +3, +7 y el siguiente es +15', () => {
    const f = factura();
    const e = armarEstadoDunning([f], [], '2026-09-13');
    expect(e.facturas[0].dias).toBe(12);
    expect(e.facturas[0].toques.map((t) => t.hito)).toEqual([-3, 0, 3, 7]);
    expect(e.facturas[0].proximoHito).toBe(15);
    expect(e.facturas[0].vencida).toBe(true);
  });

  it('un toque alcanzado sin propuesta en la cola se cuenta como «sin propuesta»', () => {
    const e = armarEstadoDunning([factura()], [], '2026-09-13');
    expect(e.toquesSinPropuesta).toBe(4);
    expect(e.facturas[0].toques.every((t) => t.sello === 'sin_propuesta')).toBe(true);
  });

  it('cruza cada propuesta con su toque por el título-llave del agente y distingue los sellos', () => {
    const f = factura(); const hoy = '2026-09-13';
    const piezas = [
      pieza(tituloDe(f, hoy, -3), { estado: 'aprobado', enviadoEn: '2026-08-30T10:00:00Z' }),
      pieza(tituloDe(f, hoy, 0), { estado: 'aprobado' }),
      pieza(tituloDe(f, hoy, 3), { estado: 'rechazado' }),
      pieza(tituloDe(f, hoy, 7), { estado: 'pendiente' }),
    ];
    const e = armarEstadoDunning([f], piezas, hoy);
    expect(e.facturas[0].toques.map((t) => t.sello)).toEqual(['enviada', 'aprobada', 'rechazada', 'pendiente']);
    expect(e.toquesSinPropuesta).toBe(0);
    expect(e.propuestasPendientes).toBe(1);
    expect(e.propuestasEnviadas).toBe(1);
  });

  it('la propuesta más nueva con el mismo título es la que manda', () => {
    const f = factura(); const hoy = '2026-09-02';
    const t = tituloDe(f, hoy, 0);
    const e = armarEstadoDunning([f], [pieza(t, { estado: 'aprobado' }), pieza(t, { estado: 'rechazado' })], hoy);
    expect(e.facturas[0].toques.find((x) => x.hito === 0)?.sello).toBe('aprobada');
  });

  it('antes del corte no hay vencida ni toque alcanzado salvo el -3; suma montos', () => {
    const a = factura(); const b = factura({ id: 'f2bbbbbb-0000-0000-0000-000000000002', monto: 5800, periodoInicio: '2026-10-20' });
    const e = armarEstadoDunning([a, b], [], '2026-10-03');
    expect(e.porCobrar).toBe(2);
    expect(e.montoPorCobrar).toBe(17400);
    expect(e.vencidas).toBe(1);
    expect(e.montoVencido).toBe(11600);
    expect(e.facturas[1].toques).toEqual([]);
    expect(e.facturas[1].proximoHito).toBe(-3);
  });
});
