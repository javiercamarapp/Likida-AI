import { describe, expect, it } from 'vitest';
import { parsearCsvSitios } from '../conductor/sitios';
import {
  adaptarAPosiciones, construirConsultaPosiciones, geocercasASitiosCsv, haversineM, leerGeocercasCsv, leerPoligonoWkt,
  leerPosicionesCsv, LectorTablaPropiaCsv, llaveEconomico, localAUtc, motivoCoordenadas, normalizarFechaLocal,
} from './lector_tabla_propia';
import { textoMuestra } from './muestras.test.util';
import type { LectorTablaPropia } from './contratos';

// ═══════════════════════════════════════════════════════════════════════════
// EL CONTRATO DEL LECTOR DE «TABLA PROPIA» — con dobles y con los archivos de
// muestra del demo. Lo que se fija: las dos rarezas sembradas (hora local sin
// zona, unidad por número económico), que nada se adivina, y que el lector solo
// puede LEER.
// ═══════════════════════════════════════════════════════════════════════════

describe('hora local sin zona → UTC', () => {
  it('CDMX es UTC-6 (sin horario de verano desde 2022): 09:00 local = 15:00Z', () => {
    expect(localAUtc('2026-10-20 09:00:00').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(localAUtc('2026-01-15 00:00:00').toISOString()).toBe('2026-01-15T06:00:00.000Z');
  });
  it('usa el desfase REAL de esa fecha (antes de 2022 CDMX tenía horario de verano: UTC-5 en julio)', () => {
    expect(localAUtc('2021-07-01 12:00:00').toISOString()).toBe('2021-07-01T17:00:00.000Z');
    expect(localAUtc('2021-12-01 12:00:00').toISOString()).toBe('2021-12-01T18:00:00.000Z');
  });
  it('acepta AAAA-MM-DD y DD/MM/AAAA, y normaliza los segundos', () => {
    expect(normalizarFechaLocal('2026-10-20 09:00')).toEqual({ ok: '2026-10-20 09:00:00' });
    expect(normalizarFechaLocal('20/10/2026 9:05:07')).toEqual({ ok: '2026-10-20 09:05:07' });
  });
  it('si el dato YA trae zona, no se supone la de CDMX: se rechaza para confirmarlo con sistemas', () => {
    expect(normalizarFechaLocal('2026-10-20T09:00:00-06:00')).toMatchObject({ error: expect.stringContaining('zona') });
    expect(normalizarFechaLocal('2026-10-20T15:00:00Z')).toMatchObject({ error: expect.stringContaining('zona') });
  });
  it('fechas imposibles o con formato desconocido se rechazan', () => {
    expect(normalizarFechaLocal('2026-02-30 10:00:00')).toHaveProperty('error');
    expect(normalizarFechaLocal('10/20/2026 10:00')).toHaveProperty('error'); // mm/dd no se voltea
    expect(normalizarFechaLocal('ayer')).toHaveProperty('error');
  });
});

describe('coordenadas: no se «arreglan»', () => {
  it('lat/lng intercambiadas se rechazan diciendo qué parecen', () => {
    expect(motivoCoordenadas(-100.19, 25.78)).toContain('intercambiadas');
  });
  it('fuera de México y fuera de rango', () => {
    expect(motivoCoordenadas(40.7, -74)).toBe('fuera de México');
    expect(motivoCoordenadas(95, -100)).toBe('coordenadas fuera de rango');
    expect(motivoCoordenadas(null, -100)).toContain('ilegible');
  });
  it('un punto de Apodaca pasa', () => expect(motivoCoordenadas(25.78, -100.19)).toBeNull());
});

describe('leerPosicionesCsv', () => {
  const ENC = 'id_unidad,latitud,longitud,fecha_hora,velocidad_kmh,ignicion';
  it('lee con los encabezados de su tabla y con alias razonables', () => {
    const r = leerPosicionesCsv(`${ENC}\nIN-001,25.78,-100.19,2026-10-20 09:00:00,72.5,1\nIN-002,21.35,-101.93,2026-10-20 09:00:00,0,0`);
    expect(r.rechazadas).toEqual([]);
    expect(r.filas[0]).toEqual({ unidad: 'IN-001', lat: 25.78, lon: -100.19, fechaHoraLocal: '2026-10-20 09:00:00', velocidadKmh: 72.5, ignicion: true });
    expect(r.filas[1].ignicion).toBe(false);
    const alias = leerPosicionesCsv('Economico,Latitude,Longitude,Timestamp,Speed,Ignition\nIN-003,20.9,-101.4,20/10/2026 09:10,40,ON');
    expect(alias.filas[0]).toMatchObject({ unidad: 'IN-003', velocidadKmh: 40, ignicion: true });
  });
  it('con «;» la coma es decimal (Excel en español) y solo entonces', () => {
    const r = leerPosicionesCsv('unidad;lat;lon;fecha_hora\nIN-001;25,78;-100,19;2026-10-20 09:00:00');
    expect(r.filas[0]).toMatchObject({ lat: 25.78, lon: -100.19 });
    const coma = leerPosicionesCsv('unidad,lat,lon,fecha_hora\nIN-001,"25,78",-100.19,2026-10-20 09:00:00');
    expect(coma.rechazadas).toHaveLength(1); // «25,78» con separador coma NO es 25.78
  });
  it('rechaza fila por fila con su número y motivo, y deja pasar las buenas', () => {
    const r = leerPosicionesCsv(`${ENC}\n,25.78,-100.19,2026-10-20 09:00:00,1,1\nIN-001,-100.19,25.78,2026-10-20 09:00:00,1,1\nIN-001,25.78,-100.19,2026-10-20T15:00:00Z,1,1\nIN-001,25.78,-100.19,2026-10-20 09:00:00,300,1\nIN-001,25.78,-100.19,2026-10-20 09:00:00,60,1`);
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas.map((x) => x.fila)).toEqual([2, 3, 4, 5]);
    expect(r.rechazadas[0].motivo).toContain('unidad');
    expect(r.rechazadas[1].motivo).toContain('intercambiadas');
    expect(r.rechazadas[2].motivo).toContain('zona');
    expect(r.rechazadas[3].motivo).toContain('velocidad');
  });
  it('sin columnas obligatorias dice cuáles faltan y qué leyó', () => {
    const r = leerPosicionesCsv('a,b,c\n1,2,3');
    expect(r.error).toMatch(/unidad, lat, lon, fecha/);
    expect(r.error).toContain('a | b | c');
    expect(leerPosicionesCsv('').error).toBe('El archivo está vacío.');
  });
});

