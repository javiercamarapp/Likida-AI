// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD 22-ago-2026 · DAT-18 y DAT-19 — LAS DOS FORMAS DE METER UNA
// CIFRA QUE NADIE MIDIÓ EN LA COLUMNA DE PESOS.
//
// DAT-18 · el schema del OCR pedía `monto: z.number()` SIN tope y el acuse
// callaba con `confianza >= 0.9`. Un OCR está igual de seguro leyendo $850.00
// que $850,000.00: la confianza mide qué tan nítido se vio el papel, no si la
// cifra cabe en un viaje de carga. Un punto decimal perdido multiplica por
// diez con la misma confianza, entra al comprobado, y la diferencia contra el
// anticipo sale «a favor del operador» por una cifra que nadie tecleó.
//
// DAT-19 · ni el OCR ni el parser del XML leían `Moneda`/`TipoCambio`, así que
// el `@Total` de un CFDI en dólares —frontera, casetas de EE. UU., un hotel que
// factura en USD— entraba TAL CUAL en la columna de pesos. USD 450 se
// comprobaba como $450.00 MXN, y su IVA se acreditaba sobre esa misma cifra.
//
// Los dos arreglos comparten criterio y por eso comparten archivo: el motor NO
// convierte ni corrige. Declara lo que no puede dar por bueno y lo manda a una
// persona, que es la regla que define a este producto.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import { esMontoImplausible, umbralMontoImplausible, decidirAcuse, TOPE_MONTO_PISO_MXN } from '../acuse_ticket';
import type { Gasto } from '@/types/likida';

const politica: PoliticaGasto[] = [{ concepto: 'diesel', topeMonto: 999_999 }];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: [] };

const diesel = (extra: Partial<Gasto> = {}): Gasto => ({
  id: 'g1', concepto: 'diesel', monto: 8000, folio: 'A1', fecha: '2026-05-01', ocrConfianza: 0.95,
  cfdiUuid: 'u-g1', xmlVerificado: true, rfcReceptor: 'REC010101AA1', formaPago: '04',
  ivaTraslado: 1103.45, subTotal: 6896.55, ...extra,
});

const cuadra = (g: Gasto) =>
  cuadrarViaje({ viajeId: 'v1', anticipo: 10_000, politica, estimulos: EST, gastos: [g] });

describe('DAT-18 · el umbral de escala', () => {
  it('el piso de $50,000 aplica cuando no hay anticipo capturado', () => {
    // `anticipo` 0 es el default de la tabla. Con «3 × 0» hasta el primer
    // ticket de casetas sería sospechoso.
    expect(umbralMontoImplausible(0)).toBe(TOPE_MONTO_PISO_MXN);
    expect(umbralMontoImplausible(null)).toBe(TOPE_MONTO_PISO_MXN);
    expect(umbralMontoImplausible(undefined)).toBe(TOPE_MONTO_PISO_MXN);
  });

  it('con anticipo grande manda el 3×, no el piso', () => {
    expect(umbralMontoImplausible(40_000)).toBe(120_000);
    expect(esMontoImplausible(100_000, 40_000), 'cabe en un viaje de $40,000 de anticipo').toBe(false);
    expect(esMontoImplausible(130_000, 40_000)).toBe(true);
  });

  it('el viaje normal no dispara: un diésel de $8,000 con anticipo de $10,000', () => {
    expect(esMontoImplausible(8_000, 10_000)).toBe(false);
  });

  it('el caso del hallazgo: el punto decimal perdido', () => {
    // $850.00 leído como $850,000.00 en un viaje de $10,000 de anticipo.
    expect(esMontoImplausible(850_000, 10_000)).toBe(true);
  });

  it('un monto que no es un número no es implausible: es otro problema', () => {
    expect(esMontoImplausible(null, 10_000)).toBe(false);
    expect(esMontoImplausible(Number.POSITIVE_INFINITY, 10_000)).toBe(false);
  });
});

