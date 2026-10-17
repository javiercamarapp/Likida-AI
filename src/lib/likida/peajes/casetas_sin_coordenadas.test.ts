import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');

const T = 'tenant-1';
const bytes = (t: string) => new TextEncoder().encode(t);
beforeEach(() => { db = crearDbFalsa({}); });

describe('importar el catálogo sin coordenadas', () => {
  it('un CSV de solo nombres se importa y las filas quedan sin lat/lng', async () => {
    const r = await D.importarCasetasArchivo(T, 'casetas.csv', bytes('nombre;alias\nCaseta Ejemplo Norte;Ej Norte\nCaseta Ejemplo Sur;\n'), 'lista local');
    expect(r).toMatchObject({ ok: true, guardadas: 2, actualizadas: 0, rechazadas: [] });
    const lista = await D.listarCasetas(T);
    expect(lista.map((c) => [c.nombre, c.lat, c.lng, c.radioM])).toEqual([['Caseta Ejemplo Norte', null, null, 300], ['Caseta Ejemplo Sur', null, null, 300]]);
  });

  it('un archivo de solo nombres NO borra las coordenadas ya cargadas de esa caseta', async () => {
    await D.importarCasetasArchivo(T, 'a.csv', bytes('nombre;lat;lng\nCaseta Ejemplo Norte;19.5;-99.2\n'), 'captura');
    const r = await D.importarCasetasArchivo(T, 'b.csv', bytes('nombre;lat;lng\nCaseta Ejemplo Norte;;\n'), 'captura');
    expect(r).toMatchObject({ ok: true, guardadas: 1, actualizadas: 0 });
    const [c] = await D.listarCasetas(T);
    expect(c).toMatchObject({ lat: 19.5, lng: -99.2 });
  });

  it('una fila con solo la latitud se rechaza y no escribe nada de ella', async () => {
    const r = await D.importarCasetasArchivo(T, 'c.csv', bytes('nombre;lat;lng\nSolo Lat;19.5;\nCompleta;19.5;-99.2\n'), 'captura');
    expect(r.ok).toBe(true);
    expect(r.rechazadas).toEqual([{ fila: 2, motivo: 'trae solo la latitud: captura las dos coordenadas o deja ambas vacías' }]);
    expect((await D.listarCasetas(T)).map((c) => c.nombre)).toEqual(['Completa']);
  });

  it('un archivo mixto guarda con y sin coordenadas, y por_pasada solo se escribe si el archivo trae la columna', async () => {
    await D.importarCasetasArchivo(T, 'd.csv', bytes('nombre;lat;lng;por_pasada\nCon Coord;19.5;-99.2;si\nSin Coord;;;no\n'), 'captura');
    const filas = db.tablas.peaje_caseta;
    expect(filas.find((f) => f.nombre === 'Con Coord')).toMatchObject({ lat: 19.5, lng: -99.2, por_pasada: true });
    expect(filas.find((f) => f.nombre === 'Sin Coord')).toMatchObject({ por_pasada: false });
    expect('lat' in (filas.find((f) => f.nombre === 'Sin Coord') as object)).toBe(false);
    // Reimportar sin la columna no pisa por_pasada.
    await D.importarCasetasArchivo(T, 'e.csv', bytes('nombre\nCon Coord\n'), 'captura');
    expect(db.tablas.peaje_caseta.find((f) => f.nombre === 'Con Coord')).toMatchObject({ por_pasada: true, lat: 19.5 });
  });

  it('el catálogo con coordenadas completas sigue funcionando igual (y detecta el cambio de coordenadas)', async () => {
    await D.importarCasetasArchivo(T, 'f.csv', bytes('nombre;lat;lng;radio_m\nCaseta Ejemplo Norte;19.5;-99.2;350\n'), 'captura');
    const r = await D.importarCasetasArchivo(T, 'g.csv', bytes('nombre;lat;lng;radio_m\nCaseta Ejemplo Norte;19.6;-99.2;350\n'), 'captura');
    expect(r).toMatchObject({ ok: true, guardadas: 1, actualizadas: 1 });
    expect((await D.listarCasetas(T))[0]).toMatchObject({ lat: 19.6, lng: -99.2, radioM: 350 });
  });

  it('importa la plantilla de catálogo tal cual (sintética)', async () => {
    const texto = readFileSync('src/lib/likida/peajes/fixtures/catalogo_casetas_plantilla.csv', 'utf8');
    const r = await D.importarCasetasArchivo(T, 'plantilla.csv', bytes(texto), 'plantilla');
    expect(r).toMatchObject({ ok: true, guardadas: 5, rechazadas: [] });
    expect(db.tablas.peaje_caseta.find((f) => f.nombre === 'Caseta Ejemplo Este')).toMatchObject({ por_pasada: true });
  });

  it('el evaluador por caseta con un catálogo sin coordenadas no lanza y devuelve sin_coordenadas', async () => {
    await D.importarCasetasArchivo(T, 'h.csv', bytes('nombre\nCaseta Ejemplo Norte\n'), 'lista local');
    const catalogo = await D.listarCasetas(T, true);
    const r = await D.evaluarGpsDeLineas(T, [{ id: 'l1', fecha: '2026-08-05', cruceEn: '2026-08-05T16:30:00.000Z', caseta: 'Caseta Ejemplo Norte', unidadId: 'u1' }], catalogo);
    expect(r).toEqual([{ lineaId: 'l1', casetaId: catalogo[0].id, veredicto: { veredicto: 'sin_datos', motivo: 'sin_coordenadas', distanciaM: null, muestras: 0 } }]);
  });
});

describe('contrato SQL de la migración 0810', () => {
  const sql = readFileSync('supabase/migrations/0810_peaje_catalogo_coordenadas_opcionales.sql', 'utf8');
  const ejecutable = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  it('lat y lng admiten NULL', () => {
    expect(ejecutable).toMatch(/alter table public\.peaje_caseta alter column lat drop not null/);
    expect(ejecutable).toMatch(/alter table public\.peaje_caseta alter column lng drop not null/);
  });
  it('las coordenadas van en pareja: ambas NULL o ambas válidas', () => {
    expect(ejecutable).toMatch(/peaje_caseta_coordenadas_en_pareja/);
    expect(ejecutable).toMatch(/\(lat is null and lng is null\) or \(lat is not null and lng is not null\)/);
    expect(ejecutable).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'peaje_caseta_coordenadas_en_pareja'/);
  });
  it('por_pasada: boolean not null default false, con if not exists', () => {
    expect(ejecutable).toMatch(/add column if not exists por_pasada boolean not null default false/);
  });
  it('no siembra nada ni destruye: sin insert, delete, drop table/column', () => {
    expect(ejecutable).not.toMatch(/\binsert\s+into\b|\bdelete\s+from\b|\btruncate\b|\bdrop\s+(table|column|constraint)\b/i);
  });
  it('el comentario de la migración explica que NO se siembran coordenadas', () => {
    expect(sql).toMatch(/NO SE SIEMBRA NINGUNA COORDENADA/);
  });
  it('los CHECK de rango de la 0375 se conservan (un CHECK con NULL no se viola)', () => {
    const base = readFileSync('supabase/migrations/0375_peaje_tags_casetas_hora.sql', 'utf8');
    expect(base).toMatch(/peaje_caseta_lat_valida check \(lat between -90 and 90\)/);
    expect(ejecutable).not.toMatch(/peaje_caseta_lat_valida|peaje_caseta_lng_valida/);
  });
});
