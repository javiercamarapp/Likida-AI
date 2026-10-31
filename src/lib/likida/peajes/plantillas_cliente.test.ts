import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { matrizDeCsvTexto } from './csv';
import { parsearCasetasMatriz } from './casetas';
import { parsearTagsMatriz } from './tags';
import { parsearTarifasMatriz } from './tarifario_archivo';
import { normalizarEncabezado } from './formatos';

// A2 ola 1 · las plantillas que se le mandan al cliente (catálogo de casetas, maestro de TAGs, tarifario) tienen la explicación
// en el propio encabezado. Estas pruebas usan EXACTAMENTE esos encabezados con datos sintéticos: ninguna reconocía su propia plantilla.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const R = await import('./repo');

const T = 'tenant-1';
const bytes = (t: string) => new TextEncoder().encode(`﻿${t}`); // con BOM, como lo guarda Excel

const H_CASETAS = 'nombre de la caseta (extraído de su reporte IAVE de septiembre: confirmen o corrijan),carretera o tramo,cobra por pasada (si/no),observaciones';
const H_TAGS = 'tag,unidad (numero economico),proveedor del tag,tipo de unidad (tracto / camioneta),estado (activo / baja / siniestrada),fecha de baja o siniestro';
const H_TARIFAS = 'caseta,clase,importe,vigente desde (AAAA-MM-DD),vigente hasta (opcional),cobra por pasada (si/no)';

describe('normalizarEncabezado', () => {
  it('quita la explicación entre paréntesis y el «(opcional)»', () => {
    expect(normalizarEncabezado('nombre de la caseta (extraído de su reporte IAVE: confirmen)')).toBe('nombre de la caseta');
    expect(normalizarEncabezado('cobra por pasada (si/no)')).toBe('cobra por pasada');
    expect(normalizarEncabezado('vigente hasta (opcional)')).toBe('vigente hasta');
    expect(normalizarEncabezado('Unidad (numero economico)')).toBe('unidad');
    expect(normalizarEncabezado('nombre')).toBe('nombre');
  });
});

