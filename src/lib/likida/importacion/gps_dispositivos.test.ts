// Mapeo masivo unidad ↔ dispositivo GPS, contra una base en memoria que aplica
// filtros y UNIQUE de verdad.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crearBaseEnMemoria, type BaseEnMemoria } from '@/lib/pruebas/tablas_en_memoria.fixture';

let base: BaseEnMemoria;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => base.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/bitacora_escritura', () => ({ anotarBitacora: async () => true }));

const { interpretarFilasGps, planificarMapeoGps, aplicarMapeoGps, normalizarProveedor, plantillaGpsCsv } = await import('./gps_dispositivos');
const { mapearGpsDesdeArchivo } = await import('./panel');

const T = '11111111-1111-4111-8111-111111111111';
const OTRO = '22222222-2222-4222-8222-222222222222';
const NORTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flota = { tipo: 'flota' } as const;

beforeEach(() => {
  base = crearBaseEnMemoria({
    tenant: [{ id: T, nombre: 'A' }, { id: OTRO, nombre: 'B' }],
    terminal: [{ id: NORTE, tenant_id: T, nombre: 'Patio Norte', ciudad: null }],
    unidad: [
      { id: 'u1', tenant_id: T, numero_economico: 'ECO-1', activo: true, terminal_id: NORTE, gps_proveedor: null, gps_device_id: null },
      { id: 'u2', tenant_id: T, numero_economico: 'ECO-2', activo: true, terminal_id: null, gps_proveedor: 'wialon', gps_device_id: '777' },
      { id: 'u3', tenant_id: T, numero_economico: 'ECO-3', activo: true, terminal_id: null, gps_proveedor: 'wialon', gps_device_id: '888' },
      { id: 'u4', tenant_id: T, numero_economico: 'ECO-4', activo: false, terminal_id: null, gps_proveedor: null, gps_device_id: null },
      { id: 'x1', tenant_id: OTRO, numero_economico: 'ECO-1', activo: true, terminal_id: null, gps_proveedor: null, gps_device_id: null },
    ],
    gps_dispositivo_huerfano: [
      { tenant_id: T, proveedor: 'wialon', device_id: '12001', primer_visto_en: 'x', ultimo_visto_en: 'x' },
      { tenant_id: OTRO, proveedor: 'wialon', device_id: '12001', primer_visto_en: 'x', ultimo_visto_en: 'x' },
    ],
  }, [{ tabla: 'unidad', nombre: 'uq_unidad_gps', columnas: ['tenant_id', 'gps_proveedor', 'gps_device_id'] }], { unidad: { activo: true } });
});

const M = (filas: string[][]) => [['numero_economico', 'proveedor', 'dispositivo'], ...filas];
const dispositivoDe = (id: string) => base.tabla('unidad').find((u) => u.id === id)?.gps_device_id;

describe('interpretar el archivo', () => {
  it('detecta columnas con sinónimos y acentos, normaliza el proveedor y descarta lo inválido con su fila', () => {
    const r = interpretarFilasGps([
      ['Número Económico', 'Plataforma GPS', 'ID del dispositivo'],
      ['ECO-1', 'Wialon', 12001],
      ['ECO-5', 'generico', 'abc'],
      ['ECO-6', 'Moto Tracker', '1'],
      ['', 'wialon', '3'],
      ['ECO-7', 'wialon', ''],
      ['ECO-1', 'wialon', '99'],
      ['ECO-8', 'wialon', '12001'],
      ['EJEMPLO — bórrame', 'wialon', '12001'],
    ]);
    expect(r.filas.map((f) => [f.numeroEconomico, f.proveedor, f.dispositivo])).toEqual([['ECO-1', 'wialon', '12001'], ['ECO-5', 'gps_generico', 'abc']]);
    const motivos = r.descartadas.map((d) => `${d.fila}:${d.motivo}`).join('|');
    expect(motivos).toMatch(/Moto Tracker/);
    expect(motivos).toMatch(/falta el número económico/);
    expect(motivos).toMatch(/falta el id del dispositivo/);
    expect(motivos).toMatch(/ECO-1 ya viene en la fila 2/);
    expect(motivos).toMatch(/dispositivo 12001 ya viene en la fila 2/);
    expect(motivos).toMatch(/fila de ejemplo/);
  });
  it('sin una columna obligatoria dice cuál y qué leyó; la plantilla trae las tres', () => {
    expect(interpretarFilasGps([['placas', 'proveedor']]).error).toMatch(/número económico/);
    expect(plantillaGpsCsv()).toMatch(/numero_economico,proveedor,dispositivo/);
  });
  it('solo acepta proveedores con lector (o push)', () => {
    expect(normalizarProveedor('Samsara')).toBe('samsara');
    expect(normalizarProveedor('GPS propio')).toBe('gps_push');
    expect(normalizarProveedor('traccar')).toBeNull();
  });
});

