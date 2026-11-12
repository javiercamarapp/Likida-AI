import { describe, expect, it } from 'vitest';
import { desdeDePeriodo, periodoVigente } from './filtros';

// Los atajos de periodo solo fijan `desde`: lo que ve la pantalla es lo que valida y exporta la acción (mismo `?desde=&hasta=`).
describe('periodo de facturas', () => {
  const hoy = '2026-11-12';
  it('cada atajo calcula su desde contra la fecha de México', () => {
    expect(desdeDePeriodo('mes', hoy)).toBe('2026-11-01');
    expect(desdeDePeriodo('30', hoy)).toBe('2026-10-14');
    expect(desdeDePeriodo('90', hoy)).toBe('2026-08-15');
    expect(desdeDePeriodo('12m', hoy)).toBe('2025-11-13');
    expect(desdeDePeriodo('todo', hoy)).toBeUndefined();
  });
  it('el segmentado marca el atajo cuyo rango coincide y «personalizado» si no', () => {
    expect(periodoVigente({}, hoy)).toBe('todo');
    expect(periodoVigente({ desde: '2026-11-01' }, hoy)).toBe('mes');
    expect(periodoVigente({ desde: '2026-10-14' }, hoy)).toBe('30');
    expect(periodoVigente({ desde: '2026-10-20' }, hoy)).toBe('personalizado');
    expect(periodoVigente({ desde: '2026-11-01', hasta: '2026-11-10' }, hoy)).toBe('personalizado');
  });
});