describe('plantilla 1: catálogo de casetas (115 nombres)', () => {
  const nombres = Array.from({ length: 115 }, (_, i) => `CASETA SINTETICA ${String(i + 1).padStart(3, '0')}`);
  const csv = (extra = '') => [H_CASETAS, ...nombres.map((n, i) => `${n},${i % 5 === 0 ? 'Autopista Ejemplo' : ''},${i % 10 === 0 ? 'si' : i % 10 === 1 ? 'no' : ''},`), extra].filter(Boolean).join('\n');

  it('reconoce los 115 nombres con los encabezados largos de la plantilla, y lee carretera y «por pasada»', () => {
    const r = parsearCasetasMatriz(matrizDeCsvTexto(csv()));
    expect(r.error).toBeUndefined();
    expect(r.casetas).toHaveLength(115);
    expect(r.rechazadas).toEqual([]);
    expect(r.casetas[0]).toMatchObject({ nombre: 'CASETA SINTETICA 001', carretera: 'Autopista Ejemplo', porPasada: true, lat: null, lng: null });
    expect(r.casetas[1]).toMatchObject({ carretera: null, porPasada: false });
    expect(r.casetas[2]).toMatchObject({ porPasada: false }); // celda vacía = no es por pasada (como siempre en este importador)
  });
  it('la fila de ejemplo de la plantilla no se importa como dato', () => {
    const r = parsearCasetasMatriz(matrizDeCsvTexto(csv('EJEMPLO PERIFERICO,,no,')));
    expect(r.casetas).toHaveLength(115);
    expect(r.rechazadas).toEqual([{ fila: 117, motivo: expect.stringMatching(/fila de ejemplo/) }]);
  });
  it('un CSV con solo «nombre» (lo único obligatorio) sigue valiendo', () => {
    const r = parsearCasetasMatriz(matrizDeCsvTexto('nombre\nCASETA UNO\nCASETA DOS'));
    expect(r.casetas.map((c) => c.nombre)).toEqual(['CASETA UNO', 'CASETA DOS']);
    expect('carretera' in r.casetas[0]).toBe(false);
    expect('porPasada' in r.casetas[0]).toBe(false);
  });
  it('lat y lng opcionales junto con la carretera', () => {
    const r = parsearCasetasMatriz(matrizDeCsvTexto('nombre,carretera,por pasada,lat,lng\nCASETA UNO,Autopista Ejemplo,sí,19.4326,-99.1332'));
    expect(r.casetas[0]).toMatchObject({ lat: 19.4326, lng: -99.1332, carretera: 'Autopista Ejemplo', porPasada: true });
  });

  describe('importarCasetasArchivo (base en memoria)', () => {
    beforeEach(() => { db = crearDbFalsa({}); });
    it('guarda las 115 con su carretera y su «por pasada»; re-subir un archivo SIN esas columnas no las borra', async () => {
      const r = await R.importarCasetasArchivo(T, 'catalogo.csv', bytes(csv()), 'plantilla');
      expect(r).toMatchObject({ ok: true, guardadas: 115, rechazadas: [] });
      const g = db.tablas.peaje_caseta;
      expect(g).toHaveLength(115);
      expect(g.find((c) => c.nombre_norm === 'caseta sintetica 001')).toMatchObject({ carretera: 'Autopista Ejemplo', por_pasada: true, tenant_id: T });
      await R.importarCasetasArchivo(T, 'solo-nombres.csv', bytes('nombre\nCASETA SINTETICA 001'), 'plantilla');
      expect(db.tablas.peaje_caseta.find((c) => c.nombre_norm === 'caseta sintetica 001')).toMatchObject({ carretera: 'Autopista Ejemplo', por_pasada: true });
    });
    it('si la 0935 no está aplicada guarda el catálogo SIN carretera y lo dice en las notas', async () => {
      const original = db.cliente.from;
      db.cliente.from = (t: string) => {
        const q = original(t) as Record<string, (...a: unknown[]) => unknown>;
        if (t !== 'peaje_caseta') return q;
        return new Proxy(q, {
          get: (obj, prop: string) => (prop === 'upsert'
            ? (filas: Array<Record<string, unknown>>, o: unknown) => (filas.some((f) => 'carretera' in f)
              ? { then: (res: (v: unknown) => unknown) => res({ data: null, error: { message: 'column "carretera" of relation "peaje_caseta" does not exist' } }) }
              : obj.upsert(filas, o))
            : obj[prop].bind(obj)),
        });
      };
      const r = await R.importarCasetasArchivo(T, 'catalogo.csv', bytes(csv()), 'plantilla');
      expect(r.ok).toBe(true);
      expect(r.guardadas).toBe(115);
      expect(r.notas?.join(' ')).toMatch(/«carretera» no se guardó/);
      expect(db.tablas.peaje_caseta.every((c) => !('carretera' in c))).toBe(true);
    });
    it('listarCasetas trae carretera y por pasada', async () => {
      await R.importarCasetasArchivo(T, 'catalogo.csv', bytes(csv()), 'plantilla');
      const lista = await R.listarCasetas(T);
      expect(lista.find((c) => c.nombreNorm === 'caseta sintetica 001')).toMatchObject({ carretera: 'Autopista Ejemplo', porPasada: true });
      expect(lista.find((c) => c.nombreNorm === 'caseta sintetica 002')).toMatchObject({ carretera: null, porPasada: false });
    });
  });
});