describe('adaptarAPosiciones: su unidad → la de Likida, su hora → UTC', () => {
  const unidades = new Map([['IN-001', 'uuid-1'], ['IN-002', 'uuid-2']]);
  const fila = (unidad: string, fh = '2026-10-20 09:00:00') => ({ unidad, lat: 25.78, lon: -100.19, fechaHoraLocal: fh, velocidadKmh: 50, ignicion: true });
  it('resuelve por número económico sin importar guiones, mayúsculas o espacios', () => {
    const r = adaptarAPosiciones([fila('in 001'), fila('IN.002')], unidades);
    expect(r.posiciones.map((p) => p.unidadId)).toEqual(['uuid-1', 'uuid-2']);
    expect(r.posiciones[0]).toMatchObject({ medidaEn: '2026-10-20T15:00:00.000Z', proveedor: 'tabla_propia', lng: -100.19 });
    expect(llaveEconomico('in-001')).toBe('IN001');
  });
  it('una unidad que Likida no tiene se CUENTA como «sin unidad»; jamás se inventa', () => {
    const r = adaptarAPosiciones([fila('IN-999'), fila('IN-999'), fila('IN-001')], unidades);
    expect(r.posiciones).toHaveLength(1);
    expect(r.sinUnidad.get('IN-999')).toBe(2);
  });
  it('dos económicos que chocan al normalizar son ambiguos: no se asigna a ninguno', () => {
    const r = adaptarAPosiciones([fila('IN-001')], new Map([['IN-001', 'a'], ['IN 001', 'b']]));
    expect(r.posiciones).toHaveLength(0);
    expect(r.sinUnidad.get('IN-001')).toBe(1);
  });
  it('lectura incremental: lo anterior a desdeUtc no se vuelve a escribir', () => {
    const r = adaptarAPosiciones([fila('IN-001', '2026-10-20 08:00:00'), fila('IN-001', '2026-10-20 09:00:00')], unidades, { desdeUtc: new Date('2026-10-20T14:30:00Z') });
    expect(r.posiciones).toHaveLength(1);
    expect(r.anteriores).toBe(1);
  });
});

describe('modo SQL de solo lectura: la consulta que se arma', () => {
  const cfg = { vista: 'innovativos_sim.v_gps_actual', columnas: { unidad: 'id_unidad', lat: 'latitud', lon: 'longitud', fecha: 'fecha_hora', velocidad: 'velocidad_kmh', ignicion: 'ignicion' } };
  it('es UN select con valores como parámetros y límite acotado', () => {
    const q = construirConsultaPosiciones(cfg, { desdeLocal: '2026-10-20 08:00:00', unidades: ['IN-001'] });
    expect(q.text).toBe('select "id_unidad" as unidad, "latitud" as lat, "longitud" as lon, "fecha_hora" as fecha_hora, "velocidad_kmh" as velocidad_kmh, "ignicion" as ignicion from "innovativos_sim"."v_gps_actual" where "fecha_hora" >= $1 and "id_unidad" = any($2) order by "fecha_hora" asc limit 50000');
    expect(q.values).toEqual(['2026-10-20 08:00:00', ['IN-001']]);
    expect(construirConsultaPosiciones({ ...cfg, limite: 10_000_000 }).text).toMatch(/limit 200000$/);
  });
  it('un identificador con algo que no sea letra/dígito/guion bajo se rechaza (no hay inyección por configuración)', () => {
    for (const vista of ['x; drop table posicion', 'a.b.c', 'v" or 1=1 --', '']) expect(() => construirConsultaPosiciones({ ...cfg, vista })).toThrow(/vista inválida/);
    expect(() => construirConsultaPosiciones({ ...cfg, columnas: { ...cfg.columnas, lat: 'latitud, (select 1)' } })).toThrow(/columna inválida/);
  });
});

