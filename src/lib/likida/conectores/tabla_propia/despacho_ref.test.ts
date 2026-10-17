/* eslint-disable security/detect-non-literal-fs-filename -- prueba que lee/escribe rutas del propio repo o de un directorio temporal; ninguna ruta ni patrón viene de entrada de usuario. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leerPosicionesCsv } from './csv';
import { normalizarDespachoRef, registrosAPosiciones } from './filas';
import { leerConfigTablaPropia } from './config';

// T-A5-13: la referencia de despacho (Icident) atraviesa el lector de «tabla propia». Fixture SINTÉTICO.
const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');

describe('despacho en el CSV de posiciones', () => {
  const r = leerPosicionesCsv(fx('posiciones_con_despacho.csv'));
  it('lee las 10 posiciones; la referencia sale normalizada (mayúsculas, sin espacios)', () => {
    expect(r.rechazadas).toEqual([]);
    expect(r.filas).toHaveLength(10);
    expect(r.filas.slice(0, 5).every((f) => f.despacho === 'D-1001')).toBe(true);
    expect(r.filas[7].despacho).toBe('ICID2002');
    expect(r.filas.every((f) => typeof f.despacho === 'string')).toBe(true);
  });
  it('una celda vacía deja la llave AUSENTE (no «null» ni «»): como si la tabla no la trajera', () => {
    const t = 'unidad,lat,lon,fecha_hora,despacho\nUN-1,25.78,-100.19,2026-10-20 07:00:00,\n';
    const f = leerPosicionesCsv(t).filas[0];
    expect(f).not.toHaveProperty('despacho');
    expect(f.unidad).toBe('UN-1');
  });
  it('sin la columna → ninguna posición trae despacho y el conteo no cambia', () => {
    const sin = leerPosicionesCsv(fx('posiciones.csv'));
    expect(sin.filas.length).toBeGreaterThan(0);
    expect(sin.filas.every((f) => !('despacho' in f))).toBe(true);
    // Mismas filas buenas con y sin la columna: la columna no cambia lo que se acepta.
    const conservada = fx('posiciones_con_despacho.csv').split('\n').map((l) => l.split(',').slice(0, 4).join(',')).join('\n');
    expect(leerPosicionesCsv(conservada).filas).toHaveLength(r.filas.length);
  });
  it('el alias «Icident» se reconoce sin distinguir mayúsculas', () => {
    for (const enc of ['Icident', 'ICIDENT', 'icident', 'Incident', 'No_Viaje', 'Despacho']) {
      const t = `unidad,lat,lon,fecha_hora,${enc}\nUN-1,25.78,-100.19,2026-10-20 07:00:00,x 9\n`;
      expect(leerPosicionesCsv(t).filas[0].despacho).toBe('X9');
    }
  });
  it('una fila con despacho pero coordenadas malas se rechaza igual que antes', () => {
    const t = 'unidad,lat,lon,fecha_hora,despacho\nUN-1,1,2,2026-10-20 07:00:00,D1\n';
    expect(leerPosicionesCsv(t).rechazadas).toHaveLength(1);
  });
});

describe('normalizarDespachoRef', () => {
  it('mayúsculas, sin espacios, vacío → null, número → texto, tope de largo', () => {
    expect(normalizarDespachoRef(' d 1 ')).toBe('D1');
    expect(normalizarDespachoRef('')).toBeNull();
    expect(normalizarDespachoRef('   ')).toBeNull();
    expect(normalizarDespachoRef(null)).toBeNull();
    expect(normalizarDespachoRef(undefined)).toBeNull();
    expect(normalizarDespachoRef(12345)).toBe('12345');
    expect(normalizarDespachoRef({})).toBeNull();
    expect(normalizarDespachoRef('a'.repeat(500))).toHaveLength(60);
  });
});

describe('despacho en los otros modos (mismo juez)', () => {
  it('registros de SQL/endpoint: el campo «despacho» llega a la posición', () => {
    const { filas } = registrosAPosiciones([
      { unidad: 'UN-1', lat: '25.78', lon: '-100.19', fecha_hora: '2026-10-20 07:00:00', despacho: 'd-7' },
      { unidad: 'UN-1', lat: '25.79', lon: '-100.19', fecha_hora: '2026-10-20 07:05:00' },
    ]);
    expect(filas[0].despacho).toBe('D-7');
    expect(filas[1]).not.toHaveProperty('despacho');
  });
  it('la configuración acepta el mapeo opcional de despacho (SQL y endpoint) y sigue rechazando campos ajenos', () => {
    const sql = leerConfigTablaPropia({
      modo: 'sql_solo_lectura', sql_host: 'bd.ejemplo.com', sql_base: 'b', sql_usuario: 'u', sql_clave: 'c', vista: 'posiciones',
      columnas: JSON.stringify({ unidad: 'u', lat: 'la', lon: 'lo', fecha_hora: 'f', despacho: 'icident' }),
    });
    expect(sql.ok).toBe(true);
    if (sql.ok && sql.config.modo === 'sql_solo_lectura') expect(sql.config.columnas.despacho).toBe('icident');
    const malo = leerConfigTablaPropia({
      modo: 'sql_solo_lectura', sql_host: 'bd.ejemplo.com', sql_base: 'b', sql_usuario: 'u', sql_clave: 'c', vista: 'posiciones',
      columnas: JSON.stringify({ unidad: 'u', lat: 'la', lon: 'lo', fecha_hora: 'f', inventado: 'x' }),
    });
    expect(malo.ok).toBe(false);
    const ep = leerConfigTablaPropia({
      modo: 'endpoint', base_url: 'https://api.ejemplo.com/pos',
      mapeo_posiciones: JSON.stringify({ lista: 'data', campos: { unidad: 'u', lat: 'la', lon: 'lo', fecha_hora: 'f', despacho: 'icident' } }),
    });
    expect(ep.ok).toBe(true);
  });
});
