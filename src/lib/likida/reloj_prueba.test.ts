import { describe, it, expect } from 'vitest';
import { conReloj, instanteDeLocal, ZONA_CANCUN, ZONA_CDMX, ZONA_FRONTERA } from './reloj_prueba';

const iso = (ms: number) => new Date(ms).toISOString();

describe('reloj_prueba (T-SYS-08)', () => {
  it('2026-10-20 09:00 CDMX = 15:00Z y Date.now()/new Date() lo reflejan', async () => {
    await conReloj('2026-10-20T09:00', ZONA_CDMX, () => {
      expect(new Date().toISOString()).toBe('2026-10-20T15:00:00.000Z');
      expect(Date.now()).toBe(Date.parse('2026-10-20T15:00:00Z'));
    });
  });

  it('Cancún (UTC−5) y CDMX (UTC−6) difieren 1 h en octubre para la misma hora de pared', () => {
    const cancun = instanteDeLocal('2026-10-20T09:00', ZONA_CANCUN);
    const cdmx = instanteDeLocal('2026-10-20T09:00', ZONA_CDMX);
    expect(iso(cancun)).toBe('2026-10-20T14:00:00.000Z');
    expect(cdmx - cancun).toBe(3_600_000);
  });

  it('Cancún no cambia con el verano: mismo desfase en julio y en octubre', () => {
    expect(iso(instanteDeLocal('2026-07-01T09:00', ZONA_CANCUN))).toBe('2026-07-01T14:00:00.000Z');
    expect(iso(instanteDeLocal('2026-10-20T09:00', ZONA_CANCUN))).toBe('2026-10-20T14:00:00.000Z');
  });

  it('CDMX no usa horario de verano desde 2022: UTC−6 en julio y en octubre', () => {
    expect(iso(instanteDeLocal('2026-07-01T09:00', ZONA_CDMX))).toBe('2026-07-01T15:00:00.000Z');
    expect(iso(instanteDeLocal('2026-10-20T09:00', ZONA_CDMX))).toBe('2026-10-20T15:00:00.000Z');
  });

  it('frontera (Nuevo Laredo/Matamoros) con DST: UTC−5 el 2026-07-01 y el 2026-10-20, UTC−6 en diciembre', () => {
    expect(iso(instanteDeLocal('2026-07-01T09:00', ZONA_FRONTERA))).toBe('2026-07-01T14:00:00.000Z');
    expect(iso(instanteDeLocal('2026-10-20T09:00', ZONA_FRONTERA))).toBe('2026-10-20T14:00:00.000Z');
    expect(iso(instanteDeLocal('2026-12-01T09:00', ZONA_FRONTERA))).toBe('2026-12-01T15:00:00.000Z');
  });

  it('la misma hora de pared frontera vs CDMX difiere 1 h en verano y 0 h en invierno (riesgo de «zona única por flota»)', () => {
    const dif = (f: string) => instanteDeLocal(f, ZONA_CDMX) - instanteDeLocal(f, ZONA_FRONTERA);
    expect(dif('2026-10-20T09:00')).toBe(3_600_000);
    expect(dif('2026-12-01T09:00')).toBe(0);
  });

  it('cruce de medianoche: 23:30 CDMX del 20-oct ya es 21-oct en UTC y en Cancún 00:30 del 21 es 05:30Z', async () => {
    await conReloj('2026-10-20T23:30', ZONA_CDMX, () => {
      expect(new Date().toISOString()).toBe('2026-10-21T05:30:00.000Z');
    });
    expect(iso(instanteDeLocal('2026-10-21T00:30', ZONA_CANCUN))).toBe('2026-10-21T05:30:00.000Z');
  });

  it('29-feb inexistente (2026 no es bisiesto) lanza; 29-feb-2028 sí existe', () => {
    expect(() => instanteDeLocal('2026-02-29T09:00', ZONA_CDMX)).toThrow(/no existe/);
    expect(iso(instanteDeLocal('2028-02-29T09:00', ZONA_CDMX))).toBe('2028-02-29T15:00:00.000Z');
  });

  it('hora inexistente por salto de horario de verano (frontera, 2026-03-08 02:30) lanza', () => {
    expect(() => instanteDeLocal('2026-03-08T02:30', ZONA_FRONTERA)).toThrow(/salto de horario/);
  });

  it('formato inválido lanza con mensaje claro', () => {
    expect(() => instanteDeLocal('20/10/2026 09:00', ZONA_CDMX)).toThrow(/formato inválido/);
  });

  it('restaura el reloj real al terminar y también si fn lanza o rechaza', async () => {
    const antes = Date.now();
    await conReloj('2020-01-01T00:00', ZONA_CDMX, () => undefined);
    expect(Date.now()).toBeGreaterThanOrEqual(antes);
    await expect(conReloj('2020-01-01T00:00', ZONA_CDMX, () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(conReloj('2020-01-01T00:00', ZONA_CDMX, async () => { throw new Error('boom2'); })).rejects.toThrow('boom2');
    expect(Date.now()).toBeGreaterThanOrEqual(antes);
  });

  it('devuelve el valor de fn (síncrono y asíncrono)', async () => {
    expect(await conReloj('2026-10-20T09:00', ZONA_CDMX, () => 7)).toBe(7);
    expect(await conReloj('2026-10-20T09:00', ZONA_CDMX, async () => 'a')).toBe('a');
  });
});
