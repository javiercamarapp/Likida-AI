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
    // A37-S64-02: 0.125 tiene tres decimales: se rechaza por centavos (como el pago), NO se lee como 125 ni se guarda 0.125.
    expect(() => ingreso('0,125')).toThrow(DatoInvalido);
    expect(ingreso('0,5')).toBe(0.5);
    expect(ingreso('1,5')).toBe(1.5);
    expect(ingreso('12,5')).toBe(12.5);
  });
  it('clientes (precio de tarifa)', () => {
    expect(() => tarifa('0,125')).toThrow(DatoInvalido); // A37-S64-02: ya no se redondea en silencio; tampoco es 125
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
    expect(leerCifraImportada('0,125')).toBe('ilegible'); // A37-S64-02: ya no se redondea a centavos
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
    expect(pasos('0,125')).toBeNull(); // A37-S64-02: ya no se redondea a '0.13' en un documento fiscal
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


describe('A37-S64-02: el punto con tres decimales (miles es-ES) y los centavos de más no se redondean en silencio', () => {
  it('ingreso_viaje: «38.500» y «1234.567» se rechazan; «1.240» km también', () => {
    expect(() => ingreso('38.500')).toThrow(/dos decimales/);
    expect(() => ingreso('1234.567')).toThrow(DatoInvalido);
    expect(() => validarIngreso({ clienteId: '', ingresoFlete: '', kmRecorridos: '1.240' })).toThrow(DatoInvalido);
    expect(ingreso('38500.50')).toBe(38500.5);
  });
  it('clientes: precio «28.500» se rechaza', () => {
    expect(() => tarifa('28.500')).toThrow(DatoInvalido);
    expect(tarifa('28500.50')).toBe(28500.5);
  });
  it('importar_viajes: «38.500», «1.240» y un número con 3 decimales son ilegibles; los centavos sanos pasan', () => {
    expect(leerCifraImportada('38.500')).toBe('ilegible');
    expect(leerCifraImportada('1.240')).toBe('ilegible');
    expect(leerCifraImportada(1234.567)).toBe('ilegible');
    expect(leerCifraImportada(38500.1)).toBe(38500.1);
    expect(leerCifraImportada(1234.56)).toBe(1234.56);
  });
  it('pasos: «1.234» no se escribe como «1.23» y un monto negativo no pierde el signo', () => {
    expect(pasos('1.234')).toBeNull();
    expect(pasos('-500.00')).toBeNull();
    expect(pasos('1,234.50')).toBe('1234.50');
  });
});
