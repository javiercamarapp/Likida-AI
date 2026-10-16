import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { revisarCobros, ROTULO_SIN_TIPO_UNIDAD, type LineaCobro, type TipoUnidadPeaje } from './reglas_cobro';
import { parsearTagsMatriz, resolverUnidadesDeTags } from './tags';
import { matrizDeCsvTexto } from './csv';
import { reglasCobroConfigSchema, tipoUnidadSchema } from './reglas_cobro_config';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// T-A2-39 · TIPO DE UNIDAD para la clase esperada. Todo con datos sintéticos.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const D = await import('./datos');
const bytes = (t: string) => new TextEncoder().encode(t);
const R = await import('./revision_cobros');

const linea = (clase: number, tipoUnidad?: TipoUnidadPeaje | null, indice = 0): LineaCobro => ({
  indice, fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: 'TAGEJEMPLO01', unidad: 'U-01', clase, monto: 400, tipoUnidad,
});
const clases = (ls: LineaCobro[], reglas = {}) => revisarCobros(ls, reglas).candidatos.filter((c) => c.categoria === 'clase_fuera_de_3_5');

describe('regla de clase por tipo de unidad', () => {
  it('tracto con clase 3 → nada', () => {
    expect(clases([linea(3, 'tracto')])).toHaveLength(0);
    expect(clases([linea(5, 'tracto')])).toHaveLength(0);
  });

  it('tracto con clase 8 → candidato, sin rótulo de «sin tipo»', () => {
    const [c] = clases([linea(8, 'tracto')]);
    expect(c.tipoUnidad).toBe('tracto');
    expect(c.rotuloTipoUnidad).toBeUndefined();
    expect(c.referencia).not.toContain(ROTULO_SIN_TIPO_UNIDAD);
    expect(c.quePaso).toMatch(/clase 3 y 5/);
  });

  it('utilitario con clase 1 y lista vacía → no evalúa y lo dice en reglasNoAplicadas', () => {
    const r = revisarCobros([linea(1, 'utilitario'), linea(9, 'utilitario', 1)]);
    expect(r.candidatos.filter((c) => c.categoria === 'clase_fuera_de_3_5')).toHaveLength(0);
    const na = r.reglasNoAplicadas.find((x) => x.regla === 'clase_fuera_de_3_5');
    expect(na?.motivo).toMatch(/2 cruce\(s\) de unidades utilitarias/);
    expect(na?.motivo).toMatch(/no se inventa una tarifa/);
  });

  it('utilitario con lista declarada: dentro de la lista nada, fuera de la lista candidato (la lista manda, no {3,5})', () => {
    const reglas = { clasesUtilitario: [1, 2] };
    expect(clases([linea(1, 'utilitario'), linea(2, 'utilitario', 1)], reglas)).toHaveLength(0);
    expect(clases([linea(3, 'utilitario')], reglas)).toHaveLength(1);
    const [c] = clases([linea(8, 'utilitario')], reglas);
    expect(c.tipoUnidad).toBe('utilitario');
    expect(c.quePaso).toMatch(/para un utilitario es clase 1 y 2/);
    expect(revisarCobros([linea(1, 'utilitario')], reglas).reglasNoAplicadas.some((x) => x.regla === 'clase_fuera_de_3_5')).toBe(false);
  });

  it('la lista de utilitarios no afecta a un tracto', () => {
    expect(clases([linea(1, 'tracto')], { clasesUtilitario: [1] })).toHaveLength(1);
  });

  it('sin tipo → candidato rotulado «sin tipo de unidad»', () => {
    for (const sin of [undefined, null]) {
      const [c] = clases([linea(8, sin)]);
      expect(c.tipoUnidad).toBeNull();
      expect(c.rotuloTipoUnidad).toBe(ROTULO_SIN_TIPO_UNIDAD);
      expect(c.referencia).toContain(ROTULO_SIN_TIPO_UNIDAD);
      expect(c.queSignifica).toMatch(/no tiene tipo declarado/);
      expect(c.queSignifica.toLowerCase()).toContain(ROTULO_SIN_TIPO_UNIDAD); // lo que la pantalla ya pinta (Qué significa)
    }
    expect(clases([linea(3, null)])).toHaveLength(0); // sin tipo y clase válida: nada
  });

  it('una excepción de caseta sigue valiendo para el tracto y para el utilitario', () => {
    const excepcionesClase = new Map([['caseta ejemplo norte', [1]]]);
    expect(clases([linea(1, 'tracto')], { excepcionesClase })).toHaveLength(0);
    expect(clases([linea(1, 'utilitario')], { excepcionesClase, clasesUtilitario: [2] })).toHaveLength(0);
  });

  it('el motor nunca afirma «cobro indebido»', () => {
    for (const c of clases([linea(8, 'tracto'), linea(8, null, 1), linea(8, 'utilitario', 2)], { clasesUtilitario: [2] })) {
      expect(`${c.quePaso} ${c.queSignifica} ${c.queHacer}`).not.toMatch(/indebido|fraude/i);
    }
  });
});

