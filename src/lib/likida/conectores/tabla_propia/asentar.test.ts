import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA TABLA PROPIA ENTRA POR EL MISMO ASENTADOR que Samsara y el push: misma
// compuerta de privacidad, mismo upsert idempotente, mismo sello gps_visto_en.
// Lo único distinto es cómo se LIGA la lectura a la unidad: por el número
// ECONÓMICO que la flota ya usa (normalizado), de ESA flota y solo activas.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

const UNIDADES = [
  { id: 'u-1', tenant_id: 't-1', numero_economico: 'IN-001', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-2', tenant_id: 't-1', numero_economico: 'IN-002', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-baja', tenant_id: 't-1', numero_economico: 'IN-009', activo: false, gps_proveedor: null, gps_device_id: null },
  // ambiguas: normalizan igual
  { id: 'u-a1', tenant_id: 't-1', numero_economico: 'AB-1', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-a2', tenant_id: 't-1', numero_economico: 'AB 1', activo: true, gps_proveedor: null, gps_device_id: null },
  // mapeada explícitamente por device id (gana sobre el económico)
  { id: 'u-3', tenant_id: 't-1', numero_economico: 'IN-003', activo: true, gps_proveedor: 'tabla_propia', gps_device_id: 'GPS-77' },
  // otra flota con el MISMO económico
  { id: 'u-otra', tenant_id: 't-2', numero_economico: 'IN-001', activo: true, gps_proveedor: null, gps_device_id: null },
];

let escrituras: Array<{ tabla: string; filas: unknown }> = [];
let huerfanos: Array<Record<string, unknown>> = [];
let consultasEconomico = 0;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const f: Record<string, unknown> = {};
      const filtros: Array<[string, unknown]> = [];
      let dentroDe: { col: string; vals: unknown[] } | null = null;
      let modo: 'select' | 'upsert' | 'update' = 'select';
      let payload: unknown = null;
      let rango: [number, number] | null = null;
      let columnas = '';
      const resolver = () => {
        if (modo === 'upsert') {
          if (tabla === 'gps_dispositivo_huerfano') { huerfanos.push(...(payload as Array<Record<string, unknown>>)); return { data: null, error: null }; }
          escrituras.push({ tabla, filas: payload });
          return { data: (payload as unknown[]).map((_, i) => ({ id: i })), error: null };
        }
        if (modo === 'update') return { data: null, error: null };
        if (tabla === 'unidad') {
          let filas = UNIDADES.filter((u) => filtros.every(([c, v]) => (u as Record<string, unknown>)[c] === v) && (!dentroDe || dentroDe.vals.includes((u as Record<string, unknown>)[dentroDe.col])));
          if (columnas.includes('numero_economico')) consultasEconomico += 1;
          if (rango) filas = filas.slice(rango[0], rango[1] + 1);
          return { data: filas.map((u) => ({ id: u.id, gps_device_id: u.gps_device_id, numero_economico: u.numero_economico })), error: null };
        }
        return { data: [], error: null };
      };
      Object.assign(f, {
        select: (c: string) => { columnas = c; return f; },
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return f; },
        in: (c: string, vals: unknown[]) => { dentroDe = { col: c, vals }; return f; },
        order: () => f,
        range: (a: number, b: number) => { rango = [a, b]; return f; },
        upsert: (filas: unknown) => { modo = 'upsert'; payload = filas; return f; },
        update: () => { modo = 'update'; return f; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej),
      });
      return f;
    },
  }),
}));

vi.mock('../cofre', () => ({ descifrar: (s: string) => JSON.parse(s) as Record<string, string> }));

import { sincronizarGpsDeFlota } from '../sincronizar_gps';
import type { Http } from '../tipos';

const AHORA = Date.parse('2026-10-20T13:30:00.000Z');
const CSV = (filas: string[]) => `id_unidad,latitud,longitud,fecha_hora\n${filas.join('\n')}\n`;
const cred = JSON.stringify({ modo: 'csv_sftp', base_url: 'https://datos.ejemplo.com/p.csv' });
const http = (cuerpo: string): Http => async () => ({ estado: 200, cuerpo });
const sync = (cuerpo: string, tenant = 't-1') => sincronizarGpsDeFlota(tenant, 'tabla_propia', cred, http(cuerpo), () => AHORA);

