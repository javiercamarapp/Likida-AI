import { describe, it, expect } from 'vitest';
import { guardiaFundamento } from './fundamento';

// W43: al vencer la RFA 2026 (2026-12-31) la guardia quitaba la cita en silencio y dejaba la afirmación en presente SIN fundamento ni aviso.
// Mientras no haya una ficha sucesora verificada en fuente primaria, el operador debe leer que la vigencia está por confirmar.
const ANTES = new Date('2026-10-25T18:00:00Z');
const DESPUES = new Date('2027-01-15T18:00:00Z');

describe('W43 — ficha vencida citada en presente: aviso de vigencia por confirmar', () => {
  const afirma = 'Con la RFA 2026 regla 2.9 puedes pagar hasta el 15% del diésel en efectivo.';
  const reconoce = 'La RFA 2026 regla 2.9 rigió hasta el 31 de diciembre de 2026 y ya no es exigible.';

  it('después del vencimiento, quitar la cita agrega el aviso con la fecha de término y sin citar la norma vencida', () => {
    const r = guardiaFundamento(afirma, ['rfa-2026-2.9'], '', DESPUES);
    expect(r.forzado).toBe(true);
    expect(r.reply).not.toMatch(/RFA\s*2026/);
    expect(r.reply).toMatch(/por confirmar/i);
    expect(r.reply).toContain('31 de diciembre de 2026');
  });

  it('el aviso se agrega una sola vez aunque se cite varias veces o varias fichas vencidas', () => {
    const dos = `${afirma} Y con la RFA 2026 regla 2.1 retienes el 7.5% a operadores.`;
    const r = guardiaFundamento(dos, ['rfa-2026-2.9', 'rfa-2026-2.1'], '', DESPUES);
    expect(r.reply.match(/por confirmar/gi)?.length).toBe(1);
  });

  it('nombrarla para decir que ya no rige no dispara el aviso (no se tocó el texto)', () => {
    const r = guardiaFundamento(reconoce, ['rfa-2026-2.9'], '', DESPUES);
    expect(r.forzado).toBe(false);
    expect(r.reply).toBe(reconoce);
  });

  it('antes del vencimiento no hay aviso', () => {
    const r = guardiaFundamento(afirma, ['rfa-2026-2.9'], '', ANTES);
    expect(r.forzado).toBe(false);
    expect(r.reply).not.toMatch(/por confirmar/i);
  });

  it('una ficha sin vencimiento citada sin permiso no recibe el aviso de vigencia', () => {
    const r = guardiaFundamento('No es deducible por LISR 27-III.', [], '', DESPUES);
    expect(r.reply).not.toMatch(/por confirmar/i);
  });
});
