import { describe, it, expect } from 'vitest';
import {
  normalizarTag, normalizarNombre, horaDeTexto, horaDeCelda, fechaHoraDeCelda, aInstanteMx, montoDeCelda,
} from './formatos';

describe('normalizarTag — el mismo dispositivo escrito de tres maneras', () => {
  it('mayúsculas y solo letras/dígitos', () => {
    expect(normalizarTag('IMDM 12345678')).toBe('IMDM12345678');
    expect(normalizarTag('imdm-12345678')).toBe('IMDM12345678');
    expect(normalizarTag('  IMDM12345678 ')).toBe('IMDM12345678');
  });
  it('un guion, vacío o «N/A» no es un TAG', () => {
    for (const v of ['', '-', 'N/A', 'n/a', 'null', 'SIN TAG', null, undefined, 'AB1']) expect(normalizarTag(v)).toBeNull();
  });
  it('más de 40 caracteres es basura, no un TAG', () => {
    expect(normalizarTag('A'.repeat(41))).toBeNull();
    expect(normalizarTag('A'.repeat(40))).toBe('A'.repeat(40));
  });
});

describe('normalizarNombre', () => {
  it('sin acentos, minúsculas, sin signos', () => {
    expect(normalizarNombre('  Tepotzotlán – Plaza #1 ')).toBe('tepotzotlan plaza 1');
    expect(normalizarNombre(null)).toBe('');
  });
});

describe('horaDeTexto — 24 h y 12 h en español', () => {
  it('formatos válidos', () => {
    expect(horaDeTexto('14:32')).toBe('14:32:00');
    expect(horaDeTexto('14:32:05')).toBe('14:32:05');
    expect(horaDeTexto('2:32 p. m.')).toBe('14:32:00');
    expect(horaDeTexto('02:32 PM')).toBe('14:32:00');
    expect(horaDeTexto('12:05 a. m.')).toBe('00:05:00');
    expect(horaDeTexto('12:05 PM')).toBe('12:05:00');
    expect(horaDeTexto('00:00:00')).toBe('00:00:00');
    expect(horaDeTexto('23:59:59')).toBe('23:59:59');
  });
  it('una hora imposible es ilegible, no se recorta', () => {
    for (const v of ['24:00', '25:10', '14:60', '14:32:61', '13:00 PM', '0:10 AM', 'tarde', '']) expect(horaDeTexto(v)).toBeNull();
  });
});

describe('horaDeCelda — la fracción de día de Excel', () => {
  it('0.5 = mediodía; 0.6 = 14:24', () => {
    expect(horaDeCelda(0.5)).toBe('12:00:00');
    expect(horaDeCelda(0.6)).toBe('14:24:00');
  });
  it('0, 1 y negativos no son horas (0 = «sin hora», no medianoche)', () => {
    expect(horaDeCelda(0)).toBeNull();
    expect(horaDeCelda(1)).toBeNull();
    expect(horaDeCelda(-0.2)).toBeNull();
    expect(horaDeCelda(1430)).toBeNull();
  });
  it('texto y vacío', () => {
    expect(horaDeCelda('10:21')).toBe('10:21:00');
    expect(horaDeCelda('')).toBeNull();
    expect(horaDeCelda(null)).toBeNull();
  });
});

describe('fechaHoraDeCelda', () => {
  it('ISO con T y con espacio', () => {
    expect(fechaHoraDeCelda('2026-08-05T14:03:22')).toEqual({ fecha: '2026-08-05', hora: '14:03:22' });
    expect(fechaHoraDeCelda('2026-08-05 14:03')).toEqual({ fecha: '2026-08-05', hora: '14:03:00' });
    expect(fechaHoraDeCelda('2026-08-05')).toEqual({ fecha: '2026-08-05', hora: null });
  });
  it('un offset o Z se ignora a propósito: el archivo es hora local de México', () => {
    expect(fechaHoraDeCelda('2026-08-05T14:03:22Z')).toEqual({ fecha: '2026-08-05', hora: '14:03:22' });
    expect(fechaHoraDeCelda('2026-08-05T14:03:22-06:00')).toEqual({ fecha: '2026-08-05', hora: '14:03:22' });
  });
  it('dd/mm/aaaa con hora 12 h en español', () => {
    expect(fechaHoraDeCelda('05/08/2026 02:03 p. m.')).toEqual({ fecha: '2026-08-05', hora: '14:03:00' });
    expect(fechaHoraDeCelda('5/8/26 9:05')).toEqual({ fecha: '2026-08-05', hora: '09:05:00' });
  });
  it('meses en español', () => {
    expect(fechaHoraDeCelda('05-ago-2026')).toEqual({ fecha: '2026-08-05', hora: null });
    expect(fechaHoraDeCelda('5 de agosto de 2026 10:20')).toEqual({ fecha: '2026-08-05', hora: '10:20:00' });
    expect(fechaHoraDeCelda('15/Sep/2026')).toEqual({ fecha: '2026-09-15', hora: null });
    expect(fechaHoraDeCelda('1 sept 2026')).toEqual({ fecha: '2026-09-01', hora: null });
  });
  it('serial de Excel con fracción trae la hora; sin fracción no inventa medianoche', () => {
    const base = (Date.UTC(2026, 7, 5) - Date.UTC(1899, 11, 30)) / 86_400_000;
    expect(fechaHoraDeCelda(base)).toEqual({ fecha: '2026-08-05', hora: null });
    expect(fechaHoraDeCelda(base + 0.5)).toEqual({ fecha: '2026-08-05', hora: '12:00:00' });
  });
  it('fecha buena + hora mala → la fecha entra, la hora no', () => {
    expect(fechaHoraDeCelda('05/08/2026 25:99')).toEqual({ fecha: '2026-08-05', hora: null });
  });
  it('NUNCA voltea mm/dd ni acepta fechas imposibles', () => {
    for (const v of ['05/13/2026', '31/02/2026', '2026-02-30', '32/01/2026', '00/01/2026', '15 xyz 2026']) {
      expect(fechaHoraDeCelda(v).fecha).toBeNull();
    }
  });
  it('basura, vacío, números chicos', () => {
    for (const v of ['', 'caseta', null, undefined, 189, -5, true]) expect(fechaHoraDeCelda(v as never).fecha).toBeNull();
  });
});

