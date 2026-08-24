import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// EL POLLER: que asiente la posición en LA UNIDAD CORRECTA, o en ninguna.
//
// `supabaseAdmin` salta RLS, así que aquí el aislamiento entre flotas no lo
// pone la base: lo pone el `.eq('tenant_id')` de esta función. La "base" de
// esta prueba lo aplica DE VERDAD — si alguien borra ese filtro, la lectura de
// una flota se asienta en el camión de otra y la prueba lo dice.
//
// Lo otro que se prueba es lo que NO hace: una lectura cuyo dispositivo no lo
// reclama ninguna unidad se cuenta como huérfana y se reporta. No se da de alta
// un camión desde un feed ajeno — así se llenan las bases de vehículos fantasma.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (q: unknown) => q }));

/** Lo que la "base" tiene: unidades por flota. */
const UNIDADES = [
  { id: 'u-1', tenant_id: 't-1', gps_proveedor: 'samsara', gps_device_id: '1234' },
  { id: 'u-2', tenant_id: 't-1', gps_proveedor: 'samsara', gps_device_id: '5678' },
  // El MISMO número de dispositivo, otra flota. Sin el filtro por tenant, la
  // lectura de t-1 podría aterrizar aquí.
  { id: 'u-otro', tenant_id: 't-2', gps_proveedor: 'samsara', gps_device_id: '1234' },
];

interface Escritura { tabla: string; filas: unknown; opciones: unknown }
let escrituras: Escritura[] = [];
let sellos: Array<{ ids: unknown; tenant: unknown; valores: Record<string, unknown> }> = [];
let credenciales: Array<Record<string, unknown>> = [];
let filtroProveedores: string[] | null = null;
let errorUnidades: { message: string } | null = null;
let errorInsert: { message: string } | null = null;
let errorCredenciales: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const f: Record<string, unknown> = {};
      const filtros: Array<[string, unknown]> = [];
      let dentroDe: { col: string; vals: unknown[] } | null = null;
      let modo: 'select' | 'upsert' | 'update' = 'select';
      let payload: unknown = null;
      let opciones: unknown = null;

      const resolver = () => {
        if (tabla === 'unidad' && modo === 'update') {
          sellos.push({
            ids: dentroDe?.vals,
            tenant: filtros.find(([c]) => c === 'tenant_id')?.[1],
            valores: payload as Record<string, unknown>,
          });
          return { data: null, error: null };
        }
        if (modo === 'upsert') {
          if (errorInsert) return { data: null, error: errorInsert };
          escrituras.push({ tabla, filas: payload, opciones });
          return { data: null, error: null };
        }
        if (tabla === 'unidad') {
          if (errorUnidades) return { data: null, error: errorUnidades };
          const filas = UNIDADES.filter((u) =>
            filtros.every(([c, v]) => (u as Record<string, unknown>)[c] === v) &&
            (!dentroDe || dentroDe.vals.includes((u as Record<string, unknown>)[dentroDe.col])),
          );
          return { data: filas.map((u) => ({ id: u.id, gps_device_id: u.gps_device_id })), error: null };
        }
        if (tabla === 'conector_credencial') {
          filtroProveedores = (dentroDe?.vals as string[]) ?? null;
          return { data: errorCredenciales ? null : credenciales, error: errorCredenciales };
        }
        return { data: [], error: null };
      };

      Object.assign(f, {
        select: () => f,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return f; },
        in: (c: string, vals: unknown[]) => { dentroDe = { col: c, vals }; return f; },
        upsert: (filas: unknown, opts: unknown) => { modo = 'upsert'; payload = filas; opciones = opts; return f; },
        update: (v: unknown) => { modo = 'update'; payload = v; return f; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(resolver()).then(res, rej),
      });
      return f;
    },
  }),
}));

/** El cofre real necesita la llave del entorno; aquí el sobre es texto plano
 *  salvo cuando dice `ROTO`, que es como se prueba el camino de la credencial
 *  ilegible. */
vi.mock('./cofre', () => ({
  descifrar: (s: string) => {
    if (s === 'ROTO') throw new Error('llave equivocada');
    return JSON.parse(s) as Record<string, string>;
  },
}));

import { sincronizarGpsDeFlota, sincronizarGpsTodas } from './sincronizar_gps';
import { LECTORES_POSICION } from './posiciones';
import type { Http } from './tipos';

const CRED = JSON.stringify({ token: 'tok' });

const cuerpoSamsara = (vehiculos: Array<{ id: string; lat: number; lng: number; t: string }>) =>
  JSON.stringify({
    data: vehiculos.map((v) => ({ id: v.id, gps: { latitude: v.lat, longitude: v.lng, time: v.t } })),
  });

const httpQue = (estado: number, cuerpo: string): Http => async () => ({ estado, cuerpo });

beforeEach(() => {
  escrituras = []; sellos = []; credenciales = []; filtroProveedores = null;
  errorUnidades = null; errorInsert = null; errorCredenciales = null;
});

