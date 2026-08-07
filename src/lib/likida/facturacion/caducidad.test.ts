import { describe, it, expect } from 'vitest';
import { calcularCaducidad } from './caducidad';

// El plazo para facturar es el riesgo que nadie enseña. Medido en la cosecha del
// 27-jul-2026 (60 guías de comercios + Clara Intelligence): las gasolineras dan
// 7–15 días y la mayoría de los comercios NO factura pasado el mes natural de la
// compra.
//
// Para una flota que liquida por quincena eso es una trampa: el ticket de diésel
// del día 2 puede estar VENCIDO cuando la oficina cierra la quincena el día 16.
// Un gasto sin CFDI no es deducible — el dinero ya se gastó y el IVA se pierde.
describe('calcularCaducidad', () => {
  it('cuenta los días de plazo desde la fecha de compra', () => {
    const r = calcularCaducidad({ fechaTicket: '2026-07-02', plazo: { dias: 15 }, hoy: '2026-07-10' });
    expect(r.fechaLimite).toBe('2026-07-17');
    expect(r.diasRestantes).toBe(7);
    expect(r.vencido).toBe(false);
  });

  it('marca vencido cuando el plazo ya pasó', () => {
    const r = calcularCaducidad({ fechaTicket: '2026-07-02', plazo: { dias: 7 }, hoy: '2026-07-20' });
    expect(r.vencido).toBe(true);
    expect(r.diasRestantes).toBe(0);
  });

  it('el último día todavía cuenta', () => {
    // El plazo vence AL FINAL del día límite, no al empezar: un ticket que se
    // factura el mismo día del vencimiento sí entra.
    const r = calcularCaducidad({ fechaTicket: '2026-07-02', plazo: { dias: 15 }, hoy: '2026-07-17' });
    expect(r.vencido).toBe(false);
    expect(r.diasRestantes).toBe(0);
  });

  it('"mes natural" vence el último día del mes de la compra', () => {
    // La regla más común: se factura dentro del mes de la operación.
    const r = calcularCaducidad({ fechaTicket: '2026-07-02', plazo: 'mes_natural', hoy: '2026-07-10' });
    expect(r.fechaLimite).toBe('2026-07-31');
    expect(r.diasRestantes).toBe(21);
  });

  it('"mes natural" respeta los meses de 28, 30 y 31 días', () => {
    expect(calcularCaducidad({ fechaTicket: '2026-02-05', plazo: 'mes_natural', hoy: '2026-02-05' }).fechaLimite).toBe('2026-02-28');
    expect(calcularCaducidad({ fechaTicket: '2026-04-05', plazo: 'mes_natural', hoy: '2026-04-05' }).fechaLimite).toBe('2026-04-30');
  });

  it('avisa cuando entra en zona de riesgo', () => {
    // Sirve para que el agente le diga al operador "esto vence en 2 días" antes
    // de que sea tarde, en vez de descubrirlo en el cierre.
    expect(calcularCaducidad({ fechaTicket: '2026-07-02', plazo: { dias: 15 }, hoy: '2026-07-15' }).urgente).toBe(true);
    expect(calcularCaducidad({ fechaTicket: '2026-07-02', plazo: { dias: 15 }, hoy: '2026-07-05' }).urgente).toBe(false);
  });

  it('sin fecha de ticket no inventa un plazo', () => {
    // El OCR falla en fechas (se le vio devolver 2023 en un ticket de 2026). Sin
    // fecha confiable NO se puede afirmar que algo está vigente ni vencido.
    const r = calcularCaducidad({ fechaTicket: undefined, plazo: { dias: 15 }, hoy: '2026-07-10' });
    expect(r.desconocido).toBe(true);
    expect(r.vencido).toBe(false);
  });
});