describe('DAT-18 · el acuse deja de callar sobre una cifra fuera de escala', () => {
  const lectura = {
    montoMxn: 850_000, concepto: 'diesel', fecha: '2026-05-01',
    confianza: 0.99, deCfdi: false, esRepeticion: false,
  };

  it('con confianza 0.99 y fuera de escala: se PIDE confirmación, no se calla', () => {
    // Era exactamente el camino del hallazgo: `confianza >= 0.9` → 'acusar'.
    expect(decidirAcuse({ ...lectura, montoImplausible: true }).peldano).toBe('confirmar');
  });

  it('CONTROL — la misma lectura sin la marca sigue callando', () => {
    expect(decidirAcuse(lectura).peldano).toBe('acusar');
  });

  it('un CFDI grande NO se le pregunta al chofer: el total lo selló el SAT', () => {
    // Pedirle que valide una cifra timbrada es el mismo teatro que el módulo ya
    // descarta para cualquier CFDI.
    expect(decidirAcuse({ ...lectura, deCfdi: true, montoImplausible: true }).peldano).toBe('acusar');
  });
});

describe('DAT-18 · el motor lo levanta aunque el chofer no haya contestado', () => {
  it('marcado en ocrExtra → diferencia monto_implausible y liquidación a revisar', () => {
    const r = cuadra(diesel({ monto: 850_000, ocrExtra: { montoImplausible: true } }));
    const d = r.diferencias.find((x) => x.tipo === 'monto_implausible');
    expect(d, 'sin esto, el contralor firma una cifra que nadie miró').toBeDefined();
    expect(d!.gastoId).toBe('g1');
    expect(d!.monto, 'no castiga: el dinero puede ser real, sólo hay que verlo').toBe(0);
    expect(r.estatus).toBe('revisar');
  });

  it('CONTROL — sin la marca, el mismo gasto no levanta nada', () => {
    expect(cuadra(diesel()).diferencias.some((x) => x.tipo === 'monto_implausible')).toBe(false);
  });
});

describe('DAT-19 · un comprobante que no está en pesos', () => {
  it('USD: se declara, se manda a revisar y NO se convierte', () => {
    const r = cuadra(diesel({ monto: 450, ivaTraslado: 62.07, subTotal: 387.93, ocrExtra: { moneda: 'USD', tipoCambio: 18.75 } }));
    const d = r.diferencias.find((x) => x.tipo === 'moneda_extranjera');
    expect(d).toBeDefined();
    expect(d!.nota).toContain('USD');
    expect(d!.nota, 'el tipo de cambio declarado se enseña, no se aplica').toContain('18.75');
    expect(r.totalComprobado, 'la cifra NO se toca: convertirla sería inventar un número').toBe(450);
    expect(r.estatus).toBe('revisar');
  });

  it('y su IVA no se acredita como pesos', () => {
    // Era la mitad cara del hallazgo: acreditar IVA sobre una cifra que nadie
    // convirtió es acreditar de más, y responde el cliente.
    const r = cuadra(diesel({ monto: 450, ivaTraslado: 62.07, subTotal: 387.93, ocrExtra: { moneda: 'USD', tipoCambio: 18.75 } }));
    expect(r.ivaAcreditable).toBe(0);
  });

  it('MXN declarado explícitamente NO dispara nada', () => {
    const r = cuadra(diesel({ ocrExtra: { moneda: 'MXN' } }));
    expect(r.diferencias.some((x) => x.tipo === 'moneda_extranjera')).toBe(false);
    expect(r.ivaAcreditable).toBeGreaterThan(0);
  });

  it('sin moneda declarada tampoco: es el caso de casi todo ticket mexicano', () => {
    const r = cuadra(diesel());
    expect(r.diferencias.some((x) => x.tipo === 'moneda_extranjera')).toBe(false);
    expect(r.ivaAcreditable).toBeGreaterThan(0);
  });

  it('sin tipo de cambio declarado lo dice, en vez de callarlo', () => {
    const r = cuadra(diesel({ ocrExtra: { moneda: 'USD' } }));
    const d = r.diferencias.find((x) => x.tipo === 'moneda_extranjera')!;
    expect(d.nota).toMatch(/sin tipo de cambio declarado/i);
  });
});
