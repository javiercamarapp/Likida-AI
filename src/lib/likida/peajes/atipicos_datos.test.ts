import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import { detectarAtipicos, CONFIG_ATIPICOS_DEFAULT, type CruceEntrada } from './atipicos';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const D = await import('./datos');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const DES = '00000000-0000-4000-8000-0000000000aa';
beforeEach(() => { db = crearDbFalsa({}); });

/** Seis cruces sintéticos a la misma caseta en 5 h (unidad ficticia TC9001). */
function cruces(unidad = 'TC9001'): CruceEntrada[] {
  return [0, 1, 2, 3, 4, 5].map((h) => ({
    unidad_archivo: unidad, caseta: 'Caseta Ejemplo Uno', fecha: '2026-09-02', hora: `${String(8 + h).padStart(2, '0')}:00`, monto: 100,
  }));
}
const hallazgos = (unidad?: string) => detectarAtipicos(cruces(unidad), CONFIG_ATIPICOS_DEFAULT).hallazgos;

describe('configuración de atípicos en base', () => {
  it('sin fila: apagado y con los umbrales por defecto', async () => {
    const c = await D.leerConfigAtipicos(T);
    expect(c.activo).toBe(false);
    expect(c.umbrales).toEqual(CONFIG_ATIPICOS_DEFAULT);
  });

  it('guarda, relee y la flota ajena no la ve', async () => {
    const r = await D.guardarConfigAtipicos(T, { activo: true, umbrales: { repeticion_caseta: { minCruces: 5 } } });
    expect(r.ok).toBe(true);
    const c = await D.leerConfigAtipicos(T);
    expect(c.activo).toBe(true);
    expect(c.umbrales.repeticion_caseta.minCruces).toBe(5);
    expect((await D.leerConfigAtipicos(OTRO)).activo).toBe(false);
    expect(db.tablas.peaje_atipico_config).toHaveLength(1);
  });

  it('guardar dos veces deja una sola fila por flota', async () => {
    await D.guardarConfigAtipicos(T, { activo: true });
    await D.guardarConfigAtipicos(T, { activo: false });
    expect(db.tablas.peaje_atipico_config).toHaveLength(1);
    expect((await D.leerConfigAtipicos(T)).activo).toBe(false);
  });

  it('rechaza H <= 0 y velocidad < 30 sin escribir nada', async () => {
    const a = await D.guardarConfigAtipicos(T, { activo: true, umbrales: { repeticion_caseta: { ventanaHoras: 0 } } });
    const b = await D.guardarConfigAtipicos(T, { activo: true, umbrales: { secuencia_imposible: { velocidadMaxKmh: 10 } } });
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });

  it('un error de base al leer se lanza (no se lee "apagado" estando ciego)', async () => {
    db.fallar('peaje_atipico_config.select', 'boom');
    await expect(D.leerConfigAtipicos(T)).rejects.toThrow(/boom/);
  });

  it('una fila guardada corrupta cae a defaults', async () => {
    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: true, umbrales: { repeticion_caseta: { ventanaHoras: -1 } } }];
    const c = await D.leerConfigAtipicos(T);
    expect(c.activo).toBe(true);
    expect(c.umbrales).toEqual(CONFIG_ATIPICOS_DEFAULT);
  });
});

