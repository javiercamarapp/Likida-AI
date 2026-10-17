import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const V = await import('./vinculos_conciliacion');
const D = await import('./datos');

const T = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const DES = '00000000-0000-4000-8000-0000000000d1';
const U1 = 'u-1';

const linea = (id: string, indice: number, fecha: string, unidad: string, tenant = T, desglose = DES) =>
  ({ id, tenant_id: tenant, desglose_id: desglose, indice, fecha, caseta: 'Caseta Ejemplo Uno', hora: '10:00', unidad_archivo: unidad });
const viaje = (id: string, ini: string, fin: string | null, unidad = U1) =>
  ({ id, tenant_id: T, folio: `F-${id}`, unidad_id: unidad, fecha_inicio: ini, fecha_fin: fin, origen: 'A', destino: 'B' });

function base(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return crearDbFalsa({
    unidad: [{ id: U1, tenant_id: T, numero_economico: 'TC9001' }, { id: 'u-2', tenant_id: T, numero_economico: 'TC9002' }],
    viaje: [viaje('v-1', '2026-09-10', '2026-09-12')],
    desglose_peaje_linea: [
      linea('l-1', 0, '2026-09-11', 'TC9001'),   // dentro del viaje → ligado
      linea('l-2', 1, '2026-09-20', 'TC9001'),   // fuera → sin_viaje
      linea('l-3', 2, '2026-09-11', 'camioneta'), // unidad genérica → sin_unidad
    ],
    ...extra,
  });
}

beforeEach(() => { db = base(); });

describe('el interruptor por flota', () => {
  it('sin configuración está APAGADO: no lee líneas ni viajes y no escribe nada', async () => {
    expect(await V.vincularDesglose(T, DES)).toEqual({ estado: 'apagado' });
    expect(db.llamadas.some((l) => ['desglose_peaje_linea', 'viaje', 'unidad', 'peaje_cruce_viaje'].includes(l.tabla))).toBe(false);
    expect(db.tablas.peaje_cruce_viaje ?? []).toHaveLength(0);
  });

  it('apagado explícito: igual', async () => {
    await D.guardarVinculosActivo(T, false);
    expect((await V.vincularDesglose(T, DES)).estado).toBe('apagado');
    expect(db.tablas.peaje_cruce_viaje ?? []).toHaveLength(0);
  });

  it('prender la flota OTRA no prende esta', async () => {
    await D.guardarVinculosActivo(OTRO, true);
    expect((await V.vincularDesglose(T, DES)).estado).toBe('apagado');
    expect(await D.leerVinculosActivo(OTRO)).toBe(true);
  });
});

