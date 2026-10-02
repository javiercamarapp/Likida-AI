import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { PDFDocument } from 'pdf-lib';
import { construirReclamacion, VENTANA_DOBLE_COBRO_MIN, type LineaReclamable, type ZonaEntrada } from './reclamacion';
import { reclamacionAExcel, reclamacionAPdf } from './reclamacion_archivos';
import { LEYENDAS_RECLAMACION, type ReporteReclamacion } from './reclamacion';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPORTE DE RECLAMACIÓN: qué cruces se pueden pedir al proveedor y por qué.
//
// La doctrina que se fija aquí: solo entra una línea con evidencia POSITIVA en
// contra del cobro; «sin datos» y «el GPS confirma» NO se reclaman; cada línea
// lleva UN motivo con su explicación y su evidencia; y el archivo (Excel/PDF)
// dice lo mismo que la pantalla.
// ═══════════════════════════════════════════════════════════════════════════

const N = { lat: 19.5, lng: -99.2, radioM: 300 };
const PASE = Date.parse('2026-08-05T16:30:00.000Z'); // 10:30 hora de México
const min = (m: number) => PASE + m * 60_000;

function linea(p: Partial<LineaReclamable> & { indice: number }): LineaReclamable {
  return {
    fecha: '2026-08-05', hora: '10:30:00', caseta: 'Caseta Ejemplo Norte', casetaCatalogo: 'Caseta Ejemplo Norte',
    tag: 'IMDM10000001', unidad: 'C2-08', monto: 189.5, cruceMs: PASE, gps: 'sin datos', gpsDistanciaM: null, gpsNota: '',
    casetaGeo: N, muestras: [], ...p,
  };
}
const lejos = (m: number) => ({ lat: N.lat + 0.2, lng: N.lng, t: min(m) });
const PATIO: ZonaEntrada = { nombre: 'Patio Central', tipo: 'patio', lat: 19.3, lng: -99.1, radioM: 500 };