describe('CSV de TAGs: columna opcional `tipo`', () => {
  const csv = (t: string) => matrizDeCsvTexto(t);

  it('lee tracto / utilitario (mayúsculas y acentos tolerados) y deja vacío como sin tipo', () => {
    const r = parsearTagsMatriz(csv('tag;unidad;tipo\nIMDM10000001;C2-08;Tracto\nIMDM10000002;C2-09;UTILITARIO\nIMDM10000003;C2-10;\n'));
    expect(r.rechazadas).toEqual([]);
    expect(r.tags.map((t) => t.tipoUnidad)).toEqual(['tracto', 'utilitario', undefined]);
  });

  it('sin la columna `tipo` todo sigue igual (sin tipo en ninguna fila)', () => {
    const r = parsearTagsMatriz(csv('tag;unidad\nIMDM10000001;C2-08\n'));
    expect(r.tags[0]).not.toHaveProperty('tipoUnidad');
  });

  it('columna `tipo` inválida → rechazo por fila con su motivo, sin tumbar las buenas', () => {
    const r = parsearTagsMatriz(csv('tag;unidad;tipo\nIMDM10000001;C2-08;camioneta\nIMDM10000002;C2-09;tracto\n'));
    expect(r.tags.map((t) => t.tag)).toEqual(['IMDM10000002']);
    expect(r.rechazadas).toEqual([{ fila: 2, motivo: expect.stringContaining('«camioneta» no es válido') }]);
  });

  it('el mismo TAG con dos tipos distintos se rechaza completo; con el mismo tipo, o con tipo en una sola fila, no', () => {
    const malo = parsearTagsMatriz(csv('tag;unidad;tipo\nIMDM10000001;C2-08;tracto\nIMDM10000001;C2-08;utilitario\n'));
    expect(malo.tags).toEqual([]);
    expect(malo.rechazadas.map((x) => x.fila)).toEqual([2, 3]);
    const mismo = parsearTagsMatriz(csv('tag;unidad;tipo\nIMDM10000001;C2-08;tracto\nIMDM10000001;C2-08;tracto\n'));
    expect(mismo.tags).toHaveLength(1);
    const uno = parsearTagsMatriz(csv('tag;unidad;tipo\nIMDM10000001;C2-08;\nIMDM10000001;C2-08;utilitario\n'));
    expect(uno.tags).toHaveLength(1);
    expect(uno.tags[0].tipoUnidad).toBe('utilitario');
  });

  it('el tipo viaja hasta el alta resuelta', () => {
    const l = parsearTagsMatriz(csv('tag;unidad;tipo\nIMDM10000001;C2-08;tracto\n'));
    const { altas } = resolverUnidadesDeTags(l.tags, [{ id: 'u1', numeroEconomico: 'C2-08', placas: null }]);
    expect(altas[0]).toMatchObject({ unidadId: 'u1', tipoUnidad: 'tracto' });
  });
});

describe('configuración de la flota', () => {
  it('clasesUtilitario es opcional (la configuración vacía no cambia) y se valida como las demás clases', () => {
    expect(reglasCobroConfigSchema.parse({})).not.toHaveProperty('clasesUtilitario');
    expect(reglasCobroConfigSchema.parse({ clasesUtilitario: [1, 2] }).clasesUtilitario).toEqual([1, 2]);
    expect(reglasCobroConfigSchema.safeParse({ clasesUtilitario: [13] }).success).toBe(false);
    expect(tipoUnidadSchema.safeParse('tracto').success).toBe(true);
    expect(tipoUnidadSchema.safeParse('camioneta').success).toBe(false);
  });
});