describe('con el interruptor prendido', () => {
  beforeEach(async () => { await D.guardarVinculosActivo(T, true); });

  it('guarda un vínculo por línea con su estado, sin tocar desglose_peaje_linea.viaje_id', async () => {
    const r = await V.vincularDesglose(T, DES);
    expect(r).toEqual({ estado: 'ok', lineas: 3, ligados: 1, ambiguos: 0, sinViaje: 1, sinUnidad: 1, conflictos: 0 });
    const vs = await D.vinculosDeDesglose(T, DES);
    expect(vs.map((v) => [v.lineaId, v.estado, v.viajeId, v.via])).toEqual(expect.arrayContaining([
      ['l-1', 'ligado', 'v-1', 'unidad_ventana'],
      ['l-2', 'sin_viaje', null, 'unidad_ventana'],
      ['l-3', 'sin_unidad', null, 'unidad_ventana'],
    ]));
    expect(vs).toHaveLength(3);
    // El viaje del gasto que respalda la línea (0106) no se mezcla con el vínculo.
    expect(db.llamadas.filter((l) => l.tabla === 'desglose_peaje_linea' && l.op !== 'select')).toHaveLength(0);
  });

  it('recalcular NO duplica: la misma línea queda en una sola fila', async () => {
    await V.vincularDesglose(T, DES);
    await V.vincularDesglose(T, DES);
    await V.vincularDesglose(T, DES);
    expect(db.tablas.peaje_cruce_viaje).toHaveLength(3);
  });

  it('recalcular SOBRESCRIBE: si aparece el viaje que faltaba, el vínculo cambia', async () => {
    await V.vincularDesglose(T, DES);
    db.tablas.viaje.push(viaje('v-2', '2026-09-19', '2026-09-21'));
    await V.vincularDesglose(T, DES);
    const l2 = (await D.vinculosDeDesglose(T, DES)).find((v) => v.lineaId === 'l-2')!;
    expect(l2).toMatchObject({ estado: 'ligado', viajeId: 'v-2' });
    expect(db.tablas.peaje_cruce_viaje).toHaveLength(3);
  });

  it('dos viajes de la misma unidad en la ventana: ambiguo, sin viaje_id y con los candidatos', async () => {
    db.tablas.viaje.push(viaje('v-3', '2026-09-11', '2026-09-11'));
    await V.vincularDesglose(T, DES);
    const l1 = (await D.vinculosDeDesglose(T, DES)).find((v) => v.lineaId === 'l-1')!;
    expect(l1.estado).toBe('ambiguo');
    expect(l1.viajeId).toBeNull();
    expect([...l1.candidatos].sort()).toEqual(['v-1', 'v-3']);
  });

  it('un viaje de OTRA flota no liga', async () => {
    db.tablas.viaje = [{ ...viaje('v-x', '2026-09-10', '2026-09-12'), tenant_id: OTRO }];
    await V.vincularDesglose(T, DES);
    expect((await D.vinculosDeDesglose(T, DES)).find((v) => v.lineaId === 'l-1')!.estado).toBe('sin_viaje');
  });

  it('una línea de otro desglose o de otra flota no se vincula', async () => {
    db.tablas.desglose_peaje_linea.push(linea('l-9', 0, '2026-09-11', 'TC9001', T, 'otro-desglose'), linea('l-8', 0, '2026-09-11', 'TC9001', OTRO));
    await V.vincularDesglose(T, DES);
    expect((db.tablas.peaje_cruce_viaje ?? []).map((f) => f.linea_id).sort()).toEqual(['l-1', 'l-2', 'l-3']);
    expect(await D.vinculosDeDesglose(OTRO, DES)).toEqual([]);
  });

  it('usa la fuente inyectada (con posiciones → Icident) y el rango cubre las fechas ±1 día', async () => {
    const rangos: Array<{ desde: string; hasta: string }> = [];
    const r = await V.vincularDesglose(T, DES, {
      async cargar(_t, rango) {
        rangos.push(rango);
        return {
          viajes: [{ id: 'v-ic', folio: null, icident: 'D-1', unidadNumero: 'TC9001', inicio: '2026-09-11', fin: '2026-09-11', origen: null, destino: null }],
          posiciones: [{ unidad: 'TC9001', icident: 'D-1', puntoInteres: 'Caseta Ejemplo Uno', fechaHoraLocal: '2026-09-11T10:05', lat: 19, lng: -99 }],
        };
      },
    });
    expect(rangos).toEqual([{ desde: '2026-09-10', hasta: '2026-09-21' }]);
    expect(r.estado).toBe('ok');
    const l1 = (await D.vinculosDeDesglose(T, DES)).find((v) => v.lineaId === 'l-1')!;
    expect(l1).toMatchObject({ estado: 'ligado', viajeId: 'v-ic', via: 'icident', icident: 'D-1' });
  });

  it('un desglose sin líneas no escribe nada', async () => {
    const r = await V.vincularDesglose(T, 'vacio');
    expect(r).toMatchObject({ estado: 'ok', lineas: 0 });
    expect(db.tablas.peaje_cruce_viaje ?? []).toHaveLength(0);
  });

  it('NUNCA lanza: un fallo de base vuelve `fallo` y no deja vínculos a medias', async () => {
    db.fallar('peaje_cruce_viaje.upsert', 'caída de base con TC9001');
    const r = await V.vincularDesglose(T, DES);
    expect(r.estado).toBe('fallo');
    expect(db.tablas.peaje_cruce_viaje ?? []).toHaveLength(0);
  });
});

describe('guardarVinculos', () => {
  it('solo un `ligado` conserva viaje_id aunque el llamador mande uno', async () => {
    await D.guardarVinculos(T, DES, [
      { lineaId: 'l-1', estado: 'sin_viaje', viajeId: 'v-1', via: 'unidad_ventana', candidatos: [] },
    ]);
    expect(db.tablas.peaje_cruce_viaje[0].viaje_id).toBeNull();
  });
  it('lee la lista vacía cuando no hay nada', async () => {
    expect(await D.vinculosDeDesglose(T, DES)).toEqual([]);
  });
});

describe('contrato de la migración 0814', () => {
  const sql = readFileSync('supabase/migrations/0814_peaje_cruce_viaje.sql', 'utf8');
  it('un vínculo por línea y por flota, con FK compuestas y el viaje en set null (solo viaje_id)', () => {
    expect(sql).toMatch(/peaje_cruce_viaje_unico unique \(tenant_id, linea_id\)/);
    expect(sql).toMatch(/foreign key \(linea_id, tenant_id\)\s+references public\.desglose_peaje_linea \(id, tenant_id\) on delete cascade/);
    expect(sql).toMatch(/foreign key \(viaje_id, tenant_id\)\s+references public\.viaje \(id, tenant_id\) on delete set null \(viaje_id\)/);
    expect(sql).toMatch(/estado in \('ligado', 'ambiguo', 'sin_viaje', 'sin_unidad', 'conflicto'\)/);
    expect(sql).toMatch(/via in \('icident', 'unidad_ventana'\)/);
  });
  it('apagado de origen, RLS deny-all y NO modifica desglose_peaje_linea.viaje_id', () => {
    expect(sql).toMatch(/activo\s+boolean not null default false/);
    expect(sql).toMatch(/alter table public\.peaje_cruce_viaje enable row level security/);
    expect(sql).not.toMatch(/alter table public\.desglose_peaje_linea\s+(add|drop|alter) column/i);
    expect(sql).not.toMatch(/create policy/i);
  });
});