describe('qué se reclama y por qué', () => {
  it('GPS lejos de la caseta: alta confianza, con la distancia, el radio y las posiciones como evidencia', () => {
    const { cruces, resumen } = construirReclamacion([
      linea({ indice: 0, gps: 'no coincide', gpsDistanciaM: 22_300, muestras: [lejos(-2), lejos(2), lejos(-15)] }),
    ], []);
    expect(cruces).toHaveLength(1);
    const c = cruces[0];
    expect(c).toMatchObject({ motivo: 'gps_lejos_de_caseta', confianza: 'alta', monto: 189.5, tag: 'IMDM10000001', unidad: 'C2-08', distanciaM: 22_300, radioCasetaM: 300 });
    expect(c.porQue).toMatch(/la unidad C2-08 no estaba en Caseta Ejemplo Norte a la hora del pase \(10:30\)/);
    expect(c.porQue).toMatch(/22,300 m/);
    expect(c.porQue).toMatch(/radio de la caseta: 300 m/);
    // evidencia: las 3 posiciones más cercanas al pase, en orden cronológico, con su distancia a la caseta
    expect(c.evidencia.map((e) => e.minutosDelPase)).toEqual([-15, -2, 2]);
    expect(c.evidencia.every((e) => (e.distanciaCasetaM ?? 0) > 20_000)).toBe(true);
    expect(resumen).toMatchObject({ lineas: 1, reclamables: 1, montoReclamable: 189.5 });
  });

  it('el GPS que CONFIRMA no se reclama, y «sin datos» tampoco (se cuentan aparte)', () => {
    const { cruces, resumen } = construirReclamacion([
      linea({ indice: 0, tag: 'T-A', gps: 'confirma', gpsDistanciaM: 40 }),
      linea({ indice: 1, tag: 'T-B', gps: 'sin datos', gpsNota: 'el archivo no trae la hora del cobro', cruceMs: null, hora: '' }),
      linea({ indice: 2, tag: 'T-C', gps: 'sin evaluar' }),
    ], [PATIO]);
    expect(cruces).toEqual([]);
    expect(resumen).toMatchObject({ lineas: 3, reclamables: 0, montoReclamable: 0, confirmadas: 1, sinDatos: 1, sinEvaluar: 1 });
  });

  it('unidad en zona no autorizada: la posición MÁS CERCANA al pase dentro del patio, aunque el GPS no alcance para afirmar', () => {
    const enPatio = { lat: PATIO.lat + 0.001, lng: PATIO.lng, t: min(-1) };
    const { cruces } = construirReclamacion([
      linea({ indice: 0, gps: 'sin datos', gpsNota: 'las posiciones GPS no alcanzan para concluir', muestras: [enPatio, lejos(-25)] }),
    ], [PATIO]);
    expect(cruces).toHaveLength(1);
    expect(cruces[0]).toMatchObject({ motivo: 'unidad_en_zona_no_autorizada', confianza: 'alta', zona: { nombre: 'Patio Central', tipo: 'patio' } });
    expect(cruces[0].porQue).toMatch(/dentro de «Patio Central» \(patio de la flota\)/);
  });

  it('una posición en el patio pero LEJOS en el tiempo (> 10 min) no cuenta; una geocerca de otro tipo tampoco', () => {
    const viejaEnPatio = { lat: PATIO.lat, lng: PATIO.lng, t: min(-14) };
    expect(construirReclamacion([linea({ indice: 0, muestras: [viejaEnPatio] })], [PATIO]).cruces).toEqual([]);
    const origen: ZonaEntrada = { ...PATIO, tipo: 'origen' };
    const enOrigen = { lat: PATIO.lat, lng: PATIO.lng, t: min(-1) };
    expect(construirReclamacion([linea({ indice: 0, muestras: [enOrigen] })], [origen]).cruces).toEqual([]);
  });

  it('una posición dentro del radio de la CASETA no es «zona no autorizada» aunque la caseta quede dentro de una zona', () => {
    const zonaSobreCaseta: ZonaEntrada = { nombre: 'Zona grande', tipo: 'restringida', lat: N.lat, lng: N.lng, radioM: 5_000 };
    const enCaseta = { lat: N.lat + 0.0005, lng: N.lng, t: min(0) };
    expect(construirReclamacion([linea({ indice: 0, muestras: [enCaseta] })], [zonaSobreCaseta]).cruces).toEqual([]);
  });

  it('posible doble cobro: el MISMO TAG en la misma caseta con ≤ 10 min; se reclama el segundo y apunta al primero', () => {
    const { cruces, resumen } = construirReclamacion([
      linea({ indice: 0 }),
      linea({ indice: 1, hora: '10:38:00', cruceMs: min(8) }),
      linea({ indice: 2, hora: '10:55:00', cruceMs: min(25) }), // 25 min: otro cruce
    ], []);
    expect(cruces).toHaveLength(1);
    expect(cruces[0]).toMatchObject({ indice: 1, motivo: 'doble_cobro', confianza: 'media', duplicadoDeLinea: 1 });
    expect(cruces[0].porQue).toMatch(/primer cobro: línea 1/);
    expect(resumen.porMotivo.doble_cobro).toEqual({ n: 1, monto: 189.5 });
  });

  it('no hay doble cobro con otro TAG, otra caseta, sin TAG o sin hora', () => {
    const base = [linea({ indice: 0 })];
    for (const otra of [
      linea({ indice: 1, tag: 'IMDM10000002', cruceMs: min(3) }),
      linea({ indice: 1, casetaCatalogo: 'Caseta Ejemplo Sur', caseta: 'Caseta Ejemplo Sur', cruceMs: min(3) }),
      linea({ indice: 1, tag: '', cruceMs: min(3) }),
      linea({ indice: 1, cruceMs: null, hora: '' }),
    ]) expect(construirReclamacion([...base, otra], []).cruces).toEqual([]);
  });

  it('el límite de la ventana es inclusivo (10 min) y la cadena se ancla en el PRIMER cobro', () => {
    const { cruces } = construirReclamacion([
      linea({ indice: 0 }), linea({ indice: 1, cruceMs: min(VENTANA_DOBLE_COBRO_MIN) }), linea({ indice: 2, cruceMs: min(VENTANA_DOBLE_COBRO_MIN + 1) }),
    ], []);
    // 1 está a 10 min del ancla (0) → duplicado; 2 está a 11 min del ancla (0) → NO (no se encadena con el duplicado)
    expect(cruces.map((c) => c.indice)).toEqual([1]);
  });

  it('cada línea recibe UN motivo: GPS manda sobre zona y sobre doble cobro; la zona se anota en el «por qué»', () => {
    const enPatio = { lat: PATIO.lat, lng: PATIO.lng, t: min(0) };
    const { cruces } = construirReclamacion([
      linea({ indice: 0 }),
      linea({ indice: 1, cruceMs: min(2), gps: 'no coincide', gpsDistanciaM: 20_000, muestras: [enPatio] }),
    ], [PATIO]);
    expect(cruces).toHaveLength(1);
    expect(cruces[0]).toMatchObject({ indice: 1, motivo: 'gps_lejos_de_caseta', zona: { nombre: 'Patio Central' } });
    expect(cruces[0].porQue).toMatch(/estaba en «Patio Central»/);
  });

  it('suma el monto con centavos exactos, por motivo y total', () => {
    const { resumen } = construirReclamacion([
      linea({ indice: 0, gps: 'no coincide', monto: 0.1 }), linea({ indice: 1, gps: 'no coincide', monto: 0.2 }),
      linea({ indice: 2, hora: '', cruceMs: null, tag: '', gps: 'confirma' }),
    ], []);
    expect(resumen.montoReclamable).toBe(0.3);
    expect(resumen.porMotivo.gps_lejos_de_caseta).toEqual({ n: 2, monto: 0.3 });
  });

  it('sin coordenadas de caseta no se inventa el radio ni la distancia a la caseta', () => {
    const { cruces } = construirReclamacion([linea({ indice: 0, gps: 'no coincide', gpsDistanciaM: null, casetaGeo: null, muestras: [lejos(-1), lejos(1)] })], []);
    expect(cruces[0].radioCasetaM).toBeNull();
    expect(cruces[0].evidencia.every((e) => e.distanciaCasetaM === null)).toBe(true);
    expect(cruces[0].porQue).not.toMatch(/radio de la caseta/);
  });
});

