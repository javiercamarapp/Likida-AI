import { describe, it, expect } from 'vitest';
import {
  detectarColumnas, fechaDeCelda, montoDeCelda,
  parsearDesgloseHoja, parsearDesgloseTextoPdf,
  cruzarLineasDesglose, TOLERANCIA_CENTAVOS_MXN,
  filasBitacora, bitacoraACsv, LEYENDAS_BITACORA_RMF_918,
  type GastoCaseta, type BitacoraRmf918,
} from './desglose_peaje';
import { llaveUnidadDia } from '../peajes/evidencia_gps';

// ═══════════════════════════════════════════════════════════════════════════
// EL PARSEO — layouts reales de proveedor, en puro (sin archivos ni base).
// ═══════════════════════════════════════════════════════════════════════════

describe('detectarColumnas — los encabezados en español que los desgloses traen', () => {
  it('layout genérico: Fecha / Caseta / Importe / TAG', () => {
    const r = detectarColumnas(['Fecha', 'Caseta', 'Importe', 'TAG']);
    expect(r).toEqual({ ok: true, columnas: { fecha: 0, caseta: 1, monto: 2, tag: 3 } });
  });

  it('layout tipo IAVE: Fecha de cruce / Plaza de cobro / No. de TAG / Importe', () => {
    const r = detectarColumnas(['Fecha de cruce', 'Plaza de cobro', 'No. de TAG', 'Importe']);
    expect(r).toEqual({ ok: true, columnas: { fecha: 0, caseta: 1, monto: 3, tag: 2 } });
  });

  it('layout tipo TeleVía: Día / Punto de cobro / Etiqueta / Monto', () => {
    const r = detectarColumnas(['Día', 'Punto de cobro', 'Etiqueta', 'Monto']);
    expect(r).toEqual({ ok: true, columnas: { fecha: 0, caseta: 1, monto: 3, tag: 2 } });
  });

  it('con «Importe» y «Total» a la vez gana Total (lo pagado con IVA, que es lo que gasto.monto guarda)', () => {
    const r = detectarColumnas(['Fecha', 'Caseta', 'Importe', 'IVA', 'Total']);
    expect(r.ok && r.columnas.monto).toBe(4);
  });

  it('«IVA» y «Saldo» jamás se toman como la columna de monto', () => {
    const r = detectarColumnas(['Fecha', 'Caseta', 'IVA', 'Saldo']);
    expect(r).toEqual({ ok: false, faltantes: ['importe'] });
  });

  it('dice exactamente QUÉ columna faltó — nunca "formato inválido"', () => {
    const r = detectarColumnas(['Fecha', 'Concepto', 'Kilómetros']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.faltantes).toEqual(['caseta', 'importe']);
  });

  it('el TAG es opcional: sin él la detección sigue', () => {
    const r = detectarColumnas(['Fecha', 'Plaza', 'Importe']);
    expect(r.ok && r.columnas.tag).toBe(null);
  });
});

describe('fechaDeCelda — nunca una fecha adivinada', () => {
  it('ISO y dd/mm/aaaa mexicano (con y sin hora)', () => {
    expect(fechaDeCelda('2026-08-05')).toBe('2026-08-05');
    expect(fechaDeCelda('05/08/2026')).toBe('2026-08-05');
    expect(fechaDeCelda('5/8/2026 14:32')).toBe('2026-08-05');
    expect(fechaDeCelda('05-08-26')).toBe('2026-08-05');
  });

  it('serial de Excel dentro del rango plausible', () => {
    const serial = (Date.UTC(2026, 7, 5) - Date.UTC(1899, 11, 30)) / 86_400_000;
    expect(fechaDeCelda(serial)).toBe('2026-08-05');
  });

  it('un número chico NO es fecha: 189 es un monto perdido, no un día de 1900', () => {
    expect(fechaDeCelda(189)).toBe(null);
  });

  it('un «mes» imposible es ilegible — NO se voltea a mm/dd en silencio', () => {
    expect(fechaDeCelda('05/13/2026')).toBe(null);
  });

  it('el 31 de febrero no existe y rebota', () => {
    expect(fechaDeCelda('31/02/2026')).toBe(null);
  });

  it('vacío y basura → null', () => {
    expect(fechaDeCelda('')).toBe(null);
    expect(fechaDeCelda('caseta')).toBe(null);
    expect(fechaDeCelda(null)).toBe(null);
  });
});

