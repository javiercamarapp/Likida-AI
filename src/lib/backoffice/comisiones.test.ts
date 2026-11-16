import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba es pura'); } }));
vi.mock('@/lib/saas/transferencia', () => ({ listarFacturasSaas: vi.fn(), TECHO_FACTURAS_SAAS: 2000 }));

import { COMISION_PRIMER_MES, COMISION_RECURRENTE } from '@/lib/likida/vendedores';
import {
  calcularClawback, comisionCent, devengadoPorMes, devengar, esCobradoComisionable, listoParaAutorizar, reglasDelCodigo, resumenPorVendedor, saldoVendedor, tipoDeMes,
  type FacturaComisionable, type MovComision, type PagoVendedor,
} from './comisiones';

const factura = (o: Partial<FacturaComisionable> = {}): FacturaComisionable => ({
  id: 'f1', tenantId: 't1', estado: 'pagada', pagadaEn: '2026-11-05T18:00:00Z', conciliadaEn: '2026-11-06T18:00:00Z', referenciaBanco: 'SPEI 12345', subtotalCent: 1_000_000, ...o,
});
const reglas = reglasDelCodigo(null);
const entrada = (o: Partial<Parameters<typeof devengar>[0]> = {}): Parameters<typeof devengar>[0] => ({
  vendedorId: 'v1', factura: factura(), primeraCobradaEn: '2026-11-05T18:00:00Z', periodo: '2026-11-01', yaDevengadas: new Set<string>(), reglas, ...o,
});

describe('la regla viene del código (vendedores.ts), no de una copia', () => {
  it('50 % primer mes y 20 % recurrente, en puntos base, sin vigencia definida', () => {
    expect(reglas).toEqual({ primerMesBp: Math.round(COMISION_PRIMER_MES * 10_000), recurrenteBp: Math.round(COMISION_RECURRENTE * 10_000), vigenciaMeses: null });
    expect(reglas.primerMesBp).toBe(5000);
    expect(reglas.recurrenteBp).toBe(2000);
  });
});

describe('solo lo cobrado y conciliado comisiona', () => {
  it('una factura pendiente o «pagada» sin referencia de banco NO comisiona', () => {
    expect(esCobradoComisionable(factura())).toBe(true);
    expect(esCobradoComisionable(factura({ estado: 'pendiente', pagadaEn: null, conciliadaEn: null, referenciaBanco: null }))).toBe(false);
    expect(esCobradoComisionable(factura({ referenciaBanco: null }))).toBe(false);
    expect(esCobradoComisionable(factura({ referenciaBanco: 'ab' }))).toBe(false);
    expect(esCobradoComisionable(factura({ conciliadaEn: null }))).toBe(false);
    expect(esCobradoComisionable(factura({ estado: 'cancelada' }))).toBe(false);
    expect(esCobradoComisionable(factura({ subtotalCent: null }))).toBe(false);
    expect(devengar(entrada({ factura: factura({ referenciaBanco: null }) }))).toEqual({ omitido: 'no_cobrado' });
  });
});

describe('devengar', () => {
  it('la base es el SUBTOTAL (sin IVA): 50 % del primer mes', () => {
    const r = devengar(entrada());
    expect(r).toEqual({ devengo: { facturaId: 'f1', concepto: 'primer_mes', baseCent: 1_000_000, pctBp: 5000, montoCent: 500_000 } });
  });
  it('20 % recurrente en los meses siguientes', () => {
    const r = devengar(entrada({ primeraCobradaEn: '2026-10-05T18:00:00Z' }));
    expect(r).toMatchObject({ devengo: { concepto: 'recurrente', pctBp: 2000, montoCent: 200_000 } });
  });
  it('es idempotente: lo ya devengado se omite', () => {
    expect(devengar(entrada({ yaDevengadas: new Set(['f1']) }))).toEqual({ omitido: 'ya_devengado' });
  });
  it('sin vendedor no devenga', () => {
    expect(devengar(entrada({ vendedorId: null }))).toEqual({ omitido: 'sin_vendedor' });
  });
  it('sin la fecha de la primera factura cobrada no decide: sin_dato', () => {
    expect(devengar(entrada({ primeraCobradaEn: null }))).toEqual({ omitido: 'sin_dato' });
  });
  it('un cobro de otro mes no entra en este periodo', () => {
    expect(devengar(entrada({ periodo: '2026-12-01' }))).toEqual({ omitido: 'fuera_de_periodo' });
  });
  it('la vigencia solo rige si está configurada', () => {
    const lejos = '2024-11-05T18:00:00Z'; // 24 meses antes
    expect(devengar(entrada({ primeraCobradaEn: lejos }))).toMatchObject({ devengo: { concepto: 'recurrente' } });
    expect(devengar(entrada({ primeraCobradaEn: lejos, reglas: reglasDelCodigo(24) }))).toEqual({ omitido: 'fuera_de_vigencia' });
    expect(devengar(entrada({ primeraCobradaEn: '2024-12-05T18:00:00Z', reglas: reglasDelCodigo(24) }))).toMatchObject({ devengo: { concepto: 'recurrente' } });
  });
});

