import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// La vista SQL entra por el MISMO asentador que el CSV y los proveedores: se liga por número económico SOLO a unidades
// de ESA flota. Si la vista del cliente trae unidades de OTRA flota no se asienta nada ajeno: quedan como huérfanas
// (id y hora, jamás coordenadas). El ejecutor real de PostgreSQL se sustituye en `./sql` para correr el camino
// completo (cron → asentador → lector → ejecutor) sin red.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const UNIDADES = [
  { id: 'u-1', tenant_id: 't-1', numero_economico: 'IN-001', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-otra', tenant_id: 't-2', numero_economico: 'OT-777', activo: true, gps_proveedor: null, gps_device_id: null },
];
let escrituras: Array<{ tabla: string; filas: unknown }> = [];
let huerfanos: Array<Record<string, unknown>> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const f: Record<string, unknown> = {};
      const filtros: Array<[string, unknown]> = [];
      let dentroDe: { col: string; vals: unknown[] } | null = null;
      let modo: 'select' | 'upsert' | 'update' = 'select';
      let payload: unknown = null;
      const resolver = () => {
        if (modo === 'upsert') {
          if (tabla === 'gps_dispositivo_huerfano') { huerfanos.push(...(payload as Array<Record<string, unknown>>)); return { data: null, error: null }; }
          escrituras.push({ tabla, filas: payload });
          return { data: (payload as unknown[]).map((_, i) => ({ id: i })), error: null };
        }
        if (modo === 'update') return { data: null, error: null };
        if (tabla === 'unidad') {
          const filas = UNIDADES.filter((u) => filtros.every(([c, v]) => (u as Record<string, unknown>)[c] === v) && (!dentroDe || dentroDe.vals.includes((u as Record<string, unknown>)[dentroDe.col])));
          return { data: filas.map((u) => ({ id: u.id, gps_device_id: u.gps_device_id, numero_economico: u.numero_economico })), error: null };
        }
        return { data: [], error: null };
      };
      Object.assign(f, {
        select: () => f,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return f; },
        in: (c: string, vals: unknown[]) => { dentroDe = { col: c, vals }; return f; },
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
vi.mock('../cofre', () => ({ descifrar: (s: string) => JSON.parse(s) as Record<string, string> }));

let filasVista: Array<Record<string, string>> = [];
let error: Error | null = null;
const consultas: Array<{ text: string; values: unknown[] }> = [];
vi.mock('./sql', async (original) => ({
  ...(await original<typeof import('./sql')>()),
  crearEjecutorPg: () => ({ ejecutar: async (c: { text: string; values: unknown[] }) => { consultas.push({ text: c.text, values: c.values }); if (error) throw error; return filasVista; } }),
}));

import { sincronizarGpsDeFlota } from '../sincronizar_gps';
import type { Http } from '../tipos';
import { ErrorTablaPropia } from './contrato';

const AHORA = Date.parse('2026-10-20T13:30:00.000Z');
const cred = JSON.stringify({
  modo: 'sql_solo_lectura', sql_host: 'replica.cliente.mx', sql_base: 'flota', sql_usuario: 'likida_lectura', sql_clave: 'clave-sql-secreta-99',
  vista: 'public.v_posiciones', columnas: '{"unidad":"eco","lat":"lat","lon":"lon","fecha_hora":"ts"}',
});
const sinHttp: Http = async () => { throw new Error('no debe usar http'); };
const sync = (tenant = 't-1') => sincronizarGpsDeFlota(tenant, 'tabla_propia', cred, sinHttp, () => AHORA);

beforeEach(() => { escrituras = []; huerfanos = []; filasVista = []; error = null; consultas.length = 0; });

describe('SQL → asentador', () => {
  it('asienta las unidades de la flota y deja como huérfanas las de otra (nunca asienta en otra flota)', async () => {
    filasVista = [
      { unidad: 'IN-001', lat: '25.5', lon: '-100.5', fecha_hora: '2026-10-20 07:20:00' },
      { unidad: 'OT-777', lat: '25.6', lon: '-100.6', fecha_hora: '2026-10-20 07:21:00' },
    ];
    const r = await sync('t-1');
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ leidas: 2, guardadas: 1, huerfanas: 1 });
    expect((escrituras[0].filas as Array<Record<string, unknown>>).map((x) => `${x.tenant_id}:${x.unidad_id}`)).toEqual(['t-1:u-1']);
    expect(huerfanos.map((h) => h.device_id)).toEqual(['OT-777']);
    expect(huerfanos.every((h) => h.tenant_id === 't-1' && !('lat' in h) && !('lng' in h))).toBe(true);
    expect(consultas).toHaveLength(1);
    expect(consultas[0].text).toMatch(/^select .* from "public"\."v_posiciones" where "ts" >= \$1::timestamp order by "ts" desc limit 50000$/);
  });
  it('la falla del servidor llega con su clase y SIN secretos al resultado del poll', async () => {
    error = new ErrorTablaPropia('el servidor SQL rechazó el usuario o la contraseña', 'credencial');
    const r = await sync();
    expect(r.falla).toBe('credencial');
    expect(escrituras).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('clave-sql-secreta-99');
  });
  it('un error inesperado del ejecutor tampoco filtra secretos', async () => {
    error = new Error('revienta con clave-sql-secreta-99');
    const r = await sync();
    expect(r.falla).toBe('proveedor');
    expect(JSON.stringify(r)).not.toContain('clave-sql-secreta-99');
  });
});