describe('montoDeCelda', () => {
  it('lee $, comas, MXN y números crudos', () => {
    expect(montoDeCelda('$1,234.56')).toBe(1234.56);
    expect(montoDeCelda('MXN 189.00')).toBe(189);
    expect(montoDeCelda(189.5)).toBe(189.5);
    expect(montoDeCelda(' 234.50 ')).toBe(234.5);
  });

  it('lo ilegible es null, no cero — NULL ≠ 0', () => {
    expect(montoDeCelda('')).toBe(null);
    expect(montoDeCelda('N/A')).toBe(null);
    expect(montoDeCelda(null)).toBe(null);
  });
});

describe('parsearDesgloseHoja — el archivo completo', () => {
  const HOJA = [
    ['DESGLOSE DE CRUCES', '', '', ''],                       // título
    ['Cliente: TRANSPORTES EJEMPLO SA', '', '', ''],          // ruido arriba
    ['Fecha de cruce', 'Plaza de cobro', 'No. de TAG', 'Importe'],
    ['05/08/2026', 'Tepotzotlán', 'IMDM12345678', '$189.00'],
    ['06/08/2026', 'Palmillas', 'IMDM12345678', '235.00'],
    ['', '', '', ''],                                          // renglón en blanco
    ['???', 'San Juan del Río', 'IMDM12345678', '118.00'],     // fecha ilegible: ENTRA con fecha null
    ['07/08/2026', 'Querétaro', 'IMDM12345678', ''],           // sin importe: se salta con aviso
    ['TOTAL', '', '', '$542.00'],                              // fila de totales: se salta
  ];

  it('encuentra el encabezado bajo el título y lee las líneas', () => {
    const r = parsearDesgloseHoja(HOJA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toHaveLength(3);
    expect(r.lineas[0]).toEqual({ indice: 0, fecha: '2026-08-05', caseta: 'Tepotzotlán', monto: 189, tag: 'IMDM12345678' });
    expect(r.lineas[2].fecha).toBe(null); // la ilegible entra visible, no tragada
  });

  it('los avisos cuentan lo saltado y lo sin fecha — nada desaparece callado', () => {
    const r = parsearDesgloseHoja(HOJA);
    if (!r.ok) throw new Error('parseo falló');
    expect(r.avisos.join(' ')).toMatch(/1 filas sin importe/);
    expect(r.avisos.join(' ')).toMatch(/1 filas de totales/);
    expect(r.avisos.join(' ')).toMatch(/1 líneas no traen fecha/);
  });

  it('sin columna de importe, el error la nombra y lista los encabezados leídos', () => {
    const r = parsearDesgloseHoja([
      ['Fecha', 'Caseta', 'Kilómetros'],
      ['05/08/2026', 'Tepotzotlán', '57'],
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toContain('importe');
    expect(r.motivo).toContain('«Fecha»');
    expect(r.motivo).toContain('no voy a adivinar');
  });
});

describe('parsearDesgloseTextoPdf — la capa de texto de un PDF', () => {
  it('reconoce renglones fecha … caseta … monto, con hora, TAG y $', () => {
    const texto = [
      'ESTADO DE CUENTA IAVE',
      '05/08/2026 10:21 Tepotzotlán IMDM12345678 $189.00',
      '06/08/2026 Palmillas IMDM12345678 235.00',
      'Página 1 de 1',
    ].join('\n');
    const r = parsearDesgloseTextoPdf(texto);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toHaveLength(2);
    expect(r.lineas[0]).toEqual({ indice: 0, fecha: '2026-08-05', caseta: 'Tepotzotlán', monto: 189, tag: 'IMDM12345678' });
  });

  it('un PDF sin renglones reconocibles se rechaza pidiendo el Excel/CSV', () => {
    const r = parsearDesgloseTextoPdf('párrafos de un contrato que no son un desglose');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain('Excel o CSV');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CRUCE PURO — las tres cubetas, regla por regla.
// ═══════════════════════════════════════════════════════════════════════════

const gasto = (id: string, monto: number, fecha: string, viajeId = `v-${id}`): GastoCaseta =>
  ({ id, viajeId, monto, fecha });

describe('cruzarLineasDesglose', () => {
  it('cuadra exacto: mismo monto, mismo día → liga y la diferencia es un 0 medido', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }],
      [gasto('g1', 189, '2026-08-05')],
    );
    expect(r).toMatchObject({ estatus: 'cuadra', gastoId: 'g1', viajeId: 'v-g1', diferencia: 0 });
  });

  it('cuadra a ±1 día: la ventana del consolidado, la misma regla', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }],
      [gasto('g1', 189, '2026-08-06')],
    );
    expect(r.estatus).toBe('cuadra');
  });

  it('a 2 días ya no: fuera de ventana es sin_contraparte', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }],
      [gasto('g1', 189, '2026-08-07')],
    );
    expect(r.estatus).toBe('sin_contraparte');
    expect(r.detalle).toMatchObject({ motivo: 'sin_gastos_en_ventana' });
  });

  it('tolerancia de rondeo: la diferencia se ADMITE y se ESCRIBE, no se esconde', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189.4 }],
      [gasto('g1', 189, '2026-08-05')],
    );
    expect(r.estatus).toBe('cuadra');
    expect(r.diferencia).toBe(0.4); // desglose cobra 40 centavos más que lo comprobado
  });

  it(`más de $${TOLERANCIA_CENTAVOS_MXN} ya no es rondeo: no_cuadra con la diferencia en pesos`, () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 250 }],
      [gasto('g1', 189, '2026-08-05')],
    );
    expect(r).toMatchObject({ estatus: 'no_cuadra', viajeId: null, gastoId: null, diferencia: 61 });
    expect(r.detalle).toMatchObject({ motivo: 'monto_distinto' });
  });

  it('doble candidato exacto a DISTINTA distancia de fecha: gana el más cercano', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }],
      [gasto('lejos', 189, '2026-08-06'), gasto('cerca', 189, '2026-08-05')],
    );
    expect(r.estatus).toBe('cuadra');
    expect(r.gastoId).toBe('cerca');
  });

  it('doble candidato exacto EMPATADO en fecha: ambigua — no se adivina, candidatos a la vista', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }],
      [gasto('a', 189, '2026-08-05'), gasto('b', 189, '2026-08-05')],
    );
    expect(r).toMatchObject({ estatus: 'no_cuadra', viajeId: null, gastoId: null, diferencia: null });
    expect(r.detalle?.motivo).toBe('ambigua_monto_exacto');
    expect(r.detalle?.candidatos).toHaveLength(2);
  });

  it('sin contraparte: cero gastos de caseta en la ventana', () => {
    const [r] = cruzarLineasDesglose([{ fecha: '2026-08-05', monto: 189 }], []);
    expect(r.estatus).toBe('sin_contraparte');
    expect(r.diferencia).toBe(null); // NULL ≠ 0: no hay contra quién medir
  });

  it('línea sin fecha: jamás se cruza por puro monto', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: null, monto: 189 }],
      [gasto('g1', 189, '2026-08-05')],
    );
    expect(r.estatus).toBe('sin_contraparte');
    expect(r.detalle).toMatchObject({ motivo: 'sin_fecha' });
  });

  it('línea duplicada: la primera del archivo gana el gasto; la segunda dice que su contraparte ya fue reclamada', () => {
    const [r1, r2] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }, { fecha: '2026-08-05', monto: 189 }],
      [gasto('g1', 189, '2026-08-05')],
    );
    expect(r1.estatus).toBe('cuadra');
    expect(r2.estatus).toBe('sin_contraparte');
    expect(r2.detalle).toMatchObject({ motivo: 'contraparte_ya_reclamada' });
  });

  it('un gasto respalda UNA línea: dos líneas distintas no reclaman el mismo comprobante', () => {
    const [r1, r2] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }, { fecha: '2026-08-06', monto: 189 }],
      [gasto('g1', 189, '2026-08-05'), gasto('g2', 189, '2026-08-06')],
    );
    expect(r1.gastoId).toBe('g1');
    expect(r2.gastoId).toBe('g2');
    expect(r1.gastoId).not.toBe(r2.gastoId);
  });

  it('exacto le gana a tolerable: con un match exacto no se conforma con el rondeo', () => {
    const [r] = cruzarLineasDesglose(
      [{ fecha: '2026-08-05', monto: 189 }],
      [gasto('rondeo', 189.5, '2026-08-05'), gasto('exacto', 189, '2026-08-06')],
    );
    expect(r.gastoId).toBe('exacto');
    expect(r.diferencia).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA BITÁCORA RMF 9.1.8 — filas correctas y leyenda presente.
// ═══════════════════════════════════════════════════════════════════════════

describe('filasBitacora', () => {
  const viajes = new Map([
    ['v1', { folio: 'F-001', origen: 'CDMX', destino: 'Querétaro', unidadId: 'u1' }],
    ['v2', { folio: null, origen: null, destino: null, unidadId: null }],
  ]);
  const posiciones = new Map([[llaveUnidadDia('u1', '2026-08-05'), 87]]);

  it('arma la fila con viaje, ruta, caseta, monto conciliado y evidencia GPS', () => {
    const filas = filasBitacora(
      [{ fecha: '2026-08-05', caseta: 'Tepotzotlán', monto: 189, tag: 'IMDM12345678', viajeId: 'v1' }],
      viajes,
      posiciones,
    );
    expect(filas).toEqual([{
      viajeFolio: 'F-001', origen: 'CDMX', destino: 'Querétaro',
      fechaCruce: '2026-08-05', caseta: 'Tepotzotlán', tag: 'IMDM12345678', montoConciliado: 189,
      posicionesGpsDia: 87,
    }]);
  });

  it('lo que el viaje no tiene queda VACÍO — jamás inventado (y GPS null, no 0)', () => {
    const [fila] = filasBitacora(
      [{ fecha: '2026-08-05', caseta: null, monto: 189, tag: null, viajeId: 'v2' }],
      viajes,
      posiciones,
    );
    expect(fila).toEqual({
      viajeFolio: '', origen: '', destino: '',
      fechaCruce: '2026-08-05', caseta: '', tag: '', montoConciliado: 189,
      posicionesGpsDia: null,
    });
  });

  it('una línea sin viaje no entra a la bitácora', () => {
    expect(filasBitacora([{ fecha: '2026-08-05', caseta: 'X', monto: 1, tag: null, viajeId: null }], viajes)).toEqual([]);
  });

  it('unidad con cero posiciones ese día → null («sin datos»), nunca un 0 que afirme quietud', () => {
    const [fila] = filasBitacora(
      [{ fecha: '2026-08-06', caseta: 'T', monto: 10, tag: null, viajeId: 'v1' }],
      viajes,
      posiciones, // u1 solo tiene posiciones el 05, no el 06
    );
    expect(fila.posicionesGpsDia).toBeNull();
  });

  it('sin mapa de posiciones (llamador viejo) toda la columna es null — compatible hacia atrás', () => {
    const [fila] = filasBitacora(
      [{ fecha: '2026-08-05', caseta: 'T', monto: 10, tag: null, viajeId: 'v1' }],
      viajes,
    );
    expect(fila.posicionesGpsDia).toBeNull();
  });
});

describe('la leyenda de la bitácora — dice qué cumple y qué NO afirma', () => {
  const todo = LEYENDAS_BITACORA_RMF_918.join(' ');

  it('nombra la fracción II como lo que este documento ES', () => {
    expect(todo).toContain('fracción II');
    expect(todo).toContain('9.1.8');
  });

  it('deja por cuenta del contribuyente el aviso de marzo y el pago electrónico', () => {
    expect(todo).toContain('aviso de marzo');
    expect(todo).toMatch(/sistema electrónico/);
    expect(todo).toContain('por cuenta del contribuyente');
  });

  it('NUNCA afirma que el estímulo procede', () => {
    expect(todo).toContain('NO afirma');
    expect(todo).toContain('NO calcula el estímulo');
  });
});

describe('bitacoraACsv', () => {
  const bitacora: BitacoraRmf918 = {
    desgloseId: 'd-1', proveedor: 'IAVE', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10',
    filas: [{ viajeFolio: 'F-001', origen: 'CDMX', destino: 'Querétaro', fechaCruce: '2026-08-05', caseta: 'Tepotzotlán', tag: 'IMDM12345678', montoConciliado: 189, posicionesGpsDia: 87 }],
    leyendas: LEYENDAS_BITACORA_RMF_918,
  };

  it('la leyenda viaja DENTRO del archivo, antes de la tabla', () => {
    const csv = bitacoraACsv(bitacora);
    const posLeyenda = csv.indexOf('NO afirma');
    const posTabla = csv.indexOf('viaje,origen,destino');
    expect(posLeyenda).toBeGreaterThan(-1);
    expect(posTabla).toBeGreaterThan(posLeyenda);
  });

  it('las filas llevan sus ocho columnas con el monto tal cual', () => {
    const csv = bitacoraACsv(bitacora);
    expect(csv).toContain('viaje,origen,destino,fecha_cruce,caseta,tag,monto_conciliado,posiciones_gps_dia');
    expect(csv).toContain('F-001,CDMX,Querétaro,2026-08-05,Tepotzotlán,IMDM12345678,189,87');
  });

  it('sin conteo GPS la columna dice «sin datos» — y la leyenda explica que no invalida el cruce', () => {
    const csv = bitacoraACsv({
      ...bitacora,
      filas: [{ ...bitacora.filas[0], posicionesGpsDia: null }],
    });
    expect(csv).toContain('F-001,CDMX,Querétaro,2026-08-05,Tepotzotlán,IMDM12345678,189,sin datos');
    expect(csv).toContain('no invalida el cruce conciliado');
    expect(csv).toContain('posiciones_gps_dia');
  });

  it('sin líneas conciliadas el CSV lo dice — no manda una tabla vacía muda', () => {
    const csv = bitacoraACsv({ ...bitacora, filas: [] });
    expect(csv).toContain('Sin líneas conciliadas todavía');
  });
});
