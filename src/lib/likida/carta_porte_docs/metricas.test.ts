import { describe, expect, it } from 'vitest';
import { MINUTOS_CAPTURA_MANUAL_EMBARQUE, calcularMetricas } from './metricas';
import type { DocumentoFila } from './repo';

const doc = (id: string, over: Partial<DocumentoFila> = {}): DocumentoFila => ({
  id, tenantId: 't', canal: 'manual', formato: 'excel', nombreArchivo: id, mime: null, bytes: 1, sha256: id.padEnd(64, '0'), storageRuta: null, estado: 'aprobado', version: 1, clienteId: null,
  perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null, textoExtracto: null, riesgoInyeccion: false, extraccion: { campos: {}, mercancias: [], meta: { origen: 'llm', nivel: 1, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } },
  validacion: null, confianzaMin: null, nivelModelo: 1, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null, revisadoPor: null,
  aprobadoPor: null, aprobadoEn: 'x', rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '', purgadoEn: null, createdAt: '', updatedAt: '', ...over,
});

describe('calcularMetricas', () => {
  it('sin documentos NO hay porcentajes inventados: todo es null', () => {
    const m = calcularMetricas([], new Map());
    expect(m).toMatchObject({ recibidos: 0, aprobados: 0, pctSinCorreccion: null, minutosRevisionPromedio: null, minutosAhorradosTotal: null, minutosAhorradosPorEmbarque: null, costoUsdPorDocumento: null });
  });

  it('% sin corrección = aprobados sin una sola corrección / aprobados (confirmar no cuenta)', () => {
    const docs = [doc('a'), doc('b'), doc('c'), doc('d')];
    const m = calcularMetricas(docs, new Map([['b', 2], ['c', 1]]));
    expect(m).toMatchObject({ aprobados: 4, sinCorreccion: 2, conCorreccion: 2, pctSinCorreccion: 50 });
  });

  it('solo cuentan los APROBADOS: los rechazados y por revisar no inflan el porcentaje', () => {
    const m = calcularMetricas([doc('a'), doc('r', { estado: 'rechazado' }), doc('p', { estado: 'por_revisar' }), doc('f', { estado: 'fallido' })], new Map());
    expect(m).toMatchObject({ recibidos: 4, aprobados: 1, rechazados: 1, porRevisar: 1, fallidos: 1, pctSinCorreccion: 100 });
  });

  it('el tiempo ahorrado es MEDIDO (12 min supuesto − revisión real) y solo sobre los medidos', () => {
    const m = calcularMetricas([doc('a', { tiempoRevisionSeg: 120 }), doc('b', { tiempoRevisionSeg: 600 }), doc('c', { tiempoRevisionSeg: null })], new Map());
    expect(m.supuestoMinutosManual).toBe(MINUTOS_CAPTURA_MANUAL_EMBARQUE);
    expect(m).toMatchObject({ aprobadosMedidos: 2, aprobadosSinMedir: 1, minutosRevisionPromedio: 6, minutosAhorradosTotal: 12, minutosAhorradosPorEmbarque: 6 });
  });

  it('una revisión más lenta que la captura manual no da ahorro negativo', () => {
    const m = calcularMetricas([doc('a', { tiempoRevisionSeg: 3600 })], new Map());
    expect(m.minutosAhorradosTotal).toBe(0);
  });

  it('sin ninguna marca de tiempo: ahorro null, no 0', () => {
    expect(calcularMetricas([doc('a')], new Map()).minutosAhorradosTotal).toBeNull();
  });

  it('documentos sin modelo (XML/perfil) y costo', () => {
    const m = calcularMetricas([doc('a', { nivelModelo: 0, costoUsd: 0 }), doc('b', { nivelModelo: 1, costoUsd: 0.004 }), doc('c', { nivelModelo: null })], new Map());
    expect(m.sinModelo).toBe(2);
    expect(m.costoUsdTotal).toBeCloseTo(0.004, 6);
    expect(m.costoUsdPorDocumento).toBeCloseTo(0.001333, 6);
  });

  it('desglose por origen de la extracción', () => {
    const xml = doc('x', { extraccion: { campos: {}, mercancias: [], meta: { origen: 'xml', nivel: 0, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } } });
    const m = calcularMetricas([xml, doc('l')], new Map([['l', 1]]));
    expect(m.porOrigen).toEqual({ xml: { documentos: 1, sinCorreccion: 1 }, llm: { documentos: 1, sinCorreccion: 0 } });
  });
});
