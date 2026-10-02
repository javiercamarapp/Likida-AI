/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leerGeocercasCsv, leerPosicionesCsv, partirCsv } from './csv';
import { leerConfigTablaPropia } from './config';
import { ErrorTablaPropia } from './contrato';
import { localAUtc, normalizarFechaLocal, utcALocal, zonaValida } from './tiempo';
import { leerIgnicion, leerNumero, leerPoligonoWkt, llaveEconomico, motivoCoordenadas } from './validar';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

describe('hora local ⇄ UTC con zona configurable', () => {
  it('CDMX es UTC-6 sin horario de verano desde 2022; antes sí lo tenía (desfase real de ESA fecha)', () => {
    expect(localAUtc('2026-10-20 09:00:00').toISOString()).toBe('2026-10-20T15:00:00.000Z');
    expect(localAUtc('2021-07-01 12:00:00').toISOString()).toBe('2021-07-01T17:00:00.000Z');
  });
  it('otra zona configurada cambia el resultado (Chihuahua = UTC-6 todo el año; Tijuana tiene horario de verano)', () => {
    expect(localAUtc('2026-07-01 12:00:00', 'America/Tijuana').toISOString()).toBe('2026-07-01T19:00:00.000Z');
    expect(localAUtc('2026-01-01 12:00:00', 'America/Tijuana').toISOString()).toBe('2026-01-01T20:00:00.000Z');
  });
  it('ida y vuelta', () => expect(utcALocal(localAUtc('2026-10-20 09:05:07'))).toBe('2026-10-20 09:05:07'));
  it('una fecha CON zona explícita se respeta y se pasa a la hora local configurada', () => {
    expect(normalizarFechaLocal('2026-10-20T15:00:00Z')).toEqual({ ok: '2026-10-20 09:00:00' });
    expect(normalizarFechaLocal('2026-10-20 09:00:00-06:00')).toEqual({ ok: '2026-10-20 09:00:00' });
    // lo que escribe Postgres para timestamptz: desfase sin minutos (+00, -06) o compacto (-0600)
    expect(normalizarFechaLocal('2026-10-20 15:00:00+00')).toEqual({ ok: '2026-10-20 09:00:00' });
    expect(normalizarFechaLocal('2026-10-20 09:00:00.123456-06')).toEqual({ ok: '2026-10-20 09:00:00' });
    expect(normalizarFechaLocal('2026-10-20T15:00:00+0000')).toEqual({ ok: '2026-10-20 09:00:00' });
  });
  it('descarta la fracción de segundo de un timestamp sin zona', () => {
    expect(normalizarFechaLocal('2026-10-20 09:00:00.250')).toEqual({ ok: '2026-10-20 09:00:00' });
  });
  it('rechaza lo ilegible: mm/dd no se voltea, fechas imposibles, texto', () => {
    expect(normalizarFechaLocal('10/20/2026 10:00')).toHaveProperty('error');
    expect(normalizarFechaLocal('2026-02-30 10:00:00')).toHaveProperty('error');
    expect(normalizarFechaLocal('ayer')).toHaveProperty('error');
    expect(normalizarFechaLocal('')).toHaveProperty('error');
  });
  it('valida nombres de zona', () => {
    expect(zonaValida('America/Monterrey')).toBe(true);
    expect(zonaValida('Mordor/Orodruin')).toBe(false);
    expect(zonaValida('../etc')).toBe(false);
  });
});

