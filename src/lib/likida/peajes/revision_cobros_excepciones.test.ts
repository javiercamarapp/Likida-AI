import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa, type Fila } from './db_falsa.test.util';

// ═══════════════════════════════════════════════════════════════════════════
// T-A2-09: excepciones por unidad de «caseta que no debe cruzarse» y cruces
// justificados, contra la base en memoria. Todo sintético: casetas, unidades y
// TAGs inventados; la flota nace SIN ninguna lista.
// ═══════════════════════════════════════════════════════════════════════════

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const R = await import('./revision_cobros');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const D = '11111111-1111-4111-8111-111111111111';
const CASETA = 'Caseta Ejemplo Norte';

const linea = (indice: number, unidad: string | null, p: Fila = {}): Fila => ({
  tenant_id: T, desglose_id: D, indice, fecha: '2026-03-05', hora: `10:${String(indice).padStart(2, '0')}:00`,
  caseta: CASETA, tag: `TAG0000000${indice}`, monto: 100, clase: 5, unidad_archivo: unidad, unidad_id: null, ...p,
});

function sembrar(extra: Record<string, Fila[]> = {}) {
  db = crearDbFalsa({
    desglose_peaje: [{ id: D, tenant_id: T, proveedor: 'IAVE', archivo_nombre: 'prueba.xlsx', periodo_oficial_desde: '2026-03-01', periodo_oficial_hasta: '2026-03-10', anulado_en: null }],
    desglose_peaje_linea: [linea(0, 'TC9001'), linea(1, 'TC9002'), linea(2, null), linea(3, 'tc-9001')],
    peaje_caseta_nombre: [{ id: 'c1', tenant_id: T, nombre: CASETA, nombre_norm: 'caseta ejemplo norte', clases_permitidas: [], no_cruzar: true, cruces_vistos: 4 }],
    ...extra,
  });
}
beforeEach(() => sembrar());

const marcados = async (tenant = T) => {
  const rep = await R.revisionDeDesglose(tenant, D);
  return rep?.revision.candidatos.filter((c) => c.categoria === 'caseta_no_debe_cruzarse') ?? [];
};

describe('una flota nueva: nada precargado', () => {
  it('sin lista de casetas prohibidas, la revisión no marca nada y dice por qué', async () => {
    sembrar({ peaje_caseta_nombre: [{ id: 'c1', tenant_id: T, nombre: CASETA, nombre_norm: 'caseta ejemplo norte', clases_permitidas: [], no_cruzar: false }] });
    const rep = await R.revisionDeDesglose(T, D);
    expect(rep?.revision.porCategoria.caseta_no_debe_cruzarse.n).toBe(0);
    expect(rep?.revision.reglasNoAplicadas.find((x) => x.regla === 'caseta_no_debe_cruzarse')?.motivo).toMatch(/no hay casetas prohibidas configuradas/i);
    expect(await R.listarExcepcionesUnidad(T)).toEqual([]);
  });
});

describe('excepciones por unidad', () => {
  it('round-trip: guardar y leer; la unidad exceptuada deja de marcarse y las demás siguen', async () => {
    expect((await marcados()).map((c) => c.indice)).toEqual([0, 1, 2, 3]);
    expect(await R.guardarExcepcionUnidad(T, { caseta: `  ${CASETA} `, unidad: 'TC9001', nota: 'Atiende rescates' })).toEqual({ ok: true });
    const guardadas = await R.listarExcepcionesUnidad(T);
    expect(guardadas).toEqual([{ id: expect.any(String), casetaNorm: 'caseta ejemplo norte', unidad: 'TC9001', unidadNorm: 'tc9001', nota: 'Atiende rescates' }]);
    // 0 es TC9001 y 3 es «tc-9001»: la misma unidad escrita distinto
    expect((await marcados()).map((c) => c.indice)).toEqual([1, 2]);
  });

  it('guardar dos veces la misma excepción no la duplica; quitarla vuelve a marcar', async () => {
    await R.guardarExcepcionUnidad(T, { caseta: CASETA, unidad: 'TC9001' });
    await R.guardarExcepcionUnidad(T, { caseta: CASETA, unidad: 'tc-9001' });
    const lista = await R.listarExcepcionesUnidad(T);
    expect(lista).toHaveLength(1);
    expect(await R.quitarExcepcionUnidad(T, lista[0].id)).toBe(true);
    expect((await marcados()).map((c) => c.indice)).toEqual([0, 1, 2, 3]);
  });

  it('rechaza caseta o unidad vacías, y una caseta que no está en el catálogo de la flota', async () => {
    expect((await R.guardarExcepcionUnidad(T, { caseta: '', unidad: 'TC9001' })).ok).toBe(false);
    expect((await R.guardarExcepcionUnidad(T, { caseta: CASETA, unidad: '  ' })).ok).toBe(false);
    const r = await R.guardarExcepcionUnidad(T, { caseta: 'Caseta Inventada', unidad: 'TC9001' });
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining('catálogo') });
    expect(db.tablas.peaje_caseta_excepcion_unidad ?? []).toHaveLength(0);
  });

  it('una excepción de OTRA flota no afecta a esta, y quitar con el id ajeno no borra', async () => {
    sembrar({ peaje_caseta_nombre: [
      { id: 'c1', tenant_id: T, nombre: CASETA, nombre_norm: 'caseta ejemplo norte', no_cruzar: true },
      { id: 'c2', tenant_id: OTRO, nombre: CASETA, nombre_norm: 'caseta ejemplo norte', no_cruzar: true },
    ] });
    await R.guardarExcepcionUnidad(OTRO, { caseta: CASETA, unidad: 'TC9001' });
    expect((await marcados()).map((c) => c.indice)).toEqual([0, 1, 2, 3]);
    const ajena = (await R.listarExcepcionesUnidad(OTRO))[0];
    expect(await R.quitarExcepcionUnidad(T, ajena.id)).toBe(true); // sin error, pero con filtro de flota…
    expect(await R.listarExcepcionesUnidad(OTRO)).toHaveLength(1); // …no borró la de la otra flota
  });

  it('toda consulta nueva lleva el filtro de la flota', async () => {
    await R.guardarExcepcionUnidad(T, { caseta: CASETA, unidad: 'TC9001' });
    const antes = db.llamadas.length;
    await R.revisionDeDesglose(T, D);
    await R.listarExcepcionesUnidad(T);
    for (const l of db.llamadas.slice(antes)) {
      expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T), `${l.tabla}.${l.op} sin tenant`).toBe(true);
    }
  });

  it('una falla de lectura de las excepciones LANZA (no se lee como «sin excepciones»)', async () => {
    db.fallar('peaje_caseta_excepcion_unidad.select', 'base caída');
    await expect(R.revisionDeDesglose(T, D)).rejects.toThrow();
  });
});

