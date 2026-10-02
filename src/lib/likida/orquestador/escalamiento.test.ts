import { describe, expect, it } from 'vitest';
import { limpiarResumen, llaveDedupe, MAX_RESUMEN, taparNumerosLargos, validarEscalacion } from './escalamiento';

describe('taparNumerosLargos', () => {
  it('tapa teléfonos, CLABE y tarjetas, con o sin separadores', () => {
    expect(taparNumerosLargos('llama al 5512345678')).toBe('llama al [número]');
    expect(taparNumerosLargos('55 1234 5678')).toBe('[número]');
    expect(taparNumerosLargos('+52 55-1234-5678.')).toBe('+[número].');
    expect(taparNumerosLargos('CLABE 012345678901234567 fin')).toBe('CLABE [número] fin');
    expect(taparNumerosLargos('4111 1111 1111 1111')).toBe('[número]');
  });
  it('respeta lo corto y lo que no es personal: montos, horas, folios cortos, fechas ISO', () => {
    for (const t of ['12,500.00 pesos', 'a las 14:35', 'folio F-1234', 'viaje 4821', '3.5 horas', 'el 2026-10-02 salió', 'tope 123456789']) expect(taparNumerosLargos(t)).toBe(t);
  });
  it('lineal: una cadena enorme de dígitos y separadores no se cuelga', () => {
    const t0 = Date.now();
    taparNumerosLargos('1 '.repeat(50_000) + 'x');
    taparNumerosLargos('9'.repeat(100_000));
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('limpiarResumen', () => {
  it('quita enlaces, correos y control, y acota a MAX_RESUMEN', () => {
    const r = limpiarResumen('Mira https://x.example/a?b=c o escribe a a.b@mail.example\u0007 ya\n\n\tluego');
    expect(r).toBe('Mira [enlace] o escribe a [correo] ya luego');
    expect(limpiarResumen('x'.repeat(1000))).toHaveLength(MAX_RESUMEN);
  });
});

describe('validarEscalacion', () => {
  const base = { destino: 'liquidacion', motivo: 'diferencia_liquidacion', resumen: 'No cuadra el anticipo.' };
  it('acepta lo válido y normaliza el folio', () => {
    expect(validarEscalacion({ ...base, viaje_folio: ' VJ-100/A ' })).toEqual({ ok: true, valor: { destino: 'liquidacion', motivo: 'diferencia_liquidacion', viajeFolio: 'VJ-100/A', resumen: 'No cuadra el anticipo.' } });
    expect(validarEscalacion(base)).toMatchObject({ ok: true, valor: { viajeFolio: null } });
  });
  it('rechaza dominios abiertos, folios raros y resúmenes vacíos', () => {
    expect(validarEscalacion({ ...base, destino: 'jefe' }).ok).toBe(false);
    expect(validarEscalacion({ ...base, motivo: 7 }).ok).toBe(false);
    expect(validarEscalacion({ ...base, viaje_folio: 'a b' }).ok).toBe(false);
    expect(validarEscalacion({ ...base, viaje_folio: '../../etc' }).ok).toBe(false);
    expect(validarEscalacion({ ...base, resumen: '' }).ok).toBe(false);
    expect(validarEscalacion({ ...base, resumen: 5512345678 as never }).ok).toBe(false);
  });
  it('la llave de dedupe separa por destino, motivo y viaje', () => {
    expect(llaveDedupe({ destino: 'contador', motivo: 'otro' }, null)).toBe('contador|otro|-');
    expect(llaveDedupe({ destino: 'contador', motivo: 'otro' }, 'v1')).not.toBe(llaveDedupe({ destino: 'contador', motivo: 'otro' }, 'v2'));
  });
});