function reporte(): ReporteReclamacion {
  const { cruces, resumen } = construirReclamacion([
    linea({ indice: 0, gps: 'no coincide', gpsDistanciaM: 22_300, muestras: [lejos(-2), lejos(2)] }),
    linea({ indice: 1, tag: '=cmd|x', caseta: '=HYPERLINK("http://x")', casetaCatalogo: '', hora: '11:00:00', cruceMs: min(30), gps: 'no coincide', gpsDistanciaM: 5000, monto: 100 }),
    linea({ indice: 2, tag: 'IMDM10000009', gps: 'confirma' }),
  ], []);
  return { desgloseId: 'd-1', proveedor: 'PASE', periodoDesde: '2026-08-01', periodoHasta: '2026-08-10', cruces, resumen, leyendas: LEYENDAS_RECLAMACION };
}

describe('el Excel del reporte', () => {
  const libro = () => XLSX.read(reclamacionAExcel(reporte()), { type: 'array' });

  it('trae las tres hojas, los cruces con su monto como NÚMERO y el total reclamable', () => {
    const l = libro();
    expect(l.SheetNames).toEqual(['Reclamación', 'Evidencia GPS', 'Resumen']);
    const m = XLSX.utils.sheet_to_json<unknown[]>(l.Sheets['Reclamación'], { header: 1, defval: null });
    const enc = m.findIndex((f) => f[0] === 'Línea');
    expect(m[enc].slice(0, 8)).toEqual(['Línea', 'Fecha del cruce', 'Hora del pase', 'Caseta (proveedor)', 'Caseta (catálogo)', 'TAG', 'Unidad', 'Monto (MXN)']);
    expect(m[enc + 1].slice(0, 8)).toEqual([1, '2026-08-05', '10:30:00', 'Caseta Ejemplo Norte', 'Caseta Ejemplo Norte', 'IMDM10000001', 'C2-08', 189.5]);
    expect(m[enc + 1][8]).toBe('GPS lejos de la caseta');
    expect(String(m[enc + 1][10])).toMatch(/22,300 m/);
    expect(String(m[enc + 1][13])).toMatch(/de la caseta/);
    expect(m.find((f) => f[0] === 'Total reclamable')?.[7]).toBe(289.5);
  });

  it('un texto del proveedor que parece fórmula se escribe como TEXTO', () => {
    const hoja = libro().Sheets['Reclamación'];
    for (const [k, c] of Object.entries(hoja)) {
      if (k.startsWith('!')) continue;
      expect((c as XLSX.CellObject).f, `la celda ${k} no debe ser fórmula`).toBeUndefined();
    }
    const m = XLSX.utils.sheet_to_json<unknown[]>(hoja, { header: 1, defval: null });
    expect(m.some((f) => f[3] === '=HYPERLINK("http://x")')).toBe(true);
  });

  it('la hoja de evidencia lista cada posición con su línea; el resumen separa lo que NO se reclama y trae las leyendas', () => {
    const l = libro();
    const ev = XLSX.utils.sheet_to_json<unknown[]>(l.Sheets['Evidencia GPS'], { header: 1, defval: null });
    expect(ev.slice(1).map((f) => f[0])).toEqual([1, 1]);
    const res = XLSX.utils.sheet_to_json<unknown[]>(l.Sheets.Resumen, { header: 1, defval: null });
    expect(res.find((f) => f[0] === 'Confirmadas por el GPS')?.[1]).toBe(1);
    expect(res.some((f) => String(f[0]).startsWith('Reporte de cruces para pedir'))).toBe(true);
  });

  it('es determinista', () => {
    expect(Buffer.from(reclamacionAExcel(reporte())).equals(Buffer.from(reclamacionAExcel(reporte())))).toBe(true);
  });
});

