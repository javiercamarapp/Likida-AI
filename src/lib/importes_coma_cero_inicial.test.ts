import { describe, it, expect } from 'vitest';
import { validarIngreso } from './likida/ingreso_viaje';
import { validarTarifa, type TarifaCruda } from './likida/clientes';
import { validarPago, type PagoCrudo } from './likida/facturacion_escritura';
import { leerCifraImportada } from './likida/importar_viajes';
import { monto, CampoInvalido } from './http/campos_cuerpo';
import { aplicarFormato } from './likida/facturacion/adaptadores/pasos';
import { DatoInvalido } from './likida/errores';

// Residuo (a) de la oleada 4: «coma + 3 dígitos = miles» sigue vigente para el
// dinero («50,000» = 50000), pero los miles NUNCA empiezan con cero: «0,125»
// es 0.125, no 125. Las siete lecturas de dinero comparten la regla.

const ingreso = (s: string) => validarIngreso({ clienteId: '', ingresoFlete: s, kmRecorridos: '' }).ingresoFlete;

const TARIFA: TarifaCruda = {
  clienteId: '', origen: 'Silao', destino: 'Monterrey', modo: 'por_viaje', precio: '1',
  moneda: 'MXN', vigenteDesde: '2026-01-01', vigenteHasta: '', activa: true,
};
const tarifa = (s: string) => validarTarifa({ ...TARIFA, precio: s }).precio;

const PAGO: PagoCrudo = { facturaId: '11111111-1111-4111-8111-111111111111', fecha: '2026-01-15', monto: '1', metodo: '', referencia: '' };
const pago = (s: string) => validarPago({ ...PAGO, monto: s }).monto;

const cuerpo = (s: string) => monto({ m: s }, 'm', { min: 0, max: 10_000_000 });
const pasos = (s: string) => aplicarFormato(s, 'monto');

describe('cero a la izquierda + coma + 3 dígitos NO es separador de miles', () => {
  it('ingreso_viaje', () => {
    expect(ingreso('0,125')).toBe(0.125);
    expect(ingreso('0,5')).toBe(0.5);
    expect(ingreso('1,5')).toBe(1.5);
    expect(ingreso('12,5')).toBe(12.5);
  });
  it('clientes (precio de tarifa)', () => {
    expect(tarifa('0,125')).toBe(0.13); // la tarifa se redondea a centavos; lo que importa: no es 125
    expect(tarifa('0,5')).toBe(0.5);
    expect(tarifa('12,5')).toBe(12.5);
  });
  it('facturacion_escritura (monto de pago)', () => {
    expect(pago('0,5')).toBe(0.5);
    expect(pago('1,5')).toBe(1.5);
    // 0.125 tiene tres decimales: se rechaza por centavos, NO se lee como 125.
    expect(() => pago('0,125')).toThrow(DatoInvalido);
  });
  it('importar_viajes (leerCifraImportada)', () => {
    // A37-L-03: tres decimales ya no se redondean en silencio: se rechaza por centavos, como el resto de las lecturas de dinero.
    expect(leerCifraImportada('0,125')).toBe('ilegible');
    expect(leerCifraImportada('0,5')).toBe(0.5);
    expect(leerCifraImportada('12,5')).toBe(12.5);
  });
  it('campos_cuerpo (monto)', () => {
    // 0.125 trae tres decimales: se rechaza por centavos, NO se lee como 125.
    expect(() => cuerpo('0,125')).toThrow(CampoInvalido);
    expect(cuerpo('0,5')).toBe(0.5);
    expect(cuerpo('12,5')).toBe(12.5);
  });
  it('adaptadores/pasos (monto del portal)', () => {
    expect(pasos('0,125')).toBe('0.13');
    expect(pasos('0,5')).toBe('0.50');
    expect(pasos('12,5')).toBe('12.50');
  });
});

describe('la regla de miles NO cambia', () => {
  it('«50,000», «1,234», «52,500», «1,234.50», «1.234,50»', () => {
    expect(ingreso('50,000')).toBe(50000);
    expect(ingreso('1,234')).toBe(1234);
    expect(ingreso('52,500')).toBe(52500);
    expect(ingreso('1,234.50')).toBe(1234.5);
    expect(tarifa('50,000')).toBe(50000);
    expect(tarifa('1,234')).toBe(1234);
    expect(pago('52,500')).toBe(52500);
    expect(pago('1,234.50')).toBe(1234.5);
    expect(leerCifraImportada('50,000')).toBe(50000);
    expect(leerCifraImportada('1,234')).toBe(1234);
    expect(leerCifraImportada('1,234.50')).toBe(1234.5);
    expect(leerCifraImportada('1.234,50')).toBe(1234.5);
    expect(cuerpo('50,000')).toBe(50000);
    expect(cuerpo('1,234')).toBe(1234);
    expect(cuerpo('1,234.50')).toBe(1234.5);
    expect(pasos('50,000')).toBe('50000.00');
    expect(pasos('1,234')).toBe('1234.00');
    expect(pasos('1,234.50')).toBe('1234.50');
  });
  it('un cero que NO está solo sigue contando: «10,125», «1,000,000», «100,500»', () => {
    expect(ingreso('10,125')).toBe(10125);
    expect(ingreso('1,000,000')).toBe(1000000);
    expect(ingreso('100,500')).toBe(100500);
  });
  it('vacío y basura conservan su comportamiento', () => {
    expect(ingreso('')).toBeNull();
    expect(() => ingreso('abc')).toThrow(DatoInvalido);
    expect(leerCifraImportada('')).toBeNull();
    expect(leerCifraImportada('abc')).toBe('ilegible');
    expect(pasos('')).toBeNull();
    expect(pasos('abc')).toBeNull();
    expect(cuerpo('')).toBeNull();
  });
});