describe('planificar (no escribe)', () => {
  it('clasifica: se liga, ya estaba, existe/no existe, baja, dispositivo de otra unidad', async () => {
    const filas = interpretarFilasGps(M([
      ['ECO-1', 'wialon', '12001'],   // se liga
      ['ECO-2', 'wialon', '777'],     // ya estaba
      ['ECO-9', 'wialon', '1'],       // no existe
      ['ECO-4', 'wialon', '2'],       // baja
    ])).filas;
    const p = await planificarMapeoGps(T, filas, flota);
    expect(p.aplicar.map((a) => a.numeroEconomico)).toEqual(['ECO-1']);
    expect(p.yaEstaban.map((a) => a.numeroEconomico)).toEqual(['ECO-2']);
    const m = p.errores.map((e) => e.motivo).join('|');
    expect(m).toMatch(/ECO-9 no existe/); expect(m).toMatch(/ECO-4 está dada de baja/);
    expect(dispositivoDe('u1')).toBeNull(); // nada escrito
  });
  it('un dispositivo que ya es de OTRA unidad (que no se reasigna) se rechaza diciendo de cuál', async () => {
    const p = await planificarMapeoGps(T, interpretarFilasGps(M([['ECO-3', 'wialon', '777']])).filas, flota);
    expect(p.aplicar).toEqual([]);
    expect(p.errores[0].motivo).toMatch(/ya es de la unidad ECO-2/);
  });
  it('el dispositivo de otra FLOTA no estorba: el mismo id en otro tenant es otro dispositivo', async () => {
    base.tabla('unidad').push({ id: 'x9', tenant_id: OTRO, numero_economico: 'ECO-9', activo: true, terminal_id: null, gps_proveedor: 'wialon', gps_device_id: '5555' });
    const p = await planificarMapeoGps(T, interpretarFilasGps(M([['ECO-1', 'wialon', '5555']])).filas, flota);
    expect(p.aplicar.map((a) => a.numeroEconomico)).toEqual(['ECO-1']);
  });
  it('un jefe con patio solo liga unidades de su patio', async () => {
    const filas = interpretarFilasGps(M([['ECO-1', 'wialon', '12001'], ['ECO-3', 'wialon', '5']])).filas;
    const p = await planificarMapeoGps(T, filas, { tipo: 'patio', terminalId: NORTE });
    expect(p.aplicar.map((a) => a.numeroEconomico)).toEqual(['ECO-1']);
    expect(p.errores[0].motivo).toMatch(/no es de tu patio/);
  });
  it('base caída: no afirma nada', async () => {
    base.fallarProxima('unidad', 'select', { message: 'boom' });
    const p = await planificarMapeoGps(T, interpretarFilasGps(M([['ECO-1', 'wialon', '1']])).filas, flota);
    expect(p.error).toMatch(/no cambié nada/);
  });
});

describe('aplicar', () => {
  it('liga, limpia el huérfano de ESA flota (no el de otra) y sella gps_visto_en en null', async () => {
    const filas = interpretarFilasGps(M([['ECO-1', 'wialon', '12001']])).filas;
    const r = await aplicarMapeoGps(T, filas, flota);
    expect(r).toMatchObject({ ligadas: 1, errores: [] });
    expect(base.tabla('unidad').find((u) => u.id === 'u1')).toMatchObject({ gps_proveedor: 'wialon', gps_device_id: '12001', gps_visto_en: null });
    expect(base.tabla('gps_dispositivo_huerfano').map((h) => h.tenant_id)).toEqual([OTRO]);
    // OTRO TENANT: su ECO-1 no se tocó
    expect(base.tabla('unidad').find((u) => u.id === 'x1')?.gps_device_id).toBeNull();
  });
  it('INTERCAMBIO: ECO-2 y ECO-3 se cambian los dispositivos sin chocar con el único', async () => {
    const filas = interpretarFilasGps(M([['ECO-2', 'wialon', '888'], ['ECO-3', 'wialon', '777']])).filas;
    const r = await aplicarMapeoGps(T, filas, flota);
    expect(r.ligadas).toBe(2);
    expect([dispositivoDe('u2'), dispositivoDe('u3')]).toEqual(['888', '777']);
  });
  it('idempotente: el mismo archivo otra vez no cambia nada', async () => {
    const filas = interpretarFilasGps(M([['ECO-1', 'wialon', '12001']])).filas;
    await aplicarMapeoGps(T, filas, flota);
    const otra = await aplicarMapeoGps(T, filas, flota);
    expect(otra.ligadas).toBe(0);
  });
  it('un fallo de escritura se dice por fila y no deja a medias el soltar', async () => {
    const filas = interpretarFilasGps(M([['ECO-1', 'wialon', '12001']])).filas;
    base.fallarProxima('unidad', 'update', { message: 'boom' });
    const r = await aplicarMapeoGps(T, filas, flota);
    expect(r.ligadas).toBe(0);
    expect(r.errores[0].motivo).toMatch(/no se pudo guardar/);
  });
});

describe('el panel: revisar y confirmar con huella', () => {
  const csv = (filas: string[][]) => new File(['﻿' + filas.map((f) => f.join(',')).join('\n')], 'gps.csv', { type: 'text/csv' });
  const fd = (archivo: File, extra: Record<string, string> = {}) => { const d = new FormData(); d.set('archivo', archivo); for (const [k, v] of Object.entries(extra)) d.set(k, v); return d; };
  it('la vista previa no escribe; confirmar exige la misma huella y escribe', async () => {
    const archivo = csv(M([['ECO-1', 'wialon', '12001'], ['ECO-9', 'wialon', '3']]));
    const prev = await mapearGpsDesdeArchivo({ tenantId: T, alcance: flota, actor: { id: 'u' }, datos: fd(archivo) });
    expect(prev).toMatchObject({ paso: 'previsualizar', nuevas: 1, conProblema: 1 });
    expect(dispositivoDe('u1')).toBeNull();
    const malo = await mapearGpsDesdeArchivo({ tenantId: T, alcance: flota, actor: { id: 'u' }, datos: fd(csv(M([['ECO-1', 'wialon', '1']])), { paso: 'confirmar', huella: prev.huella }) });
    expect(malo.error).toMatch(/cambió desde la vista previa/);
    const ok = await mapearGpsDesdeArchivo({ tenantId: T, alcance: flota, actor: { id: 'u' }, datos: fd(archivo, { paso: 'confirmar', huella: prev.huella }) });
    expect(ok).toMatchObject({ confirmado: true, nuevas: 1 });
    expect(dispositivoDe('u1')).toBe('12001');
  });
});