describe('la posición aterriza en la unidad correcta, o en ninguna', () => {
  it('liga cada lectura con la unidad de ESA flota', async () => {
    const http = httpQue(200, cuerpoSamsara([
      { id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' },
      { id: '5678', lat: 21.1, lng: -86.8, t: '2026-08-23T18:01:00Z' },
    ]));
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(r.error).toBeUndefined();
    expect(r.leidas).toBe(2);
    expect(r.guardadas).toBe(2);
    expect(r.huerfanas).toBe(0);
    const filas = escrituras[0].filas as Array<Record<string, unknown>>;
    expect(filas.map((f) => f.unidad_id).sort()).toEqual(['u-1', 'u-2']);
    expect(filas.every((f) => f.tenant_id === 't-1')).toBe(true);
  });

  it('el dispositivo 1234 de OTRA flota no recibe la lectura de esta', async () => {
    // Si alguien quitara el `.eq('tenant_id')`, `u-otro` entraría en el mapa y
    // la posición de t-1 se asentaría en el camión de t-2.
    const http = httpQue(200, cuerpoSamsara([{ id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    const filas = escrituras[0].filas as Array<Record<string, unknown>>;
    expect(filas.map((f) => f.unidad_id)).toEqual(['u-1']);
    expect(filas.map((f) => f.unidad_id)).not.toContain('u-otro');
  });

  it('un dispositivo que ninguna unidad reclama se cuenta HUÉRFANO — no se inventa el camión', async () => {
    const http = httpQue(200, cuerpoSamsara([
      { id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' },
      { id: 'nadie-lo-tiene', lat: 19.4, lng: -99.1, t: '2026-08-23T18:00:00Z' },
    ]));
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(r.huerfanas).toBe(1);
    expect(r.guardadas).toBe(1);
    const filas = escrituras[0].filas as Array<Record<string, unknown>>;
    expect(filas).toHaveLength(1);
  });
});

describe('la idempotencia y el sello', () => {
  it('escribe con `on conflict … ignoreDuplicates`: la misma última posición no es un error', async () => {
    const http = httpQue(200, cuerpoSamsara([{ id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(escrituras[0].opciones).toEqual({
      onConflict: 'tenant_id,unidad_id,medida_en', ignoreDuplicates: true,
    });
  });

  it('sella `gps_visto_en` SOLO de las unidades que llegaron, y dentro de la flota', async () => {
    const http = httpQue(200, cuerpoSamsara([{ id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(sellos).toHaveLength(1);
    expect(sellos[0].ids).toEqual(['u-1']);
    expect(sellos[0].tenant).toBe('t-1');
    expect(sellos[0].valores.gps_visto_en).toBeTypeOf('string');
  });

  it('sin posiciones no escribe NADA, ni sella', async () => {
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, httpQue(200, cuerpoSamsara([])));
    expect(r.leidas).toBe(0);
    expect(escrituras).toHaveLength(0);
    expect(sellos).toHaveLength(0);
  });

  it('todas huérfanas: tampoco sella una unidad que no llegó', async () => {
    const http = httpQue(200, cuerpoSamsara([{ id: 'nadie', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(r.huerfanas).toBe(1);
    expect(escrituras).toHaveLength(0);
    expect(sellos).toHaveLength(0);
  });
});

describe('los fallos se declaran, no se tragan', () => {
  it('un proveedor sin lector se dice por su nombre', async () => {
    const r = await sincronizarGpsDeFlota('t-1', 'wialon', CRED, httpQue(200, '{}'));
    expect(r.error).toContain('wialon');
    expect(r.guardadas).toBe(0);
  });

  it('una credencial que no descifra no revienta la corrida', async () => {
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', 'ROTO', httpQue(200, '{}'));
    expect(r.error).toContain('descifrar');
    expect(escrituras).toHaveLength(0);
  });

  it('401 del proveedor se propaga y no se escribe nada', async () => {
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, httpQue(401, ''));
    expect(r.error).toContain('401');
    expect(escrituras).toHaveLength(0);
  });

  it('si la lectura de unidades falla, NO se escribe a ciegas', async () => {
    errorUnidades = { message: 'conexión caída' };
    const http = httpQue(200, cuerpoSamsara([{ id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(r.error).toContain('unidades');
    expect(escrituras).toHaveLength(0);
    expect(sellos).toHaveLength(0);
  });

  it('si el insert falla, no se sella `gps_visto_en`: la fuente NO está entrando', async () => {
    errorInsert = { message: 'se cayó' };
    const http = httpQue(200, cuerpoSamsara([{ id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    const r = await sincronizarGpsDeFlota('t-1', 'samsara', CRED, http);
    expect(r.error).toContain('guardar');
    expect(sellos).toHaveLength(0);
  });
});

describe('la corrida de todas las flotas', () => {
  it('pide credenciales SOLO de los proveedores que hoy tienen lector', async () => {
    await sincronizarGpsTodas(httpQue(200, cuerpoSamsara([])));
    expect(filtroProveedores).toEqual(Object.keys(LECTORES_POSICION));
  });

  it('una flota con el token vencido no deja sin posiciones a las demás', async () => {
    credenciales = [
      { tenant_id: 't-1', conector_id: 'samsara', valores_cifrados: 'ROTO' },
      { tenant_id: 't-1', conector_id: 'samsara', valores_cifrados: CRED },
    ];
    const http = httpQue(200, cuerpoSamsara([{ id: '1234', lat: 20.9, lng: -89.5, t: '2026-08-23T18:00:00Z' }]));
    const r = await sincronizarGpsTodas(http);
    expect(r).toHaveLength(2);
    expect(r[0].error).toContain('descifrar');
    expect(r[1].error).toBeUndefined();
    expect(r[1].guardadas).toBe(1);
  });

  it('si NO se puede leer el universo de credenciales, falla el cron: [] sería un verde falso', async () => {
    errorCredenciales = { message: 'db down' };
    await expect(sincronizarGpsTodas(httpQue(200, cuerpoSamsara([])))).rejects.toThrow('gps.credenciales');
  });
});