describe('validación: nada se «arregla»', () => {
  it('coordenadas intercambiadas, fuera de México y fuera de rango', () => {
    expect(motivoCoordenadas(-100.19, 25.78)).toContain('intercambiadas');
    expect(motivoCoordenadas(40.7, -74)).toBe('fuera de México');
    expect(motivoCoordenadas(95, -100)).toBe('coordenadas fuera de rango');
    expect(motivoCoordenadas(25.78, -100.19)).toBeNull();
  });
  it('números estrictos y económicos normalizados', () => {
    expect(leerNumero('20.5')).toBe(20.5);
    expect(leerNumero('-103,31', true)).toBe(-103.31);
    expect(leerNumero('-103,31', false)).toBeNull();
    expect(leerNumero("20°43'")).toBeNull();
    expect(llaveEconomico('IN-001')).toBe(llaveEconomico('in 001'));
    expect(leerIgnicion('Sí')).toBe(true);
    expect(leerIgnicion('quizá')).toBeNull();
  });
  it('polígono WKT simple; huecos, multipolígonos y vértices fuera de México se rechazan', () => {
    expect(leerPoligonoWkt('POLYGON((-103.3 20.6, -103.2 20.6, -103.2 20.7, -103.3 20.6))')).toHaveProperty('ok');
    expect(leerPoligonoWkt('POLYGON((-103.3 20.6, -103.2 20.6, -103.2 20.7, -103.3 20.6),(-103.25 20.62, -103.24 20.62, -103.24 20.63, -103.25 20.62))')).toHaveProperty('error');
    expect(leerPoligonoWkt('MULTIPOLYGON(((1 1, 2 2, 3 3, 1 1)))')).toHaveProperty('error');
    expect(leerPoligonoWkt('POLYGON((-103.3 20.6, -103.2 20.6))')).toHaveProperty('error');
    expect(leerPoligonoWkt('POLYGON((10 10, 11 10, 11 11, 10 10))')).toHaveProperty('error');
  });
});

describe('CSV de posiciones (fixture de contrato)', () => {
  const r = leerPosicionesCsv(fx('posiciones.csv'));
  it('entiende las filas buenas, con DD/MM/AAAA y con fecha con zona', () => {
    expect(r.filas.map((f) => f.unidad)).toEqual(['UN-001', 'UN-001', 'un 002']);
    expect(r.filas[2].fechaHoraLocal).toBe('2026-10-20 07:06:00');
    expect(r.filas[1]).toMatchObject({ velocidadKmh: 48.5, ignicion: true });
  });
  it('rechaza con motivo y número de fila (cabecera = 1)', () => {
    const m = new Map(r.rechazadas.map((x) => [x.fila, x.motivo]));
    expect(m.get(5)).toContain('intercambiadas');
    expect(m.get(6)).toBe('fuera de México');
    expect(m.get(7)).toContain('velocidad fuera de rango');
    expect(m.get(8)).toContain('fecha_hora');
    expect(m.get(9)).toBe('unidad vacía');
  });
  it('faltan columnas → error con los encabezados leídos; vacío → error', () => {
    expect(() => leerPosicionesCsv('a,b\n1,2')).toThrow(ErrorTablaPropia);
    expect(() => leerPosicionesCsv('a,b\n1,2')).toThrow(/Faltan columnas obligatorias/);
    expect(() => leerPosicionesCsv('')).toThrow(/vacío/);
  });
  it('separador «;» con decimal en coma, BOM y comillas', () => {
    const t = '﻿unidad;lat;lon;fecha_hora\n"UN;7";25,78;-100,19;2026-10-20 07:00:00\n';
    expect(leerPosicionesCsv(t).filas[0]).toMatchObject({ unidad: 'UN;7', lat: 25.78, lon: -100.19 });
  });
  it('una línea adversaria de 200,000 caracteres no explota', () => {
    const t = `unidad,lat,lon,fecha_hora\n${'x'.repeat(200_000)},1,2,3\n`;
    expect(leerPosicionesCsv(t).rechazadas).toHaveLength(1);
    expect(partirCsv('a,"b\nc').length).toBeGreaterThan(0);
  });
  it('se aplica la zona configurada a las fechas con zona', () => {
    const t = 'unidad,lat,lon,fecha_hora\nUN-1,25.78,-100.19,2026-10-20T15:00:00Z\n';
    expect(leerPosicionesCsv(t, { zona: 'America/Tijuana' }).filas[0].fechaHoraLocal).toBe('2026-10-20 08:00:00');
  });
});

describe('CSV de geocercas', () => {
  it('círculo y polígono; sin radio no se supone uno', () => {
    const r = leerGeocercasCsv(fx('geocercas.csv'));
    expect(r.rechazadas).toEqual([]);
    expect(r.filas.map((g) => g.tipo)).toEqual(['circulo', 'circulo', 'poligono', 'poligono']);
    expect(r.filas[2].poligono).toHaveLength(4);
    const sin = leerGeocercasCsv('codigo,nombre,lat_centro,lon_centro\nA,Uno,25.78,-100.19\n');
    expect(sin.rechazadas[0].motivo).toContain('radio_m obligatorio');
  });
  it('código repetido y columnas faltantes', () => {
    expect(leerGeocercasCsv('codigo,nombre,lat_centro,lon_centro,radio_m\nA,Uno,25.78,-100.19,100\nA,Dos,25.78,-100.19,100\n').rechazadas[0].motivo).toContain('repetido');
    expect(() => leerGeocercasCsv('codigo,nombre\nA,B\n')).toThrow(/lat_centro o poligono_wkt/);
  });
});