describe('hallazgos atípicos: upsert idempotente', () => {
  it('guardar dos veces el mismo desglose = una fila', async () => {
    const hs = hallazgos();
    expect(hs.length).toBeGreaterThan(0);
    const a = await D.upsertAtipicos(T, DES, hs);
    const b = await D.upsertAtipicos(T, DES, hs);
    expect(a).toEqual({ nuevos: hs.length, yaExistian: 0 });
    expect(b).toEqual({ nuevos: 0, yaExistian: hs.length });
    expect(db.tablas.peaje_atipico).toHaveLength(hs.length);
    const f = db.tablas.peaje_atipico[0];
    expect(f).toMatchObject({ tenant_id: T, estado: 'nuevo', unidad_archivo: 'TC9001', desglose_id: DES });
    expect((f.detalle as { nCruces: number }).nCruces).toBe(6);
  });

  it('re-guardar NO pisa un hallazgo ya revisado ni justificado', async () => {
    const hs = hallazgos();
    await D.upsertAtipicos(T, DES, hs);
    const id = String(db.tablas.peaje_atipico[0].id);
    await D.marcarAtipico(T, id, { estado: 'justificado', por: 'ana@ejemplo.test', nota: 'Salida de servicio de rescate' });
    await D.upsertAtipicos(T, DES, hs);
    expect(db.tablas.peaje_atipico).toHaveLength(hs.length);
    expect(db.tablas.peaje_atipico[0]).toMatchObject({ estado: 'justificado', nota: 'Salida de servicio de rescate', revisado_por: 'ana@ejemplo.test' });
  });

  it('el mismo patrón en otra flota es otra fila; entradas repetidas en una llamada se colapsan', async () => {
    const hs = hallazgos();
    await D.upsertAtipicos(T, DES, [...hs, ...hs]);
    await D.upsertAtipicos(OTRO, null, hs);
    expect(db.tablas.peaje_atipico).toHaveLength(hs.length * 2);
    expect(db.tablas.peaje_atipico.filter((f) => f.tenant_id === T)).toHaveLength(hs.length);
  });

  it('liga la unidad del sistema cuando se conoce y toda consulta lleva el filtro de la flota', async () => {
    await D.upsertAtipicos(T, DES, hallazgos(), new Map([['TC9001', 'u-1']]));
    expect(db.tablas.peaje_atipico[0].unidad_id).toBe('u-1');
    for (const l of db.llamadas.filter((x) => x.op === 'select')) {
      expect(l.filtros.some(([c, o, v]) => c === 'tenant_id' && o === 'eq' && v === T)).toBe(true);
    }
  });

  it('un error de base se lanza', async () => {
    db.fallar('peaje_atipico.upsert', 'sin espacio');
    await expect(D.upsertAtipicos(T, DES, hallazgos())).rejects.toThrow(/sin espacio/);
  });
});

describe('marcar un hallazgo', () => {
  async function uno() {
    await D.upsertAtipicos(T, DES, hallazgos());
    return String(db.tablas.peaje_atipico[0].id);
  }

  it('avanza y registra cuándo se avisó y quién revisó', async () => {
    const id = await uno();
    expect(await D.marcarAtipico(T, id, { estado: 'avisado' })).toEqual({ ok: true, estado: 'avisado' });
    expect(db.tablas.peaje_atipico[0].avisado_en).toBeTruthy();
    expect(db.tablas.peaje_atipico[0].revisado_por).toBeUndefined();
    expect((await D.marcarAtipico(T, id, { estado: 'revisado', por: ' ana@ejemplo.test ', nota: 'Llamé al operador' })).ok).toBe(true);
    expect(db.tablas.peaje_atipico[0]).toMatchObject({ estado: 'revisado', revisado_por: 'ana@ejemplo.test', nota: 'Llamé al operador' });
    expect(db.tablas.peaje_atipico[0].revisado_en).toBeTruthy();
  });

  it('el estado no retrocede de justificado a nuevo', async () => {
    const id = await uno();
    await D.marcarAtipico(T, id, { estado: 'justificado', por: 'ana@ejemplo.test', nota: 'Rescate nocturno' });
    const r = await D.marcarAtipico(T, id, { estado: 'nuevo' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toMatch(/justificado/);
    expect(db.tablas.peaje_atipico[0].estado).toBe('justificado');
    expect((await D.marcarAtipico(T, id, { estado: 'revisado', por: 'x' })).ok).toBe(false);
  });

  it('revisado/justificado piden revisor y justificado pide motivo; estado inválido o hallazgo ajeno se rechazan', async () => {
    const id = await uno();
    expect((await D.marcarAtipico(T, id, { estado: 'revisado' })).ok).toBe(false);
    expect((await D.marcarAtipico(T, id, { estado: 'justificado', por: 'ana' })).ok).toBe(false);
    expect((await D.marcarAtipico(T, id, { estado: 'cerrado' as never })).ok).toBe(false);
    expect((await D.marcarAtipico(OTRO, id, { estado: 'avisado' })).ok).toBe(false);
    expect(db.tablas.peaje_atipico[0].estado).toBe('nuevo');
  });
});