describe('aInstanteMx — hora local de México → UTC', () => {
  it('invierno y verano de 2026: México ya no cambia de horario (UTC-6 todo el año)', () => {
    expect(aInstanteMx('2026-01-15', '10:30:00')).toBe('2026-01-15T16:30:00.000Z');
    expect(aInstanteMx('2026-08-05', '10:30:00')).toBe('2026-08-05T16:30:00.000Z');
  });
  it('un archivo de antes de 2022 sí tuvo horario de verano (UTC-5): se calcula, no se asume −6', () => {
    expect(aInstanteMx('2021-07-15', '10:30:00')).toBe('2021-07-15T15:30:00.000Z');
    expect(aInstanteMx('2021-01-15', '10:30:00')).toBe('2021-01-15T16:30:00.000Z');
  });
  it('cruza la medianoche UTC: las 20:00 de México son el día siguiente en UTC', () => {
    expect(aInstanteMx('2026-08-05', '20:00:00')).toBe('2026-08-06T02:00:00.000Z');
    expect(aInstanteMx('2026-08-05', '00:00:00')).toBe('2026-08-05T06:00:00.000Z');
  });
  it('sin fecha u hora → null (jamás medianoche)', () => {
    expect(aInstanteMx(null, '10:00:00')).toBeNull();
    expect(aInstanteMx('2026-08-05', null)).toBeNull();
    expect(aInstanteMx('basura', '10:00:00')).toBeNull();
    expect(aInstanteMx('2026-08-05', '25:00:00')).toBeNull();
    expect(aInstanteMx('2026-08-05', '10:60:00')).toBeNull();
    expect(aInstanteMx('2026-02-30', '10:00:00')).toBeNull();
  });
});

describe('montoDeCelda — el dinero no se adivina', () => {
  it('formatos comunes', () => {
    expect(montoDeCelda('$1,234.56')).toBe(1234.56);
    expect(montoDeCelda('MXN 189.00')).toBe(189);
    expect(montoDeCelda(' 234.50 ')).toBe(234.5);
    expect(montoDeCelda(189.5)).toBe(189.5);
    expect(montoDeCelda('-189')).toBe(-189);
  });
  it('coma decimal: «189,50» son 189.50, NO 18950', () => {
    expect(montoDeCelda('189,50')).toBe(189.5);
    expect(montoDeCelda('12,5')).toBe(12.5);
    expect(montoDeCelda('$ 1.234,56')).toBe(1234.56);
  });
  it('coma de miles: «1,234» son mil doscientos treinta y cuatro', () => {
    expect(montoDeCelda('1,234')).toBe(1234);
    expect(montoDeCelda('1,234,567')).toBe(1234567);
    expect(montoDeCelda('1.234.567')).toBe(1234567);
  });
  it('paréntesis = negativo contable', () => {
    expect(montoDeCelda('(189.00)')).toBe(-189);
    expect(montoDeCelda('($1,234.50)')).toBe(-1234.5);
  });
  it('lo ambiguo o basura es null', () => {
    for (const v of ['', 'N/A', null, undefined, '1,23,45', '12.34.5', '1.2.3', 'abc', '$', '--5', '1e5', NaN, Infinity]) {
      expect(montoDeCelda(v as never)).toBeNull();
    }
  });
});
