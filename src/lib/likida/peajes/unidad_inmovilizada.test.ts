import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { revisarCobros, CATEGORIAS_COBRO, CATEGORIAS_CRITICAS, type LineaCobro, type VentanaInmovilizada } from './reglas_cobro';
import { parsearInmovilizadasMatriz, resolverUnidadesInmovilizadas } from './reglas_cobro_config';
import { matrizDeCsvTexto } from './csv';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

// T-A2-36 · REGLA «CRUCE CON UNIDAD INMOVILIZADA» (taller / siniestro). Todo con datos sintéticos.

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const D = await import('./datos');
const bytes = (t: string) => new TextEncoder().encode(t);

const T = 'tenant-1';
const TAG = 'TAGEJEMPLO01';
const linea = (fecha: string | null, extra: Partial<LineaCobro> = {}): LineaCobro => ({
  indice: 0, fecha, hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: TAG, unidad: 'U-01', clase: 3, monto: 400, ...extra,
});
const taller35: VentanaInmovilizada[] = [{ desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller' }];
const mapa = (v: VentanaInmovilizada[] = taller35, tag = TAG) => new Map([[tag, v]]);
const inmov = (ls: LineaCobro[], reglas = {}) => revisarCobros(ls, reglas).candidatos.filter((c) => c.categoria === 'unidad_inmovilizada');

describe('regla unidad_inmovilizada (pura)', () => {
  it('unidad en taller del 3 al 5 y cruce el 4 → candidato crítico, sin afirmar fraude', () => {
    const r = revisarCobros([linea('2026-03-04')], { inmovilizadasPorTag: mapa() });
    const [c] = r.candidatos.filter((x) => x.categoria === 'unidad_inmovilizada');
    expect(c).toBeDefined();
    expect(c.severidad).toBe('critica');
    expect(c.quePaso).toMatch(/en taller del 2026-03-03 al 2026-03-05/);
    expect(c.referencia).toBe('taller del 2026-03-03 al 2026-03-05');
    const texto = `${c.quePaso} ${c.queSignifica} ${c.queHacer}`;
    expect(texto).toMatch(/candidato a validar/);
    expect(texto).toMatch(/No se afirma que haya fraude/);
    expect(r.porCategoria.unidad_inmovilizada.n).toBe(1);
  });

  it('los extremos de la ventana cuentan (3 y 5) y fuera de ella no hay nada (2 y 6)', () => {
    for (const f of ['2026-03-03', '2026-03-05']) expect(inmov([linea(f)], { inmovilizadasPorTag: mapa() })).toHaveLength(1);
    for (const f of ['2026-03-02', '2026-03-06']) expect(inmov([linea(f)], { inmovilizadasPorTag: mapa() })).toHaveLength(0);
  });

  it('ventana abierta (hasta nulo, siniestro sin cierre) cuenta desde «desde» en adelante', () => {
    const abierta: VentanaInmovilizada[] = [{ desde: '2026-03-10', hasta: null, motivo: 'siniestro' }];
    const [c] = inmov([linea('2026-09-01')], { inmovilizadasPorTag: mapa(abierta) });
    expect(c.quePaso).toMatch(/siniestrada desde el 2026-03-10/);
    expect(inmov([linea('2026-03-09')], { inmovilizadasPorTag: mapa(abierta) })).toHaveLength(0);
  });

  it('con varias ventanas, la que contiene la fecha manda', () => {
    const dos: VentanaInmovilizada[] = [
      { desde: '2026-01-01', hasta: '2026-01-05', motivo: 'taller' },
      { desde: '2026-03-03', hasta: '2026-03-05', motivo: 'baja' },
    ];
    const [c] = inmov([linea('2026-03-04')], { inmovilizadasPorTag: mapa(dos) });
    expect(c.referencia).toMatch(/^baja /);
  });

  it('el TAG se compara normalizado (espacios, guiones y minúsculas)', () => {
    expect(inmov([linea('2026-03-04', { tag: 'tag-ejemplo 01' })], { inmovilizadasPorTag: mapa() })).toHaveLength(1);
  });

  it('un TAG sin ventanas, sin TAG o sin fecha no genera candidato', () => {
    const reglas = { inmovilizadasPorTag: mapa() };
    expect(inmov([linea('2026-03-04', { tag: 'OTROTAG0001' })], reglas)).toHaveLength(0);
    expect(inmov([linea('2026-03-04', { tag: null })], reglas)).toHaveLength(0);
    expect(inmov([linea(null)], reglas)).toHaveLength(0);
  });

  it('sin lista → regla en reglasNoAplicadas y ningún candidato', () => {
    for (const reglas of [{}, { inmovilizadasPorTag: new Map<string, VentanaInmovilizada[]>() }]) {
      const r = revisarCobros([linea('2026-03-04')], reglas);
      expect(r.candidatos.filter((c) => c.categoria === 'unidad_inmovilizada')).toHaveLength(0);
      const na = r.reglasNoAplicadas.find((x) => x.regla === 'unidad_inmovilizada');
      expect(na?.motivo).toMatch(/No hay unidades inmovilizadas declaradas/);
    }
  });

  it('con lista pero archivo sin TAG → no aplicada y lo dice', () => {
    const r = revisarCobros([linea('2026-03-04', { tag: null })], { inmovilizadasPorTag: mapa() });
    expect(r.reglasNoAplicadas.find((x) => x.regla === 'unidad_inmovilizada')?.motivo).toMatch(/no trae TAG/);
  });

  it('con lista y archivo con TAG la regla sí se aplicó (no aparece en reglasNoAplicadas)', () => {
    const r = revisarCobros([linea('2026-03-04')], { inmovilizadasPorTag: mapa() });
    expect(r.reglasNoAplicadas.find((x) => x.regla === 'unidad_inmovilizada')).toBeUndefined();
  });

  it('unidad con baja de TAG: el cruce posterior a la baja sigue en tag_dado_de_baja SIN duplicarse', () => {
    const r = revisarCobros([linea('2026-03-04')], {
      inmovilizadasPorTag: mapa(), tagsBaja: new Map([[TAG, '2026-03-02']]),
    });
    expect(r.candidatos.map((c) => c.categoria)).toEqual(['tag_dado_de_baja']);
    expect(r.lineasConCandidato).toBe(1);
  });

  it('cruce dentro de la ventana pero ANTES de la baja del TAG → solo unidad_inmovilizada', () => {
    const r = revisarCobros([linea('2026-03-04')], {
      inmovilizadasPorTag: mapa(), tagsBaja: new Map([[TAG, '2026-03-20']]),
    });
    expect(r.candidatos.map((c) => c.categoria)).toEqual(['unidad_inmovilizada']);
  });

  it('es la PRIMERA categoría de la lista y la única crítica', () => {
    expect(CATEGORIAS_COBRO[0]).toBe('unidad_inmovilizada');
    expect(CATEGORIAS_CRITICAS).toEqual(['unidad_inmovilizada']);
    const r = revisarCobros([linea('2026-03-04', { clase: 9 })], { inmovilizadasPorTag: mapa() });
    expect(r.candidatos.map((c) => c.categoria)).toEqual(['unidad_inmovilizada', 'clase_fuera_de_3_5']);
    expect(r.candidatos[1].severidad).toBeUndefined();
  });

  it('el reporte nunca dice «fraude» ni «indebido»', () => {
    const [c] = inmov([linea('2026-03-04')], { inmovilizadasPorTag: mapa() });
    // La única mención permitida es la negación explícita («No se afirma que haya fraude»).
    expect(JSON.stringify(c).replace('No se afirma que haya fraude', '')).not.toMatch(/fraud|indebid|robo|ladr/i);
  });
});

describe('importación de la lista de unidades inmovilizadas', () => {
  const csv = (t: string) => parsearInmovilizadasMatriz(matrizDeCsvTexto(t));

  it('lee unidad, desde, hasta, motivo y nota; hasta vacío = sigue inmovilizada', () => {
    const l = csv('unidad;desde;hasta;motivo;nota\nC2-08;2026-03-03;2026-03-05;taller;cambio de caja\nC2-09;2026-03-10;;siniestro;\n');
    expect(l.error).toBeUndefined();
    expect(l.rechazadas).toEqual([]);
    expect(l.ventanas).toEqual([
      { fila: 2, unidadRef: 'C2-08', desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller', nota: 'cambio de caja' },
      { fila: 3, unidadRef: 'C2-09', desde: '2026-03-10', hasta: null, motivo: 'siniestro', nota: null },
    ]);
  });

  it('acepta fechas dd/mm/aaaa y motivo con mayúsculas o acentos', () => {
    const l = csv('unidad;desde;hasta;motivo\nC2-08;03/03/2026;05/03/2026;Taller\n');
    expect(l.ventanas[0]).toMatchObject({ desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller' });
  });

  it('rechaza con su fila y motivo: sin unidad, fecha ilegible, ventana al revés, motivo inventado', () => {
    const l = csv('unidad;desde;hasta;motivo\n;2026-03-03;;taller\nC2-08;ayer;;taller\nC2-09;2026-03-05;2026-03-03;taller\nC2-10;2026-03-03;;robo\nC2-11;2026-03-03;mañana;taller\n');
    expect(l.ventanas).toHaveLength(0);
    expect(l.rechazadas.map((r) => r.fila)).toEqual([2, 3, 4, 5, 6]);
    expect(l.rechazadas[0].motivo).toMatch(/sin unidad/);
    expect(l.rechazadas[1].motivo).toMatch(/«desde»/);
    expect(l.rechazadas[2].motivo).toMatch(/al revés/);
    expect(l.rechazadas[3].motivo).toMatch(/taller.*siniestro.*baja/);
    expect(l.rechazadas[4].motivo).toMatch(/«hasta»/);
  });

  it('faltan columnas obligatorias → error que las nombra; archivo vacío → error', () => {
    expect(csv('unidad;desde\nC2-08;2026-03-03\n').error).toMatch(/Faltan columnas: motivo/);
    expect(parsearInmovilizadasMatriz([]).error).toMatch(/vacío/);
  });

  it('la misma unidad, fecha y motivo repetida: idéntica se ignora, con otro «hasta» se rechaza', () => {
    const l = csv('unidad;desde;hasta;motivo\nC2-08;2026-03-03;2026-03-05;taller\nC2-08;2026-03-03;2026-03-05;taller\nC2-08;2026-03-03;2026-03-09;taller\n');
    expect(l.ventanas).toHaveLength(1);
    expect(l.rechazadas).toHaveLength(1);
    expect(l.rechazadas[0].fila).toBe(4);
  });

  it('resuelve la unidad por número económico y luego por placas; inexistente o ambigua se rechaza', () => {
    const l = csv('unidad;desde;motivo\nC2-08;2026-03-03;taller\nABC-001;2026-03-03;taller\nNOEXISTE;2026-03-03;taller\nDUP;2026-03-03;taller\n');
    const { altas, rechazadas } = resolverUnidadesInmovilizadas(l.ventanas, [
      { id: 'u1', numeroEconomico: 'C2-08', placas: null },
      { id: 'u2', numeroEconomico: 'C2-09', placas: 'ABC-001' },
      { id: 'u3', numeroEconomico: 'DUP', placas: null },
      { id: 'u4', numeroEconomico: 'dup', placas: null },
    ]);
    expect(altas.map((a) => a.unidadId)).toEqual(['u1', 'u2']);
    expect(rechazadas.map((r) => r.fila)).toEqual([4, 5]);
    expect(rechazadas[0].motivo).toMatch(/no existe/);
    expect(rechazadas[1].motivo).toMatch(/más de una unidad/);
  });
});

describe('I/O de unidades inmovilizadas', () => {
  const semilla = () => ({
    unidad: [
      { id: 'u1', tenant_id: T, numero_economico: 'C2-08', placas: 'AAA-111' },
      { id: 'u9', tenant_id: 'tenant-2', numero_economico: 'C2-08', placas: null },
    ],
    peaje_tag: [
      { tenant_id: T, tag: TAG, unidad_id: 'u1' },
      { tenant_id: T, tag: 'TAGEJEMPLO02', unidad_id: 'u2' },
      { tenant_id: 'tenant-2', tag: 'TAGAJENO0001', unidad_id: 'u9' },
    ],
    peaje_unidad_inmovilizada: [] as Array<Record<string, unknown>>,
  });
  beforeEach(() => { db = crearDbFalsa(semilla()); });

  it('importa, queda acotado a la flota y repetir el archivo no duplica (actualiza hasta)', async () => {
    const r1 = await D.importarInmovilizadasArchivo(T, 'inm.csv', bytes('unidad;desde;hasta;motivo\nC2-08;2026-03-03;2026-03-05;taller\nNOEXISTE;2026-03-03;;taller\n'));
    expect(r1).toMatchObject({ ok: true, guardadas: 1, actualizadas: 0 });
    expect(r1.rechazadas).toHaveLength(1);
    expect(db.tablas.peaje_unidad_inmovilizada).toHaveLength(1);
    expect(db.tablas.peaje_unidad_inmovilizada[0]).toMatchObject({ tenant_id: T, unidad_id: 'u1', desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller' });
    const r2 = await D.importarInmovilizadasArchivo(T, 'inm.csv', bytes('unidad;desde;hasta;motivo\nC2-08;2026-03-03;2026-03-09;taller\n'));
    expect(r2).toMatchObject({ ok: true, guardadas: 1, actualizadas: 1 });
    expect(db.tablas.peaje_unidad_inmovilizada).toHaveLength(1);
    expect(db.tablas.peaje_unidad_inmovilizada[0].hasta).toBe('2026-03-09');
  });

  it('un archivo con columnas faltantes no escribe nada y dice por qué', async () => {
    const r = await D.importarInmovilizadasArchivo(T, 'inm.csv', bytes('unidad;desde\nC2-08;2026-03-03\n'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Faltan columnas/);
    expect(db.tablas.peaje_unidad_inmovilizada).toHaveLength(0);
  });

  it('un fallo de la base al guardar se dice y no se da por hecho', async () => {
    db.fallar('peaje_unidad_inmovilizada.upsert', 'caída');
    const r = await D.importarInmovilizadasArchivo(T, 'inm.csv', bytes('unidad;desde;motivo\nC2-08;2026-03-03;taller\n'));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/es seguro repetirlo/);
  });

  it('inmovilizadasPorTag une TAG → unidad → ventanas, solo de la flota, y un TAG sin ventanas no aparece', async () => {
    db.tablas.peaje_unidad_inmovilizada = [
      { id: 'i1', tenant_id: T, unidad_id: 'u1', desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller', nota: null },
      { id: 'i2', tenant_id: 'tenant-2', unidad_id: 'u9', desde: '2026-03-03', hasta: null, motivo: 'baja', nota: null },
    ];
    const m = await D.inmovilizadasPorTag(T);
    expect([...m.keys()]).toEqual([TAG]);
    expect(m.get(TAG)).toEqual([{ desde: '2026-03-03', hasta: '2026-03-05', motivo: 'taller' }]);
  });

  it('sin ventanas devuelve un mapa vacío sin leer los TAGs; un error de lectura LANZA', async () => {
    expect((await D.inmovilizadasPorTag(T)).size).toBe(0);
    expect(db.llamadas.some((l) => l.tabla === 'peaje_tag')).toBe(false);
    db.fallar('peaje_unidad_inmovilizada.select', 'caída');
    await expect(D.inmovilizadasPorTag(T)).rejects.toThrow();
  });
});

describe('la migración 0813 (contrato leído del SQL)', () => {
  const sql = readFileSync('supabase/migrations/0813_peaje_unidad_inmovilizada.sql', 'utf8');
  it('es aditiva e idempotente, con RLS deny-all y sin sembrar datos', () => {
    expect(sql).toMatch(/create table if not exists public\.peaje_unidad_inmovilizada/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/insert into|drop |delete from/i);
  });
  it('restringe el motivo, la ventana y la flota de la unidad', () => {
    expect(sql).toMatch(/motivo in \('taller', 'siniestro', 'baja'\)/);
    expect(sql).toMatch(/hasta is null or hasta >= desde/);
    expect(sql).toMatch(/foreign key \(unidad_id, tenant_id\) references public\.unidad \(id, tenant_id\)/);
    expect(sql).toMatch(/unique \(tenant_id, unidad_id, desde, motivo\)/);
  });
});
