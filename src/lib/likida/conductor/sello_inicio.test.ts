import { describe, expect, it, vi, beforeEach } from 'vitest';
import { decidirSelloInicio, hayFotoDeSello, mensajeEvidencia, mensajeSelloInicio, type EvidenciaSelloFila } from './evidencia';
import { CONFIG_CONDUCTOR_DEFAULT } from './config';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
interface Registro { tabla: string; ops: Array<[string, ...unknown[]]> }
const registros: Registro[] = [];
let respuestas: Respuesta[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const reg: Registro = { tabla, ops: [] };
      registros.push(reg);
      const proxy: unknown = new Proxy({}, {
        get: (_t, prop: string) => {
          if (prop === 'then') return (res: (r: Respuesta) => unknown) => res(respuestas.shift() ?? { data: [], error: null });
          return (...args: unknown[]) => { if (prop !== 'abortSignal') reg.ops.push([prop, ...args]); return proxy; };
        },
      });
      return proxy;
    },
  }),
}));
const repo = await import('./repo');

const AHORA = new Date('2026-10-02T20:00:00.000Z');
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const sello = (min: number): EvidenciaSelloFila => ({ tipo: 'sello', creadaEn: hace(min) });

beforeEach(() => { registros.length = 0; respuestas = []; });

describe('decidirSelloInicio (T-A5-40)', () => {
  const base = { objetivo: 'salida_carga' as const, servicio: 'importacion' as const, ahora: AHORA };

  it('con foto de sello reciente: registra el inicio sin recomendar ni pedir (opción apagada o encendida)', () => {
    expect(decidirSelloInicio({ ...base, exigir: false, evidencias: [sello(30)] })).toEqual({ accion: 'registrar', recomendar: false });
    expect(decidirSelloInicio({ ...base, exigir: true, evidencias: [sello(30)] })).toEqual({ accion: 'registrar', recomendar: false });
  });

  it('sin foto y opción apagada: registra el inicio y recomienda la foto', () => {
    expect(decidirSelloInicio({ ...base, exigir: false, evidencias: [] })).toEqual({ accion: 'registrar', recomendar: true });
    expect(decidirSelloInicio({ ...base, exigir: undefined, evidencias: [] })).toEqual({ accion: 'registrar', recomendar: true });
  });

  it('sin foto y opción encendida (importación): pide la foto y NO registra', () => {
    expect(decidirSelloInicio({ ...base, exigir: true, evidencias: [] })).toEqual({ accion: 'pedir_foto' });
  });

  it('foto repetida: dos fotos de sello no cambian la decisión (registra una vez); y el acuse dice que ya la tenía', () => {
    const d = decidirSelloInicio({ ...base, exigir: true, evidencias: [sello(30), sello(5)] });
    expect(d).toEqual({ accion: 'registrar', recomendar: false });
    expect(mensajeEvidencia('duplicada', 'sello')).toMatch(/ya la tenía/);
  });

  it('exportación NUNCA exige ni recomienda el sello previo, aunque la opción esté encendida', () => {
    expect(decidirSelloInicio({ ...base, servicio: 'exportacion', exigir: true, evidencias: [] })).toEqual({ accion: 'registrar', recomendar: false });
  });

  it('nacional: sin regla del cliente, no se exige ni se recomienda', () => {
    expect(decidirSelloInicio({ ...base, servicio: 'nacional', exigir: true, evidencias: [] })).toEqual({ accion: 'registrar', recomendar: false });
  });

  it('servicio desconocido (aún sin T-A5-41): nunca exige, solo recomienda', () => {
    expect(decidirSelloInicio({ ...base, servicio: null, exigir: true, evidencias: [] })).toEqual({ accion: 'registrar', recomendar: true });
  });

  it('solo el inicio de viaje (salida_carga) pasa por la regla: los demás hitos se registran como siempre', () => {
    for (const objetivo of ['llegada_carga', 'llegada_descarga', 'salida_descarga', 'regreso'] as const) {
      expect(decidirSelloInicio({ ...base, objetivo, exigir: true, evidencias: [] })).toEqual({ accion: 'registrar', recomendar: false });
    }
  });

  it('una foto vieja (> 12 h), de otro papel o con fecha inválida no cuenta como sello reciente', () => {
    expect(hayFotoDeSello([sello(13 * 60)], AHORA)).toBe(false);
    expect(hayFotoDeSello([{ tipo: 'anden', creadaEn: hace(5) }, { tipo: 'recibido', creadaEn: hace(5) }, { tipo: 'otra', creadaEn: hace(5) }], AHORA)).toBe(false);
    expect(hayFotoDeSello([{ tipo: 'sello', creadaEn: 'no-es-fecha' }], AHORA)).toBe(false);
    expect(hayFotoDeSello([sello(-60)], AHORA)).toBe(false);
    expect(hayFotoDeSello([sello(11 * 60)], AHORA)).toBe(true);
  });
});

describe('mensajeSelloInicio', () => {
  it('pide o recomienda la foto del sello y no cita claves, amago, pánico ni monitoreo', () => {
    for (const que of ['pedir', 'recomendar'] as const) {
      const t = mensajeSelloInicio(que);
      expect(t).toMatch(/sello/);
      expect(t).not.toMatch(/amago|clave|p[aá]nico|monitoreo|c[aá]mara|bloqueo/i);
    }
    expect(mensajeSelloInicio('pedir')).toMatch(/Antes de iniciar/);
  });
});

describe('configuración exigirSelloInicio', () => {
  it('nace apagada', () => {
    expect(CONFIG_CONDUCTOR_DEFAULT.exigirSelloInicio).toBe(false);
  });
});

describe('leerEvidenciasSelloViaje', () => {
  it('filtra por flota, viaje, tipo sello, no purgadas y ventana; devuelve solo tipo y hora', async () => {
    respuestas = [{ data: [{ tipo: 'sello', created_at: hace(10), ruta: 'x', sha256: 'y' }], error: null }];
    const r = await repo.leerEvidenciasSelloViaje('t1', 'v1', AHORA);
    expect(r).toEqual([{ tipo: 'sello', creadaEn: hace(10) }]);
    const reg = registros[0];
    expect(reg.tabla).toBe('viaje_hito_evidencia');
    const eqs = reg.ops.filter(([o]) => o === 'eq').map(([, c, v]) => `${c}=${v}`);
    expect(eqs).toEqual(expect.arrayContaining(['tenant_id=t1', 'viaje_id=v1', 'tipo=sello']));
    expect(reg.ops.find(([o]) => o === 'is')?.slice(1)).toEqual(['purgada_en', null]);
    expect(reg.ops.find(([o]) => o === 'gte')?.[2]).toBe(new Date(AHORA.getTime() - 12 * 3_600_000).toISOString());
  });

  it('una base caída lanza (no es «no hay foto»)', async () => {
    respuestas = [{ error: { message: 'connection reset', code: '08006' } }];
    await expect(repo.leerEvidenciasSelloViaje('t1', 'v1', AHORA)).rejects.toThrow();
  });
});
