// A2 (ronda 20, ALTO): el fail-closed de `tarjeta_no_empresa` NO es retroactivo.
// Una liquidación cerrada ANTES de la regla no trae el tipo persistido; al
// reabrirla/recalcularla el motor no puede agregarlo, o el detalle se apagaría
// (`derivoLaConfig`) y un ajuste firmado bajaría los litros acreditables a 0.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import { derivoLaConfig } from '../analytics';
import { reglaTarjetaRigeParaCierre, TARJETA_NO_EMPRESA_VIGENTE_DESDE } from './vigencia_tarjeta';
import type { Gasto } from '@/types/likida';

describe('reglaTarjetaRigeParaCierre — criterio de vigencia', () => {
  it('cierre anterior a la vigencia: no rige', () => {
    expect(reglaTarjetaRigeParaCierre('2026-09-20T12:00:00Z')).toBe(false);
    expect(reglaTarjetaRigeParaCierre('2026-10-03T23:59:59-06:00')).toBe(false);
  });
  it('cierre en o después de la vigencia: rige', () => {
    expect(reglaTarjetaRigeParaCierre(TARJETA_NO_EMPRESA_VIGENTE_DESDE)).toBe(true);
    expect(reglaTarjetaRigeParaCierre('2026-10-20T10:00:00Z')).toBe(true);
  });
  it('sin cierre (cierre nuevo) o fecha ilegible: rige — ante la duda, fail-closed', () => {
    expect(reglaTarjetaRigeParaCierre(undefined)).toBe(true);
    expect(reglaTarjetaRigeParaCierre(null)).toBe(true);
    expect(reglaTarjetaRigeParaCierre('no-es-fecha')).toBe(true);
  });
});

describe('derivoLaConfig — tarjeta_no_empresa posterior al cierre no es deriva', () => {
  const persistidasAntesDeLaRegla = [{ tipo: 'anticipo', esperado: 5000 }];
  const hoy = [{ tipo: 'anticipo', esperado: 5000 }, { tipo: 'tarjeta_no_empresa' }];
  it('cerrada antes de la regla: el tipo nuevo se ignora', () => {
    expect(derivoLaConfig(persistidasAntesDeLaRegla, hoy, { cerradaEn: '2026-09-20T12:00:00Z' })).toBe(false);
  });
  it('cerrada con la regla vigente (o sin fecha): el mismo tipo SÍ es deriva', () => {
    expect(derivoLaConfig(persistidasAntesDeLaRegla, hoy, { cerradaEn: '2026-10-20T12:00:00Z' })).toBe(true);
    expect(derivoLaConfig(persistidasAntesDeLaRegla, hoy)).toBe(true);
  });
  it('el tipo «sin declarar» tampoco cuenta como deriva en una liquidación anterior a la regla', () => {
    const hoySinDeclarar = [{ tipo: 'anticipo', esperado: 5000 }, { tipo: 'tarjeta_sin_declarar' }];
    expect(derivoLaConfig(persistidasAntesDeLaRegla, hoySinDeclarar, { cerradaEn: '2026-09-20T12:00:00Z' })).toBe(false);
    expect(derivoLaConfig(persistidasAntesDeLaRegla, hoySinDeclarar, { cerradaEn: '2026-10-20T12:00:00Z' })).toBe(true);
  });
  it('ignorar ese tipo no esconde OTRA deriva real (p. ej. cambió el RFC)', () => {
    const conRfc = [...hoy, { tipo: 'rfc_receptor' }];
    expect(derivoLaConfig(persistidasAntesDeLaRegla, conRfc, { cerradaEn: '2026-09-20T12:00:00Z' })).toBe(true);
  });
});

// ── El motor con el mismo insumo que arma desde_db ─────────────────────────
const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 10000 }];
const HC = { claves: ['15101505'], unidad: 'LTR', vigenteDesde: '2026-04-24' };
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };
const diesel04 = {
  id: 'g1', concepto: 'diesel', monto: 5000, folio: 'D1', fecha: '2026-05-01',
  ocrConfianza: 0.95, cfdiUuid: 'u1', xmlVerificado: true, rfcReceptor: 'REC010101AA1',
  claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I',
  complementoHidrocarburos: true, ivaTraslado: 689.66, iepsTraslado: 0,
  ocrExtra: { litros: 200 }, formaPago: '04',
} as unknown as Gasto;

describe('reabrir una liquidación vieja (flota sin declarar tarjetas) no cambia nada', () => {
  // Misma expresión que desde_db: tarjetasEmpresa = rige ? declarado : true.
  const reabrir = (cerradaEn?: string) => cuadrarViaje({
    viajeId: 'v1', anticipo: 5000, politica, hidrocarburos: HC, estimulos: EST, gastos: [diesel04],
    tarjetasEmpresa: reglaTarjetaRigeParaCierre(cerradaEn) ? undefined : true,
  });
  it('cerrada antes de la regla: litros acreditados, sin tarjeta_no_empresa, sin deriva', () => {
    const r = reabrir('2026-09-20T12:00:00Z');
    expect(r.litrosDieselAcreditables).toBe(200);
    expect(r.diferencias.map((d) => d.tipo)).not.toContain('tarjeta_sin_declarar');
    expect(derivoLaConfig(r.diferencias, r.diferencias, { cerradaEn: '2026-09-20T12:00:00Z' })).toBe(false);
  });
  it('cerrada con la regla vigente y sin declarar: sigue fail-closed', () => {
    const r = reabrir('2026-10-20T12:00:00Z');
    expect(r.litrosDieselAcreditables).toBe(0);
    expect(r.diferencias.map((d) => d.tipo)).toContain('tarjeta_sin_declarar');
  });
});
