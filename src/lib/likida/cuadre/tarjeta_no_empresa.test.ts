// ═══════════════════════════════════════════════════════════════════════════
// P0-6 · UNA TARJETA QUE NO ES DE LA EMPRESA NO ACREDITA LITROS.
//
// LIF 2026 art. 20-A fr. IV: el medio de pago electrónico del estímulo del
// diésel tiene que ser de la cuenta del contribuyente. «Con la suya y le
// reembolsamos» tumba el estímulo aunque el CFDI diga forma de pago 04, y
// ningún ticket lo revela: solo lo sabe la flota (`tarjetasANombreEmpresa`).
//
// «Caso 04» = el diésel con forma de pago 04 (tarjeta de crédito) que ANTES
// acreditaba sus litros sin preguntar de quién era la tarjeta.
//
// Fuera de alcance (pendiente del fiscalista, PREGUNTAS-AL-FISCALISTA.md C5):
// si la tarjeta de un tercero afecta también la deducción de ISR y el IVA.
// Aquí solo se corta el estímulo de litros y se manda a revisión humana.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import { tarjetasDeLaEmpresa } from '../perfil/preguntas';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 10000 }];
const HC = { claves: ['15101505'], unidad: 'LTR', vigenteDesde: '2026-04-24' };
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };

/** 200 L de diésel con CFDI verificado. Solo cambia la forma de pago. */
const diesel = (formaPago: string): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 5000, folio: 'D1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I',
  complementoHidrocarburos: true, ivaTraslado: 689.66, iepsTraslado: 0,
  ocrExtra: { litros: 200 }, formaPago,
} as unknown as Gasto);

const cuadrar = (formaPago: string, tarjetasEmpresa?: boolean) => cuadrarViaje({
  viajeId: 'v1', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST,
  gastos: [diesel(formaPago)], ...(tarjetasEmpresa === undefined ? {} : { tarjetasEmpresa }),
});
const tipos = (r: ReturnType<typeof cuadrar>) => (r.diferencias ?? []).map((d) => d.tipo);

describe('estímulo de diésel — la tarjeta tiene que ser de la empresa (LIF 20-A fr. IV)', () => {
  it('caso 04: tarjeta declarada de la empresa SÍ acredita los litros', () => {
    const r = cuadrar('04', true);
    expect(r.litrosDieselAcreditables).toBe(200);
    expect(tipos(r)).not.toContain('tarjeta_no_empresa');
  });

  it('caso 04: tarjeta que NO es de la empresa NO acredita, con motivo visible y revisión humana', () => {
    const r = cuadrar('04', false);
    expect(r.litrosDieselAcreditables).toBe(0);
    const d = r.diferencias.find((x) => x.tipo === 'tarjeta_no_empresa');
    expect(d?.nota).toMatch(/NO es de la empresa/);
    expect(d?.nota).toMatch(/20-A fr\. IV/);
    expect(r.estatus).toBe('revisar');
  });

  it('sin declarar tampoco acredita: un estímulo no se concede por omisión', () => {
    const r = cuadrar('04');
    expect(r.litrosDieselAcreditables).toBe(0);
    expect(r.diferencias.find((x) => x.tipo === 'tarjeta_no_empresa')?.nota).toMatch(/no ha declarado/);
    expect(r.estatus).toBe('revisar');
  });

  it.each(['04', '28', '29', '05'])('la forma %s (instrumento con titular) también exige tarjeta de la empresa', (f) => {
    expect(cuadrar(f, false).litrosDieselAcreditables).toBe(0);
    expect(cuadrar(f, true).litrosDieselAcreditables).toBe(200);
  });

  it.each(['02', '03'])('cheque nominativo / transferencia (%s) no dependen de la tarjeta: acreditan igual', (f) => {
    const r = cuadrar(f, false);
    expect(r.litrosDieselAcreditables).toBe(200);
    expect(tipos(r)).not.toContain('tarjeta_no_empresa');
  });

  it('el efectivo sigue sin acreditar por su propia regla, sin ruido de tarjeta', () => {
    const r = cuadrar('01', false);
    expect(r.litrosDieselAcreditables).toBe(0);
    expect(tipos(r)).not.toContain('tarjeta_no_empresa');
  });

  it('solo corta el estímulo: el IVA del mismo diésel se sigue acreditando (la regla fiscal fina espera al fiscalista)', () => {
    const r = cuadrar('04', false);
    expect(r.ivaAcreditable).toBeGreaterThan(0);
  });
});

describe('tarjetasDeLaEmpresa(perfil) — tri-estado y fail-closed', () => {
  const dec = <T,>(valor: T) => ({ valor, procedencia: 'declarado' as const });
  it('sin perfil o sin campos: undefined', () => {
    expect(tarjetasDeLaEmpresa(undefined)).toBeUndefined();
    expect(tarjetasDeLaEmpresa({})).toBeUndefined();
  });
  it('declarado sí: true; declarado no: false', () => {
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: dec(true) })).toBe(true);
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: dec(false) })).toBe(false);
  });
  it('un valor inferido o de default NO decide', () => {
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: { valor: true, procedencia: 'inferido' } })).toBeUndefined();
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: { valor: true, procedencia: 'default' } })).toBeUndefined();
  });
  it('«el chofer paga con la suya y se le reembolsa» tumba el sí', () => {
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: dec(true), pagoEnBomba: dec('chofer_reembolso') })).toBe(false);
    expect(tarjetasDeLaEmpresa({ pagoEnBomba: dec('chofer_reembolso') })).toBe(false);
  });
  it('pago mixto: no se afirma nada', () => {
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: dec(true), pagoEnBomba: dec('mixto') })).toBeUndefined();
  });
  it('pago de la empresa + tarjetas de la empresa: true', () => {
    expect(tarjetasDeLaEmpresa({ tarjetasANombreEmpresa: dec(true), pagoEnBomba: dec('empresa') })).toBe(true);
  });
});
