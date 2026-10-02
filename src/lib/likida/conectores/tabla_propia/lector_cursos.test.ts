/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures del propio directorio por URL relativa a este archivo, nunca por entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Http } from '../tipos';
import { ErrorTablaPropia } from './contrato';
import { leerConfigTablaPropia } from './config';
import { leerCursosCsv } from './csv';
import { registrosACursos } from './filas';
import { crearLectorTablaPropia } from './lector';
import { leerLineaWkt } from './validar';
import { construirSelect, type EjecutorSql } from './sql';

// ═══════════════════════════════════════════════════════════════════════════
// LOS CURSOS (rutas autorizadas) EN EL LECTOR DE TABLA PROPIA: CSV, endpoint JSON y SQL de solo lectura detrás del mismo
// contrato, con fixtures sintéticos. Lo que no se entiende se RECHAZA con su motivo; jamás se adivina un formato.
// ═══════════════════════════════════════════════════════════════════════════

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const ok = (cuerpo: string) => ({ estado: 200, cuerpo, encabezados: {} });
const reloj = { ahora: () => Date.parse('2026-10-20T13:30:00.000Z'), dormir: async () => undefined };

describe('CSV de cursos', () => {
  it('lee casetas por convenio, casetas por unidad (con vigencia) y un corredor sintético', () => {
    const r = leerCursosCsv(fx('cursos.csv'));
    expect(r.rechazadas).toEqual([]);
    expect(r.filas).toHaveLength(3);
    expect(r.filas[0]).toEqual({
      codigo: 'CUR-001', nombre: 'Planta Poniente a Patio Norte', tipo: 'casetas', unidad: null, convenio: 'Convenio Ficticio Uno',
      casetas: ['Caseta Ejemplo Norte', 'Caseta Ejemplo Sur', 'Caseta Ejemplo Centro'], corredor: null, bufferM: null, vigenteDesde: null, vigenteHasta: null,
    });
    expect(r.filas[1]).toMatchObject({ tipo: 'casetas', unidad: 'UN-001', convenio: null, casetas: ['Caseta Ejemplo Sur'], vigenteDesde: '2026-01-01', vigenteHasta: '2026-12-31' });
    expect(r.filas[2]).toMatchObject({ tipo: 'corredor', unidad: 'UN-002', casetas: [], bufferM: 500, vigenteDesde: '2026-02-01', vigenteHasta: null });
    expect(r.filas[2].corredor).toEqual([{ lat: 20.62, lon: -103.30 }, { lat: 20.62, lon: -103.20 }, { lat: 20.70, lon: -103.10 }]);
  });

  it('cada fila mala se rechaza con su motivo y la fila buena sigue (la primera repetida gana)', () => {
    const r = leerCursosCsv(fx('cursos_con_errores.csv'));
    expect(r.filas.map((f) => f.codigo)).toEqual(['OK-1']);
    const por = (n: number) => r.rechazadas.find((x) => x.fila === n)?.motivo ?? '';
    expect(por(3)).toMatch(/código repetido: OK-1/);
    expect(por(4)).toMatch(/codigo o nombre vacío/);
    expect(por(5)).toMatch(/sin unidad ni convenio/);
    expect(por(6)).toMatch(/sin casetas autorizadas ni corredor/);
    expect(por(7)).toMatch(/casetas Y corredor/);
    expect(por(8)).toMatch(/buffer_m obligatorio/);
    expect(por(9)).toMatch(/buffer_m obligatorio/);
    expect(por(10)).toMatch(/al menos 2 vértices/);
    expect(por(11)).toMatch(/fuera de México/);
    expect(por(12)).toMatch(/intercambiadas/);
    expect(por(13)).toMatch(/fecha inexistente/);
    expect(por(14)).toMatch(/anterior a vigente_desde/);
    expect(por(15)).toMatch(/se repite/);
    expect(r.rechazadas).toHaveLength(13);
  });

  it('sin la columna de casetas ni la de corredor el archivo entero se rechaza con los encabezados leídos; vacío también', () => {
    expect(() => leerCursosCsv('codigo,nombre,unidad\nA,B,UN-1\n')).toThrow(/casetas o corredor_wkt|Faltan columnas/);
    expect(() => leerCursosCsv('')).toThrow(ErrorTablaPropia);
  });

  it('separador «;», alias de encabezado y casetas con «|» entre comillas', () => {
    const r = leerCursosCsv('Clave;Ruta;No. Económico;Casetas autorizadas;Buffer\nX-1;Ruta uno;un 001;"Caseta Ejemplo Norte|Caseta Ejemplo Sur";\n');
    expect(r.rechazadas).toEqual([]);
    expect(r.filas[0]).toMatchObject({ codigo: 'X-1', nombre: 'Ruta uno', unidad: 'un 001', casetas: ['Caseta Ejemplo Norte', 'Caseta Ejemplo Sur'] });
  });

  it('un texto hostil no explota (línea adversaria larga) y no pasa de las filas máximas', () => {
    const t0 = Date.now();
    const r = leerCursosCsv(`codigo,nombre,unidad,casetas\nA,B,UN-1,${'x|'.repeat(100_000)}\n`);
    expect(r.rechazadas[0].motivo).toMatch(/hasta 200 casetas/);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe('LINESTRING', () => {
  it('lee lon lat en ese orden y rechaza lo que no es una línea simple', () => {
    expect(leerLineaWkt('LINESTRING(-103.3 20.6, -103.2 20.6)')).toEqual({ ok: [{ lat: 20.6, lon: -103.3 }, { lat: 20.6, lon: -103.2 }] });
    for (const malo of ['POLYGON((0 0, 1 0, 1 1, 0 0))', 'MULTILINESTRING((-103.3 20.6, -103.2 20.6))', 'LINESTRING(-103.3 20.6, -103.2)', 'LINESTRING(a b, c d)', 'LINESTRING EMPTY']) {
      expect('error' in leerLineaWkt(malo), malo).toBe(true);
    }
  });
  it('más de 2,000 vértices se rechaza', () => {
    const muchos = `LINESTRING(${Array.from({ length: 2_001 }, (_, i) => `-103.${String(i).padStart(4, '0')} 20.6`).join(', ')})`;
    expect(leerLineaWkt(muchos)).toEqual({ error: expect.stringMatching(/hasta 2000 vértices/) });
  });
});

describe('configuración de cursos por modo', () => {
  const CSV = { modo: 'csv_sftp', base_url: 'https://ejemplo.com/pos.csv', cursos_url: 'https://ejemplo.com/cursos.csv' };
  it('csv: cursos_url https opcional; con usuario dentro de la dirección se rechaza', () => {
    expect(leerConfigTablaPropia(CSV)).toMatchObject({ ok: true, config: { urlCursos: 'https://ejemplo.com/cursos.csv' } });
    expect(leerConfigTablaPropia({ modo: 'csv_sftp', base_url: CSV.base_url })).toMatchObject({ ok: true, config: { urlCursos: undefined } });
    expect(leerConfigTablaPropia({ ...CSV, cursos_url: 'http://ejemplo.com/c.csv' })).toMatchObject({ ok: false, motivo: expect.stringMatching(/cursos_url debe ser https/) });
    expect(leerConfigTablaPropia({ ...CSV, cursos_url: 'https://u:p@ejemplo.com/c.csv' })).toMatchObject({ ok: false });
  });
  const MAPEO = JSON.stringify({ campos: { codigo: 'a', nombre: 'b' } });
  const MAP_POS = JSON.stringify({ campos: { unidad: 'e', lat: 'a', lon: 'o', fecha_hora: 't' } });
  it('endpoint: cursos_url exige mapeo_cursos válido', () => {
    const EP = { modo: 'endpoint', base_url: 'https://ejemplo.com/p', mapeo_posiciones: MAP_POS, cursos_url: 'https://ejemplo.com/c' };
    expect(leerConfigTablaPropia(EP)).toMatchObject({ ok: false, motivo: expect.stringMatching(/mapeo_cursos/) });
    expect(leerConfigTablaPropia({ ...EP, mapeo_cursos: '{"campos":{"x":"y"}}' })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...EP, mapeo_cursos: MAPEO })).toMatchObject({ ok: true });
  });
  const SQL = { modo: 'sql_solo_lectura', sql_host: '203.0.113.10', sql_base: 'b', sql_usuario: 'u', sql_clave: 'c', vista: 'v', columnas: '{"unidad":"u","lat":"a","lon":"o","fecha_hora":"t"}' };
  it('sql: vista y columnas de cursos validadas; sin a quién aplica o sin ruta se rechaza', () => {
    const buena = JSON.stringify({ codigo: 'cve', nombre: 'nom', unidad: 'eco', casetas: 'paradas' });
    expect(leerConfigTablaPropia({ ...SQL, vista_cursos: 'public.cursos', columnas_cursos: buena })).toMatchObject({ ok: true, config: { vistaCursos: 'public.cursos' } });
    expect(leerConfigTablaPropia({ ...SQL, vista_cursos: 'c;drop', columnas_cursos: buena })).toMatchObject({ ok: false });
    expect(leerConfigTablaPropia({ ...SQL, vista_cursos: 'c', columnas_cursos: JSON.stringify({ codigo: 'a', nombre: 'b', casetas: 'c' }) })).toMatchObject({ ok: false, motivo: expect.stringMatching(/unidad o la del convenio/) });
    expect(leerConfigTablaPropia({ ...SQL, vista_cursos: 'c', columnas_cursos: JSON.stringify({ codigo: 'a', nombre: 'b', unidad: 'u' }) })).toMatchObject({ ok: false, motivo: expect.stringMatching(/casetas, o corredor_wkt con buffer_m/) });
    expect(leerConfigTablaPropia({ ...SQL, vista_cursos: 'c', columnas_cursos: JSON.stringify({ codigo: 'a"; drop', nombre: 'b', unidad: 'u', casetas: 'c' }) })).toMatchObject({ ok: false });
  });
});

describe('los tres lectores detrás del mismo contrato', () => {
  it('csv por https: lee los cursos con la credencial solo en la cabecera', async () => {
    const llamadas: string[] = [];
    const http: Http = async (p) => { llamadas.push(p.url); return ok(fx('cursos.csv')); };
    const c = crearLectorTablaPropia({ modo: 'csv_sftp', base_url: 'https://ejemplo.com/pos.csv', cursos_url: 'https://ejemplo.com/cursos.csv', patron: 'bearer', token: 'tok-1' }, { http, reloj });
    if (!c.ok) throw new Error(c.motivo);
    const r = await c.lector.leerCursos!();
    expect(r.filas.map((f) => f.codigo)).toEqual(['CUR-001', 'CUR-002', 'COR-001']);
    expect(llamadas).toEqual(['https://ejemplo.com/cursos.csv']);
  });

  it('csv sin cursos_url: lo dice y no inventa nada', async () => {
    const c = crearLectorTablaPropia({ modo: 'csv_sftp', base_url: 'https://ejemplo.com/pos.csv' }, { http: async () => ok('') });
    if (!c.ok) throw new Error(c.motivo);
    await expect(c.lector.leerCursos!()).rejects.toThrow(/no hay archivo de cursos/);
  });

  it('endpoint JSON: mapea por ruta, acepta la lista de casetas como arreglo y rechaza el curso sin dueño', async () => {
    const mapeo = JSON.stringify({ lista: 'datos.cursos', campos: { codigo: 'cve', nombre: 'desc', unidad: 'eco', convenio: 'conv', casetas: 'paradas', vigente_desde: 'desde', vigente_hasta: 'hasta' } });
    const c = crearLectorTablaPropia({ modo: 'endpoint', base_url: 'https://ejemplo.com/p', mapeo_posiciones: JSON.stringify({ campos: { unidad: 'e', lat: 'a', lon: 'o', fecha_hora: 't' } }), cursos_url: 'https://ejemplo.com/c', mapeo_cursos: mapeo },
      { http: async () => ok(fx('endpoint_cursos.json')), reloj });
    if (!c.ok) throw new Error(c.motivo);
    const r = await c.lector.leerCursos!();
    expect(r.filas).toHaveLength(2);
    expect(r.filas[0]).toMatchObject({ codigo: 'CUR-E1', unidad: 'UN-003', casetas: ['Caseta Ejemplo Norte', 'Caseta Ejemplo Sur'], vigenteDesde: '2026-10-01', vigenteHasta: null });
    expect(r.filas[1]).toMatchObject({ codigo: 'CUR-E2', convenio: 'Convenio Ficticio Uno', unidad: null });
    expect(r.rechazadas).toEqual([{ fila: 3, motivo: expect.stringMatching(/sin unidad ni convenio/) }]);
  });

  it('sql de solo lectura: un SELECT armado con las columnas de cursos (valores como parámetros) y filas del ejecutor', async () => {
    let consulta = '';
    const ejecutor: EjecutorSql = { ejecutar: async (c) => { consulta = c.text; return [{ codigo: 'S-1', nombre: 'Ruta', unidad: 'UN-009', casetas: 'Caseta Ejemplo Norte|Caseta Ejemplo Sur' }]; } };
    const cols = JSON.stringify({ codigo: 'cve', nombre: 'nom', unidad: 'eco', casetas: 'paradas' });
    const c = crearLectorTablaPropia({ modo: 'sql_solo_lectura', sql_host: '203.0.113.10', sql_base: 'b', sql_usuario: 'u', sql_clave: 'c', vista: 'v', columnas: '{"unidad":"u","lat":"a","lon":"o","fecha_hora":"t"}', vista_cursos: 'cursos', columnas_cursos: cols }, { http: async () => ok(''), ejecutor });
    if (!c.ok) throw new Error(c.motivo);
    const r = await c.lector.leerCursos!();
    expect(consulta).toBe(construirSelect('cursos', JSON.parse(cols), { limite: 20_000 }).text);
    expect(r.filas[0]).toMatchObject({ codigo: 'S-1', unidad: 'UN-009', casetas: ['Caseta Ejemplo Norte', 'Caseta Ejemplo Sur'] });
  });

  it('sql sin vista de cursos: lo dice', async () => {
    const c = crearLectorTablaPropia({ modo: 'sql_solo_lectura', sql_host: '203.0.113.10', sql_base: 'b', sql_usuario: 'u', sql_clave: 'c', vista: 'v', columnas: '{"unidad":"u","lat":"a","lon":"o","fecha_hora":"t"}' }, { http: async () => ok(''), ejecutor: { ejecutar: async () => [] } });
    if (!c.ok) throw new Error(c.motivo);
    await expect(c.lector.leerCursos!()).rejects.toThrow(/no hay vista de cursos/);
  });
});

describe('registrosACursos directo', () => {
  it('una fecha DD/MM/AAAA se normaliza; una vigencia con hora se recorta a la fecha', () => {
    const r = registrosACursos([{ codigo: 'A', nombre: 'n', unidad: 'UN-1', casetas: 'X', vigente_desde: '31/01/2026', vigente_hasta: '2026-12-31 23:59:59' }]);
    expect(r.filas[0]).toMatchObject({ vigenteDesde: '2026-01-31', vigenteHasta: '2026-12-31' });
  });
});
