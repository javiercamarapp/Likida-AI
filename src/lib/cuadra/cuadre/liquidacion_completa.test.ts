import { describe, it, expect } from 'vitest';
import { cuadrarViaje, type PoliticaGasto } from './engine';
import { resumenCuadre } from './resumen';
import { resumenOmitidos } from '../liquidacion/omitidos';
import type { Gasto } from '@/types/cuadra';

// ═══════════════════════════════════════════════════════════════════════════
// CRITERIO DE TERMINADO DE LA FASE 0 — una liquidación REALISTA completa.
//
// Los tests de arriba prueban una regla a la vez. Este prueba lo que de verdad
// llega: veinte comprobantes de un viaje real, con dos facturas de diésel
// timbradas, una foto duplicada, casetas, comidas y un hotel.
//
// La pregunta que responde no es "¿funciona cada regla?" sino "¿el documento que
// recibe el contralor cuadra consigo mismo?".
// ═══════════════════════════════════════════════════════════════════════════

const politica: PoliticaGasto[] = [
  { concepto: 'diesel', topeMonto: 6000 },
  { concepto: 'caseta', topeMonto: 1500 },
  { concepto: 'alimentacion', topeMonto: 800 },
  { concepto: 'hospedaje', topeMonto: 2500 },
];
const EST = { peajeFactor: 0.5, viaticosTopeFiscalDiarioMxn: 750, efectivoTopeMxn: 2000, clavesDieselIeps: ['15101505'] };
const HC = { claves: ['15101505', '15101514', '15101515'], unidad: 'LTR', vigenteDesde: '2026-04-24' };

let n = 0;
const g = (p: Partial<Gasto>): Gasto => ({ id: `g${++n}`, concepto: 'diesel', monto: 0, ocrConfianza: 0.95, formaPago: '04', ...p });

/** Un viaje Mérida→Querétaro de tres días, como llega de verdad. */
function viajeReal(): Gasto[] {
  n = 0;
  const gastos: Gasto[] = [
    // Dos cargas de diésel TIMBRADAS (el camino bueno: XML completo)
    g({ concepto: 'diesel', monto: 5800, fecha: '2026-05-01', cfdiUuid: 'uuid-d1', xmlVerificado: true,
        claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true,
        rfcReceptor: 'TIN950101ABC', subTotal: 4310, ivaTraslado: 690, iepsTraslado: 800, estadoSat: 'vigente' }),
    g({ concepto: 'diesel', monto: 5200, fecha: '2026-05-02', cfdiUuid: 'uuid-d2', xmlVerificado: true,
        claveProdServ: '15101505', claveUnidad: 'LTR', tipoComprobante: 'I', complementoHidrocarburos: true,
        rfcReceptor: 'TIN950101ABC', subTotal: 3862, ivaTraslado: 618, iepsTraslado: 720, estadoSat: 'vigente' }),
    // Una caseta timbrada (para que el estímulo de peaje entre)
    g({ concepto: 'caseta', monto: 1160, fecha: '2026-05-01', cfdiUuid: 'uuid-c1', xmlVerificado: true,
        rfcReceptor: 'TIN950101ABC', subTotal: 1000, ivaTraslado: 160, estadoSat: 'vigente' }),
  ];
  // Once casetas sueltas (lo normal: tickets sin timbrar)
  for (let i = 0; i < 11; i++) {
    gastos.push(g({ concepto: 'caseta', monto: 180 + i * 15, fecha: '2026-05-02', folio: `CAS-${100 + i}` }));
  }
  // Comidas de dos días distintos, dentro del tope diario
  gastos.push(g({ concepto: 'alimentacion', monto: 320, fecha: '2026-05-01', folio: 'AL-1' }));
  gastos.push(g({ concepto: 'alimentacion', monto: 380, fecha: '2026-05-02', folio: 'AL-2' }));
  // Un hotel: además de ser gasto, es el soporte que LISR 28-V le exige a la comida
  gastos.push(g({ concepto: 'hospedaje', monto: 1450, fecha: '2026-05-01', folio: 'HOT-1' }));
  // Transporte del operador
  gastos.push(g({ concepto: 'transporte', monto: 260, fecha: '2026-05-02', folio: 'TR-1' }));
  // LA FOTO DUPLICADA: mismo folio, concepto y monto que una caseta ya capturada
  gastos.push(g({ concepto: 'caseta', monto: 180, fecha: '2026-05-02', folio: 'CAS-100' }));
  // Un gasto más para llegar a 20
  gastos.push(g({ concepto: 'otro', monto: 340, fecha: '2026-05-03', folio: 'OT-1' }));
  return gastos;
}

