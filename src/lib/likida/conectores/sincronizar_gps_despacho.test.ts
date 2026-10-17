import { beforeEach, describe, expect, it, vi } from 'vitest';

// T-A5-13: `posicion.despacho_ref` se escribe al asentar. Mismo arnés que tabla_propia/asentar.test.ts (sin tocarlo).
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const UNIDADES = [
  { id: 'u-1', tenant_id: 't-1', numero_economico: 'UN-001', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-2', tenant_id: 't-1', numero_economico: 'UN-002', activo: true, gps_proveedor: null, gps_device_id: null },
];
let escrituras: Array<Array<Record<string, unknown>>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const f: Record<string, unknown> = {};
      const filtros: Array<[string, unknown]> = [];
      let modo: 'select' | 'upsert' | 'update' = 'select';
      let payload: unknown = null;
      const resolver = () => {
        if (modo === 'upsert') {
          if (tabla === 'posicion') escrituras.push(payload as Array<Record<string, unknown>>);
          return { data: (payload as unknown[]).map((_, i) => ({ id: i })), error: null };
        }
        if (modo === 'update') return { data: null, error: null };
        if (tabla === 'unidad') {
          const filas = UNIDADES.filter((u) => filtros.every(([c, v]) => (u as Record<string, unknown>)[c] === v));
          return { data: filas.map((u) => ({ id: u.id, gps_device_id: u.gps_device_id, numero_economico: u.numero_economico })), error: null };
        }
        return { data: [], error: null };
      };
      Object.assign(f, {
        select: () => f,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return f; },
        in: () => f,
        order: () => f,
        range: () => f,
        upsert: (filas: unknown) => { modo = 'upsert'; payload = filas; return f; },
        update: () => { modo = 'update'; return f; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej),
      });
      return f;
    },
  }),
}));
vi.mock('./cofre', () => ({ descifrar: (s: string) => JSON.parse(s) as Record<string, string> }));

import { sincronizarGpsDeFlota } from './sincronizar_gps';
import type { Http } from './tipos';

const AHORA = Date.parse('2026-10-20T13:30:00.000Z');
const cred = JSON.stringify({ modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv' });
const http = (cuerpo: string): Http => async () => ({ estado: 200, cuerpo });
const sync = (cuerpo: string) => sincronizarGpsDeFlota('t-1', 'tabla_propia', cred, http(cuerpo), () => AHORA);

beforeEach(() => { escrituras = []; });

const CON = 'unidad,lat,lon,fecha_hora,despacho\n' + [
  'UN-001,25.5600,-100.9300,2026-10-20 07:00:00,d-1',
  'UN-001,25.5601,-100.9301,2026-10-20 07:05:00,d-1',
  'UN-002,25.5602,-100.9302,2026-10-20 07:10:00,Icid 2',
  'UN-002,25.5603,-100.9303,2026-10-20 07:15:00,',
].join('\n') + '\n';
const SIN = 'unidad,lat,lon,fecha_hora\n' + [
  'UN-001,25.5600,-100.9300,2026-10-20 07:00:00',
  'UN-001,25.5601,-100.9301,2026-10-20 07:05:00',
  'UN-002,25.5602,-100.9302,2026-10-20 07:10:00',
  'UN-002,25.5603,-100.9303,2026-10-20 07:15:00',
].join('\n') + '\n';

describe('asentar con despacho_ref', () => {
  it('la referencia llega a `posicion.despacho_ref` normalizada; la fila sin valor no lleva la llave', async () => {
    const r = await sync(CON);
    expect(r.error).toBeUndefined();
    const filas = escrituras[0];
    expect(filas.map((x) => x.despacho_ref)).toEqual(['D-1', 'D-1', 'ICID2', undefined]);
    expect(filas[3]).not.toHaveProperty('despacho_ref');
  });
  it('sin la columna: ninguna fila lleva despacho_ref y el conteo guardado es el MISMO', async () => {
    const con = await sync(CON);
    const conFilas = escrituras[0];
    escrituras = [];
    const sin = await sync(SIN);
    expect(escrituras[0].every((x) => !('despacho_ref' in x))).toBe(true);
    expect(sin).toMatchObject({ leidas: con.leidas, guardadas: con.guardadas, huerfanas: con.huerfanas });
    // La idempotencia sigue siendo (flota, unidad, medida_en): mismas claves en ambas versiones.
    const clave = (x: Record<string, unknown>) => `${x.tenant_id}|${x.unidad_id}|${x.medida_en}|${x.proveedor}`;
    expect(escrituras[0].map(clave)).toEqual(conFilas.map(clave));
  });
});