describe('el PDF del reporte', () => {
  it('es un PDF válido y determinista, en horizontal', async () => {
    const a = await reclamacionAPdf(reporte(), 'Flota Ejemplo SA');
    const b = await reclamacionAPdf(reporte(), 'Flota Ejemplo SA');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const d = await PDFDocument.load(a);
    expect(d.getPageCount()).toBe(1);
    const { width, height } = d.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
  });

  it('sin cruces reclamables lo dice (no entrega una tabla vacía con cara de reporte)', async () => {
    const vacio = { ...reporte(), cruces: [], resumen: construirReclamacion([linea({ indice: 0, gps: 'confirma' })], []).resumen };
    expect((await PDFDocument.load(await reclamacionAPdf(vacio))).getPageCount()).toBe(1);
    const m = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(reclamacionAExcel(vacio), { type: 'array' }).Sheets['Reclamación'], { header: 1, defval: null });
    expect(m.find((f) => f[0] === 'Total reclamable')?.[7]).toBe(0);
  });

  it('pagina con muchos cruces y no truena con texto hostil o fuera de Latin-1', async () => {
    const muchos = construirReclamacion(
      Array.from({ length: 120 }, (_, i) => linea({ indice: i, caseta: `Caseta ñandú 😀 → ${i}`, casetaCatalogo: '', tag: `T${i}`, unidad: 'C\u0007-1', gps: 'no coincide', gpsDistanciaM: 3_000 + i, muestras: [lejos(-2), lejos(2)] })),
      [],
    );
    const pdf = await PDFDocument.load(await reclamacionAPdf({ ...reporte(), cruces: muchos.cruces, resumen: muchos.resumen }));
    expect(pdf.getPageCount()).toBeGreaterThan(2);
  });
});
