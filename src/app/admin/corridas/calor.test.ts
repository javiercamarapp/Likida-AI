import { describe, expect, it } from 'vitest';
import { BLOQUES_HORA, diaYHoraMx, matrizDeCorridas } from './calor';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

describe('mapa de calor de corridas', () => {
  it('lee día y hora en hora de México (UTC-6 sin horario de verano)', () => {
    // 2026-11-09 es lunes; 05:30 UTC = 23:30 del domingo 8 en México.
    expect(diaYHoraMx('2026-11-09T05:30:00Z')).toEqual({ dia: 6, hora: 23 });
    expect(diaYHoraMx('2026-11-09T15:00:00Z')).toEqual({ dia: 0, hora: 9 });
    expect(diaYHoraMx('no es fecha')).toBeNull();
  });
  it('cuenta por bloque de 3 horas, no cuenta fechas ilegibles y las dice', () => {
    const m = matrizDeCorridas(['2026-11-09T15:00:00Z', '2026-11-09T16:59:00Z', '2026-11-09T05:30:00Z', 'x'], DIAS);
    expect(m.contadas).toBe(3);
    expect(m.ilegibles).toBe(1);
    expect(m.filas[0].valores).toEqual([0, 0, 0, 2, 0, 0, 0, 0]);
    expect(m.filas[6].valores[BLOQUES_HORA.indexOf('21')]).toBe(1);
  });
});