describe('tipoDeMes', () => {
  it('primer mes, recurrente, fuera de vigencia y sin dato', () => {
    expect(tipoDeMes('2026-11-05T18:00:00Z', '2026-11-01', null)).toBe('primer_mes');
    expect(tipoDeMes('2026-11-05', '2026-12-01', null)).toBe('recurrente');
    expect(tipoDeMes('2026-11-05', '2028-11-01', 24)).toBe('fuera_de_vigencia');
    expect(tipoDeMes('2026-11-05', '2028-10-01', 24)).toBe('recurrente');
    expect(tipoDeMes(null, '2026-11-01', null)).toBe('sin_dato');
    expect(tipoDeMes('basura', '2026-11-01', null)).toBe('sin_dato');
  });
  it('un cobro antes de la «primera» factura es incoherente: sin_dato, no «recurrente»', () => {
    expect(tipoDeMes('2026-12-05', '2026-11-01', null)).toBe('sin_dato');
  });
  it('el mes es el de México: 1-nov 05:00 UTC todavía es 31-oct en México', () => {
    expect(tipoDeMes('2026-11-01T05:00:00Z', '2026-10-01', null)).toBe('primer_mes');
    expect(tipoDeMes('2026-11-01T06:00:00Z', '2026-11-01', null)).toBe('primer_mes');
  });
});

describe('redondeo a centavos', () => {
  it('medio centavo sube al centavo (caso 0.005)', () => {
    expect(comisionCent(1, 5000)).toBe(1); // $0.01 al 50 % = $0.005 → $0.01
    expect(comisionCent(1001, 5000)).toBe(501);
    expect(comisionCent(3, 2000)).toBe(1); // 0.6 ¢
    expect(comisionCent(2, 2000)).toBe(0); // 0.4 ¢
    expect(comisionCent(1_000_000, 5000)).toBe(500_000);
  });
});

describe('clawback por cancelación posterior', () => {
  const dev = { id: 'm1', vendedorId: 'v1', facturaId: 'f1', baseCent: 1_000_000, montoCent: 500_000 };
  it('genera un movimiento NEGATIVO ligado al origen', () => {
    expect(calcularClawback(dev, 'cancelada', new Set())).toEqual({ referenciaOrigen: 'm1', vendedorId: 'v1', facturaId: 'f1', baseCent: 1_000_000, montoCent: -500_000 });
  });
  it('no se duplica si ya existe', () => {
    expect(calcularClawback(dev, 'cancelada', new Set(['m1']))).toBeNull();
  });
  it('solo cancelaciones: una factura pagada, pendiente o desconocida no genera ajuste', () => {
    for (const e of ['pagada', 'pendiente', 'fallida', null]) expect(calcularClawback(dev, e, new Set())).toBeNull();
  });
  it('un devengo de cero no tiene nada que revertir', () => {
    expect(calcularClawback({ ...dev, montoCent: 0 }, 'cancelada', new Set())).toBeNull();
  });
});

describe('saldoVendedor: lo negativo se arrastra, jamás se cobra', () => {
  it('devengado − ajustes − pagado − autorizado', () => {
    const s = saldoVendedor(
      [{ tipo: 'devengo', montoCent: 500_000 }, { tipo: 'devengo', montoCent: 200_000 }, { tipo: 'clawback', montoCent: -100_000 }],
      [{ estado: 'pagado', montoCent: 300_000 }, { estado: 'autorizado', montoCent: 100_000 }, { estado: 'borrador', montoCent: 999_999 }],
    );
    expect(s).toMatchObject({ devengadoCent: 700_000, clawbackCent: -100_000, pagadoCent: 300_000, autorizadoCent: 100_000, saldoCent: 200_000, arrastrar: false, porPagarCent: 200_000, arrastreCent: 0 });
  });
  it('un saldo negativo se arrastra y no hay nada por pagar', () => {
    const s = saldoVendedor([{ tipo: 'devengo', montoCent: 100_000 }, { tipo: 'clawback', montoCent: -300_000 }], []);
    expect(s).toMatchObject({ saldoCent: -200_000, arrastrar: true, porPagarCent: 0, arrastreCent: 200_000 });
  });
  it('sin movimientos el saldo es cero real y no arrastra', () => {
    expect(saldoVendedor([], [])).toMatchObject({ saldoCent: 0, arrastrar: false, porPagarCent: 0 });
  });
});

