import { describe, it, expect } from 'vitest';
import { conceptoDesdeClave, CLAVES_PEAJE } from './concepto';

// Un XML que llega sin foto previa creaba el gasto con `concepto: 'diesel' | 'factura'`
// y nada más. Toda caseta timbrada entraba como 'factura', y el estímulo de peaje
// del motor exige `concepto === 'caseta'` — así que el 50% del peaje que llega por
// el camino MÁS confiable (el XML) se perdía en silencio. Dinero real, invisible.
const CLAVES_DIESEL = ['15101505', '15101514', '15101515'];

describe('conceptoDesdeClave', () => {
  it('reconoce el peaje por su clave del SAT', () => {
    // 95111602 y 95111603, verificadas en la guía de sugerencias del propio SAT
    // (Sugerencia_PyS/Peaje.pdf): "Carretera o autopista o autopista de peaje
    // interestatal".
    expect(conceptoDesdeClave('95111602', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('caseta');
    expect(conceptoDesdeClave('95111603', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('caseta');
  });

  it('reconoce el combustible por su clave', () => {
    expect(conceptoDesdeClave('15101505', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('diesel');
    expect(conceptoDesdeClave('15101514', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('diesel');
  });

  it('una clave desconocida cae en "factura", no adivina', () => {
    expect(conceptoDesdeClave('01010101', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('factura');
  });

  it('sin clave cae en "factura"', () => {
    expect(conceptoDesdeClave(undefined, CLAVES_DIESEL, CLAVES_PEAJE)).toBe('factura');
    expect(conceptoDesdeClave('', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('factura');
  });

  it('NO clasifica 93151505 como caseta', () => {
    // El SAT dice que las facturas de peaje emitidas con 93151505 "Servicios de
    // organismos administrativos" no se consideran erróneas. PERO esa clave es
    // genérica: la usa cualquier organismo público para cualquier servicio.
    // Tratarla como caseta acreditaría el 50% de peaje sobre gastos que no son
    // peaje. Se queda fuera hasta poder distinguirla por emisor.
    expect(conceptoDesdeClave('93151505', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('factura');
  });

  it('tolera espacios alrededor de la clave', () => {
    expect(conceptoDesdeClave(' 95111603 ', CLAVES_DIESEL, CLAVES_PEAJE)).toBe('caseta');
  });
});