describe('geocercas de su sistema', () => {
  it('el WKT va lon-lat y se lee completo; un ring cerrado no repite el primer vértice', () => {
    const p = leerPoligonoWkt('POLYGON((-100.2 25.7, -100.1 25.7, -100.1 25.8, -100.2 25.8, -100.2 25.7))');
    expect(p).toEqual({ ok: [{ lat: 25.7, lon: -100.2 }, { lat: 25.7, lon: -100.1 }, { lat: 25.8, lon: -100.1 }, { lat: 25.8, lon: -100.2 }] });
    expect(leerPoligonoWkt('POLYGON((-100.2 25.7, -100.1 25.7))')).toHaveProperty('error');
    expect(leerPoligonoWkt('POINT(1 2)')).toHaveProperty('error');
    expect(leerPoligonoWkt('POLYGON((25.7 -100.2, 25.7 -100.1, 25.8 -100.1))')).toMatchObject({ error: expect.stringContaining('intercambiadas') });
  });
  it('un círculo sin radio NO recibe uno supuesto', () => {
    const r = leerGeocercasCsv('codigo,nombre,tipo,lat_centro,lon_centro,radio_m\nPL-1,Planta,circulo,25.78,-100.19,\nPL-2,Otra,circulo,25.79,-100.2,300');
    expect(r.filas.map((g) => g.codigo)).toEqual(['PL-2']);
    expect(r.rechazadas[0].motivo).toContain('radio_m');
  });
  it('un código repetido se rechaza', () => {
    const r = leerGeocercasCsv('codigo,nombre,lat,lon,radio\nA,Uno,25.78,-100.19,300\nA,Dos,25.79,-100.2,300');
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas[0].motivo).toContain('repetido');
  });
  it('pasa al catálogo de sitios REAL del Conductor: el polígono se aproxima por un círculo que lo contiene', () => {
    const g = leerGeocercasCsv('codigo,nombre,tipo,lat_centro,lon_centro,radio_m,poligono_wkt\nPL-9,Planta poligonal,poligono,,,,"POLYGON((-100.204 25.777, -100.196 25.777, -100.196 25.783, -100.204 25.783, -100.204 25.777))"\nPATIO-1,Patio,circulo,25.78,-100.19,600,');
    const s = geocercasASitiosCsv(g.filas);
    expect(s.aproximadas).toHaveLength(1);
    const sitios = parsearCsvSitios(s.csv);
    expect(sitios.errores).toEqual([]);
    expect(sitios.filas.map((x) => [x.codigo, x.tipo])).toEqual([['PL-9', 'planta'], ['PATIO-1', 'patio']]);
    const poli = g.filas[0].poligono!; const centro = { lat: sitios.filas[0].lat, lon: sitios.filas[0].lng };
    for (const v of poli) expect(haversineM(centro, v)).toBeLessThanOrEqual(sitios.filas[0].radio_m); // SIEMPRE lo contiene
  });
});

describe('contra los archivos de muestra del demo (la salida de «su tabla»)', () => {
  const lector: LectorTablaPropia = new LectorTablaPropiaCsv({ posiciones: textoMuestra('gps/gps_posicion_muestra.csv'), geocercas: textoMuestra('gps/geocercas.csv') });
  it('cumple la interfaz: lee 12 unidades sin una sola fila rechazada', async () => {
    expect(lector.modo).toBe('csv_sftp');
    const r = await lector.leerPosiciones();
    expect(r.rechazadas).toEqual([]);
    expect(new Set(r.filas.map((f) => f.unidad)).size).toBe(12);
    const una = await lector.leerPosiciones({ unidades: ['in 005'] });
    expect(new Set(una.filas.map((f) => f.unidad))).toEqual(new Set(['IN-005']));
  });
  it('la unidad silenciosa (IN-023) deja de reportar >90 min antes del final: el contrato lo hace visible', async () => {
    const { filas } = await lector.leerPosiciones();
    const ultima = (u: string) => Math.max(...filas.filter((f) => f.unidad === u).map((f) => localAUtc(f.fechaHoraLocal).getTime()));
    expect(ultima('IN-001') - ultima('IN-023')).toBeGreaterThanOrEqual(100 * 60_000);
  });
  it('lee las 17 geocercas: 13 círculos y 4 polígonos', async () => {
    const r = await lector.leerGeocercas();
    expect(r.rechazadas).toEqual([]);
    expect(r.filas.filter((g) => g.tipo === 'poligono')).toHaveLength(4);
    expect(r.filas).toHaveLength(17);
  });
});
