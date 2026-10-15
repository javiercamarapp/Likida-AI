/* eslint-disable security/detect-non-literal-fs-filename -- solo pruebas: leen fixtures sintéticos del propio directorio por URL relativa a este archivo. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../conductor/repo_validacion', () => ({ importarSitios: vi.fn() }));
vi.mock('../credenciales', () => ({ leerCredencial: vi.fn() }));

import { leerGeocercasCsv } from './csv';
import { ErrorTablaPropia } from './contrato';
import { leerGeocercasGeoJson, poligonoSeAutointerseca } from './filas';
import { geocercasASitios, importarGeocercasConLector, resumenImportacionGeocercas } from './importar_geocercas';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const canon = (t: string) => geocercasASitios(leerGeocercasCsv(t).filas).filas.map((s) => ({ ...s, linea: 0 }));

// Contrato de importación del catálogo de geocercas del cliente (T-A5-18). Cuando llegue el catálogo real,
// solo se agrega un caso aquí con su formato; el código no cambia.
describe('contrato de importación de geocercas: tres formatos, mismos sitios', () => {
  const base = canon(fx('geocercas_catalogo.csv'));

  it('CSV con círculo y WKT: 3 sitios (2 círculos y 1 polígono nativo)', () => {
    const r = leerGeocercasCsv(fx('geocercas_catalogo.csv'));
    expect(r.rechazadas).toEqual([]);
    expect(base.map((s) => [s.codigo, s.radio_m, s.poligono ? 'poligono' : 'circulo', s.cliente])).toEqual([
      ['PATIO-A', 600, 'circulo', null], ['PL-01', 550, 'circulo', 'Cliente Ficticio Uno'], ['PL-02', expect.any(Number), 'poligono', null],
    ]);
  });

  it('CSV con sinónimos de encabezado en español, «;» y decimal con coma → los mismos sitios', () => {
    expect(canon(fx('geocercas_sinonimos.csv'))).toEqual(base);
  });

  it('GeoJSON FeatureCollection (Point + radio, Polygon; propiedades con acento y mayúsculas) → los mismos sitios', () => {
    const r = leerGeocercasGeoJson(fx('geocercas_catalogo.geojson'));
    expect(r.rechazadas).toEqual([]);
    expect(geocercasASitios(r.filas).filas.map((s) => ({ ...s, linea: 0 }))).toEqual(base);
  });

  it('el lector de CSV reconoce un GeoJSON por su primera llave', () => {
    expect(leerGeocercasCsv(fx('geocercas_catalogo.geojson')).filas).toHaveLength(3);
  });
});

describe('rechazos con «fila N: motivo»', () => {
  const ENC = 'codigo,nombre,lat_centro,lon_centro,radio_m,poligono_wkt,cliente\n';

  it('polígono con autointersección (moño) → rechazado con motivo; uno válido en la misma tabla sigue leyéndose', () => {
    const t = ENC + 'MONO,Moño,,,,"POLYGON((-103.30 20.62, -103.29 20.63, -103.29 20.62, -103.30 20.63, -103.30 20.62))",\n'
      + 'OK,Cuadro,,,,"POLYGON((-103.30 20.62, -103.29 20.62, -103.29 20.63, -103.30 20.63, -103.30 20.62))",\n';
    const r = leerGeocercasCsv(t);
    expect(r.filas.map((f) => f.codigo)).toEqual(['OK']);
    expect(r.rechazadas).toEqual([{ fila: 2, motivo: 'el polígono se cruza consigo mismo (autointersección): corrige sus vértices' }]);
  });

  it('el detector: un cuadro no se cruza; un moño sí; lados que se tocan en un vértice no contiguo también', () => {
    const P = (lon: number, lat: number) => ({ lat, lon });
    expect(poligonoSeAutointerseca([P(0, 0), P(1, 0), P(1, 1), P(0, 1)])).toBe(false);
    expect(poligonoSeAutointerseca([P(0, 0), P(1, 1), P(1, 0), P(0, 1)])).toBe(true);
    expect(poligonoSeAutointerseca([P(0, 0), P(2, 0), P(2, 2), P(1, 0), P(0, 2)])).toBe(true);
  });

  it('radio 0 (y los fuera de 25–100,000 m, o vacío) → rechazado; no se supone un radio', () => {
    const t = ENC + 'R0,Cero,25.78,-100.19,0,,\nR1,Chico,25.78,-100.19,10,,\nR2,Vacío,25.78,-100.19,,,\nR3,Bueno,25.78,-100.19,300,,\n';
    const r = leerGeocercasCsv(t);
    expect(r.filas.map((f) => f.codigo)).toEqual(['R3']);
    expect(r.rechazadas.map((x) => x.fila)).toEqual([2, 3, 4]);
    for (const x of r.rechazadas) expect(x.motivo).toBe('radio_m obligatorio entre 25 y 100,000 m (no se supone uno)');
  });

  it('GeoJSON: Point sin radio, hueco en el Polygon, geometría no soportada, autointersección → rechazos con el número de Feature', () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { codigo: 'A', nombre: 'A' }, geometry: { type: 'Point', coordinates: [-100.19, 25.78] } },
      { type: 'Feature', properties: { codigo: 'B', nombre: 'B' }, geometry: { type: 'Polygon', coordinates: [[[-103.3, 20.62], [-103.29, 20.62], [-103.29, 20.63], [-103.3, 20.62]], [[-103.299, 20.621], [-103.298, 20.621], [-103.298, 20.622], [-103.299, 20.621]]] } },
      { type: 'Feature', properties: { codigo: 'C', nombre: 'C' }, geometry: { type: 'LineString', coordinates: [[-103.3, 20.62], [-103.29, 20.62]] } },
      { type: 'Feature', properties: { codigo: 'D', nombre: 'D' }, geometry: { type: 'Polygon', coordinates: [[[-103.30, 20.62], [-103.29, 20.63], [-103.29, 20.62], [-103.30, 20.63], [-103.30, 20.62]]] } },
      { type: 'Feature', properties: { codigo: 'E', nombre: 'E', radio_m: 200 }, geometry: { type: 'Point', coordinates: [-100.19, 25.78] } },
    ] });
    const r = leerGeocercasGeoJson(gj);
    expect(r.filas.map((f) => f.codigo)).toEqual(['E']);
    expect(r.rechazadas.map((x) => [x.fila, x.motivo])).toEqual([
      [1, 'radio_m obligatorio entre 25 y 100,000 m (no se supone uno)'],
      [2, 'el Polygon debe traer un solo anillo exterior (sin huecos)'],
      [3, 'geometría no soportada: LineString (usa Polygon o Point con radio_m)'],
      [4, 'el polígono se cruza consigo mismo (autointersección): corrige sus vértices'],
    ]);
  });

  it('GeoJSON ilegible o que no es FeatureCollection → error de formato, no filas vacías', () => {
    expect(() => leerGeocercasGeoJson('{no es json')).toThrow(ErrorTablaPropia);
    expect(() => leerGeocercasGeoJson('{"type":"Feature"}')).toThrow(/FeatureCollection/);
  });
});

describe('reporte final', () => {
  const lector = (t: string) => ({ leerGeocercas: async () => leerGeocercasCsv(t), leerPosiciones: vi.fn(), leerCursos: vi.fn() }) as never;

  it('«N sitios nuevos, M actualizados, K rechazados»', async () => {
    const importar = vi.fn(async () => ({ ok: true as const, creados: 2, actualizados: 1 }));
    const r = await importarGeocercasConLector('t1', { lector: lector(fx('geocercas_catalogo.csv')), importar });
    expect(r.ok).toBe(true);
    expect(resumenImportacionGeocercas(r)).toBe('2 sitios nuevos, 1 actualizados, 0 rechazados');
  });

  it('con una fila mala no se importa nada y el reporte cuenta los rechazados', async () => {
    const importar = vi.fn();
    const malo = fx('geocercas_catalogo.csv') + 'R0,Cero,25.78,-100.19,0,,\n';
    const r = await importarGeocercasConLector('t1', { lector: lector(malo), importar });
    expect(importar).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(resumenImportacionGeocercas(r)).toBe('0 sitios nuevos, 0 actualizados, 1 rechazados');
    expect(!r.ok && r.detalles).toEqual(['Fila 5: radio_m obligatorio entre 25 y 100,000 m (no se supone uno)']);
  });

  it('reimportar el mismo catálogo con su huella = 0 cambios (idempotente)', async () => {
    const importar = vi.fn(async () => ({ ok: true as const, creados: 3, actualizados: 0 }));
    const a = await importarGeocercasConLector('t1', { lector: lector(fx('geocercas_catalogo.csv')), importar });
    if (!a.ok) throw new Error('debió importar');
    const b = await importarGeocercasConLector('t1', { lector: lector(fx('geocercas_catalogo.csv')), importar, huellaPrevia: a.huella });
    expect(b.ok && b.sinCambios).toBe(true);
    expect(importar).toHaveBeenCalledTimes(1);
    expect(resumenImportacionGeocercas(b)).toBe('0 sitios nuevos, 0 actualizados, 0 rechazados');
  });
});
