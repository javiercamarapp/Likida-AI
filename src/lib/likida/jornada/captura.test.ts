import { describe, it, expect } from 'vitest';
import { validarCapturaMarca } from './captura';
import type { Asiento } from './modelo';

// A37-S19-01 / A37-S19-02: la captura del contralor firma una hora que se
// compara contra un tope legal. La hora tiene que caer en el día del expediente,
// existir de verdad, venir con su fuente, y la corrección apuntar a una marca
// anulada de la MISMA jornada.

function asiento(p: Partial<Asiento>): Asiento {
  return {
    id: 'a1', tipo: 'inicio_jornada', momento: '2026-03-10T14:00:00Z', procedencia: 'whatsapp',
    origenRef: null, waMessageId: null, viajeId: null, registradoPorEmail: null, nota: null,
    corrigeA: null, anuladoEn: null, anuladoPorEmail: null, anuladoMotivo: null, ...p,
  };
}
const NOTA = 'me lo dijo por teléfono';
const base = { dia: '2026-03-10', nota: NOTA, corrigeA: null as string | null, asientos: [] as Asiento[] };

describe('validarCapturaMarca — la hora', () => {
  it('acepta una hora del día, anclada al huso de México', () => {
    const r = validarCapturaMarca({ ...base, cuando: '2026-03-10T08:05' });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.momento.toISOString()).toBe('2026-03-10T14:05:00.000Z');
  });
  it('acepta el día anterior y el siguiente (un fin de jornada pasada la medianoche)', () => {
    expect(validarCapturaMarca({ ...base, cuando: '2026-03-11T02:00' }).ok).toBe(true);
    expect(validarCapturaMarca({ ...base, cuando: '2026-03-09T23:00' }).ok).toBe(true);
  });
  it.each(['2026-03-13T08:00', '2025-03-10T08:00', '2026-03-07T08:00'])('rechaza %s: lejos del día del expediente', (c) => {
    const r = validarCapturaMarca({ ...base, cuando: c });
    expect(r.ok).toBe(false);
  });
  it.each(['2026-02-30T08:00', '2026-13-01T08:00', '2026-03-10T25:00', '2026-03-10T08:61'])('rechaza %s: no existe', (c) => {
    const r = validarCapturaMarca({ ...base, dia: c.slice(0, 10) === '2026-02-30' ? '2026-03-01' : base.dia, cuando: c });
    expect(r.ok).toBe(false);
  });
  it('rechaza una hora mal formada', () => {
    expect(validarCapturaMarca({ ...base, cuando: '' }).ok).toBe(false);
    expect(validarCapturaMarca({ ...base, cuando: '2026-03-10 08:00' }).ok).toBe(false);
  });
});

describe('validarCapturaMarca — la fuente (nota)', () => {
  it.each(['', '   ', 'ok', '1234'])('rechaza la nota «%s»', (nota) => {
    const r = validarCapturaMarca({ ...base, nota, cuando: '2026-03-10T08:00' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/nota|fuente|de dónde/i);
  });
  it('acepta 5 caracteres recortados', () => {
    expect(validarCapturaMarca({ ...base, nota: '  12345 ', cuando: '2026-03-10T08:00' }).ok).toBe(true);
  });
});

describe('validarCapturaMarca — corrigeA', () => {
  const anulada = asiento({ id: 'x1', anuladoEn: '2026-03-10T16:00:00Z' });
  it('acepta una marca anulada de la misma jornada', () => {
    const r = validarCapturaMarca({ ...base, cuando: '2026-03-10T08:00', corrigeA: 'x1', asientos: [anulada] });
    expect(r).toMatchObject({ ok: true, corrigeA: 'x1' });
  });
  it('rechaza un id que no es de esta jornada (otro operador, mismo tenant)', () => {
    expect(validarCapturaMarca({ ...base, cuando: '2026-03-10T08:00', corrigeA: 'ajeno', asientos: [anulada] }).ok).toBe(false);
  });
  it('rechaza una marca VIVA', () => {
    const viva = asiento({ id: 'v1' });
    expect(validarCapturaMarca({ ...base, cuando: '2026-03-10T08:00', corrigeA: 'v1', asientos: [viva] }).ok).toBe(false);
  });
  it('sin corrigeA devuelve null', () => {
    expect(validarCapturaMarca({ ...base, cuando: '2026-03-10T08:00' })).toMatchObject({ ok: true, corrigeA: null });
  });
});
