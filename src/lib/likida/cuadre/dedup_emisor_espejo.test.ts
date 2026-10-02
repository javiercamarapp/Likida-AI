import { describe, it, expect } from 'vitest';
import { copiasDeComprobante } from './engine';
import type { Gasto } from '@/types/likida';

// ═══════════════════════════════════════════════════════════════════════════
// FIS-C3 / ARQ32C3-C2 (auditoría 32 c3, CRÍTICO) — EL ESPEJO TS↔SQL SE ROMPIÓ
// POR EL EJE DEL EMISOR, Y LO ROMPIÓ ESTA MISMA RAMA.
//
// Dos auditores independientes —fiscal, desde la norma, y arquitectura, desde
// la estructura— llegaron al mismo sitio con pesos medidos contra Postgres 16:
//
//   · Las migraciones 0357/0358/0359 enseñaron al SQL que el folio SE REINICIA
//     POR EMISOR: dos tickets legítimos de $2,500 con folio 1234, de dos
//     gasolineras distintas, son DOS comprobantes, no uno.
//   · `copiasDeComprobante` —el criterio del motor, el que imprime el PDF y el
//     que `desde_db.ts:184-192` usa para restar el previo del 15 %— se quedó
//     mirando `concepto|folioNorm|monto`, SIN emisor.
//
// Resultado medido sobre las mismas dos filas: `/dashboard/fiscal` dice
// 2 comprobantes / $5,000 / $689.66 de IVA, y el PDF del mismo viaje dice
// 1 / $2,500 con un renglón «duplicado» sobre un ticket real. Antes de la 0359
// coincidían. Es textualmente lo que CLAUDE.md prohíbe: «una cifra fiscal que
// se lee distinto en dos pantallas se lee como dos cálculos».
//
// LA SEMÁNTICA QUE SE ESPEJA ES LA DE LA 0358, no la de la 0357: el emisor
// discrimina SÓLO CUANDO SE CONOCE, y la fila sin emisor hereda el del grupo
// en vez de abrir partición propia. Es el único campo de la llave que el OCR
// puede perder entero (`ocr.ts:560`), y por eso la 0357 —que lo metió a secas—
// trajo dos CRÍTICOS que la 0358 tuvo que cerrar. Los tres casos van abajo.
// ═══════════════════════════════════════════════════════════════════════════

const base = (over: Partial<Gasto>): Gasto => ({
  id: 'x', concepto: 'diesel', monto: 2500, folio: '1234', folioNorm: '1234',
  ...over,
} as unknown as Gasto);

