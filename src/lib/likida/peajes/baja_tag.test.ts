import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { validarBajaTag, resolverTagEnFecha, type VigenciaTag } from './tags';
import { revisarCobros, type LineaCobro } from './reglas_cobro';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-10 — baja lógica de un TAG: fecha y motivo, historial intacto, sin borrar.
// Datos sintéticos (TAGs y unidades de ejemplo).
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');
const T = 'tenant-1';
const OTRO = 'tenant-2';
const TAG = 'IMDM00000001';
const HOY = '2026-03-20';

const semilla = () => ({
  peaje_tag: [
    { id: 'tg1', tenant_id: T, tag: TAG, tag_original: 'IMDM 00000001', unidad_id: 'u1', proveedor: 'PASE', activo: true },
    { id: 'tg2', tenant_id: OTRO, tag: TAG, tag_original: 'IMDM 00000001', unidad_id: 'u9', proveedor: null, activo: true },
  ],
  unidad: [{ id: 'u1', tenant_id: T, numero_economico: 'TC9001', placas: 'XYZ-001' }],
  peaje_tag_baja: [],
});
beforeEach(() => { db = crearDbFalsa(semilla()); });

describe('validarBajaTag', () => {
  it('fecha vacía o ausente se rechaza con mensaje llano', () => {
    for (const fecha of ['', '   ', undefined, null]) {
      const r = validarBajaTag({ fecha }, HOY);
      expect(r).toMatchObject({ ok: false });
      if (!r.ok) expect(r.motivo).toMatch(/Falta la fecha de baja/);
    }
  });
  it('fecha mal formada o inexistente se rechaza', () => {
    for (const fecha of ['05/03/2026', '2026-13-01', '2026-02-30', 'ayer']) {
      expect(validarBajaTag({ fecha }, HOY)).toMatchObject({ ok: false });
    }
  });
  it('fecha pasada o de hoy rige ya; futura queda programada', () => {
    expect(validarBajaTag({ fecha: '2026-03-05' }, HOY)).toMatchObject({ ok: true, vigente: true });
    expect(validarBajaTag({ fecha: HOY }, HOY)).toMatchObject({ ok: true, vigente: true });
    expect(validarBajaTag({ fecha: '2026-04-01' }, HOY)).toMatchObject({ ok: true, vigente: false });
  });
  it('el motivo se recorta, se limita a 300 y vacío es null', () => {
    expect(validarBajaTag({ fecha: HOY, motivo: '  Unidad siniestrada  ' }, HOY)).toMatchObject({ motivo: 'Unidad siniestrada' });
    expect(validarBajaTag({ fecha: HOY, motivo: '   ' }, HOY)).toMatchObject({ motivo: null });
    const largo = validarBajaTag({ fecha: HOY, motivo: 'x'.repeat(500) }, HOY);
    expect(largo.ok && largo.motivo?.length).toBe(300);
  });
});

