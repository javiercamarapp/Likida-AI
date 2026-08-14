import { describe, it, expect } from 'vitest';
import { validarIngreso, faltaParaElMargen, admiteSugerencia } from './ingreso_viaje';
import { DatoInvalido } from './errores';

const V = (p: Partial<{ clienteId: string; ingresoFlete: string; kmRecorridos: string }> = {}) =>
  validarIngreso({ clienteId: '', ingresoFlete: '', kmRecorridos: '', ...p });

describe('VACÍO NO ES CERO — la regla que sostiene todo el módulo', () => {
  it('un campo vacío entra como null, no como 0', () => {
    // Number('') es 0. Si el vacío entrara como 0, un viaje sin ingreso
    // capturado se contaría como uno que NO PRODUJO NADA: contribución igual a
    // menos todo el gasto, margen -100%, y el promedio de la flota hundido con
    // viajes de los que en realidad no se sabe nada. Las tres cifras se ven
    // plausibles y nadie las cuestionaría.
    const r = V();
    expect(r.ingresoFlete).toBeNull();
    expect(r.kmRecorridos).toBeNull();
    expect(r.clienteId).toBeNull();
  });

  it('espacios en blanco cuentan como vacío', () => {
    expect(V({ ingresoFlete: '   ' }).ingresoFlete).toBeNull();
  });

  it('un CERO TECLEADO sí es cero — es una medición', () => {
    // Un viaje de cortesía, o el tramo de regreso que se factura aparte.
    expect(V({ ingresoFlete: '0' }).ingresoFlete).toBe(0);
    expect(V({ kmRecorridos: '0' }).kmRecorridos).toBe(0);
  });
});

describe('cómo teclea y pega la gente de verdad', () => {
  it('acepta la coma decimal mexicana', () => {
    expect(V({ ingresoFlete: '38500,50' }).ingresoFlete).toBe(38500.5);
  });

  it('acepta el separador de millares pegado desde Excel', () => {
    expect(V({ ingresoFlete: '38,500.00' }).ingresoFlete).toBe(38500);
    expect(V({ kmRecorridos: '1,240' }).kmRecorridos).toBe(1240);
  });

  it('aguanta espacios de sobra', () => {
    expect(V({ ingresoFlete: ' 38 500 ' }).ingresoFlete).toBe(38500);
  });
});

describe('los topes cazan el dedazo al capturar, no tres semanas después', () => {
  it('un flete de 5 millones en UN viaje es un cero de más', () => {
    expect(() => V({ ingresoFlete: '5000001' })).toThrow(DatoInvalido);
    expect(() => V({ ingresoFlete: '5000001' })).toThrow(/cero de más/);
  });

  it('20 mil km en un viaje es un odómetro mal leído (México mide ~3,200)', () => {
    expect(() => V({ kmRecorridos: '20001' })).toThrow(DatoInvalido);
  });

  it('un valor negativo no pasa', () => {
    expect(() => V({ ingresoFlete: '-100' })).toThrow(/no puede ser negativo/);
    expect(() => V({ kmRecorridos: '-1' })).toThrow(/no puede ser negativo/);
  });

  it('texto que no es número no se convierte en NaN silencioso', () => {
    expect(() => V({ ingresoFlete: 'mucho' })).toThrow(/número/);
  });

  it('un flete grande pero plausible SÍ pasa', () => {
    expect(V({ ingresoFlete: '185000' }).ingresoFlete).toBe(185000);
  });
});

describe('el cliente es opcional a propósito', () => {
  it('se puede capturar el monto sin cliente', () => {
    // Muchas flotas capturan primero el monto y asignan el cliente al facturar.
    const r = V({ ingresoFlete: '38500' });
    expect(r.ingresoFlete).toBe(38500);
    expect(r.clienteId).toBeNull();
  });

  it('el id del cliente se limpia de espacios', () => {
    expect(V({ clienteId: '  abc-123  ' }).clienteId).toBe('abc-123');
  });
});

describe('faltaParaElMargen — la pantalla dice QUÉ capturar', () => {
  it('sin ingreso, explica por qué no hay margen', () => {
    // La diferencia entre un guion sin explicación y un dato que el usuario no
    // sabe que puede llenar.
    expect(faltaParaElMargen(V())).toMatch(/ingreso del flete/);
  });

  it('con ingreso capturado no falta nada', () => {
    expect(faltaParaElMargen(V({ ingresoFlete: '38500' }))).toBeNull();
  });

  it('un ingreso de CERO tampoco es una falta', () => {
    expect(faltaParaElMargen(V({ ingresoFlete: '0' }))).toBeNull();
  });
});

describe('admiteSugerencia — la tarifa sugiere, la persona decide', () => {
  it('con el ingreso vacío, sí se ofrece la del catálogo', () => {
    expect(admiteSugerencia(V())).toBe(true);
  });

  it('con un monto ya tecleado, NO se sobrescribe', () => {
    // Sobrescribirlo borraría justo lo que distingue al viaje: el precio
    // negociado.
    expect(admiteSugerencia(V({ ingresoFlete: '42000' }))).toBe(false);
  });

  it('un cero tecleado también se respeta', () => {
    expect(admiteSugerencia(V({ ingresoFlete: '0' }))).toBe(false);
  });
});
