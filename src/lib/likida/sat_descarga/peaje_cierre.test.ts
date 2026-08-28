import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }));
vi.mock('@/lib/meta/client', () => ({ sendText: vi.fn() }));

import {
  ultimoDiaDelMes, primerDiaDelMes, diasHastaCierre, umbralDeHoy,
  mensajeCierrePeaje, DIAS_AVISO_DEFECTO, MAX_LINEAS,
} from './peaje_cierre';

describe('el calendario del cierre de mes', () => {
  it('el último día del mes sale bien en meses de 30, 31 y en febrero', () => {
    expect(ultimoDiaDelMes('2026-09-10')).toBe('2026-09-30');
    expect(ultimoDiaDelMes('2026-08-01')).toBe('2026-08-31');
    expect(ultimoDiaDelMes('2026-02-05')).toBe('2026-02-28');
    // 2028 es bisiesto: la cuenta no se hace con una tabla escrita a mano.
    expect(ultimoDiaDelMes('2028-02-05')).toBe('2028-02-29');
    expect(ultimoDiaDelMes('2026-12-31')).toBe('2026-12-31');
  });

  it('el periodo del sello es el día 1: un mes es UN ciclo, no treinta', () => {
    expect(primerDiaDelMes('2026-09-17')).toBe('2026-09-01');
  });

  it('los días que faltan cuentan hasta el cierre, y el último día son cero', () => {
    expect(diasHastaCierre('2026-09-23')).toBe(7);
    expect(diasHastaCierre('2026-09-30')).toBe(0);
    expect(diasHastaCierre('2026-09-01')).toBe(29);
  });
});

describe('umbralDeHoy — dos avisos, no treinta', () => {
  it('avisa con la anticipación de la flota', () => {
    expect(umbralDeHoy('2026-09-23')).toBe(7); // default
    expect(DIAS_AVISO_DEFECTO).toBe(7);
  });

  it('avisa SIEMPRE el último día, sea cual sea la anticipación configurada', () => {
    // Es el aviso que ya no admite postergarse: mañana el derecho no existe.
    expect(umbralDeHoy('2026-09-30', 15)).toBe(0);
    expect(umbralDeHoy('2026-09-30', 1)).toBe(0);
  });

  it('CUALQUIER otro día calla — un aviso diario entrena a ignorarlo', () => {
    expect(umbralDeHoy('2026-09-15')).toBeNull();
    expect(umbralDeHoy('2026-09-22')).toBeNull();
    expect(umbralDeHoy('2026-09-24')).toBeNull();
  });

  it('respeta la anticipación declarada por la flota', () => {
    expect(umbralDeHoy('2026-09-15', 15)).toBe(15);
    expect(umbralDeHoy('2026-09-23', 15)).toBeNull();
  });
});

describe('mensajeCierrePeaje', () => {
  const gastos = [
    { id: 'a', monto: 300, fecha: '2026-09-03' },
    { id: 'b', monto: 450.5, fecha: '2026-09-08' },
  ];

  it('dice el plazo, la lista y el paso exacto — y cita la regla', () => {
    const m = mensajeCierrePeaje(gastos, 7, 750.5);
    expect(m).toMatch(/Faltan 7 días/);
    expect(m).toMatch(/2 cruces de caseta sin CFDI/);
    expect(m).toMatch(/2026-09-03/);
    expect(m).toMatch(/último día del mes en curso/);
    // Likida AVISA; el acto sigue siendo de la flota.
    expect(m).toMatch(/Entra a tu portal/);
  });

  it('el último día habla distinto: HOY vence', () => {
    const m = mensajeCierrePeaje(gastos, 0, 750.5);
    expect(m).toMatch(/HOY vence/);
    expect(m).not.toMatch(/Faltan 0/);
  });

  it('con muchos cruces corta la lista y dice cuántos faltan', () => {
    const muchos = Array.from({ length: 14 }, (_, i) => ({
      id: String(i), monto: 100, fecha: '2026-09-05',
    }));
    const m = mensajeCierrePeaje(muchos, 7, 1400);
    expect(m.match(/^· /gm)).toHaveLength(MAX_LINEAS);
    expect(m).toMatch(/y 4 cruces más/);
  });

  it('un solo cruce se dice en singular', () => {
    const m = mensajeCierrePeaje([gastos[0]], 7, 300);
    expect(m).toMatch(/1 cruce de caseta/);
    expect(m).not.toMatch(/cruces más/);
  });
});