describe('justificar un cruce', () => {
  it('el cruce queda revisado con su motivo y NO desaparece de la lista ni de los totales', async () => {
    expect(await R.justificarCruce(T, { desgloseId: D, indice: 1, motivo: '  Salida de servicio autorizada ' })).toEqual({ ok: true });
    const cs = await marcados();
    expect(cs).toHaveLength(4);
    expect(cs.find((c) => c.indice === 1)?.justificacion).toBe('Salida de servicio autorizada');
    expect(cs.filter((c) => c.justificacion)).toHaveLength(1);
    expect(db.tablas.peaje_cruce_justificado).toHaveLength(1);
    expect(db.tablas.peaje_cruce_justificado[0]).toMatchObject({ tenant_id: T, desglose_id: D, indice: 1, categoria: 'caseta_no_debe_cruzarse' });
    const rep = await R.revisionDeDesglose(T, D);
    expect(rep?.revision.porCategoria.caseta_no_debe_cruzarse.n).toBe(4);
  });

  it('justificar otra vez el mismo cruce cambia el motivo sin duplicar', async () => {
    await R.justificarCruce(T, { desgloseId: D, indice: 1, motivo: 'Primer motivo' });
    await R.justificarCruce(T, { desgloseId: D, indice: 1, motivo: 'Motivo corregido' });
    expect(db.tablas.peaje_cruce_justificado).toHaveLength(1);
    expect((await marcados()).find((c) => c.indice === 1)?.justificacion).toBe('Motivo corregido');
  });

  it('rechaza motivo vacío o corto, renglón inválido, y un cruce que no es candidato', async () => {
    expect((await R.justificarCruce(T, { desgloseId: D, indice: 1, motivo: '' })).ok).toBe(false);
    expect((await R.justificarCruce(T, { desgloseId: D, indice: 1, motivo: 'ab' })).ok).toBe(false);
    expect((await R.justificarCruce(T, { desgloseId: D, indice: -3, motivo: 'motivo válido' })).ok).toBe(false);
    expect(await R.justificarCruce(T, { desgloseId: D, indice: 99, motivo: 'motivo válido' })).toMatchObject({ ok: false, motivo: expect.stringContaining('nada que justificar') });
    expect(db.tablas.peaje_cruce_justificado ?? []).toHaveLength(0);
  });

  it('un desglose de otra flota o inexistente no se puede justificar', async () => {
    expect(await R.justificarCruce(OTRO, { desgloseId: D, indice: 1, motivo: 'motivo válido' })).toMatchObject({ ok: false });
    expect(await R.justificarCruce(T, { desgloseId: '22222222-2222-4222-8222-222222222222', indice: 1, motivo: 'motivo válido' })).toMatchObject({ ok: false });
    expect(db.tablas.peaje_cruce_justificado ?? []).toHaveLength(0);
  });

  it('un cruce exceptuado por unidad ya no es candidato, así que tampoco se justifica', async () => {
    await R.guardarExcepcionUnidad(T, { caseta: CASETA, unidad: 'TC9001' });
    expect((await R.justificarCruce(T, { desgloseId: D, indice: 0, motivo: 'motivo válido' })).ok).toBe(false);
  });
});
