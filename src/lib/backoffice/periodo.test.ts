import { describe, expect, it } from 'vitest';
import { desplazarMes, diaMxDeInstante, diasCalendarioEntre, diasHabilesEntre, esPeriodo, etiquetaMes, instanteEnPeriodo, mesDeMx, rangoMes, ultimosMeses } from './periodo';

describe('periodo: el mes es el de México, no el de UTC', () => {
  it('31-dic 18:01 en México ya es 1-ene en UTC, pero el periodo sigue siendo diciembre', () => {
    // 2027-01-01T00:01:00Z = 31-dic-2026 18:01 hora de México (UTC-6, sin horario de verano).
    expect(mesDeMx(new Date('2027-01-01T00:01:00Z'))).toBe('2026-12-01');
    // Seis horas después ya es enero también en México.
    expect(mesDeMx(new Date('2027-01-01T06:00:00Z'))).toBe('2027-01-01');
    // El último segundo de enero en México.
    expect(mesDeMx(new Date('2027-02-01T05:59:59Z'))).toBe('2027-01-01');
  });

  it('instanteEnPeriodo usa el mes de México en la frontera, y lo ausente o ilegible nunca cae «dentro»', () => {
    expect(instanteEnPeriodo('2027-01-01T00:01:00Z', '2026-12-01')).toBe(true);
    expect(instanteEnPeriodo('2027-01-01T00:01:00Z', '2027-01-01')).toBe(false);
    expect(instanteEnPeriodo(null, '2026-12-01')).toBe(false);
    expect(instanteEnPeriodo('no es una fecha', '2026-12-01')).toBe(false);
  });

  it('diaMxDeInstante devuelve el día de México o null', () => {
    expect(diaMxDeInstante('2027-01-01T00:01:00Z')).toBe('2026-12-31');
    expect(diaMxDeInstante(undefined)).toBeNull();
    expect(diaMxDeInstante('x')).toBeNull();
  });
});

describe('periodo: validación y aritmética de meses', () => {
  it('esPeriodo solo acepta AAAA-MM-01', () => {
    expect(esPeriodo('2026-10-01')).toBe(true);
    expect(esPeriodo('2026-10-02')).toBe(false);
    expect(esPeriodo('2026-13-01')).toBe(false);
    expect(esPeriodo('2026-00-01')).toBe(false);
    expect(esPeriodo(20261001)).toBe(false);
    expect(esPeriodo(null)).toBe(false);
  });

  it('desplazarMes cruza años en los dos sentidos', () => {
    expect(desplazarMes('2026-12-01', 1)).toBe('2027-01-01');
    expect(desplazarMes('2026-01-01', -1)).toBe('2025-12-01');
    expect(desplazarMes('2026-03-01', -14)).toBe('2025-01-01');
    expect(desplazarMes('2026-11-01', 0)).toBe('2026-11-01');
    expect(() => desplazarMes('2026-11-05', 1)).toThrow();
  });

  it('ultimosMeses termina en el periodo dado y va del más viejo al más reciente', () => {
    expect(ultimosMeses('2026-02-01', 4)).toEqual(['2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01']);
    expect(ultimosMeses('2026-02-01', 1)).toEqual(['2026-02-01']);
  });
});

describe('periodo: rangoMes', () => {
  it('da el último día real del mes, febrero bisiesto incluido', () => {
    expect(rangoMes('2026-02-01').ultimoDia).toBe('2026-02-28');
    expect(rangoMes('2028-02-01').ultimoDia).toBe('2028-02-29');
    expect(rangoMes('2026-12-01').ultimoDia).toBe('2026-12-31');
    expect(rangoMes('2026-04-01').ultimoDia).toBe('2026-04-30');
  });

  it('los límites en instante son la medianoche de México (-06:00), con fin exclusivo', () => {
    const r = rangoMes('2026-12-01');
    expect(r.desdeIso).toBe('2026-12-01T00:00:00-06:00');
    expect(r.hastaIso).toBe('2027-01-01T00:00:00-06:00');
    expect(r.finExclusivo).toBe('2027-01-01');
    // El 31-dic 18:01 de México (01-ene 00:01 UTC) cae DENTRO del rango de diciembre.
    const t = new Date('2027-01-01T00:01:00Z').getTime();
    expect(t >= new Date(r.desdeIso).getTime() && t < new Date(r.hastaIso).getTime()).toBe(true);
  });
});

describe('periodo: diasHabilesEntre', () => {
  it('cuenta lunes a viernes después de `desde` hasta `hasta` inclusive', () => {
    // 30-oct-2026 es viernes; el lunes 2, martes 3 y miércoles 4 de noviembre son 3 días hábiles.
    expect(diasHabilesEntre('2026-10-30', '2026-11-04')).toBe(3);
    // De viernes a sábado y domingo no pasa ningún día hábil.
    expect(diasHabilesEntre('2026-10-30', '2026-11-01')).toBe(0);
    // Una semana completa: 5.
    expect(diasHabilesEntre('2026-11-02', '2026-11-09')).toBe(5);
  });

  it('el mismo día o una fecha anterior es 0, y una fecha ilegible o inexistente es null (no 0)', () => {
    expect(diasHabilesEntre('2026-11-04', '2026-11-04')).toBe(0);
    expect(diasHabilesEntre('2026-11-10', '2026-11-04')).toBe(0);
    expect(diasHabilesEntre('2026-02-30', '2026-03-04')).toBeNull();
    expect(diasHabilesEntre('hoy', '2026-03-04')).toBeNull();
  });
});

describe('periodo: diasCalendarioEntre', () => {
  it('cuenta días de calendario con signo y devuelve null si una fecha no existe', () => {
    expect(diasCalendarioEntre('2026-11-01', '2026-11-16')).toBe(15);
    expect(diasCalendarioEntre('2026-11-16', '2026-11-01')).toBe(-15);
    expect(diasCalendarioEntre('2026-11-16', '2026-11-16')).toBe(0);
    expect(diasCalendarioEntre('2026-12-30', '2027-01-02')).toBe(3);
    expect(diasCalendarioEntre('2026-02-30', '2026-03-01')).toBeNull();
  });
});

describe('periodo: etiquetas', () => {
  it('rotula el mes en el idioma pedido y devuelve el texto tal cual si no es un periodo', () => {
    expect(etiquetaMes('2026-10-01', 'es')).toContain('2026');
    expect(etiquetaMes('2026-10-01', 'en')).toMatch(/October/);
    expect(etiquetaMes('basura', 'es')).toBe('basura');
  });
});
