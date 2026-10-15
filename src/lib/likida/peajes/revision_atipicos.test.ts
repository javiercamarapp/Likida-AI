import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';
import type { CruceEntrada } from './atipicos';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const corridas: Array<{ estado: string; error?: string }> = [];
vi.mock('../agentes/corridas', () => ({ registrarCorrida: async (_t: string, _a: string, c: { estado: string; error?: string }) => { corridas.push(c); } }));

const R = await import('./revision_atipicos');

const T = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const cruce = (hora: string, extra: Partial<CruceEntrada> = {}): CruceEntrada => ({
  unidad_archivo: 'TC9001', caseta: 'Caseta Ejemplo Uno', fecha: '2026-09-10', hora, monto: 100, ...extra,
});

describe('unirCruces: traslape entre archivos', () => {
  it('un cruce que dos archivos comparten cuenta una vez', () => {
    const a = [cruce('10:00'), cruce('11:00')];
    const b = [cruce('11:00'), cruce('12:00')];
    expect(R.unirCruces([a, b])).toHaveLength(3);
  });
  it('dos cobros idénticos dentro de UN archivo se conservan', () => {
    expect(R.unirCruces([[cruce('10:00'), cruce('10:00')], [cruce('10:00')]])).toHaveLength(2);
  });
  it('sin archivos no hay cruces', () => {
    expect(R.unirCruces([])).toEqual([]);
  });
});

describe('ventanaDeDesgloses', () => {
  const des = (id: string, desde: string | null, tenant = T, anulado: string | null = null) =>
    ({ id, tenant_id: tenant, periodo_desde: desde, anulado_en: anulado });
  beforeEach(() => {
    db = crearDbFalsa({
      desglose_peaje: [
        des('d-ago', '2026-08-21'),
        des('d-01', '2026-09-01'),
        des('d-11', '2026-09-11'),
        des('d-21', '2026-09-21'),
        des('d-anulado', '2026-09-05', T, '2026-09-30T00:00:00Z'),
        des('d-ajeno', '2026-09-06', OTRO),
        des('d-sin-periodo', null),
      ],
    });
  });
  it('suma las 2 decenas previas del MISMO mes de la misma flota, no anuladas ni de otra flota', async () => {
    const v = await R.ventanaDeDesgloses(T, 'd-21');
    expect(v!.map((x) => x.id)).toEqual(['d-21', 'd-11', 'd-01']);
  });
  it('la primera decena del mes no jala el mes anterior', async () => {
    expect((await R.ventanaDeDesgloses(T, 'd-01'))!.map((x) => x.id)).toEqual(['d-01']);
  });
  it('sin periodo medido revisa solo el archivo actual', async () => {
    expect((await R.ventanaDeDesgloses(T, 'd-sin-periodo'))!.map((x) => x.id)).toEqual(['d-sin-periodo']);
  });
  it('un desglose anulado o ajeno es inexistente', async () => {
    expect(await R.ventanaDeDesgloses(T, 'd-anulado')).toBeNull();
    expect(await R.ventanaDeDesgloses(T, 'd-ajeno')).toBeNull();
  });
});

describe('revisarAtipicosDeDesglose', () => {
  beforeEach(() => { corridas.length = 0; db = crearDbFalsa({ desglose_peaje: [{ id: 'd1', tenant_id: T, periodo_desde: '2026-09-10', anulado_en: null }] }); });

  it('flota sin configuración: apagado y no lee líneas ni escribe hallazgos', async () => {
    expect(await R.revisarAtipicosDeDesglose(T, 'd1')).toEqual({ estado: 'apagado' });
    expect(db.llamadas.some((l) => l.tabla === 'desglose_peaje_linea' || l.tabla === 'peaje_atipico')).toBe(false);
  });

  it('flota con el detector apagado explícitamente: igual', async () => {
    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: false, umbrales: null }];
    expect((await R.revisarAtipicosDeDesglose(T, 'd1')).estado).toBe('apagado');
  });

  it('la configuración de OTRA flota no activa esta', async () => {
    db.tablas.peaje_atipico_config = [{ tenant_id: OTRO, activo: true, umbrales: null }];
    expect((await R.revisarAtipicosDeDesglose(T, 'd1')).estado).toBe('apagado');
  });

  it('desglose inexistente: sin_desglose', async () => {
    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: true, umbrales: null }];
    expect((await R.revisarAtipicosDeDesglose(T, 'no-existe')).estado).toBe('sin_desglose');
  });

  it('un error de base NO lanza: devuelve fallo y anota la corrida como parcial sin detalle técnico', async () => {
    db.tablas.peaje_atipico_config = [{ tenant_id: T, activo: true, umbrales: null }];
    db.fallar('desglose_peaje_linea.select', 'boom interno');
    const r = await R.revisarAtipicosDeDesglose(T, 'd1');
    expect(r).toMatchObject({ estado: 'fallo', motivo: expect.stringMatching(/boom interno/) });
    expect(corridas).toHaveLength(1);
    expect(corridas[0].estado).toBe('parcial');
    expect(corridas[0].error).not.toMatch(/boom/);
  });
});
