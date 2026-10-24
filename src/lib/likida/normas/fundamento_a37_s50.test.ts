import { describe, it, expect } from 'vitest';
import { guardiaFundamento } from './fundamento';

// A37-S50-01 (ALTO): al restaurar las citas protegidas, `/ (\d+) /` tomaba
// cualquier número suelto rodeado de espacios del mensaje como si fuera un
// marcador y lo cambiaba por `undefined` (o por otra cita).
// En master los marcadores ya son NUL + índice + NUL (no ` N `): el escenario original
// ya no aplica. Estas pruebas fijan que siga así y endurecen el borde del NUL en el texto.
describe('A37-S50-01 — los números sueltos del mensaje sobreviven a la guardia', () => {
  it('no convierte «1200» ni «3» en undefined cuando quita una cita inventada', () => {
    const r = guardiaFundamento(
      'Tu diésel de 1200 pesos y 3 tickets entra según el artículo 27 de la LISR.',
      [],
    );
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/undefined/);
    expect(r.reply).toContain(' 1200 ');
    expect(r.reply).toContain(' 3 ');
  });

  it('un número suelto que coincide con un índice de cita protegida no se sustituye por la cita', () => {
    const r = guardiaFundamento(
      'Con la regla 2.9 de la RFA 2026 y 0 tickets, ver también el artículo 27 de la LISR.',
      ['rfa-2026-2.9'],
    );
    expect(r.reply).not.toMatch(/undefined/);
    expect(r.reply).toMatch(/ 0 tickets/);
    expect(r.reply.match(/regla 2\.9/gi)?.length ?? 0).toBe(1);
  });

  it('un NUL falso en la respuesta del modelo no se hace pasar por marcador', () => {
    const nul = String.fromCharCode(0);
    const r = guardiaFundamento(`Mira ${nul}0${nul} y 7 pesos, artículo 27 de la LISR`, ['rfa-2026-2.9']);
    expect(r.reply).not.toContain('undefined');
    expect(r.reply).not.toContain(nul);
  });
});

// A37-S50-02: frases de uso corriente en `citas` no son citas.
describe('A37-S50-02 — «Carta Porte» y otras frases sin número no se borran', () => {
  it('«el complemento Carta Porte» sobrevive sin consultar_normas', () => {
    const r = guardiaFundamento('Te falta el complemento Carta Porte en este viaje.', []);
    expect(r.forzado).toBe(false);
    expect(r.reply).toBe('Te falta el complemento Carta Porte en este viaje.');
  });
  it('«salario base de cotización» y «Red Nacional de Autopistas de Cuota» tampoco', () => {
    const t = 'Tu salario base de cotización y la Red Nacional de Autopistas de Cuota cambian el cálculo.';
    const r = guardiaFundamento(t, []);
    expect(r.reply).toBe(t);
  });
  it('una cita numérica inventada SIGUE quitándose', () => {
    const r = guardiaFundamento('Según el artículo 27 de la LISR es deducible.', []);
    expect(r.forzado).toBe(true);
  });
});

// A37-S50-03: números económicos y folios no son citas desnudas.
describe('A37-S50-03 — «unidad 21-B» y «caja 45-D» no se toman por cita desconocida', () => {
  it('conserva el identificador de la unidad y de la caja', () => {
    const t = 'La unidad 21-B y la caja 45-D salen mañana; folio 12-C pendiente.';
    const r = guardiaFundamento(t, []);
    expect(r.forzado).toBe(false);
    expect(r.reply).toBe(t);
  });
  it('la cita desnuda con contexto jurídico se sigue detectando', () => {
    const r = guardiaFundamento('Es deducible conforme al 27-III.', []);
    expect(r.forzado).toBe(true);
  });
});
