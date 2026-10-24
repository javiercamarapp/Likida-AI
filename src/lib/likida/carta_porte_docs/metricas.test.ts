import { describe, expect, it } from 'vitest';
import { CAUSAS_RECHAZO, MINUTOS_CAPTURA_MANUAL_EMBARQUE, calcularInsights, calcularMetricas, clasificarCausaNoLiga, esCausaRechazo, type EntradaInsights } from './metricas';
import type { EnvioParaInsights } from './repo';
import type { DocumentoFila } from './repo';

const doc = (id: string, over: Partial<DocumentoFila> = {}): DocumentoFila => ({
  id, tenantId: 't', canal: 'manual', formato: 'excel', nombreArchivo: id, mime: null, bytes: 1, sha256: id.padEnd(64, '0'), storageRuta: null, estado: 'aprobado', version: 1, clienteId: null,
  perfilId: null, perfilVersion: null, remitente: null, asunto: null, remitenteReconocido: null, textoExtracto: null, riesgoInyeccion: false, extraccion: { campos: {}, mercancias: [], meta: { origen: 'llm', nivel: 1, escalamientos: [], avisos: [], notasModelo: [], indiciosInyeccion: [] } },
  validacion: null, confianzaMin: null, nivelModelo: 1, modelo: null, tokensIn: 0, tokensOut: 0, costoUsd: 0, viajeId: null, procesandoHasta: null, intentos: 1, ultimoError: null, abiertoEn: null, revisadoPor: null,
  aprobadoPor: null, aprobadoEn: 'x', rechazoMotivo: null, tiempoRevisionSeg: null, exportadoEn: null, retenerHasta: '', purgadoEn: null, createdAt: '', updatedAt: '', ...over,
});

describe('A37-A3-14 — las métricas dicen cuando son de una muestra', () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `d${i}`, estado: 'aprobado', costoUsd: 0, tiempoRevisionSeg: null, nivelModelo: 1, perfilId: null } as unknown as Parameters<typeof calcularMetricas>[0][number]));
  it('con más documentos en la ventana que los leídos: `parcial` trae leídos y total', () => {
    const m = calcularMetricas(mk(500), new Map(), 900);
    expect(m.parcial).toEqual({ leidos: 500, total: 900 });
  });
  it('si se leyó todo (o no se pasa el total), no hay `parcial`', () => {
    expect(calcularMetricas(mk(3), new Map(), 3).parcial).toBeUndefined();
    expect(calcularMetricas(mk(3), new Map()).parcial).toBeUndefined();
  });
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

  it('un archivo DIVIDIDO en embarques no cuenta: se miden sus hijos (ni infla «recibidos» ni diluye el costo por documento)', () => {
    const m = calcularMetricas([
      doc('padre', { estado: 'dividido', aprobadoEn: null, costoUsd: 0 }),
      doc('h1', { costoUsd: 0.01 }), doc('h2', { costoUsd: 0.03 }), doc('h3', { estado: 'por_revisar', aprobadoEn: null, costoUsd: 0.02 }),
    ], new Map());
    expect(m).toMatchObject({ recibidos: 3, aprobados: 2, porRevisar: 1, costoUsdTotal: 0.06, costoUsdPorDocumento: 0.02 });
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

  it('desglose por origen de la lectura, sacado de las columnas (la lista liviana no trae la extracción)', () => {
    const m = calcularMetricas([
      doc('x', { nivelModelo: 0, perfilId: null, extraccion: null }),
      doc('p', { nivelModelo: 0, perfilId: 'p1', extraccion: null }),
      doc('pl', { nivelModelo: 2, perfilId: 'p1', extraccion: null }),
      doc('l'),
    ], new Map([['l', 1]]));
    expect(m.porOrigen).toEqual({
      xml: { documentos: 1, sinCorreccion: 1 }, perfil: { documentos: 1, sinCorreccion: 1 },
      'perfil+llm': { documentos: 1, sinCorreccion: 1 }, llm: { documentos: 1, sinCorreccion: 0 },
    });
  });
});

// ── T-A3-37 · insights del agente ───────────────────────────────────────────
const AHORA = new Date('2026-10-15T12:00:00.000Z');
const horasAtras = (h: number) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
const envio = (documentoId: string, estado: EnvioParaInsights['estado'], over: Partial<EnvioParaInsights> = {}): EnvioParaInsights =>
  ({ documentoId, estado, createdAt: horasAtras(1), enviadoEn: null, causaPendiente: null, ...over });
