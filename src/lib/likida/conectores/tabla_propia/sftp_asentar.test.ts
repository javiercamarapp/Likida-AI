import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// El CSV que llega por SFTP entra por el MISMO asentador que el de https: se liga
// por número económico SOLO a unidades de ESA flota. Un CSV que trae unidades de
// OTRA flota (el servidor del cliente puede mezclar las suyas) no asienta nada
// ajeno: quedan como huérfanas (id y hora, jamás coordenadas).
// El cliente SFTP se sustituye en el módulo `./sftp` para que el camino completo
// (cron → asentador → lector → `crearClienteSftp()`) corra sin red.
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

let contenido = '';
let error: Error | null = null;
const peticiones: unknown[] = [];
vi.mock('./sftp', async (original) => ({
  ...(await original<typeof import('./sftp')>()),
  crearClienteSftp: () => ({ leerArchivo: async (d: unknown) => { peticiones.push(d); if (error) throw error; return contenido; } }),
}));

import { sincronizarGpsDeFlota } from '../sincronizar_gps';
import type { Http } from '../tipos';
import { ErrorTablaPropia } from './contrato';

const AHORA = Date.parse('2026-10-20T13:30:00.000Z');
const cred = JSON.stringify({ modo: 'csv_sftp', base_url: 'sftp://s.ejemplo.com/p.csv', nombre_campo: 'likida', token: 'clave-secreta-99', huella_host: 'SHA256:' + 'A'.repeat(43) });
const sinHttp: Http = async () => { throw new Error('no debe usar http'); };
const sync = (tenant = 't-1') => sincronizarGpsDeFlota(tenant, 'tabla_propia', cred, sinHttp, () => AHORA);
const CSV = (filas: string[]) => `id_unidad,latitud,longitud,fecha_hora\n${filas.join('\n')}\n`;

beforeEach(() => { escrituras = []; huerfanos = []; contenido = ''; error = null; peticiones.length = 0; });

describe('SFTP → asentador', () => {
  it('asienta las unidades de la flota y deja como huérfanas las de otra (nunca asienta en otra flota)', async () => {
    contenido = CSV(['IN-001,25.5,-100.5,2026-10-20 07:20:00', 'OT-777,25.6,-100.6,2026-10-20 07:21:00']);
    const r = await sync('t-1');
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ leidas: 2, guardadas: 1, huerfanas: 1 });
    expect((escrituras[0].filas as Array<Record<string, unknown>>).map((x) => `${x.tenant_id}:${x.unidad_id}`)).toEqual(['t-1:u-1']);
    expect(huerfanos.map((h) => h.device_id)).toEqual(['OT-777']);
    expect(huerfanos.every((h) => h.tenant_id === 't-1' && !('lat' in h) && !('lng' in h))).toBe(true);
    expect(peticiones).toHaveLength(1);
  });
  it('la falla del servidor llega con su clase y SIN secretos al resultado del poll', async () => {
    error = new ErrorTablaPropia('El servidor SFTP rechazó el usuario o la credencial (contraseña o llave).', 'credencial');
    const r = await sync();
    expect(r.falla).toBe('credencial');
    expect(escrituras).toHaveLength(0);
    expect(JSON.stringify(r)).not.toContain('clave-secreta-99');
  });
  it('un error inesperado del cliente tampoco filtra secretos', async () => {
    error = new Error('revienta con clave-secreta-99');
    const r = await sync();
    expect(r.falla).toBe('proveedor');
    expect(JSON.stringify(r)).not.toContain('clave-secreta-99');
  });
});