describe('plantilla 2: maestro TAG → unidad', () => {
  const csv = [
    H_TAGS,
    'EJEMPLO 0012345678,T-102,IAVE,tracto,activo,',
    'IMDM 1000000001,T-101,IAVE,tracto,activo,',
    'IMDM 1000000002,C-201,IAVE,camioneta,activo,',
    'IMDM 1000000003,T-103,IAVE,tracto,baja,2026-09-05',
    'IMDM 1000000004,T-104,IAVE,tracto,siniestrada,05/09/2026',
    'IMDM 1000000005,T-105,IAVE,tracto,baja,',
    'IMDM 1000000006,T-106,IAVE,Autobús,activo,',
    'IMDM 1000000007,T-107,IAVE,tracto,perdida,2026-09-01',
  ].join('\n');

  it('lee los encabezados largos, «camioneta» = utilitario, estado y fecha; la baja o el siniestro sin fecha se rechazan', () => {
    const r = parsearTagsMatriz(matrizDeCsvTexto(csv));
    expect(r.error).toBeUndefined();
    const por = (t: string) => r.tags.find((x) => x.tag === t);
    expect(por('IMDM1000000001')).toMatchObject({ unidadRef: 'T-101', proveedor: 'IAVE', tipoUnidad: 'tracto' });
    expect(por('IMDM1000000001')?.estado).toBeUndefined();
    expect(por('IMDM1000000002')).toMatchObject({ tipoUnidad: 'utilitario' });
    expect(por('IMDM1000000003')).toMatchObject({ estado: 'baja', fechaEstado: '2026-09-05' });
    expect(por('IMDM1000000004')).toMatchObject({ estado: 'siniestrada', fechaEstado: '2026-09-05' });
    expect(r.rechazadas.map((x) => x.fila).sort()).toEqual([2, 7, 8, 9]);
    expect(r.rechazadas.find((x) => x.fila === 2)?.motivo).toMatch(/fila de ejemplo/);
    expect(r.rechazadas.find((x) => x.fila === 7)?.motivo).toMatch(/falta la fecha de la baja/);
    expect(r.rechazadas.find((x) => x.fila === 8)?.motivo).toMatch(/tipo de unidad «Autobús»/);
    expect(r.rechazadas.find((x) => x.fila === 9)?.motivo).toMatch(/estado «perdida»/);
  });
  it('el CSV viejo de cuatro columnas (tag;unidad;proveedor;tipo) sigue valiendo', () => {
    const r = parsearTagsMatriz(matrizDeCsvTexto('tag;unidad;proveedor;tipo\nIMDM 1000000001;T-101;PASE;utilitario'));
    expect(r.tags[0]).toMatchObject({ tag: 'IMDM1000000001', tipoUnidad: 'utilitario' });
  });

  describe('importarTagsArchivo (base en memoria)', () => {
    beforeEach(() => {
      db = crearDbFalsa({
        unidad: ['T-101', 'C-201', 'T-103', 'T-104'].map((n, i) => ({ id: `u${i}`, tenant_id: T, numero_economico: n, placas: null })),
      });
    });
    it('da de alta los TAGs, registra la baja y el siniestro con la fecha del archivo, y lo dice; repetirlo es idempotente', async () => {
      const r = await R.importarTagsArchivo(T, 'maestro.csv', bytes(csv));
      expect(r.ok).toBe(true);
      expect(r.guardadas).toBe(4);
      expect(r.notas?.join(' ')).toMatch(/1 TAG\(s\) dados de baja/);
      expect(r.notas?.join(' ')).toMatch(/1 unidad\(es\) siniestrada\(s\)/);
      expect(db.tablas.peaje_tag_baja).toEqual([expect.objectContaining({ tag: 'IMDM1000000003', baja_en: '2026-09-05', tenant_id: T })]);
      expect(db.tablas.peaje_unidad_inmovilizada).toEqual([expect.objectContaining({ unidad_id: 'u3', desde: '2026-09-05', hasta: null, motivo: 'siniestro', tenant_id: T })]);
      expect(db.tablas.peaje_tag.find((t) => t.tag === 'IMDM1000000002')).toMatchObject({ tipo_unidad: 'utilitario' });
      // segunda vez: la baja del propio archivo no se rechaza como «reactivación» ni se duplica nada
      const r2 = await R.importarTagsArchivo(T, 'maestro.csv', bytes(csv));
      expect(r2.guardadas).toBe(4);
      expect(db.tablas.peaje_tag_baja).toHaveLength(1);
      expect(db.tablas.peaje_unidad_inmovilizada).toHaveLength(1);
    });
    it('un TAG dado de baja a mano NO se reactiva desde un archivo que no dice «baja» (sigue la regla de siempre)', async () => {
      await R.importarTagsArchivo(T, 'maestro.csv', bytes(csv));
      const r = await R.importarTagsArchivo(T, 'otro.csv', bytes(`${H_TAGS}\nIMDM 1000000003,T-103,IAVE,tracto,activo,`));
      expect(r.guardadas).toBe(0);
      expect(r.rechazadas[0].motivo).toMatch(/dado de baja/);
    });
  });
});