describe('configuración por flota', () => {
  const sqlOk = { modo: 'sql_solo_lectura', sql_host: 'replica.ejemplo.com', sql_base: 'flota', sql_usuario: 'lectura', sql_clave: 'x', vista: 'esquema.posiciones', columnas: '{"unidad":"eco","lat":"lat","lon":"lon","fecha_hora":"ts"}' };
  it('SQL válido', () => expect(leerConfigTablaPropia(sqlOk)).toMatchObject({ ok: true }));
  it('SQL: vista/columnas con inyección, esquema de sistema, ssl en claro', () => {
    expect(leerConfigTablaPropia({ ...sqlOk, vista: 'v; drop table x' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...sqlOk, vista: 'pg_catalog.pg_user' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...sqlOk, vista: 'a.b.c' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...sqlOk, columnas: '{"unidad":"eco\\" ; --","lat":"lat","lon":"lon","fecha_hora":"ts"}' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...sqlOk, columnas: '{"unidad":"eco","lat":"lat","lon":"lon","fecha_hora":"ts","otra":"x"}' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...sqlOk, sql_ssl: 'disable' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...sqlOk, sql_host: 'host con espacios' })).toMatchObject({ ok: false });
  });
  it('endpoint/CSV: solo https, sin usuario en la URL, patrón conocido, zona válida, ventana acotada', () => {
    const csv = { modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv' };
    expect(leerConfigTablaPropia(csv)).toMatchObject({ ok: true });
    expect(leerConfigTablaPropia({ ...csv, base_url: 'http://datos.ejemplo.com/p.csv' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...csv, base_url: 'https://u:p@datos.ejemplo.com/p.csv' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...csv, patron: 'magia' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...csv, patron: 'bearer' })).toMatchObject({ ok: false }); // falta token
    expect(leerConfigTablaPropia({ ...csv, zona: 'Mordor/X' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...csv, ventana_minutos: '99999' })).toMatchObject({ ok: false });
    // M2: el barrido largo nace apagado y solo admite 0 o 60..1,440, mayor que la ventana
    expect(leerConfigTablaPropia(csv)).toMatchObject({ ok: true, config: { barridoLargoMinutos: 0 } });
    expect(leerConfigTablaPropia({ ...csv, barrido_largo_minutos: '360' })).toMatchObject({ ok: true, config: { barridoLargoMinutos: 360, ventanaMinutos: 30 } });
    for (const malo of ['30', '59', '1441', 'seis horas', '-1']) expect(leerConfigTablaPropia({ ...csv, barrido_largo_minutos: malo }), malo).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...csv, ventana_minutos: '120', barrido_largo_minutos: '120' })).toMatchObject({ ok: false }); // no mayor que la ventana
    expect(leerConfigTablaPropia({ ...csv, ventana_minutos: '120', barrido_largo_minutos: '0' })).toMatchObject({ ok: true });
    expect(leerConfigTablaPropia({ modo: 'telepatia' })).toMatchObject({ ok: false });
    // sftp:// ya se lee de verdad, pero exige usuario, credencial y la huella del servidor (ver sftp.test.ts)
    expect(leerConfigTablaPropia({ ...csv, base_url: 'sftp://s.ejemplo.com/p.csv' })).toMatchObject({ ok: false });
  });
  it('endpoint exige mapeo y rechaza claves de prototipo', () => {
    const e = { modo: 'endpoint', base_url: 'https://api.ejemplo.com/p' };
    expect(leerConfigTablaPropia(e)).toMatchObject({ ok: false });
    const m = (campos: string) => JSON.stringify({ lista: 'data', campos: JSON.parse(campos) });
    expect(leerConfigTablaPropia({ ...e, mapeo_posiciones: m('{"unidad":"a","lat":"b","lon":"c","fecha_hora":"d"}') })).toMatchObject({ ok: true });
    expect(leerConfigTablaPropia({ ...e, mapeo_posiciones: m('{"unidad":"__proto__","lat":"b","lon":"c","fecha_hora":"d"}') })).toMatchObject({ ok: false });
  });
});
