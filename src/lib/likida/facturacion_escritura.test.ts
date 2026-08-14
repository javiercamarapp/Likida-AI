import { describe, it, expect } from 'vitest';
import {
  validarFactura, validarPago, evaluarAbono, sumarDias,
  type FacturaCruda, type PagoCrudo,
} from './facturacion_escritura';
import { DatoInvalido } from './errores';

// ═══════════════════════════════════════════════════════════════════════════
// SOLO LO PURO, igual que `clientes.test.ts`: lo que se prueba es la parte que
// decide DINERO — qué factura es válida, cuánto abono cabe, cuándo se salda y
// cuándo vence. Las escrituras (`crearFactura`, `registrarPago`) no se prueban
// contra un mock de Supabase: eso demostraría que el mock funciona.
// ═══════════════════════════════════════════════════════════════════════════

const CLIENTE = '11111111-2222-3333-4444-555555555555';
const UUID_CFDI = 'ad662d33-6934-459c-a128-BDf0393f0f44'; // con mayúsculas a propósito

const FACTURA_OK: FacturaCruda = {
  clienteId: CLIENTE,
  fecha: '2026-08-14',
  subtotal: '10000',
  iva: '1600',
  folio: '',
  cfdiUuid: '',
  viajeIds: [],
};

describe('validarFactura — el total no se teclea, se calcula', () => {
  it('total = subtotal + IVA, redondeado a centavos', () => {
    const f = validarFactura(FACTURA_OK);
    expect(f.subtotal).toBe(10000);
    expect(f.iva).toBe(1600);
    expect(f.total).toBe(11600);
  });

  it('la cola binaria de 0.1 + 0.2 no llega a la base', () => {
    const f = validarFactura({ ...FACTURA_OK, subtotal: '0.1', iva: '0.2' });
    expect(f.total).toBe(0.3);
  });

  it('acepta coma decimal y separador de millares, como se teclea en México', () => {
    const f = validarFactura({ ...FACTURA_OK, subtotal: '10,000.50', iva: '1,600.08' });
    expect(f.subtotal).toBe(10000.5);
    expect(f.iva).toBe(1600.08);
  });

  it('tres decimales se rechazan en vez de redondearse en silencio', () => {
    expect(() => validarFactura({ ...FACTURA_OK, subtotal: '100.505' })).toThrow(DatoInvalido);
  });

  it('el IVA vacío NO se inventa: se exige, aunque sea $0 tecleado', () => {
    expect(() => validarFactura({ ...FACTURA_OK, iva: '' })).toThrow(DatoInvalido);
    expect(validarFactura({ ...FACTURA_OK, iva: '0' }).iva).toBe(0);
  });
});

describe('validarFactura — borrador y emitida, el estatus no miente', () => {
  it('sin UUID nace en borrador: el SAT no la conoce todavía', () => {
    expect(validarFactura(FACTURA_OK).estatus).toBe('borrador');
    expect(validarFactura(FACTURA_OK).cfdiUuid).toBeNull();
  });

  it('con UUID nace emitida, y el UUID se normaliza a minúsculas', () => {
    const f = validarFactura({ ...FACTURA_OK, cfdiUuid: ` ${UUID_CFDI} ` });
    expect(f.estatus).toBe('emitida');
    expect(f.cfdiUuid).toBe(UUID_CFDI.toLowerCase());
  });

  it('un UUID con pinta de folio interno se rechaza con instrucción de dónde copiarlo', () => {
    expect(() => validarFactura({ ...FACTURA_OK, cfdiUuid: 'FAC-2026-001' })).toThrow(/XML|PDF/);
  });

  it('una fecha que no existe se rechaza', () => {
    expect(() => validarFactura({ ...FACTURA_OK, fecha: '2026-02-30' })).toThrow(DatoInvalido);
  });

  it('los viajes se deduplican y un id basura tira el alta completa', () => {
    const v = '99999999-8888-7777-6666-555555555555';
    expect(validarFactura({ ...FACTURA_OK, viajeIds: [v, v] }).viajeIds).toEqual([v]);
    expect(() => validarFactura({ ...FACTURA_OK, viajeIds: ['el-de-ayer'] })).toThrow(DatoInvalido);
  });
});

describe('validarPago', () => {
  const PAGO_OK: PagoCrudo = {
    facturaId: CLIENTE, fecha: '2026-08-14', monto: '5000', metodo: '', referencia: '',
  };

  it('un pago de cero no es un pago', () => {
    expect(() => validarPago({ ...PAGO_OK, monto: '0' })).toThrow(DatoInvalido);
  });

  it('método y referencia vacíos quedan en null, no en cadena vacía', () => {
    const p = validarPago(PAGO_OK);
    expect(p.metodo).toBeNull();
    expect(p.referencia).toBeNull();
  });
});

describe('evaluarAbono — a qué se le abona y cuánto cabe', () => {
  it('a un borrador NO se le abona: sería cobro contra un CFDI que el SAT no conoce', () => {
    const r = evaluarAbono({ estatus: 'borrador', total: 11600, pagado: 0 }, 5000);
    expect(r.rechazo).toContain('borrador');
  });

  it('a una cancelada tampoco', () => {
    expect(evaluarAbono({ estatus: 'cancelada', total: 11600, pagado: 0 }, 5000).rechazo).toContain('cancelada');
  });

  it('el sobrepago se rechaza CON el saldo exacto en el mensaje', () => {
    const r = evaluarAbono({ estatus: 'emitida', total: 11600, pagado: 10000 }, 2000);
    expect(r.rechazo).toContain('1,600');
  });

  it('un pago parcial pasa y NO salda', () => {
    const r = evaluarAbono({ estatus: 'emitida', total: 11600, pagado: 0 }, 5000);
    expect(r.rechazo).toBeNull();
    expect(r.quedaSaldada).toBe(false);
  });

  it('el pago que completa el total salda, con tolerancia de centavo por redondeo', () => {
    expect(evaluarAbono({ estatus: 'emitida', total: 11600, pagado: 5000 }, 6600).quedaSaldada).toBe(true);
    // 3 × $3,866.67 = $11,600.01 de suma tecleada contra $11,600.00: el último
    // abono real de una factura partida en tres no puede quedarse atorado por
    // un centavo de redondeo.
    expect(evaluarAbono({ estatus: 'emitida', total: 11600, pagado: 7733.34 }, 3866.66).quedaSaldada).toBe(true);
  });

  it('la cola binaria de la resta no fabrica saldo: 0.1+0.2 pagado contra 0.3', () => {
    const r = evaluarAbono({ estatus: 'emitida', total: 0.3, pagado: 0.1 + 0.2 }, 0.01);
    expect(r.saldo).toBe(0);
  });
});

describe('sumarDias — de aquí sale el vencimiento', () => {
  it('cruza el fin de mes y el fin de año', () => {
    expect(sumarDias('2026-08-14', 30)).toBe('2026-09-13');
    expect(sumarDias('2026-12-20', 15)).toBe('2027-01-04');
  });

  it('cero días de crédito vence el mismo día: contado', () => {
    expect(sumarDias('2026-08-14', 0)).toBe('2026-08-14');
  });

  it('el año bisiesto no lo corre un día', () => {
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
    expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01');
  });
});
