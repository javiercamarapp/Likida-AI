import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

// ═══════════════════════════════════════════════════════════════════════════
// RONDA 7 · EL MISMO HECHO FISCAL ESTABA ESCRITO EN DOS ARCHIVOS.
//
// `['95111602', '95111603']` vivía aquí y otra vez en `config.ts`, y el
// comentario de `config.ts` decía "ver intake/concepto.ts" — o sea que quien lo
// escribió SABÍA cuál era el original y aun así lo copió.
//
// Es la misma familia que `mxn()` (tres rondas, 3 → 8 → 11 sitios): dos copias
// idénticas hoy que se separan mañana. Aquí la separación cuesta el 50% de
// acreditamiento de peaje de LIF 2026 art. 20-A, aplicado en un camino y no en
// el otro sobre la misma flota, sin un solo error en el log.
// ═══════════════════════════════════════════════════════════════════════════
describe('las claves del SAT tienen un solo origen', () => {
  const CONFIG = readFileSync('src/lib/likida/config.ts', 'utf8');

  it('`config.ts` importa las claves de peaje, no las reescribe', () => {
    for (const clave of CLAVES_PEAJE) {
      expect(CONFIG, `config.ts vuelve a escribir la clave ${clave} en vez de importarla`)
        .not.toMatch(new RegExp(`'${clave}'`));
    }
    expect(CONFIG).toMatch(/clavesPeaje: CLAVES_PEAJE/);
  });

  it('y el default de la función ya no deja saltarse la config del cliente', () => {
    // Con default, `conceptoDesdeClave(clave, combustible)` compilaba y usaba la
    // lista de aquí en vez de la del tenant. El único llamador de producción
    // pasa `cfg.estimulos.clavesPeaje`, así que estaba muerto — pero era un
    // camino abierto hacia dos respuestas distintas para la misma flota.
    const FUENTE = readFileSync('src/lib/likida/intake/concepto.ts', 'utf8');
    expect(FUENTE).not.toMatch(/clavesPeaje: string\[\] =/);
  });
});