describe('liquidación completa de 20 comprobantes', () => {
  const gastos = viajeReal();
  // El anticipo se calcula para que cuadre EXACTO contra lo comprobado (sin el duplicado).
  const esperado = gastos.filter((x) => x.folio !== 'CAS-100' || x.id === 'g4').reduce((s, x) => s + x.monto, 0);
  const r = cuadrarViaje({
    viajeId: 'VJ-REAL', anticipo: esperado, politica, estimulos: EST, hidrocarburos: HC,
    empresaRfc: 'TIN950101ABC', fechaMin: '2026-04-28', fechaMax: '2026-05-05',
    gastos,
  });

  it('son 20 comprobantes', () => {
    expect(gastos).toHaveLength(20);
  });

  it('la foto duplicada se detecta y NO infla el total', () => {
    expect(r.diferencias.some((d) => d.tipo === 'duplicado')).toBe(true);
    expect(r.totalComprobado).toBe(esperado); // el duplicado NO suma
  });

  it('sale CUADRADA: ninguna regla la manda a la bandeja sin razón', () => {
    // Es la prueba de fuego de la Fase 0. Antes, `ieps_no_desglosado` mandaba a
    // `revisar` TODA liquidación con diésel, y la bandeja dejaba de significar algo.
    const enBandeja = r.diferencias.filter((d) =>
      !['duplicado', 'sobre_politica', 'anticipo', 'diesel_desviacion'].includes(d.tipo));
    expect(enBandeja.map((d) => d.tipo)).toEqual([]);
    expect(r.estatus).not.toBe('revisar');
  });

  it('las tres cubetas suman el total comprobado', () => {
    expect(r.totalDeducible + r.totalNoDeducible + r.totalPorConfirmar).toBeCloseTo(r.totalComprobado, 2);
  });

  it('el estímulo de peaje sale de la caseta TIMBRADA, no de los tickets sueltos', () => {
    expect(r.peajeAcreditable).toBe(500); // 1000 × 0.5, solo la que trae XML
  });

  it('el IEPS acreditable suma las dos cargas timbradas', () => {
    expect(r.iepsAcreditable).toBe(1520); // 800 + 720
  });

  it('el IVA acreditable suma los tres CFDI con XML', () => {
    expect(r.ivaAcreditable).toBe(1468); // 690 + 618 + 160
  });

  it('la comida NO se marca sin soporte: hay hotel en el viaje', () => {
    expect(r.diferencias.some((d) => d.tipo === 'alimentacion_sin_soporte')).toBe(false);
  });

  it('el PDF anuncia lo que no cupo, y lo omitido cuadra con el total', () => {
    const CABEN = 17; // lo que entra en una página
    const om = resumenOmitidos(r.gastos, CABEN)!;
    expect(om.cuantos).toBe(3);
    const impresos = r.gastos.slice(0, CABEN).reduce((s, x) => s + (x.monto > 0 ? x.monto : 0), 0);
    // Impresos + omitidos = todo lo capturado (incluido el duplicado, que también
    // aparece como renglón). Lo que el papel muestra tiene que ser coherente.
    const todos = r.gastos.reduce((s, x) => s + (x.monto > 0 ? x.monto : 0), 0);
    expect(impresos + om.monto).toBeCloseTo(todos, 2);
  });

  it('al operador no le llega ningún veredicto fiscal', () => {
    const texto = resumenCuadre(r, true, 'operador');
    expect(texto).not.toMatch(/no deducible|69-B|cancelado/i);
  });

  it('al contralor sí le llega el descargo de responsabilidad', () => {
    expect(resumenCuadre(r, true, 'contralor')).toMatch(/no sustituye|no es un dictamen|contador/i);
  });
});
