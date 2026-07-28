import { describe, it, expect } from 'vitest';
import { fusionarConfig } from './config';

// ═══════════════════════════════════════════════════════════════════════════
// EL OVERRIDE DEL TENANT BORRABA A SUS HERMANOS.
//
// `{ ...DEMO_CONFIG, ...override }` es shallow: si el tenant guarda
// `config: { estimulos: { efectivoTopeMxn: 3000 } }`, el spread REEMPLAZA el
// objeto `estimulos` entero. Se van con él el tope de alimentación, el factor de
// peaje y las claves del IEPS de diésel.
//
// Y no truena: en engine.ts el tope de alimentación se lee con
// `if (topeAlimentacion != null)`, así que al quedar undefined el bloque se
// SALTA. El tope de $750/día de LISR 28-V deja de aplicarse sin un solo error en
// el log, y la liquidación sale diciendo que todo es deducible.
//
// Personalizar un tope no puede tirar los otros tres.
// ═══════════════════════════════════════════════════════════════════════════
const base = {
  empresa: { rfc: 'AAA010101AAA', rfcsAdicionales: ['BBB020202BBB'] },
  estimulos: { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101514'] },
  catalogoCuentas: { diesel: '600-001', caseta: '600-002' },
  politica: [{ concepto: 'diesel', topeMonto: 2500 }],
  salida: 'csv',
};

describe('fusionarConfig', () => {
  it('cambiar UN tope conserva a sus hermanos', () => {
    const r = fusionarConfig(base, { estimulos: { efectivoTopeMxn: 3000 } });
    expect(r.estimulos.efectivoTopeMxn).toBe(3000);          // lo que pidió
    expect(r.estimulos.viaticosTopeFiscalDiarioMxn).toBe(750); // LISR 28-V sigue vivo
    expect(r.estimulos.peajeFactor).toBe(0.5);
    expect(r.estimulos.clavesDieselIeps).toEqual(['15101514']);
  });

  it('sin override devuelve la base intacta', () => {
    expect(fusionarConfig(base, null)).toEqual(base);
    expect(fusionarConfig(base, {})).toEqual(base);
  });

  it('los ARRAYS se reemplazan, no se concatenan', () => {
    // Si la flota define su política de gastos quiere la SUYA. Concatenarla con
    // la de demo le dejaría topes que nadie autorizó.
    const r = fusionarConfig(base, { politica: [{ concepto: 'caseta', topeMonto: 900 }] });
    expect(r.politica).toEqual([{ concepto: 'caseta', topeMonto: 900 }]);
  });

  it('un array vacío también reemplaza: es una decisión, no un hueco', () => {
    expect(fusionarConfig(base, { politica: [] }).politica).toEqual([]);
  });

  it('los mapas concepto→cuenta se mezclan por llave', () => {
    // Que la flota le cambie la cuenta al diésel no debe dejar sin cuenta a la
    // caseta: quedaría undefined en el asiento contable.
    const r = fusionarConfig(base, { catalogoCuentas: { diesel: '500-100' } });
    expect(r.catalogoCuentas).toEqual({ diesel: '500-100', caseta: '600-002' });
  });

  it('los primitivos se reemplazan', () => {
    expect(fusionarConfig(base, { salida: 'contpaqi_txt' }).salida).toBe('contpaqi_txt');
  });

  it('NO muta la base: dos tenants no se contaminan entre sí', () => {
    // DEMO_CONFIG es un módulo compartido. Si el merge lo muta, el override de
    // un tenant se le aplica al siguiente que pida config.
    const copia = structuredClone(base);
    fusionarConfig(base, { estimulos: { efectivoTopeMxn: 9999 }, catalogoCuentas: { diesel: 'X' } });
    expect(base).toEqual(copia);
  });

  it('un objeto anidado a dos niveles también conserva hermanos', () => {
    const b2 = { a: { b: { c: 1, d: 2 }, e: 3 } };
    expect(fusionarConfig(b2, { a: { b: { c: 9 } } })).toEqual({ a: { b: { c: 9, d: 2 }, e: 3 } });
  });
});
