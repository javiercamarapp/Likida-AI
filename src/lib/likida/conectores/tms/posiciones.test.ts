import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// T-TMS-10 — lector de posiciones con `Icident` → asentarLecturas. Todo sintético: unidades, Icident y
// coordenadas inventados. Ninguna prueba duerme de verdad. La base se simula en memoria; el asentador es el
// REAL (`asentarLecturas`), para probar que el lector le entrega lo que su ruta única espera.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../presupuesto', () => ({ acotada: (q: unknown) => q }));

interface FilaPos { tenant_id: string; unidad_id: string; medida_en: string; proveedor: string; despacho_ref: string | null; lat: number }
const UNIDADES = [
  { id: 'u-1', tenant_id: 't-1', numero_economico: 'UNI-101', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-2', tenant_id: 't-1', numero_economico: 'UNI-102', activo: true, gps_proveedor: null, gps_device_id: null },
  { id: 'u-otra', tenant_id: 't-2', numero_economico: 'UNI-101', activo: true, gps_proveedor: null, gps_device_id: null },
];
let posiciones: FilaPos[] = [];
let updates: Array<{ valores: Record<string, unknown>; filtros: Array<[string, unknown]> }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const f: Record<string, unknown> = {};
      const filtros: Array<[string, unknown]> = [];
      let dentroDe: { col: string; vals: unknown[] } | null = null;
      let soloNulos: string | null = null;
      let modo: 'select' | 'upsert' | 'update' = 'select';
      let payload: unknown = null;
      let rango: [number, number] | null = null;
      const resolver = () => {
        if (modo === 'upsert' && tabla === 'posicion') {
          // Equivale al índice único (tenant, unidad, medida_en) con ignoreDuplicates.
          const nuevas: unknown[] = [];
          for (const x of payload as Array<Record<string, unknown>>) {
            if (posiciones.some((p) => p.tenant_id === x.tenant_id && p.unidad_id === x.unidad_id && p.medida_en === x.medida_en)) continue;
            posiciones.push({ ...(x as unknown as FilaPos), despacho_ref: null });
            nuevas.push({ id: nuevas.length });
          }
          return { data: nuevas, error: null };
        }
        if (modo === 'update' && tabla === 'posicion') {
          updates.push({ valores: payload as Record<string, unknown>, filtros: [...filtros, ...(dentroDe ? [[dentroDe.col, dentroDe.vals] as [string, unknown]] : [])] });
          const tocadas = posiciones.filter((p) => filtros.every(([c, v]) => (p as unknown as Record<string, unknown>)[c] === v)
            && (!dentroDe || dentroDe.vals.includes((p as unknown as Record<string, unknown>)[dentroDe.col]))
            && (soloNulos === null || (p as unknown as Record<string, unknown>)[soloNulos] === null));
          for (const p of tocadas) Object.assign(p, payload);
          return { data: tocadas.map((_, i) => ({ id: i })), error: null };
        }
        if (modo === 'update' || modo === 'upsert') return { data: null, error: null };
        if (tabla === 'unidad') {
          let filas = UNIDADES.filter((u) => filtros.every(([c, v]) => (u as Record<string, unknown>)[c] === v) && (!dentroDe || dentroDe.vals.includes((u as Record<string, unknown>)[dentroDe.col])));
          if (rango) filas = filas.slice(rango[0], rango[1] + 1);
          return { data: filas.map((u) => ({ id: u.id, gps_device_id: u.gps_device_id, numero_economico: u.numero_economico })), error: null };
        }
        return { data: [], error: null };
      };
      Object.assign(f, {
        select: () => f,
        eq: (c: string, v: unknown) => { filtros.push([c, v]); return f; },
        in: (c: string, vals: unknown[]) => { dentroDe = { col: c, vals }; return f; },
        is: (c: string) => { soloNulos = c; return f; },
        order: () => f,
        range: (a: number, b: number) => { rango = [a, b]; return f; },
        upsert: (filas: unknown) => { modo = 'upsert'; payload = filas; return f; },
        update: (valores: unknown) => { modo = 'update'; payload = valores; return f; },
        then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej),
      });
      return f;
    },
  }),
}));

