import { describe, it, expect } from 'vitest';
import {
  evaluarReclamo, estadoTrasAcreditar, resumirSeguimiento, PLAZO_RECLAMO_MESES, DIAS_AVISO_VENCIMIENTO, type ReclamoSeguimiento,
} from './reclamos_seguimiento';

const r = (p: Partial<ReclamoSeguimiento> = {}): ReclamoSeguimiento => ({
  id: 'r1', estado: 'enviado', fechaCobroMasAntiguo: '2026-06-15', montoReclamado: 10_000, montoAcreditado: 0, ...p,
});

describe('el plazo de 3 meses con reloj simulado', () => {
  it('vence exactamente 3 meses después del cobro más antiguo', () => {
    expect(PLAZO_RECLAMO_MESES).toBe(3);
    expect(evaluarReclamo(r(), '2026-07-01').fechaLimite).toBe('2026-09-15');
  });
  it('lejos del vencimiento: ok; a 30 días o menos: por vencer; pasada la fecha: vencido', () => {
    expect(evaluarReclamo(r(), '2026-07-01')).toMatchObject({ alerta: 'ok', diasRestantes: 76 });
    expect(evaluarReclamo(r(), '2026-08-16')).toMatchObject({ alerta: 'por_vencer', diasRestantes: DIAS_AVISO_VENCIMIENTO });
    expect(evaluarReclamo(r(), '2026-08-15').alerta).toBe('ok');
    expect(evaluarReclamo(r(), '2026-09-15')).toMatchObject({ alerta: 'por_vencer', diasRestantes: 0 });
    expect(evaluarReclamo(r(), '2026-09-16')).toMatchObject({ alerta: 'vencido', diasRestantes: -1 });
  });
  it('un reclamo preparado que vence sin enviarse lo dice; uno enviado vencido avisa lo que quedó sin acreditar', () => {
    expect(evaluarReclamo(r({ estado: 'preparado' }), '2026-10-01').mensaje).toMatch(/Venció el 2026-09-15 sin enviarse/);
    expect(evaluarReclamo(r({ estado: 'acreditado_parcial', montoAcreditado: 4000 }), '2026-10-01').mensaje).toMatch(/Faltan por acreditar 6000\.00/);
  });
  it('acreditado completo o rechazado: cerrado, no avisa de plazo aunque pase la fecha', () => {
    expect(evaluarReclamo(r({ estado: 'acreditado', montoAcreditado: 10_000 }), '2027-01-01').alerta).toBe('cerrado');
    expect(evaluarReclamo(r({ estado: 'rechazado' }), '2027-01-01').alerta).toBe('cerrado');
  });
  it('fin de mes: 30-nov + 3 meses = 28-feb (no se desborda a marzo)', () => {
    expect(evaluarReclamo(r({ fechaCobroMasAntiguo: '2026-11-30' }), '2026-12-01').fechaLimite).toBe('2027-02-28');
  });
});

describe('lo acreditado', () => {
  it('pendiente y porcentaje se MIDEN; con cero reclamado el porcentaje es null (no 0)', () => {
    expect(evaluarReclamo(r({ montoAcreditado: 2500 }), '2026-07-01')).toMatchObject({ pendienteAcreditar: 7500, pctAcreditado: 25 });
    expect(evaluarReclamo(r({ montoReclamado: 0 }), '2026-07-01').pctAcreditado).toBeNull();
    expect(evaluarReclamo(r({ montoAcreditado: 12_000 }), '2026-07-01').pendienteAcreditar).toBe(0);
  });
  it('el estado tras una nota de crédito', () => {
    expect(estadoTrasAcreditar('enviado', 10_000, 0)).toBe('enviado');
    expect(estadoTrasAcreditar('enviado', 10_000, 4000)).toBe('acreditado_parcial');
    expect(estadoTrasAcreditar('acreditado_parcial', 10_000, 10_000)).toBe('acreditado');
    expect(estadoTrasAcreditar('enviado', 10_000, 9999.999)).toBe('acreditado');
  });
  it('el resumen suma el pendiente solo de los reclamos abiertos', () => {
    const s = resumirSeguimiento([
      r({ id: 'a', montoAcreditado: 2000 }),
      r({ id: 'b', estado: 'acreditado', montoAcreditado: 10_000 }),
      r({ id: 'c', estado: 'rechazado' }),                                  // rechazado: no cuenta como pendiente
      r({ id: 'd', fechaCobroMasAntiguo: '2026-05-01', montoReclamado: 500 }), // vencido
    ], '2026-09-16');
    expect(s).toMatchObject({ reclamos: 4, montoReclamado: 30_500, montoAcreditado: 12_000, pendienteAcreditar: 8_500, porVencer: 0 });
    expect(s.vencidos).toBe(2); // a (15-sep) y d
  });
});