describe('plantilla 3: tarifario', () => {
  const csv = [
    H_TARIFAS,
    'EJEMPLO PERIFERICO,5,338.00,2026-01-01,,no',
    'CASETA SINTETICA 001,3,230.00,2026-01-01,,no',
    'CASETA SINTETICA 001,5,338.00,2026-01-01,2026-06-30,no',
    'CASETA SINTETICA 002,1,95.50,2026-01-01,,si',
    'CASETA SINTETICA 003,5,120,2026-01-01,,',
  ].join('\n');

  it('lee los encabezados largos (vigente desde/hasta, cobra por pasada) y descarta la fila de ejemplo', () => {
    const r = parsearTarifasMatriz(matrizDeCsvTexto(csv));
    expect(r.error).toBeUndefined();
    expect(r.tarifas).toHaveLength(4);
    expect(r.tarifas[1]).toMatchObject({ caseta: 'CASETA SINTETICA 001', clase: 5, importe: 338, vigenteDesde: '2026-01-01', vigenteHasta: '2026-06-30', porPasada: false });
    expect(r.tarifas[2]).toMatchObject({ caseta: 'CASETA SINTETICA 002', porPasada: true });
    expect('porPasada' in r.tarifas[3]).toBe(false); // celda vacía = no se sabe
    expect(r.rechazadas).toEqual([{ fila: 2, motivo: expect.stringMatching(/fila de ejemplo/) }]);
  });
  it('sin la columna «vigente desde» y sin fecha por defecto sigue pidiéndola', () => {
    expect(parsearTarifasMatriz(matrizDeCsvTexto('caseta,clase,importe\nCASETA UNO,5,300')).error).toMatch(/Falta la columna «desde»/);
  });

  describe('importarTarifasArchivo (base en memoria)', () => {
    beforeEach(() => { db = crearDbFalsa({}); });
    it('guarda las tarifas y marca «por pasada» en el catálogo SOLO donde el archivo dice sí (la caseta se crea si no existía)', async () => {
      const r = await R.importarTarifasArchivo(T, 'tarifario.csv', bytes(csv), 'declarada', null);
      expect(r.ok).toBe(true);
      expect(r.guardadas).toBe(4);
      expect(r.notas?.join(' ')).toMatch(/1 caseta\(s\) marcadas «por pasada»/);
      const catalogo = db.tablas.peaje_caseta;
      expect(catalogo).toHaveLength(1);
      expect(catalogo[0]).toMatchObject({ nombre: 'CASETA SINTETICA 002', nombre_norm: 'caseta sintetica 002', por_pasada: true, tenant_id: T });
    });
    it('una caseta que ya existe conserva su coordenada, su radio y su estado al marcarla por pasada', async () => {
      db = crearDbFalsa({ peaje_caseta: [{ id: 'c1', tenant_id: T, nombre: 'CASETA SINTETICA 002', nombre_norm: 'caseta sintetica 002', alias: [], lat: 19.5, lng: -99.2, radio_m: 450, activa: false, fuente: 'captura', por_pasada: false }] });
      const r = await R.marcarCasetasPorPasada(T, ['CASETA SINTETICA 002']);
      expect(r).toEqual({ ok: true, marcadas: 1 });
      expect(db.tablas.peaje_caseta[0]).toMatchObject({ por_pasada: true, lat: 19.5, radio_m: 450, activa: false });
    });
  });
});
