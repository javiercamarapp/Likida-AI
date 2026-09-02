import { describe, it, expect } from 'vitest';
import { MARGEN_CIERRE_MS, MARGEN_CIERRE_CRITICO_MS, PASOS_CIERRE, crearPresupuesto, PRESUPUESTO_WEBHOOK_MS } from './presupuesto';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · AGEN-A1 (ALTO) — la alarma se apagaba justo donde vigilaba.
//
//   margenDuro() = restante() + MARGEN_CIERRE_MS      (identidad)
//
// El agente pide `min(40_000, restante())`. Siempre que ese `min` lo gana
// `restante()` —el turno llegó con menos de 41 s utilizables— y el agente
// consume su tope, `restante()` aterriza en 0 y `margenDuro()` en
// `MARGEN_CIERRE_MS − ε`. El chequeo `margenDuro() >= MARGEN_CIERRE_MS` daba
// FALSO determinísticamente, no por mala suerte, y con él se suprimía el único
// aviso de que la liquidación salió corta.
//
// La causa es un doble descuento: `restante()` YA reservó el margen antes de
// dárselo al agente. Lo que el chequeo tiene que responder es «¿alcanzo lo
// irrenunciable?» — mandar la respuesta, firmar el PDF, entregarlo.
// ═══════════════════════════════════════════════════════════════════════════
describe('AGEN-A1: el margen que se exige al cerrar es el irrenunciable', () => {
  it('el crítico es estrictamente menor que la reserva — si no, el doble descuento sigue', () => {
    expect(MARGEN_CIERRE_CRITICO_MS).toBeLessThan(MARGEN_CIERRE_MS);
    expect(MARGEN_CIERRE_CRITICO_MS).toBeGreaterThan(0);
  });

  it('es exactamente la suma de los pasos críticos a su techo duro', () => {
    const esperado = PASOS_CIERRE.filter((p) => p.critico).reduce((s, p) => s + p.techoMs, 0);
    expect(MARGEN_CIERRE_CRITICO_MS).toBe(esperado);
  });

  // El escenario del reporte, con sus números: barrera de intake agotada, mutex
  // y lecturas previas, el agente arranca con 45 s gastados y consume su tope
  // recortado.
  it('tras consumir el tope recortado, el cierre SÍ tiene margen irrenunciable', () => {
    let ahora = 0;
    const reloj = crearPresupuesto(PRESUPUESTO_WEBHOOK_MS, () => ahora, 0);
    ahora = 45_000;
    const topeAgente = Math.min(40_000, reloj.restante());
    ahora = 45_000 + topeAgente + 5;   // el agente consumió su tope (+ε)

    const margenReal = reloj.margenDuro();
    // Lo que rompía: `margenReal < MARGEN_CIERRE_MS` por identidad.
    expect(margenReal).toBeLessThan(MARGEN_CIERRE_MS);
    // Y lo que ahora se afirma: alcanza para lo que no se puede dejar de hacer.
    expect(margenReal).toBeGreaterThanOrEqual(MARGEN_CIERRE_CRITICO_MS);
  });
});
