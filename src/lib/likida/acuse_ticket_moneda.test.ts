import { describe, it, expect } from 'vitest';
import { mensajeAcuse, mensajeConfirmar, type LecturaTicket } from './acuse_ticket';

// FISCAL-19C2-3 (barrido MEDIO/BAJO) — un ticket en USD se anunciaba en el
// acuse como si fueran pesos (`mxn(45)` → "$45.00"), sin que nada avisara
// que la cifra no está en la moneda que dice. El motor ya lo excluye del
// acreditamiento (`moneda_extranjera`, engine.ts), pero el mensaje inmediato
// mentía la cifra al chofer.

const base: LecturaTicket = {
  montoMxn: 45, concepto: 'diésel', fecha: '2026-08-01', confianza: 0.95,
  deCfdi: false, esRepeticion: false,
};

describe('FISCAL-19C2-3: el acuse no anuncia una cifra extranjera como si fueran pesos', () => {
  it('sin moneda declarada (o MXN), se formatea como siempre', () => {
    expect(mensajeAcuse(base, null)).toContain('$45.00');
    expect(mensajeAcuse({ ...base, moneda: 'MXN' }, null)).toContain('$45.00');
  });

  it('con una moneda distinta, el código va al frente del monto', () => {
    const msg = mensajeAcuse({ ...base, moneda: 'USD' }, null);
    expect(msg).toContain('USD 45.00');
    expect(msg).not.toMatch(/\$45\.00(?!.*USD)/);
  });

  it('mensajeConfirmar (el de los botones) hace lo mismo', () => {
    const { cuerpo } = mensajeConfirmar('g1', { ...base, moneda: 'USD' }, null);
    expect(cuerpo).toContain('USD 45.00');
  });
});
