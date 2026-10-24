import { describe, expect, it } from 'vitest';
import { esFechaReal } from './fecha_real';
import { altaBajaDeTag, marcarReclamoEnviado, registrarNotaDeCredito } from './repo';

describe('A37-S64-08: fechas de peajes validadas con ida y vuelta', () => {
  it('acepta fechas reales y rechaza las que no existen', () => {
    expect(esFechaReal('2026-02-28')).toBe(true);
    expect(esFechaReal('2028-02-29')).toBe(true);
    expect(esFechaReal('2026-02-30')).toBe(false);
    expect(esFechaReal('2026-13-01')).toBe(false);
    expect(esFechaReal('2026-2-3')).toBe(false);
  });
  it('baja de TAG, envío de reclamo y nota de crédito rechazan 2026-02-30 con motivo claro, sin tocar la base', async () => {
    const t = '11111111-1111-1111-1111-111111111111';
    const baja = await altaBajaDeTag(t, { tag: 'TAG12345', bajaEn: '2026-02-30' });
    expect(baja).toEqual({ ok: false, motivo: 'La fecha de baja debe ser AAAA-MM-DD.' });
    const env = await marcarReclamoEnviado(t, '22222222-2222-2222-2222-222222222222', '2026-02-30');
    expect(env).toEqual({ ok: false, motivo: 'La fecha de envío debe ser AAAA-MM-DD.' });
    const nota = await registrarNotaDeCredito(t, { reclamoId: '22222222-2222-2222-2222-222222222222', monto: 10, fecha: '2026-02-30' });
    expect(nota).toEqual({ ok: false, motivo: 'La fecha de la nota debe ser AAAA-MM-DD.' });
  });
});
