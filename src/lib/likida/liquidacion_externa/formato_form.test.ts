import { describe, it, expect } from 'vitest';
import { leerTelefonos, aplicarAjustes } from './formato_form';
import { FORMATO_BASE } from './formato_flota';

describe('leerTelefonos', () => {
  it('normaliza a E.164 sin «+», quita repetidos y acepta separadores comunes', () => {
    expect(leerTelefonos('5512345678, 55 1234 5678\n+52 33 1234 5678', 'Copia')).toEqual(['525512345678', '523312345678']);
  });
  it('vacío = ninguno', () => { expect(leerTelefonos('  ', 'Copia')).toEqual([]); });
  it('rechaza más de 3 y números que no son celulares mexicanos, sin adivinar', () => {
    expect(() => leerTelefonos('5512345671,5512345672,5512345673,5512345674', 'Copia')).toThrow(/hasta 3/);
    expect(() => leerTelefonos('12345', 'Copia')).toThrow(/dígitos/);
    expect(() => leerTelefonos('14155550123', 'Copia')).toThrow(/celular mexicano/);
  });
});

describe('aplicarAjustes', () => {
  const base = { salida: 'xlsx', fechas: 'iso', titulo: '', mostrarTotal: true, etiquetaTotal: '', encabezados: [], etiquetasDatos: [] };
  it('cambia lo pedido y conserva lo vacío', () => {
    const f = aplicarAjustes(FORMATO_BASE, { ...base, titulo: 'Mi liquidación', encabezados: ['', 'Descripción'], etiquetaTotal: 'Neto' });
    expect(f.salida).toBe('xlsx');
    expect(f.titulo).toBe('Mi liquidación');
    expect(f.columnas[0].encabezado).toBe('Clave');
    expect(f.columnas[1].encabezado).toBe('Descripción');
    expect(f.total.etiqueta).toBe('Neto');
  });
  it('vuelve a validar: una salida inventada se rechaza con palabras', () => {
    expect(() => aplicarAjustes(FORMATO_BASE, { ...base, salida: 'docx' })).toThrow(/pdf.*xlsx/);
  });
  it('un encabezado largo se rechaza, no se recorta', () => {
    expect(() => aplicarAjustes(FORMATO_BASE, { ...base, encabezados: ['x'.repeat(100)] })).toThrow(/hasta 80/);
  });
});