describe('resolverTagEnFecha: la baja no reescribe el pasado', () => {
  const mapa = new Map<string, VigenciaTag>([[TAG, { unidadId: 'u1', bajaEn: '2026-03-05' }], ['IMDM00000002', { unidadId: 'u2', bajaEn: null }]]);
  it('cruce anterior o del último día vigente conserva su unidad', () => {
    expect(resolverTagEnFecha(TAG, '2026-03-01', mapa)).toEqual({ estado: 'vigente', unidadId: 'u1' });
    expect(resolverTagEnFecha(TAG, '2026-03-05', mapa)).toEqual({ estado: 'vigente', unidadId: 'u1' });
  });
  it('cruce posterior ya no se atribuye a la unidad, pero se sabe cuál era y cuándo se dio de baja', () => {
    expect(resolverTagEnFecha(TAG, '2026-03-06', mapa)).toEqual({ estado: 'dado_de_baja', unidadAnteriorId: 'u1', bajaEn: '2026-03-05' });
    expect(resolverTagEnFecha(TAG, '2026-03-06T10:00:00', mapa)).toMatchObject({ estado: 'dado_de_baja' });
  });
  it('una baja FUTURA no afecta a los cruces de hoy ni anteriores', () => {
    const futura = new Map<string, VigenciaTag>([[TAG, { unidadId: 'u1', bajaEn: '2026-04-01' }]]);
    expect(resolverTagEnFecha(TAG, HOY, futura)).toEqual({ estado: 'vigente', unidadId: 'u1' });
    expect(resolverTagEnFecha(TAG, '2026-04-02', futura)).toMatchObject({ estado: 'dado_de_baja' });
  });
  it('sin baja siempre vigente; sin alta o sin TAG, sin_alta; sin fecha de cruce no se afirma nada', () => {
    expect(resolverTagEnFecha('IMDM00000002', '2030-01-01', mapa)).toEqual({ estado: 'vigente', unidadId: 'u2' });
    expect(resolverTagEnFecha('NOEXISTE0001', '2026-03-01', mapa)).toEqual({ estado: 'sin_alta' });
    expect(resolverTagEnFecha(null, '2026-03-01', mapa)).toEqual({ estado: 'sin_alta' });
    expect(resolverTagEnFecha(TAG, null, mapa)).toEqual({ estado: 'vigente', unidadId: 'u1' });
  });
});

describe('bajaTag (datos, base falsa)', () => {
  it('ya no borra la fila: queda activo=false y la baja con fecha y motivo', async () => {
    const r = await D.bajaTag(T, 'tg1', { fecha: '2026-03-05', motivo: 'Unidad siniestrada' }, HOY);
    expect(r).toEqual({ ok: true });
    expect(db.tablas.peaje_tag).toHaveLength(2);
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg1')).toMatchObject({ activo: false });
    expect(db.tablas.peaje_tag_baja).toEqual([expect.objectContaining({ tenant_id: T, tag: TAG, baja_en: '2026-03-05', motivo: 'Unidad siniestrada' })]);
    expect(db.llamadas.some((l) => l.tabla === 'peaje_tag' && l.op === 'delete')).toBe(false);
  });
  it('fecha vacía: se rechaza y no escribe nada', async () => {
    const r = await D.bajaTag(T, 'tg1', { fecha: '', motivo: 'x' }, HOY);
    expect(r).toMatchObject({ ok: false });
    expect(db.tablas.peaje_tag_baja).toHaveLength(0);
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg1')).toMatchObject({ activo: true });
  });
  it('baja futura: queda registrada pero el TAG sigue activo hasta que llegue', async () => {
    await D.bajaTag(T, 'tg1', { fecha: '2026-04-01' }, HOY);
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg1')).toMatchObject({ activo: true });
    expect(db.tablas.peaje_tag_baja).toHaveLength(1);
  });
  it('es idempotente: repetirla actualiza fecha y motivo, no duplica', async () => {
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-05', motivo: 'a' }, HOY);
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-07', motivo: 'b' }, HOY);
    expect(db.tablas.peaje_tag_baja).toEqual([expect.objectContaining({ baja_en: '2026-03-07', motivo: 'b' })]);
  });
  it('no cruza flotas: un id de otra flota no existe para esta', async () => {
    const r = await D.bajaTag(T, 'tg2', { fecha: '2026-03-05' }, HOY);
    expect(r).toMatchObject({ ok: false, motivo: expect.stringMatching(/ya no existe/) });
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg2')).toMatchObject({ activo: true });
    expect(db.tablas.peaje_tag_baja).toHaveLength(0);
  });
  it('un fallo de base se informa sin tumbar y sin dejar el TAG a medias', async () => {
    db.fallar('peaje_tag_baja.upsert', 'boom');
    const r = await D.bajaTag(T, 'tg1', { fecha: '2026-03-05' }, HOY);
    expect(r).toMatchObject({ ok: false });
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg1')).toMatchObject({ activo: true });
  });
});

