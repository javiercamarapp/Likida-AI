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

  // ═════════════════════════════════════════════════════════════════════════
  // «MES DE COMPRA + COLA» — la variante que el recon del 28-ago-2026 obligó a
  // añadir. Dos portales lo dicen por escrito y ninguna de las otras cuatro
  // variantes lo expresa; forzarlo a la más parecida habría hecho que el
  // sistema jurara vigente un ticket ya muerto. Ver el comentario del tipo.
  // ═════════════════════════════════════════════════════════════════════════

  it('ADO: el mes de compra entero MÁS 7 días del siguiente', () => {
    // Literal del portal (factura.grupoado.com.mx/FETFS/, leído el 28-ago-2026):
    // «durante el mes que los compraste y como máximo 07 días del siguiente mes».
    const r = calcularCaducidad({
      fechaTicket: '2026-08-03',
      plazo: { mesDeCompraMas: { dias: 7 } },
      hoy: '2026-08-03',
    });
    expect(r.fechaLimite).toBe('2026-09-07');
  });

  it('ADO: un boleto del día 2 y uno del día 30 vencen el MISMO día', () => {
    // Es la prueba de que la cola se cuenta desde el CIERRE DEL MES y no desde
    // la compra. Si se contara desde la compra, el del día 2 vencería el 9-ago
    // y el sistema lo daría por muerto un mes antes de tiempo.
    const plazo = { mesDeCompraMas: { dias: 7 } } as const;
    const temprano = calcularCaducidad({ fechaTicket: '2026-08-02', plazo, hoy: '2026-08-02' });
    const tarde = calcularCaducidad({ fechaTicket: '2026-08-30', plazo, hoy: '2026-08-30' });
    expect(temprano.fechaLimite).toBe('2026-09-07');
    expect(tarde.fechaLimite).toBe('2026-09-07');
  });

  it('Primera Plus: 72 h tras el cierre de mes — el caso de borde que el portal publica', () => {
    // ORÁCULO EXTERNO, no una cuenta nuestra. El portal
    // (www.facturaelectronicagfa.mx) publica el resultado ya resuelto:
    // «Si tu compra se realiza el último día del mes, solo tendrás hasta el día
    // 3 del mes siguiente para solicitar tu factura.»
    // Una compra del 31-ago con 72 h de cola debe dar EXACTAMENTE el 3-sep.
    const r = calcularCaducidad({
      fechaTicket: '2026-08-31',
      plazo: { mesDeCompraMas: { horas: 72 } },
      hoy: '2026-08-31',
    });
    expect(r.fechaLimite).toBe('2026-09-03');
  });

  it('la cola respeta los meses cortos: febrero + 7 días cae en marzo', () => {
    const r = calcularCaducidad({
      fechaTicket: '2026-02-10',
      plazo: { mesDeCompraMas: { dias: 7 } },
      hoy: '2026-02-10',
    });
    expect(r.fechaLimite).toBe('2026-03-07');
  });

  it('la cola NO se pasa al mes siguiente completo, que es el error caro', () => {
    // El punto entero de la variante. Con `'mes_siguiente'` un boleto de ADO
    // del 3-ago habría "vencido" el 30-sep: 23 días DESPUÉS de estar muerto, y
    // el panel diría que hay tiempo mientras la factura ya no se puede emitir.
    const real = calcularCaducidad({ fechaTicket: '2026-08-03', plazo: { mesDeCompraMas: { dias: 7 } }, hoy: '2026-09-20' });
    const siForzado = calcularCaducidad({ fechaTicket: '2026-08-03', plazo: 'mes_siguiente', hoy: '2026-09-20' });
    expect(real.vencido).toBe(true);
    expect(siForzado.vencido).toBe(false); // lo que habría pasado al forzarlo
  });

  it('la cola tampoco se queda corta como el mes natural', () => {
    // El otro error: con `'mes_natural'` el mismo boleto habría "vencido" el
    // 31-ago, y se habría perdido una factura que el portal sí acepta el 5-sep.
    const real = calcularCaducidad({ fechaTicket: '2026-08-03', plazo: { mesDeCompraMas: { dias: 7 } }, hoy: '2026-09-05' });
    const siForzado = calcularCaducidad({ fechaTicket: '2026-08-03', plazo: 'mes_natural', hoy: '2026-09-05' });
    expect(real.vencido).toBe(false);
    expect(siForzado.vencido).toBe(true); // lo que habría pasado al forzarlo
  });

  it('sin fecha de ticket no inventa un plazo', () => {
    // El OCR falla en fechas (se le vio devolver 2023 en un ticket de 2026). Sin
    // fecha confiable NO se puede afirmar que algo está vigente ni vencido.
    const r = calcularCaducidad({ fechaTicket: undefined, plazo: { dias: 15 }, hoy: '2026-07-10' });
    expect(r.desconocido).toBe(true);
    expect(r.vencido).toBe(false);
  });
});
