import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearDbFalsa, type DbFalsa } from './db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const V = await import('./viajes_fuente');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const U1 = 'u-1';
const U2 = 'u-2';
const RANGO = { desde: '2026-09-01', hasta: '2026-09-30' };

beforeEach(() => {
  db = crearDbFalsa({
    unidad: [
      { id: U1, tenant_id: T, numero_economico: 'TC9001' },
      { id: U2, tenant_id: T, numero_economico: 'TC9002' },
      { id: 'u-x', tenant_id: OTRO, numero_economico: 'TC7777' },
    ],
    viaje: [
      { id: 'v1', tenant_id: T, folio: 'F-1', unidad_id: U1, fecha_inicio: '2026-09-02', fecha_fin: '2026-09-04', origen: 'Origen A', destino: 'Destino B' },
      { id: 'v2', tenant_id: T, folio: null, unidad_id: null, fecha_inicio: '2026-09-05', fecha_fin: '2026-09-06', origen: null, destino: null },
      { id: 'v3', tenant_id: T, folio: 'F-3', unidad_id: U2, fecha_inicio: '2026-09-10', fecha_fin: null, origen: 'Origen C', destino: 'Destino D' },
      { id: 'v4', tenant_id: T, folio: 'F-4', unidad_id: U1, fecha_inicio: '2026-08-01', fecha_fin: '2026-08-03', origen: null, destino: null },
      { id: 'v5', tenant_id: T, folio: 'F-5', unidad_id: U1, fecha_inicio: '2026-10-02', fecha_fin: '2026-10-03', origen: null, destino: null },
      { id: 'v6', tenant_id: OTRO, folio: 'F-6', unidad_id: 'u-x', fecha_inicio: '2026-09-02', fecha_fin: '2026-09-03', origen: null, destino: null },
      { id: 'v7', tenant_id: T, folio: 'F-7', unidad_id: U2, fecha_inicio: '2026-08-28', fecha_fin: '2026-09-01', origen: null, destino: null },
    ],
  });
});

describe('adaptador de la tabla local de viajes', () => {
  it('trae los viajes que tocan el rango con la unidad por número económico e icident nulo', async () => {
    const r = await V.desdeTablaViajeLocal(T, RANGO);
    expect(r.viajes.map((v) => v.id).sort()).toEqual(['v1', 'v3', 'v7']);
    const v1 = r.viajes.find((v) => v.id === 'v1')!;
    expect(v1).toEqual({ id: 'v1', folio: 'F-1', icident: null, unidadNumero: 'TC9001', inicio: '2026-09-02', fin: '2026-09-04', origen: 'Origen A', destino: 'Destino B' });
  });

  it('un viaje abierto (sin fin) que empezó dentro del rango cuenta y conserva fin nulo', async () => {
    const r = await V.desdeTablaViajeLocal(T, RANGO);
    expect(r.viajes.find((v) => v.id === 'v3')!.fin).toBeNull();
  });

  it('el viaje sin unidad se aparta en sinUnidad, no se inventa una', async () => {
    const r = await V.desdeTablaViajeLocal(T, RANGO);
    expect(r.viajes.some((v) => v.id === 'v2')).toBe(false);
    expect(r.sinUnidad).toEqual([{ id: 'v2', folio: null }]);
  });

  it('no ve viajes de otra flota ni de fuera del rango', async () => {
    const r = await V.desdeTablaViajeLocal(T, RANGO);
    const ids = r.viajes.map((v) => v.id);
    expect(ids).not.toContain('v6');
    expect(ids).not.toContain('v4');
    expect(ids).not.toContain('v5');
  });

  it('A37-A2-28: la consulta se acota por fecha_fin (viajes terminados antes del rango no se traen), conservando los abiertos', async () => {
    await V.desdeTablaViajeLocal(T, RANGO);
    const q = db.llamadas.find((l) => l.tabla === 'viaje')!;
    const or = q.filtros.find(([, o]) => o === 'or');
    expect(or, 'falta la cota inferior por fecha_fin').toBeDefined();
    expect(String(or![2])).toContain('fecha_fin.is.null');
    expect(String(or![2])).toMatch(/fecha_fin\.gte\.2026-08-31/); // un día de margen por zona horaria; el filtro exacto sigue en memoria
  });

  it('es solo lectura', async () => {
    await V.desdeTablaViajeLocal(T, RANGO);
    expect(db.llamadas.every((l) => l.op === 'select')).toBe(true);
    expect(db.llamadas.every((l) => l.filtros.some(([c, , v]) => c === 'tenant_id' && v === T))).toBe(true);
  });

  it('rechaza un rango invertido o con fechas inexistentes', async () => {
    await expect(V.desdeTablaViajeLocal(T, { desde: '2026-09-30', hasta: '2026-09-01' })).rejects.toThrow();
    await expect(V.desdeTablaViajeLocal(T, { desde: '2026-02-30', hasta: '2026-03-01' })).rejects.toThrow();
  });
});

