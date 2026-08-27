import { describe, it, expect } from 'vitest';
import { validarDeclaracion, validarMercancia, validarDatosCliente } from './carta_porte_datos';
import { DatoInvalido } from './errores';

// Solo lo puro: la validación de la declaración. El lector y el escritor
// tocan Supabase y no se prueban contra un mock (probaría el mock).

describe('validarDeclaracion', () => {
  it('vacío es "sin declarar", jamás un "no"', () => {
    const d = validarDeclaracion({ pisaFederal: '', radioKm: '' });
    expect(d.pisaFederal).toBeNull();
    expect(d.radioKm).toBeNull();
  });

  it('sí y no se leen como booleanos; otra cosa se rechaza', () => {
    expect(validarDeclaracion({ pisaFederal: 'si', radioKm: '' }).pisaFederal).toBe(true);
    expect(validarDeclaracion({ pisaFederal: 'no', radioKm: '' }).pisaFederal).toBe(false);
    expect(() => validarDeclaracion({ pisaFederal: 'quizas', radioKm: '' })).toThrow(DatoInvalido);
  });

  it('el radio vacío es "no medido", no 0 km', () => {
    expect(validarDeclaracion({ pisaFederal: 'si', radioKm: '' }).radioKm).toBeNull();
  });

  it('el radio acepta coma decimal y se redondea a décimas', () => {
    expect(validarDeclaracion({ pisaFederal: 'si', radioKm: '28,75' }).radioKm).toBe(28.8);
  });

  it('un radio negativo o gigante se rechaza recordando que es RADIO, no odómetro', () => {
    expect(() => validarDeclaracion({ pisaFederal: 'si', radioKm: '-3' })).toThrow(DatoInvalido);
    expect(() => validarDeclaracion({ pisaFederal: 'si', radioKm: '9000' })).toThrow(/RADIO/);
  });

  it('la contradicción "no pisa federal" + radio medido se rechaza, no se guarda ambigua', () => {
    expect(() => validarDeclaracion({ pisaFederal: 'no', radioKm: '20' })).toThrow(DatoInvalido);
  });
});

// ── La mercancía y los datos del cliente (Fase C, 0204) ────────────────────

const MERC_CRUDA = {
  descripcion: 'Cajas de aguacate', bienesTransp: '50301700', cantidad: '120',
  claveUnidad: 'xbx', pesoKg: '1200,5', materialPeligroso: 'no',
};

describe('validarMercancia', () => {
  it('la captura completa pasa: unidad a mayúsculas, coma decimal, «no» explícito', () => {
    const m = validarMercancia(MERC_CRUDA);
    expect(m).toEqual({
      descripcion: 'Cajas de aguacate', bienesTransp: '50301700', cantidad: 120,
      claveUnidad: 'XBX', pesoKg: 1200.5, materialPeligroso: false,
    });
  });

  it('sin descripción no hay renglón — es lo mínimo que el cliente dio', () => {
    expect(() => validarMercancia({ ...MERC_CRUDA, descripcion: '  ' })).toThrow(DatoInvalido);
  });

  it('la clave SAT vacía queda null («no se inventa»); una que no sean 8 dígitos se rechaza', () => {
    expect(validarMercancia({ ...MERC_CRUDA, bienesTransp: '' }).bienesTransp).toBeNull();
    expect(() => validarMercancia({ ...MERC_CRUDA, bienesTransp: '1234' })).toThrow(/no se inventa/);
    expect(() => validarMercancia({ ...MERC_CRUDA, bienesTransp: 'ABCD1234' })).toThrow(DatoInvalido);
  });

  it('cantidad vacía, cero o negativa se rechaza; peso vacío es "sin dato", no cero', () => {
    expect(() => validarMercancia({ ...MERC_CRUDA, cantidad: '' })).toThrow(DatoInvalido);
    expect(() => validarMercancia({ ...MERC_CRUDA, cantidad: '0' })).toThrow(DatoInvalido);
    expect(validarMercancia({ ...MERC_CRUDA, pesoKg: '' }).pesoKg).toBeNull();
    expect(() => validarMercancia({ ...MERC_CRUDA, pesoKg: '0' })).toThrow(DatoInvalido);
  });

  it('material peligroso vacío es NULL (sin declarar), jamás un «no» supuesto', () => {
    expect(validarMercancia({ ...MERC_CRUDA, materialPeligroso: '' }).materialPeligroso).toBeNull();
    expect(validarMercancia({ ...MERC_CRUDA, materialPeligroso: 'si' }).materialPeligroso).toBe(true);
    expect(() => validarMercancia({ ...MERC_CRUDA, materialPeligroso: 'x' })).toThrow(DatoInvalido);
  });
});

const CLIENTE_CRUDO = {
  origenCp: '64000', destinoCp: '76000', origenEstado: 'Nuevo León',
  destinoEstado: 'Querétaro', rfcDestinatario: 'des010101ab1', transpInternac: 'no',
};

describe('validarDatosCliente', () => {
  it('la captura completa pasa, con el RFC a mayúsculas', () => {
    expect(validarDatosCliente(CLIENTE_CRUDO)).toEqual({
      origenCp: '64000', destinoCp: '76000', origenEstado: 'Nuevo León',
      destinoEstado: 'Querétaro', rfcDestinatario: 'DES010101AB1', transpInternac: false,
    });
  });

  it('todo vacío es todo null — el cliente no lo ha dado, no un default', () => {
    expect(validarDatosCliente({
      origenCp: '', destinoCp: '', origenEstado: '', destinoEstado: '',
      rfcDestinatario: '', transpInternac: '',
    })).toEqual({
      origenCp: null, destinoCp: null, origenEstado: null, destinoEstado: null,
      rfcDestinatario: null, transpInternac: null,
    });
  });

  it('un CP que no son 5 dígitos y un RFC malformado se rechazan por formato', () => {
    expect(() => validarDatosCliente({ ...CLIENTE_CRUDO, origenCp: '640' })).toThrow(DatoInvalido);
    expect(() => validarDatosCliente({ ...CLIENTE_CRUDO, rfcDestinatario: 'X-123' })).toThrow(DatoInvalido);
  });
});