describe('FIS-C3 · `copiasDeComprobante` espeja el dedup por emisor de la 0358', () => {
  it('CASO 1 — dos emisores CONOCIDOS y distintos: NO son copias (el folio se reinicia por estación)', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', rfcEmisor: 'GAS020202BBB' }),
    ]);
    expect(
      copias.size,
      'dos tickets reales de $2,500 con folio 1234 de estaciones distintas: el PDF marcaba uno como duplicado',
    ).toBe(0);
  });

  it('CASO 2 — el MISMO emisor conocido: siguen siendo copias (dos fotos del mismo ticket)', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', rfcEmisor: 'PEM010101AAA' }),
    ]);
    expect(copias.get('b')).toBe('a');
    expect(copias.size).toBe(1);
  });

  it('CASO 3 — el OCR perdió el emisor en UNA de las dos: la fila sin emisor HEREDA el del grupo', () => {
    // Éste es el que la 0357 rompió y la 0358 cerró: con el emisor ausente
    // abriendo partición propia, dos fotos del MISMO ticket de $2,500 sumaban
    // $5,000 y el PDF negaba $375 de deducción legítima.
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', rfcEmisor: undefined }),
    ]);
    expect(
      copias.get('b'),
      'sin herencia del grupo, la foto con el RFC perdido se cuenta como un ticket más',
    ).toBe('a');
  });

  it('CASO 3 bis — la herencia no depende del orden en que llegan las filas', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: undefined }),
      base({ id: 'b', rfcEmisor: 'PEM010101AAA' }),
    ]);
    expect(copias.get('b')).toBe('a');
    expect(copias.size).toBe(1);
  });

  it('CASO 4 — NADIE del grupo trae emisor: se comporta exactamente como antes de la 0357', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', rfcEmisor: undefined }),
      base({ id: 'b', rfcEmisor: undefined }),
    ]);
    expect(copias.get('b')).toBe('a');
    expect(copias.size).toBe(1);
  });

  it('el emisor NO cruza grupos: distinto monto sigue siendo distinto comprobante', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', monto: 2500, rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', monto: 1800, rfcEmisor: undefined }),
    ]);
    expect(copias.size).toBe(0);
  });

  it('el UUID sigue mandando sobre el folio: un CFDI con emisor distinto no cambia la regla dura', () => {
    const copias = copiasDeComprobante([
      base({ id: 'a', cfdiUuid: 'UUID-1', rfcEmisor: 'PEM010101AAA' }),
      base({ id: 'b', cfdiUuid: 'uuid-1', rfcEmisor: 'GAS020202BBB' }),
    ]);
    expect(copias.get('b'), 'el mismo folio fiscal es el mismo comprobante, venga de donde venga').toBe('a');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FIS/BE/ARQ/DAT-32C11-C1 (auditoría 32 c11, CRÍTICO) — EL SEGUNDO EJE DEL
// MISMO ESPEJO: EL PAR MIXTO. Y ESTA VEZ NO ERA UNA DIVERGENCIA DE PANTALLAS,
// ERA UN PARO.
//
// El par mixto es UNA foto ligada a su CFDI y OTRA del mismo ticket sin él.
// Es la única forma que puede tomar una copia de un comprobante con folio
// fiscal: `uq_gasto_cfdi_uuid` prohíbe que las dos filas traigan el UUID y
// `uq_gasto_img_hash` deja entrar la segunda foto.
//
// `copiasDeComprobante` no lo veía: la fila con UUID hacía `continue` sin
// consultar nunca `vistoFolio`, y la fila sin UUID nunca consultaba
// `vistoUuid`. Llaves distintas por construcción, en los dos órdenes.
//
// La 0365 se lo enseñó al ejercicio y la 0366 al cierre. El guardia de
// `guardar_liquidacion_tx` es un contrato de IGUALDAD, así que arreglar un
// solo lado no dejó una divergencia parcial: dejó una INDISPONIBILIDAD.
// Medido en los dos lenguajes, con un ticket de $10,000 en dos filas y
// anticipo $30,000:
//
//     engine.ts (este motor)     →  total_comprobado = 20000
//     guardar_liquidacion_tx     →  v_total          = 10000  → CU007
//     `insumosDeCierreCambiaron` →  sólo CU003/CU006, no reintenta
//
// El viaje se quedaba en `en_cuadre` para siempre —y el reintento da 20000
// otra vez, porque el cálculo es determinista—, con el PDF ya subido diciendo
// $20,000.00 comprobados sobre $10,000.00 de combustible del ejercicio. Y
// `uq_viaje_abierto_por_operador` cubre `en_cuadre`: el operador tampoco podía
// abrir su siguiente viaje.
//
// CINCO auditores convergieron desde sitios distintos (fiscal, backend,
// arquitectura, modelo de datos y pruebas) y el orquestador lo reprodujo en
// las dos mitades. La suite estaba verde: 993 archivos / 13,061 pruebas.
// Ningún arnés cruzaba DOS sedes del dedup sobre LAS MISMAS filas, que es
// exactamente el hueco que estos casos vienen a tapar.
// ═══════════════════════════════════════════════════════════════════════════

describe('FIS-32C11-C1 · `copiasDeComprobante` espeja el dedup del par mixto de la 0365/0366', () => {
  const diesel = (over: Partial<Gasto>): Gasto => ({
    id: 'x', concepto: 'diesel', monto: 10000, folio: 'MIX', folioNorm: 'MIX',
    rfcEmisor: 'ESA030303CC1',
    ...over,
  } as unknown as Gasto);
  const totalDe = (gastos: Gasto[]): number => {
    const copias = copiasDeComprobante(gastos);
    return gastos.filter((g) => !copias.has(g.id)).reduce((s, g) => s + g.monto, 0);
  };

  it('EL PAR MIXTO ES UNA COPIA — la foto con CFDI y la que no son el mismo ticket', () => {
    const copias = copiasDeComprobante([
      diesel({ id: 'sinCfdi', cfdiUuid: undefined }),
      diesel({ id: 'conCfdi', cfdiUuid: '36633333-3333-4333-8333-333333333333' }),
    ]);
    expect(
      copias.size,
      'el ticket de $10,000 contaba DOS veces y el cierre rebotaba con CU007: el viaje no se podía liquidar',
    ).toBe(1);
  });

  it('y el total es $10,000 EN LOS DOS ÓRDENES DE LLEGADA, que es lo que la 0366 deriva', () => {
    const sinCfdi = diesel({ id: 'sinCfdi', cfdiUuid: undefined });
    const conCfdi = diesel({ id: 'conCfdi', cfdiUuid: '36633333-3333-4333-8333-333333333333' });
    // El orden importaba: con la copia sin UUID llegando primero sobrevivían
    // las dos en el panel, y aquí sobrevivían las dos siempre.
    expect(totalDe([sinCfdi, conCfdi]), 'copia sin UUID primero').toBe(10000);
    expect(totalDe([conCfdi, sinCfdi]), 'copia con UUID primero').toBe(10000);
  });

  it('CONTRAPESO — dos CFDI DISTINTOS que comparten folio, monto, concepto y emisor siguen contando DOS veces', () => {
    // Si esto se cae, el arreglo se pasó de largo y empezó a fusionar
    // comprobantes legítimos, que es el daño simétrico y cuesta dinero que la
    // flota SÍ gastó. Es el mismo control que siembra el arnés de la 0366.
    const copias = copiasDeComprobante([
      diesel({ id: 'a', monto: 3000, folio: 'DOS', folioNorm: 'DOS', cfdiUuid: '36644444-4444-4444-8444-444444444444' }),
      diesel({ id: 'b', monto: 3000, folio: 'DOS', folioNorm: 'DOS', cfdiUuid: '36655555-5555-4555-8555-555555555555' }),
    ]);
    expect(copias.size, 'dos folios fiscales propios no son copias').toBe(0);
  });

  it('CONTRAPESO — la factura consolidada sigue entrando entera: mismo UUID, dos `cfdiOrden`', () => {
    // La 0065 separó «nació de ese CFDI» de «está amparado por ese CFDI». Si
    // esto se cae, las ocho casetas de una factura de CAPUFE vuelven a entrar
    // como UNA y el operador cobra $250 de $2,000.
    const copias = copiasDeComprobante([
      diesel({ id: 'a', concepto: 'caseta', monto: 250, folio: 'CAP', folioNorm: 'CAP', cfdiUuid: 'u-cap', cfdiOrden: 1 }),
      diesel({ id: 'b', concepto: 'caseta', monto: 250, folio: 'CAP', folioNorm: 'CAP', cfdiUuid: 'u-cap', cfdiOrden: 2 }),
    ]);
    expect(copias.size, 'dos renglones de la misma factura amparada no son copias').toBe(0);
  });

  it('CONTRAPESO — un CFDI SIN folio sigue deduplicándose sólo por UUID (frontera 0349)', () => {
    const copias = copiasDeComprobante([
      diesel({ id: 'a', folio: undefined, folioNorm: undefined, cfdiUuid: 'u-1' }),
      diesel({ id: 'b', folio: undefined, folioNorm: undefined, cfdiUuid: 'u-2' }),
    ]);
    expect(copias.size).toBe(0);
  });
});