describe('contrato de ViajeFuente', () => {
  const base = { id: 'v1', folio: 'F-1', icident: '5551', unidadNumero: 'TC9001', inicio: '2026-09-02', fin: '2026-09-04', origen: 'A', destino: 'B' };

  it('acepta un viaje completo', () => {
    const r = V.validarViajeFuente(base);
    expect(r).toEqual({ ok: true, valor: base });
  });

  it('rechaza unidadNumero vacío o de solo espacios', () => {
    expect(V.validarViajeFuente({ ...base, unidadNumero: '' }).ok).toBe(false);
    expect(V.validarViajeFuente({ ...base, unidadNumero: '   ' }).ok).toBe(false);
    expect(V.validarViajeFuente({ ...base, unidadNumero: undefined }).ok).toBe(false);
  });

  it('rechaza fechas mal formadas o fin anterior al inicio', () => {
    expect(V.validarViajeFuente({ ...base, inicio: '02/09/2026' }).ok).toBe(false);
    expect(V.validarViajeFuente({ ...base, fin: '2026-09-01' }).ok).toBe(false);
    expect(V.validarViajeFuente({ ...base, fin: '' }).ok).toBe(false);
  });

  it('icident, folio y fin pueden ser nulos', () => {
    const r = V.validarViajeFuente({ ...base, icident: null, folio: null, fin: null });
    expect(r.ok && r.valor.icident).toBeNull();
  });
});

describe('contrato de PosicionConViaje y del conector TMS (respuesta sintética)', () => {
  const pos = { unidad: 'TC9001', icident: '5551', puntoInteres: 'Caseta Ejemplo Uno', fechaHoraLocal: '2026-09-02T10:15:00', lat: 25.6, lng: -100.3 };

  it('acepta una posición válida y rechaza icident vacío, coordenadas fuera de rango y hora inválida', () => {
    expect(V.validarPosicionConViaje(pos).ok).toBe(true);
    expect(V.validarPosicionConViaje({ ...pos, icident: '' }).ok).toBe(false);
    expect(V.validarPosicionConViaje({ ...pos, lat: 91 }).ok).toBe(false);
    expect(V.validarPosicionConViaje({ ...pos, lng: '−100' }).ok).toBe(false);
    expect(V.validarPosicionConViaje({ ...pos, fechaHoraLocal: '2026-09-02' }).ok).toBe(false);
  });

  it('desdeConectorTms aparta lo inválido con su motivo y no toca lo válido', async () => {
    const fuente = {
      viajes: async () => [
        { id: 'a', folio: null, icident: '5551', unidadNumero: 'TC9001', inicio: '2026-09-02', fin: null, origen: null, destino: null },
        { id: 'b', folio: null, icident: '5552', unidadNumero: '', inicio: '2026-09-02', fin: null, origen: null, destino: null },
      ],
      posiciones: async () => [pos, { ...pos, puntoInteres: '' }],
    };
    const r = await V.desdeConectorTms(fuente, T, RANGO);
    expect(r.viajes.validos.map((v) => v.id)).toEqual(['a']);
    expect(r.viajes.rechazados).toHaveLength(1);
    expect(r.viajes.rechazados[0].indice).toBe(1);
    expect(r.posiciones.validos).toHaveLength(1);
    expect(r.posiciones.rechazados[0].motivo).toMatch(/puntoInteres/);
  });

  it('una respuesta que no es lista se reporta, no se traga', async () => {
    const r = await V.desdeConectorTms({ viajes: async () => ({ error: 'x' }), posiciones: async () => [] }, T, RANGO);
    expect(r.viajes.validos).toEqual([]);
    expect(r.viajes.rechazados[0].motivo).toMatch(/lista/);
  });
});
