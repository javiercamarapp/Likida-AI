import { describe, it, expect } from 'vitest';
import { cuadrarViaje } from './engine';
import { SOLO_CONTRALOR } from './resumen';
import { DEMO_CONFIG } from '../config';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 9 · ALTO (fiscal) — "LISR 28-V, tercer párrafo: una comida
// amparada SOLO por transporte y pagada sin tarjeta de crédito sale
// 'Deducible' en verde, estatus 'cuadrada', y sin una sola observación".
//
// Norma comparada — `normas/lisr-28-V.yaml`, tercera oración del segundo
// párrafo (verificado_fuente_primaria), literal:
//
//   "Cuando a la documentación que ampare el gasto de alimentación el
//   contribuyente únicamente acompañe el comprobante fiscal relativo al
//   transporte, la deducción a que se refiere este párrafo sólo procederá
//   cuando el pago se efectúe mediante tarjeta de crédito de la persona que
//   realiza el viaje."
//
// H1 (`alimentacion_sin_soporte`, ver `flete_no_ampara.test.ts`) ya exige QUE
// exista hospedaje o transporte. Lo que faltaba: cuando lo único que hay es
// TRANSPORTE (sin hospedaje en el viaje), la ley pide además que el pago haya
// sido con tarjeta de crédito de quien viaja — débito no cuenta, efectivo no
// cuenta. Sin esa condición, el motor daba la comida por completamente
// amparada y no decía nada.
// ═══════════════════════════════════════════════════════════════════════════

const g = (over: Partial<Gasto>): Gasto => ({
  id: Math.random().toString(36).slice(2), concepto: 'otro', monto: 100, fecha: '2026-07-27', ...over,
});

const cuadrar = (gastos: Gasto[]) =>
  cuadrarViaje({
    viajeId: 'v', anticipo: 20_000, gastos,
    politica: DEMO_CONFIG.politica, estimulos: DEMO_CONFIG.estimulos,
  });

const sinTarjeta = (gastos: Gasto[]) =>
  (cuadrar(gastos).diferencias ?? []).filter((d) => d.tipo === 'alimentacion_transporte_sin_tarjeta_credito');

describe('transporte sin hospedaje exige tarjeta de crédito (LISR 28-V, 3er párrafo)', () => {
  it('el escenario del hallazgo: comida amparada SOLO por transporte, pagada en efectivo → avisa', () => {
    const r = cuadrar([
      g({ concepto: 'alimentacion', monto: 700, cfdiUuid: 'u1', xmlVerificado: true, formaPago: '01' }),
      g({ concepto: 'transporte', monto: 450, cfdiUuid: 'u2', xmlVerificado: true, formaPago: '01' }),
    ]);
    const d = r.diferencias.find((x) => x.tipo === 'alimentacion_transporte_sin_tarjeta_credito');
    expect(d, 'antes salía "Deducible" en verde sin ninguna observación').toBeDefined();
    expect(d!.nota).toMatch(/tarjeta de crédito/i);
    expect(d!.nota).toContain('LISR 28-V');
  });

  it('con tarjeta de DÉBITO (28) sigue avisando: la ley pide crédito, no cualquier tarjeta', () => {
    const gastos = [
      g({ concepto: 'alimentacion', monto: 700, formaPago: '28' }),
      g({ concepto: 'transporte', monto: 450, formaPago: '28' }),
    ];
    expect(sinTarjeta(gastos)).toHaveLength(1);
  });

  it('CON tarjeta de crédito (04): no avisa — la condición de la ley se cumple', () => {
    const r = cuadrar([
      g({ concepto: 'alimentacion', monto: 700, formaPago: '04' }),
      g({ concepto: 'transporte', monto: 450, formaPago: '01' }),
    ]);
    expect(r.diferencias.some((x) => x.tipo === 'alimentacion_transporte_sin_tarjeta_credito')).toBe(false);
  });

  it('con HOSPEDAJE también presente, la condición de tarjeta no aplica (ya no es "SOLO transporte")', () => {
    const r = cuadrar([
      g({ concepto: 'alimentacion', monto: 700, formaPago: '01' }),
      g({ concepto: 'transporte', monto: 450, formaPago: '01' }),
      g({ concepto: 'hospedaje', monto: 900, formaPago: '01' }),
    ]);
    expect(r.diferencias.some((x) => x.tipo === 'alimentacion_transporte_sin_tarjeta_credito')).toBe(false);
  });

  it('sin transporte ni hospedaje, esto no aplica: es el caso de H1 (alimentacion_sin_soporte)', () => {
    const r = cuadrar([g({ concepto: 'alimentacion', monto: 700, formaPago: '01' })]);
    expect(r.diferencias.some((x) => x.tipo === 'alimentacion_transporte_sin_tarjeta_credito')).toBe(false);
    expect(r.diferencias.some((x) => x.tipo === 'alimentacion_sin_soporte')).toBe(true);
  });

  it('no declara dinero perdido: monto en 0, va a revisión — mismo criterio que H1', () => {
    const r = cuadrar([
      g({ concepto: 'alimentacion', monto: 700, formaPago: '01' }),
      g({ concepto: 'transporte', monto: 450, formaPago: '01' }),
    ]);
    const d = r.diferencias.find((x) => x.tipo === 'alimentacion_transporte_sin_tarjeta_credito')!;
    expect(d.monto).toBe(0);
  });

  it('varias comidas del viaje sin tarjeta: UNA sola observación con el total, no una por comprobante', () => {
    const r = cuadrar([
      g({ concepto: 'alimentacion', monto: 300, formaPago: '01' }),
      g({ concepto: 'alimentacion', monto: 400, formaPago: '01' }),
      g({ concepto: 'transporte', monto: 450, formaPago: '01' }),
    ]);
    const ds = r.diferencias.filter((x) => x.tipo === 'alimentacion_transporte_sin_tarjeta_credito');
    expect(ds).toHaveLength(1);
    expect(ds[0].nota).toContain('$700.00');
  });

  it('va solo al contralor: el operador no puede cambiar retroactivamente cómo pagó', () => {
    expect(SOLO_CONTRALOR).toContain('alimentacion_transporte_sin_tarjeta_credito');
  });
});