import type { Http } from '../tipos';
import { validarMapeo } from './mapeo';
import { SesionTms } from './sesion';
import {
  asentarDespachoRef, asentarPosicionesTms, leerPosiciones, lectorPosiciones, MAPEO_POSICIONES_SUPUESTO, PROVEEDOR_TMS_POSICIONES,
} from './posiciones';

const BASE = 'https://tms.ejemplo.test';
const LOGIN = { ruta: '/api/login', cuerpo: { usuario: '{usuario}', clave: '{clave}' }, campo_token: 'token' };
const CRED = { usuario: 'usuario-sintetico', clave: 'clave-sintetica' };
const RELOJ = { ahora: () => 1_000_000, dormir: async () => undefined };
const VENTANA = { desde: '2026-03-01T00:00:00.000Z', hasta: '2026-03-31T23:59:59.000Z' };
const sesionDe = (http: Http) => new SesionTms({ http, base: BASE, login: LOGIN, credenciales: CRED, reloj: RELOJ });

type Cruda = Record<string, unknown>;
const p = (n: number, extra: Cruda = {}): Cruda => ({
  Icident: `SINT-${String(1 + (n % 5)).padStart(4, '0')}`, unidad: 'UNI-101', latitud: 19.4 + (n % 100) / 1000, longitud: -99.1 - (n % 100) / 1000,
  fecha: new Date(Date.UTC(2026, 2, 10, 0, 0, 0) + n * 60_000).toISOString(), ...extra,
});

/** Origen mínimo: login + lista paginada por página en /api/posiciones. */
function origen(todas: Cruda[], tam = 1000) {
  const pedidas: number[] = [];
  const http: Http = async (pet) => {
    const u = new URL(pet.url);
    if (u.pathname === '/api/login') return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 'tok-sintetico' }) };
    const pagina = Number(u.searchParams.get('pagina') ?? 1);
    pedidas.push(pagina);
    const items = todas.slice((pagina - 1) * tam, pagina * tam);
    return { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ data: { items } }) };
  };
  return { http, pedidas };
}

beforeEach(() => { posiciones = []; updates = []; });