describe('listoParaAutorizar', () => {
  const uuid = 'aaaaaaaa-0000-4000-8000-000000000001';
  it('sin CFDI de honorarios no se autoriza aunque el cálculo esté perfecto', () => {
    expect(listoParaAutorizar({ saldoCent: 500_000, montoCent: 500_000, cfdiHonorariosUuid: null })).toEqual({ listo: false, falta: ['cfdi_honorarios'] });
  });
  it('saldo no positivo y monto mayor al saldo', () => {
    expect(listoParaAutorizar({ saldoCent: 0, montoCent: 100, cfdiHonorariosUuid: uuid }).falta).toEqual(['saldo_no_positivo']);
    expect(listoParaAutorizar({ saldoCent: -5, montoCent: 100, cfdiHonorariosUuid: uuid }).falta).toEqual(['saldo_no_positivo']);
    expect(listoParaAutorizar({ saldoCent: 500, montoCent: 501, cfdiHonorariosUuid: uuid }).falta).toEqual(['monto_excede_saldo']);
    expect(listoParaAutorizar({ saldoCent: 500, montoCent: 0, cfdiHonorariosUuid: uuid }).falta).toEqual(['monto_invalido']);
  });
  it('monto ≤ saldo con CFDI: listo', () => {
    expect(listoParaAutorizar({ saldoCent: 500, montoCent: 500, cfdiHonorariosUuid: uuid })).toEqual({ listo: true, falta: [] });
    expect(listoParaAutorizar({ saldoCent: 500, montoCent: 200, cfdiHonorariosUuid: uuid }).listo).toBe(true);
  });
});

const mov = (o: Partial<MovComision>): MovComision => ({
  id: 'm', vendedorId: 'v1', facturaId: 'f', prospectoId: null, tenantId: null, periodo: '2026-11-01', tipo: 'devengo', concepto: 'primer_mes', baseCent: 1_000_000, pctBp: 5000, montoCent: 500_000, referenciaOrigen: null, ...o,
});
const pago = (o: Partial<PagoVendedor>): PagoVendedor => ({
  id: 'p', vendedorId: 'v1', periodo: '2026-11-01', montoCent: 100, cfdiUuid: null, cfdiRecibidoEn: null, estado: 'borrador', autorizadoEn: null, pagadoEn: null, referenciaBanco: null, ...o,
});

describe('resumenPorVendedor y serie', () => {
  it('todos los vendedores salen; el que no devengó muestra 0 cobrados y sin porcentaje', () => {
    const filas = resumenPorVendedor([{ id: 'v1', nombre: 'Ana' }, { id: 'v2', nombre: 'Beto' }], [mov({}), mov({ id: 'm2', facturaId: 'g', pctBp: 2000, baseCent: 500_000, montoCent: 100_000, concepto: 'recurrente' })], [pago({})], '2026-11-01');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ vendedorId: 'v1', cobradoBaseCent: 1_500_000, devengadoCent: 600_000, pctsBp: [5000, 2000], pago: { id: 'p' } });
    expect(filas[1]).toMatchObject({ vendedorId: 'v2', cobradoBaseCent: 0, devengadoCent: 0, pctsBp: [], pago: null });
    expect(filas[1].saldo.saldoCent).toBe(0);
  });
  it('los movimientos de otro mes no entran en el mes, pero sí en el saldo', () => {
    const [f] = resumenPorVendedor([{ id: 'v1', nombre: 'Ana' }], [mov({ periodo: '2026-10-01' })], [], '2026-11-01');
    expect(f.devengadoCent).toBe(0);
    expect(f.saldo.saldoCent).toBe(500_000);
  });
  it('devengadoPorMes deja sin dato (null) el mes sin movimientos', () => {
    const s = devengadoPorMes([mov({ periodo: '2026-11-01' }), mov({ periodo: '2026-09-01', montoCent: 7 })], '2026-11-01', 3);
    expect(s.map((x) => x.periodo)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
    expect(s.map((x) => x.montoCent)).toEqual([7, null, 500_000]);
  });
});