describe('vigencia, historial y reactivación', () => {
  it('cargarVigenciaTags conserva el TAG dado de baja con su unidad y fecha (solo de la flota)', async () => {
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-05' }, HOY);
    const v = await D.cargarVigenciaTags(T);
    expect(v.get(TAG)).toEqual({ unidadId: 'u1', bajaEn: '2026-03-05' });
    expect(v.size).toBe(1);
    // mientras tanto el mapa «vigente» ya no lo trae (activo=false)
    expect((await D.cargarMapaTags(T)).has(TAG)).toBe(false);
    expect(resolverTagEnFecha(TAG, '2026-03-02', v)).toMatchObject({ estado: 'vigente', unidadId: 'u1' });
  });
  it('listarTags muestra la baja con fecha y motivo', async () => {
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-05', motivo: 'Unidad siniestrada' }, HOY);
    const [t] = await D.listarTags(T);
    expect(t).toMatchObject({ activo: false, bajaEn: '2026-03-05', bajaMotivo: 'Unidad siniestrada', unidadEconomico: 'TC9001' });
  });
  it('dar de alta otra vez el mismo TAG lo reactiva y retira la baja', async () => {
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-05' }, HOY);
    const r = await D.altaTag(T, { tag: 'imdm 00000001', unidadId: 'u1' });
    expect(r).toEqual({ ok: true, reactivadoDesdeBaja: '2026-03-05' });
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg1')).toMatchObject({ activo: true });
    expect(db.tablas.peaje_tag_baja).toHaveLength(0);
    expect((await D.cargarMapaTags(T)).get(TAG)).toBe('u1');
  });
  it('A37-S53-02: importar el catálogo maestro NO reactiva un TAG dado de baja ni borra su baja', async () => {
    db = crearDbFalsa({ ...semilla(), unidad: [{ id: 'u1', tenant_id: T, numero_economico: 'TC9001', placas: 'XYZ-001' }] });
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-05' }, HOY);
    const csv = new TextEncoder().encode('tag;unidad\nIMDM00000001;TC9001\n');
    const r = await D.importarTagsArchivo(T, 'tags.csv', csv);
    expect(r.ok).toBe(true);
    expect(r.guardadas).toBe(0);
    expect(r.rechazadas).toHaveLength(1);
    expect(r.rechazadas[0].motivo).toMatch(/dado de baja/);
    expect(db.tablas.peaje_tag_baja).toHaveLength(1);
    expect(db.tablas.peaje_tag.find((f) => f.id === 'tg1')).toMatchObject({ activo: false });
  });
  it('un alta normal (sin baja previa) no cambia su respuesta', async () => {
    expect(await D.altaTag(T, { tag: 'IMDM 00000077', unidadId: 'u1' })).toEqual({ ok: true });
  });
});

describe('alimenta la regla tag_dado_de_baja de la revisión de cobros', () => {
  const linea = (indice: number, fecha: string, unidad: string | null): LineaCobro => ({
    indice, fecha, hora: '10:00:00', caseta: 'Caseta Ejemplo Norte', tag: TAG, unidad, clase: 5, monto: 100,
  });
  it('cruce anterior a la baja: nada; cruce posterior: candidato con la unidad y la fecha de baja', async () => {
    await D.bajaTag(T, 'tg1', { fecha: '2026-03-05', motivo: 'Unidad siniestrada' }, HOY);
    const vig = await D.cargarVigenciaTags(T);
    const tagsBaja = new Map([...vig].filter(([, v]) => v.bajaEn).map(([k, v]) => [k, v.bajaEn as string]));
    const r = revisarCobros([linea(0, '2026-03-04', 'TC9001'), linea(1, '2026-03-05', 'TC9001'), linea(2, '2026-03-09', 'TC9001')], { tagsBaja });
    const c = r.candidatos.filter((x) => x.categoria === 'tag_dado_de_baja');
    expect(c.map((x) => x.indice)).toEqual([2]);
    expect(c[0].unidad).toBe('TC9001');
    expect(c[0].quePaso).toContain('2026-03-05');
    expect(c[0].referencia).toContain('2026-03-05');
  });
});