describe('leerPosiciones', () => {
  it('el mapeo supuesto es válido y declara la zona de las fechas sin zona', () => {
    expect(validarMapeo(MAPEO_POSICIONES_SUPUESTO)).toEqual([]);
    expect(MAPEO_POSICIONES_SUPUESTO.recurso).toBe('posiciones');
  });

  it('2 000 posiciones sintéticas llegan completas en 2 páginas (más la vacía que marca el final)', async () => {
    const o = origen(Array.from({ length: 2000 }, (_, i) => p(i)), 1000);
    const r = await leerPosiciones(sesionDe(o.http), VENTANA, { paginacion: { tipo: 'pagina', tamano: 1000 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.filas).toHaveLength(2000);
    expect(r.completa).toBe(true);
    expect(o.pedidas).toEqual([1, 2, 3]);
    expect(r.descartadasPorCoordenada).toBe(0);
    expect(r.filas[0]).toMatchObject({ deviceId: 'UNI-101', despacho_ref: 'SINT-0001', velocidad: null, rumbo: null });
  });

  it('coordenada fuera de rango o (0,0) se descarta y se CUENTA, no se pierde en silencio', async () => {
    const o = origen([p(1), p(2, { latitud: 95 }), p(3, { longitud: -200 }), p(4, { latitud: 0, longitud: 0 }), p(5)]);
    const r = await leerPosiciones(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas).toHaveLength(2);
    expect(r.descartadasPorCoordenada).toBe(3);
    expect(r.avisos.join(' ')).toContain('3 posición(es) con coordenadas inválidas');
  });

  it('una fila sin latitud o sin unidad se rechaza con motivo (no es una coordenada descartada)', async () => {
    const sinLat = p(2); delete sinLat.latitud;
    const o = origen([p(1), sinLat, p(3, { unidad: '' })]);
    const r = await leerPosiciones(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas).toHaveLength(1);
    expect(r.rechazadas).toHaveLength(2);
    expect(r.rechazadas.map((x) => x.motivo).join(' ')).toMatch(/latitud/);
    expect(r.rechazadas.map((x) => x.motivo).join(' ')).toMatch(/unidad/);
  });

  it('fecha local con segundos: 08:05:09 hora de México es 14:05:09 UTC; una fecha con Z no se mueve', async () => {
    const o = origen([p(1, { fecha: '2026-03-10 08:05:09' }), p(2, { fecha: '2026-03-10T14:06:10.000Z' })]);
    const r = await leerPosiciones(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas.map((x) => x.medidaEn)).toEqual(['2026-03-10T14:05:09.000Z', '2026-03-10T14:06:10.000Z']);
  });

  it('`despacho_ref` solo viaja si el origen lo trajo', async () => {
    const sinIcident = p(2); delete sinIcident.Icident;
    const o = origen([p(1), sinIcident, p(3, { Icident: '' })]);
    const r = await leerPosiciones(sesionDe(o.http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.filas).toHaveLength(3);
    expect(r.filas[0].despacho_ref).toBe('SINT-0002');
    expect('despacho_ref' in r.filas[1]).toBe(false);
    expect('despacho_ref' in r.filas[2]).toBe(false);
  });

  it('cursor incremental: tras una lectura completa avanza a la última medida_en; con backlog se conserva', async () => {
    const todas = Array.from({ length: 30 }, (_, i) => p(i));
    const completa = await leerPosiciones(sesionDe(origen(todas, 10).http), VENTANA, { paginacion: { tipo: 'pagina', tamano: 10 } });
    if (!completa.ok) throw new Error(completa.motivo);
    expect(completa.completa).toBe(true);
    expect(completa.cursor).toBe(todas[29].fecha);

    const parcial = await leerPosiciones(sesionDe(origen(todas, 10).http), VENTANA, { paginacion: { tipo: 'pagina', tamano: 10 }, maxPaginas: 1 });
    if (!parcial.ok) throw new Error(parcial.motivo);
    expect(parcial.backlog).toBe(true);
    expect(parcial.completa).toBe(false);
    expect(parcial.cursor).toBe(VENTANA.desde); // no se adelanta: las páginas sin leer podrían traer instantes anteriores
    expect(parcial.reanudar).toEqual({ tipo: 'pagina', pagina: 2 });
  });

  it('una lectura completa sin filas conserva el cursor recibido', async () => {
    const r = await leerPosiciones(sesionDe(origen([]).http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    expect(r.cursor).toBe(VENTANA.desde);
  });

  it('el adaptador LectorTms entrega las filas y lanza si el origen falla', async () => {
    const ok = lectorPosiciones(sesionDe(origen([p(1), p(2)]).http));
    const l = await ok.leer(VENTANA.desde, VENTANA.hasta);
    expect(ok.recurso).toBe('posiciones');
    expect(l.filas).toHaveLength(2);
    const mal: Http = async (pet) => new URL(pet.url).pathname === '/api/login'
      ? { estado: 200, encabezados: {}, cuerpo: JSON.stringify({ token: 't' }) }
      : { estado: 200, encabezados: {}, cuerpo: 'no es json' };
    await expect(lectorPosiciones(sesionDe(mal)).leer(VENTANA.desde, VENTANA.hasta)).rejects.toThrow();
  });
});

describe('asentarPosicionesTms (ruta única de escritura)', () => {
  const lectura = async (filas: Cruda[]) => {
    const r = await leerPosiciones(sesionDe(origen(filas).http), VENTANA);
    if (!r.ok) throw new Error(r.motivo);
    return r;
  };

  it('asienta por la ruta única ligando por número económico, de ESA flota, y estampa despacho_ref', async () => {
    const l = await lectura([p(1), p(2, { unidad: 'uni 102', Icident: 'SINT-0009' })]);
    const r = await asentarPosicionesTms('t-1', l, { ahora: () => Date.parse('2026-10-20T00:00:00.000Z') });
    expect(r).toMatchObject({ leidas: 2, guardadas: 2, huerfanas: 0 });
    expect(r.despachoRef).toMatchObject({ actualizadas: 2, sinUnidad: 0 });
    expect(posiciones.map((x) => [x.unidad_id, x.proveedor, x.despacho_ref])).toEqual([
      ['u-1', PROVEEDOR_TMS_POSICIONES, 'SINT-0002'], ['u-2', PROVEEDOR_TMS_POSICIONES, 'SINT-0009'],
    ]);
    expect(posiciones.every((x) => x.tenant_id === 't-1')).toBe(true);
  });

  it('misma posición re-leída → 0 nuevas y no se duplica ni se pisa la referencia', async () => {
    const l = await lectura([p(1), p(2)]);
    const opciones = { ahora: () => Date.parse('2026-10-20T00:00:00.000Z') };
    const primera = await asentarPosicionesTms('t-1', l, opciones);
    expect(primera.guardadas).toBe(2);
    const segunda = await asentarPosicionesTms('t-1', l, opciones);
    expect(segunda.guardadas).toBe(0);
    expect(segunda.despachoRef.actualizadas).toBe(0); // ya estaba asentada
    expect(posiciones).toHaveLength(2);
    // Una referencia distinta en la relectura no pisa la ya asentada.
    const otra = await lectura([p(1, { Icident: 'OTRO-0001' })]);
    await asentarPosicionesTms('t-1', otra, opciones);
    expect(posiciones[0].despacho_ref).toBe('SINT-0002');
  });

  it('sin referencia no se hace ningún update (despacho_ref solo si viene)', async () => {
    const sin = p(1); delete sin.Icident;
    const l = await lectura([sin]);
    const r = await asentarPosicionesTms('t-1', l, { ahora: () => Date.parse('2026-10-20T00:00:00.000Z') });
    expect(r.guardadas).toBe(1);
    expect(updates).toHaveLength(0);
    expect(posiciones[0].despacho_ref).toBeNull();
  });

  it('un económico que no existe en la flota es huérfano (no se inventa unidad) y no recibe referencia', async () => {
    const l = await lectura([p(1, { unidad: 'NO-EXISTE' }), p(2)]);
    const r = await asentarPosicionesTms('t-1', l, { ahora: () => Date.parse('2026-10-20T00:00:00.000Z') });
    expect(r).toMatchObject({ leidas: 2, guardadas: 1, huerfanas: 1 });
    expect(r.despachoRef).toMatchObject({ actualizadas: 1, sinUnidad: 1 });
  });

  it('el update de despacho_ref siempre va acotado a la flota y a unidad+instante, nunca a toda la tabla', async () => {
    const l = await lectura([p(1), p(2)]);
    await asentarPosicionesTms('t-1', l, { ahora: () => Date.parse('2026-10-20T00:00:00.000Z') });
    expect(updates.length).toBeGreaterThan(0);
    for (const u of updates) {
      const cols = u.filtros.map(([c]) => c);
      expect(cols).toEqual(expect.arrayContaining(['tenant_id', 'unidad_id', 'medida_en']));
      expect(u.filtros.find(([c]) => c === 'tenant_id')?.[1]).toBe('t-1');
    }
  });

  it('las coordenadas inválidas descartadas al leer se suman al conteo del asentador sin tumbar el lote', async () => {
    const l = await lectura([p(1), p(2, { latitud: 95 })]);
    expect(l.descartadasPorCoordenada).toBe(1);
    const r = await asentarPosicionesTms('t-1', l, { ahora: () => Date.parse('2026-10-20T00:00:00.000Z') });
    expect(r.guardadas).toBe(1);
    expect(r.descartadas).toBe(1);
    expect(r.error).toBeUndefined();
  });

  it('si el asentador falla antes de guardar nada, no se intenta estampar la referencia', async () => {
    const l = await lectura([p(1)]);
    const despachoRef = vi.fn(async () => ({ actualizadas: 0, sinUnidad: 0 }));
    const r = await asentarPosicionesTms('t-1', l, {}, {
      asentar: async () => ({ tenantId: 't-1', proveedor: PROVEEDOR_TMS_POSICIONES, leidas: 1, guardadas: 0, huerfanas: 0, error: 'sin base' }),
      despachoRef,
    });
    expect(r.error).toBe('sin base');
    expect(despachoRef).not.toHaveBeenCalled();
  });

  it('asentarDespachoRef sin lecturas con referencia no toca la base', async () => {
    const r = await asentarDespachoRef('t-1', [{ deviceId: 'UNI-101', lat: 19.4, lng: -99.1, medidaEn: '2026-03-10T00:00:00.000Z', velocidad: null, rumbo: null }]);
    expect(r).toEqual({ actualizadas: 0, sinUnidad: 0 });
    expect(updates).toHaveLength(0);
  });
});