const entrada = (over: Partial<EntradaInsights> = {}): EntradaInsights =>
  ({ docs: [], correcciones: new Map(), camposCorregidos: new Map(), causasRechazo: {}, envios: [], ahora: AHORA, ...over });

describe('calcularInsights', () => {
  it('sin aprobados NO hay porcentajes: null, listas vacías y ninguna tarjeta', () => {
    const i = calcularInsights(entrada());
    expect(i).toMatchObject({ aprobados: 0, pctSinTocar: null, porFormato: [], porCliente: [], topCamposCorregidos: [], tarjetas: [] });
    expect(i.envios).toMatchObject({ enviados: 0, pendientesReque: 0, medianaAprobadoAEnviadoMin: null, pendienteMasViejoHoras: null });
  });

  it('por formato y por cliente la suma de documentos es el total de aprobados (el dividido no cuenta)', () => {
    const docs = [
      doc('a', { formato: 'excel', clienteId: 'c1' }), doc('b', { formato: 'excel', clienteId: 'c1' }), doc('c', { formato: 'pdf_texto', clienteId: 'c2' }),
      doc('d', { formato: 'xml', clienteId: null }), doc('p', { estado: 'dividido', formato: 'excel', clienteId: 'c1' }), doc('r', { estado: 'rechazado' }),
    ];
    const i = calcularInsights(entrada({ docs, correcciones: new Map([['b', 2]]) }));
    expect(i.aprobados).toBe(4);
    expect(i.porFormato.reduce((s, g) => s + g.documentos, 0)).toBe(4);
    expect(i.porCliente.reduce((s, g) => s + g.documentos, 0)).toBe(4);
    expect(i.porFormato.find((g) => g.clave === 'excel')).toMatchObject({ documentos: 2, sinTocar: 1, pctSinTocar: 50 });
    expect(i.porCliente.find((g) => g.clave === 'sin_cliente')).toMatchObject({ documentos: 1, sinTocar: 1, pctSinTocar: 100 });
    expect(i.pctSinTocar).toBe(75);
  });

  it('los 3 campos más corregidos salen ordenados y solo con el NOMBRE del campo', () => {
    const i = calcularInsights(entrada({ camposCorregidos: new Map([['peso_bruto_total', 9], ['caja_numero', 4], ['folio_cliente', 4], ['origen_cp', 1], ['cero', 0]]) }));
    expect(i.topCamposCorregidos).toEqual([
      { campo: 'peso_bruto_total', correcciones: 9 }, { campo: 'caja_numero', correcciones: 4 }, { campo: 'folio_cliente', correcciones: 4 },
    ]);
  });

  it('cuenta las causas de rechazo; la clave vacía y las desconocidas son «sin clasificar»; null = no se pudo leer', () => {
    const i = calcularInsights(entrada({ causasRechazo: { suma_no_cuadra: 2, duplicado: 5, '': 3, rara: 1 } }));
    expect(i.causasRechazo?.map((c) => [c.causa, c.documentos])).toEqual([['duplicado', 5], ['suma_no_cuadra', 2]]);
    expect(i.rechazadosSinCausa).toBe(4);
    const sinLectura = calcularInsights(entrada({ causasRechazo: null }));
    expect(sinLectura.causasRechazo).toBeNull();
    expect(sinLectura.rechazadosSinCausa).toBeNull();
    expect(Object.keys(CAUSAS_RECHAZO)).toHaveLength(8);
    expect(esCausaRechazo('duplicado')).toBe(true);
    expect(esCausaRechazo('toString')).toBe(false);
  });

  it('estado de envíos: cuenta, antigüedad del pendiente, causas de «no se liga» y mediana aprobado→enviado', () => {
    const docs = [
      doc('a', { aprobadoEn: horasAtras(5) }), doc('b', { aprobadoEn: horasAtras(5) }), doc('c', { aprobadoEn: horasAtras(5) }),
      doc('d', { clienteId: 'c1' }), doc('e', { clienteId: 'c1' }), doc('f', { clienteId: 'c1' }),
    ];
    const i = calcularInsights(entrada({
      docs,
      envios: [
        envio('a', 'enviado', { enviadoEn: new Date(Date.parse(horasAtras(5)) + 10 * 60_000).toISOString() }),
        envio('b', 'enviado', { enviadoEn: new Date(Date.parse(horasAtras(5)) + 30 * 60_000).toISOString() }),
        envio('c', 'enviado', { enviadoEn: null }),
        envio('d', 'pendiente_reque', { createdAt: horasAtras(30), causaPendiente: 'El requerimiento no existe en el TMS.' }),
        envio('e', 'pendiente_reque', { createdAt: horasAtras(2), causaPendiente: 'La caja no existe en el TMS.' }),
        envio('f', 'rechazado_tms'), envio('x', 'subido_a_mano'), envio('y', 'descartado'),
      ],
    }));
    expect(i.envios).toMatchObject({
      enviados: 3, rechazadosTms: 1, subidosAMano: 1, pendientesReque: 2, pendientesRequeMasDe24h: 1, pendienteMasViejoHoras: 30, medianaAprobadoAEnviadoMin: 20,
      causasNoLiga: { reque: 1, caja: 1, cliente: null, otra: 0 },
    });
  });

  it('clasifica el texto de la causa pendiente', () => {
    expect(clasificarCausaNoLiga('El requerimiento no existe en el TMS.')).toBe('reque');
    expect(clasificarCausaNoLiga('La caja no existe en el TMS.')).toBe('caja');
    expect(clasificarCausaNoLiga('Falta el número de cliente interno')).toBe('cliente');
    expect(clasificarCausaNoLiga(null)).toBe('otra');
  });

  it('tarjeta de requerimiento: «N documentos de <cliente> esperan requerimiento hace más de 24 h» con qué significa y qué hacer', () => {
    const docs = [doc('d1', { clienteId: 'c1' }), doc('d2', { clienteId: 'c1' }), doc('d3', { clienteId: 'c1' })];
    const i = calcularInsights(entrada({
      docs, nombresCliente: new Map([['c1', 'Cliente Ejemplo']]),
      envios: [envio('d1', 'pendiente_reque', { createdAt: horasAtras(25) }), envio('d2', 'pendiente_reque', { createdAt: horasAtras(48) }), envio('d3', 'pendiente_reque', { createdAt: horasAtras(3) })],
    }));
    const t = i.tarjetas.find((x) => x.id === 'reque_c1');
    expect(t?.quePaso).toBe('2 documentos de Cliente Ejemplo esperan requerimiento hace más de 24 h.');
    expect(t?.queHacer).toMatch(/Crea los requerimientos/);
    expect(t?.queSignifica.length).toBeGreaterThan(10);
  });

  it('reglas de calidad: un formato con ≥5 aprobados y <50 % sin tocar genera tarjeta; con pocos aprobados no opina', () => {
    const muchos = Array.from({ length: 6 }, (_, k) => doc(`m${k}`, { formato: 'pdf_texto', clienteId: 'c9' }));
    const pocos = Array.from({ length: 3 }, (_, k) => doc(`p${k}`, { formato: 'imagen', clienteId: 'c8' }));
    const corr = new Map([...muchos, ...pocos].map((d) => [d.id, 1] as [string, number]));
    const i = calcularInsights(entrada({ docs: [...muchos, ...pocos], correcciones: corr }));
    expect(i.tarjetas.map((t) => t.id)).toEqual(['formato_pdf_texto', 'cliente_c9']);
  });

  it('tarjeta de rechazo del TMS y de causa dominante (≥3) con acción', () => {
    const i = calcularInsights(entrada({ causasRechazo: { duplicado: 3 }, envios: [envio('z', 'rechazado_tms')] }));
    expect(i.tarjetas.map((t) => t.id)).toEqual(['rechazo_tms', 'causa_duplicado']);
  });

  it('no filtra valores: la salida solo trae claves, conteos y nombres de campo', () => {
    const i = calcularInsights(entrada({ docs: [doc('a', { remitente: 'persona@cliente.test', asunto: 'Asunto', nombreArchivo: 'secreto.xlsx' })] }));
    expect(JSON.stringify(i)).not.toMatch(/persona@|Asunto|secreto/);
  });
});