beforeEach(() => { escrituras = []; huerfanos = []; consultasEconomico = 0; });

describe('ligar por número económico', () => {
  it('«IN-001», «in 001» y «IN.001» son la misma unidad, y solo de ESA flota', async () => {
    const r = await sync(CSV(['in 001,25.5,-100.5,2026-10-20 07:20:00', 'IN.002,25.6,-100.6,2026-10-20 07:21:00']));
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ leidas: 2, guardadas: 2, huerfanas: 0 });
    const filas = escrituras[0].filas as Array<Record<string, unknown>>;
    expect(filas.map((x) => x.unidad_id).sort()).toEqual(['u-1', 'u-2']);
    expect(filas.every((x) => x.tenant_id === 't-1' && x.proveedor === 'tabla_propia')).toBe(true);
    expect(filas[0].medida_en).toBe('2026-10-20T13:20:00.000Z');
  });
  it('el mismo económico de OTRA flota no recibe la lectura', async () => {
    await sync(CSV(['IN-001,25.5,-100.5,2026-10-20 07:20:00']));
    expect((escrituras[0].filas as Array<Record<string, unknown>>).map((x) => x.unidad_id)).toEqual(['u-1']);
    escrituras = [];
    await sync(CSV(['IN-001,25.5,-100.5,2026-10-20 07:20:00']), 't-2');
    expect((escrituras[0].filas as Array<Record<string, unknown>>).map((x) => x.unidad_id)).toEqual(['u-otra']);
  });
  it('un económico AMBIGUO (dos unidades que normalizan igual) o de una unidad dada de baja NO se liga: huérfano, jamás adivinado', async () => {
    const r = await sync(CSV(['ab1,25.5,-100.5,2026-10-20 07:20:00', 'IN-009,25.5,-100.5,2026-10-20 07:21:00', 'IN-404,25.5,-100.5,2026-10-20 07:22:00', 'IN-001,25.5,-100.5,2026-10-20 07:23:00']));
    expect(r).toMatchObject({ leidas: 4, guardadas: 1, huerfanas: 3 });
    expect(huerfanos.map((h) => h.device_id).sort()).toEqual(['IN-009', 'IN-404', 'ab1']);
    expect(huerfanos.every((h) => h.proveedor === 'tabla_propia' && h.tenant_id === 't-1')).toBe(true);
    expect(huerfanos.every((h) => !('lat' in h) && !('lng' in h))).toBe(true); // se registra el id y la hora, jamás coordenadas
  });
  it('si la flota mapeó el dispositivo a mano (gps_device_id), eso gana', async () => {
    await sync(CSV(['GPS-77,25.5,-100.5,2026-10-20 07:20:00']));
    expect((escrituras[0].filas as Array<Record<string, unknown>>).map((x) => x.unidad_id)).toEqual(['u-3']);
    expect(consultasEconomico).toBe(0); // todo ligó por id: no se leyó el catálogo de económicos
  });
  it('idempotente por (flota, unidad, medida_en): el mismo asentador con ignoreDuplicates', async () => {
    const r = await sync(CSV(['IN-001,25.5,-100.5,2026-10-20 07:20:00']));
    expect(r.guardadas).toBe(1);
  });
});

describe('fallas y datos sucios', () => {
  it('filas sucias del CSV cuentan como inválidas: el poll sale PARCIAL y se dice', async () => {
    const r = await sync(CSV(['IN-001,25.5,-100.5,2026-10-20 07:20:00', 'IN-002,1,2,2026-10-20 07:21:00']));
    expect(r.guardadas).toBe(1);
    expect(r.backlog).toBe(true);
    expect(r.error).toContain('inválida');
  });
  it('credencial/mapeo roto → error con su clase de falla para el backoff', async () => {
    const r = await sync('a,b\n1,2\n');
    expect(r.error).toContain('Faltan columnas');
    expect(r.falla).toBe('formato');
    expect(escrituras).toHaveLength(0);
  });
});
