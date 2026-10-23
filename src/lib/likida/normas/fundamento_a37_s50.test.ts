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
      [],
    );
    expect(r.reply).not.toMatch(/undefined/);
    expect(r.reply).toMatch(/ 0 tickets/);
    expect(r.reply.match(/regla 2\.9/gi)?.length ?? 0).toBe(1);
  });

  it('un texto que ya trae caracteres privados no rompe la restauración', () => {
    const r = guardiaFundamento('Mira 0 el artículo 27 de la LISR', [], []);
    expect(r.reply).not.toMatch(/undefined/);
  });
});