describe('importar TAGs y revisar un desglose con tipo de unidad (base en memoria)', () => {
  const T = 'tenant-1';
  beforeEach(() => {
    db = crearDbFalsa({
      unidad: [
        { id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: null },
        { id: 'u2', tenant_id: T, numero_economico: 'C2-09', placas: null },
        { id: 'u3', tenant_id: T, numero_economico: 'C2-10', placas: null },
      ],
    });
  });

  it('importarTags guarda tipo_unidad solo donde el CSV lo trae y una celda vacía no borra el tipo ya capturado', async () => {
    await D.importarTagsArchivo(T, 'tags.csv', bytes('tag;unidad;tipo\nIMDM10000001;C2-08;tracto\nIMDM10000002;C2-09;utilitario\nIMDM10000003;C2-10;\n'));
    const porTag = (t: string) => db.tablas.peaje_tag.find((f) => f.tag === t);
    expect(porTag('IMDM10000001')?.tipo_unidad).toBe('tracto');
    expect(porTag('IMDM10000002')?.tipo_unidad).toBe('utilitario');
    expect(porTag('IMDM10000003')).not.toHaveProperty('tipo_unidad');
    await D.importarTagsArchivo(T, 'tags.csv', bytes('tag;unidad\nIMDM10000001;C2-08\n')); // sin columna: no toca el tipo
    expect(porTag('IMDM10000001')?.tipo_unidad).toBe('tracto');
    for (const f of db.tablas.peaje_tag) expect(f.tenant_id).toBe(T);
  });

  it('listarTiposUnidadPorTag lee solo la flota pedida y solo tipos válidos', async () => {
    db.tablas.peaje_tag = [
      { tenant_id: T, tag: 'AAAA0001', tipo_unidad: 'tracto' },
      { tenant_id: T, tag: 'AAAA0002', tipo_unidad: null },
      { tenant_id: T, tag: 'AAAA0003', tipo_unidad: 'otro' },
      { tenant_id: 'tenant-2', tag: 'AAAA0004', tipo_unidad: 'utilitario' },
    ];
    expect([...(await R.listarTiposUnidadPorTag(T))]).toEqual([['AAAA0001', 'tracto']]);
  });

  it('revisionDeDesglose: el tipo sale del maestro de TAGs; sin alta o sin tipo queda «sin tipo de unidad»', async () => {
    db.tablas.desglose_peaje = [{ id: 'd1', tenant_id: T, proveedor: 'Proveedor Ejemplo', archivo_nombre: 'x', periodo_oficial_desde: '2026-03-01', anulado_en: null }];
    const l = (indice: number, tag: string, clase: number) => ({
      tenant_id: T, desglose_id: 'd1', indice, fecha: '2026-03-05', hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag, monto: 400, clase, unidad_archivo: 'U', unidad_id: null,
    });
    db.tablas.desglose_peaje_linea = [l(0, 'TRACTO01', 8), l(1, 'UTIL0001', 1), l(2, 'UTIL0001', 9), l(3, 'SINTIPO1', 8), l(4, 'SINALTA1', 8)];
    db.tablas.peaje_tag = [
      { tenant_id: T, tag: 'TRACTO01', tipo_unidad: 'tracto' }, { tenant_id: T, tag: 'UTIL0001', tipo_unidad: 'utilitario' }, { tenant_id: T, tag: 'SINTIPO1', tipo_unidad: null },
    ];
    const rep = await R.revisionDeDesglose(T, 'd1');
    const cands = (rep?.revision.candidatos ?? []).filter((c) => c.categoria === 'clase_fuera_de_3_5');
    expect(cands.map((c) => [c.indice, c.tipoUnidad])).toEqual([[0, 'tracto'], [3, null], [4, null]]);
    expect(cands.filter((c) => c.rotuloTipoUnidad === ROTULO_SIN_TIPO_UNIDAD).map((c) => c.indice)).toEqual([3, 4]);
    // utilitario con lista vacía: sus dos cruces no se evalúan y se dice
    expect(rep?.revision.reglasNoAplicadas.find((x) => x.regla === 'clase_fuera_de_3_5')?.motivo).toMatch(/2 cruce\(s\) de unidades utilitarias/);
  });
});

describe('contrato SQL de la migración 0812', () => {
  const sql = readFileSync('supabase/migrations/0812_peaje_tag_tipo_unidad.sql', 'utf8');
  it('es aditiva e idempotente: columna nullable, CHECK con dominio cerrado y guarda de existencia', () => {
    expect(sql).toMatch(/add column if not exists tipo_unidad text;/);
    expect(sql).toMatch(/tipo_unidad is null or tipo_unidad in \('tracto', 'utilitario'\)/);
    expect(sql).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'peaje_tag_tipo_unidad_dominio'\)/);
    expect(sql).not.toMatch(/\bnot null\b.*tipo_unidad|tipo_unidad.*\bdefault\b|\bdrop\b|\bdelete\b|\binsert\b/i);
  });
  it('la prueba SQL cubre nace NULL, dominio, vacío e idempotencia, y corre en ci-postgres', () => {
    const t = readFileSync('supabase/tests/0812_peaje_tag_tipo_unidad.sql', 'utf8');
    for (const k of ['nació con tipo', 'tipo de unidad inventado', 'tipo de unidad vacío', 'migración repetida']) expect(t).toContain(k);
    expect(readFileSync('.github/workflows/ci-postgres.yml', 'utf8')).toContain('supabase/tests/0812_peaje_tag_tipo_unidad.sql');
  });
});
