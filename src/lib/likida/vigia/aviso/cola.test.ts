import { describe, it, expect } from 'vitest';
import { contarPendientesViejos, HORAS_PENDIENTE_VIEJO } from './cola';

const AHORA = new Date('2026-10-05T18:00:00Z');
const hace = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
const en = (h: number) => new Date(AHORA.getTime() + h * 3_600_000).toISOString();

describe('contarPendientesViejos', () => {
  it('sin avisos pendientes, cero', () => {
    expect(contarPendientesViejos([], AHORA)).toBe(0);
  });
  it('cuenta el que lleva más de 2 h y no el reciente; justo en el corte ya cuenta', () => {
    expect(HORAS_PENDIENTE_VIEJO).toBe(2);
    const r = contarPendientesViejos([
      { creadoEn: hace(3), cita: en(4) }, { creadoEn: hace(2), cita: en(4) }, { creadoEn: hace(1.9), cita: en(4) },
    ], AHORA);
    expect(r).toBe(2);
  });
  it('un aviso viejo cuya cita ya pasó está caducado, no atorado; sin cita (o ilegible) sí cuenta', () => {
    const r = contarPendientesViejos([
      { creadoEn: hace(5), cita: hace(1) }, { creadoEn: hace(5), cita: null }, { creadoEn: hace(5), cita: 'no es fecha' },
    ], AHORA);
    expect(r).toBe(2);
  });
  it('un creadoEn ilegible no cuenta', () => {
    expect(contarPendientesViejos([{ creadoEn: 'x', cita: null }], AHORA)).toBe(0);
  });
});
