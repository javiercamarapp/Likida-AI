import { beforeEach, describe, expect, it, vi } from 'vitest';

// Base en memoria: aplica de verdad los filtros (eq / is / in) de cada consulta, así la prueba comprueba el ANCLAJE (tenant, estado
// leído, sin id de Stripe) y no solo que se llamó a algo.
type Fila = Record<string, unknown>;
const bd = vi.hoisted(() => ({
  tablas: {} as Record<string, Array<Record<string, unknown>>>,
  errores: {} as Record<string, { message: string; code?: string } | undefined>,
  seq: 0,
}));
const bitacora = vi.hoisted(() => ({ anotar: vi.fn() }));

vi.mock('@/lib/admin/acciones_riesgo', () => ({ anotarAccionAdmin: bitacora.anotar }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const filtros: Array<(f: Fila) => boolean> = [];
      let op: 'select' | 'insert' | 'update' = 'select';
      let valores: Fila = {};
      let devolver = false;
      const q = {
        select: () => { devolver = true; return q; },
        insert: (v: Fila) => { op = 'insert'; valores = v; return q; },
        update: (v: Fila) => { op = 'update'; valores = v; return q; },
        eq: (c: string, v: unknown) => { filtros.push((f) => f[c] === v); return q; },
        is: (c: string, v: null) => { filtros.push((f) => (f[c] ?? null) === v); return q; },
        in: (c: string, vs: unknown[]) => { filtros.push((f) => vs.includes(f[c])); return q; },
        then: (ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) => ejecutar().then(ok, ko),
        maybeSingle: async () => {
          const r = await ejecutar();
          const d = r.data as Fila[] | null;
          return { data: d && d.length ? d[0] : null, error: r.error };
        },
      };
      const ejecutar = async (): Promise<{ data: Fila[] | null; error: { message: string; code?: string } | null }> => {
        const err = bd.errores[`${tabla}.${op}`];
        if (err) return { data: null, error: err };
        const filas = (bd.tablas[tabla] ??= []);
        if (op === 'insert') {
          const f: Fila = { id: `id-${++bd.seq}`, ...valores };
          // suscripcion_una_viva
          if (tabla === 'suscripcion' && filas.some((x) => x.tenant_id === f.tenant_id && ['prueba', 'activa', 'morosa', 'pausada'].includes(String(x.estado)))) {
            return { data: null, error: { message: 'duplicate key', code: '23505' } };
          }
          filas.push(f);
          return { data: devolver ? [f] : null, error: null };
        }
        const objetivo = filas.filter((f) => filtros.every((fn) => fn(f)));
        if (op === 'update') { for (const f of objetivo) Object.assign(f, valores); return { data: devolver ? objetivo : null, error: null }; }
        return { data: objetivo, error: null };
      };
      return q;
    },
  }),
}));

import { gestionarSuscripcionDeFlota } from './asignar-plan';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = { userId: 'u-1' };
const PLAN_OK = { clave: 'flota', nombre: 'Flota', precio_mensual: 17500, moneda: 'MXN', precio_iva_incluido: false, stripe_price_id: 'price_1', activo: true };

beforeEach(() => {
  vi.clearAllMocks();
  bd.seq = 0;
  bd.errores = {};
  bd.tablas = {
    tenant: [{ id: T1, plan: 'demo' }, { id: T2, plan: 'demo' }],
    plan: [{ ...PLAN_OK }, { ...PLAN_OK, clave: 'pro', nombre: 'Pro' }],
    suscripcion: [],
  };
  bitacora.anotar.mockResolvedValue(true);
});

const sus = (t: string) => bd.tablas.suscripcion.filter((s) => s.tenant_id === t);
const tenant = (t: string) => bd.tablas.tenant.find((x) => x.id === t)!;

describe('asignar', () => {
  it('flota sin suscripción: crea una en `prueba` SIN id de Stripe, sincroniza tenant.plan y asienta bitácora', async () => {
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    expect(r).toMatchObject({ cambio: true, estadoAntes: null, estadoDespues: 'prueba', planClave: 'flota', bitacora: true });
    expect(sus(T1)).toHaveLength(1);
    expect(sus(T1)[0]).toMatchObject({ plan_clave: 'flota', estado: 'prueba' });
    expect(sus(T1)[0].stripe_subscription_id).toBeUndefined();
    expect(tenant(T1).plan).toBe('flota');
    expect(tenant(T2).plan).toBe('demo'); // la otra flota ni se toca
    expect(bitacora.anotar).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: T1, accion: 'suscripcion.asignada', entidad: 'suscripcion', entidadId: r.suscripcionId, actor: ACTOR,
    }));
  });

  it('IDEMPOTENTE: repetir el mismo plan no crea otra fila ni asienta otra vez', async () => {
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    bitacora.anotar.mockClear();
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    expect(r.cambio).toBe(false);
    expect(sus(T1)).toHaveLength(1);
    expect(bitacora.anotar).not.toHaveBeenCalled();
  });

  it('repara tenant.plan en el reintento si un intento anterior murió entre los dos escritos', async () => {
    bd.tablas.suscripcion.push({ id: 's-0', tenant_id: T1, plan_clave: 'flota', estado: 'prueba' });
    expect(tenant(T1).plan).toBe('demo');
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    expect(tenant(T1).plan).toBe('flota');
  });

  it('cambio de plan: actualiza la MISMA suscripción (sigue habiendo una viva) y asienta de→a', async () => {
    const a = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    bitacora.anotar.mockClear();
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'pro', actor: ACTOR });
    expect(r).toMatchObject({ cambio: true, suscripcionId: a.suscripcionId, planClave: 'pro', estadoDespues: 'prueba' });
    expect(sus(T1)).toHaveLength(1);
    expect(sus(T1)[0].plan_clave).toBe('pro');
    expect(tenant(T1).plan).toBe('pro');
    expect(bitacora.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'suscripcion.plan_cambiado', detalle: expect.objectContaining({ de: 'flota', a: 'pro' }) }));
  });

  it('carrera con `suscripcion_una_viva` (23505): si la ganadora ya tiene ese plan, resuelve sin error y sin duplicar', async () => {
    // La lectura inicial no la ve, pero el insert choca: simulamos con una viva insertada justo antes del insert.
    const original = bd.tablas.suscripcion;
    let lecturas = 0;
    Object.defineProperty(bd.tablas, 'suscripcion', {
      configurable: true,
      get() {
        lecturas += 1;
        // 1.ª lectura (leerSuscripcionViva): vacía; después, ya existe la de la otra petición.
        return lecturas === 1 ? [] : [...original, { id: 's-9', tenant_id: T1, plan_clave: 'flota', estado: 'prueba' }];
      },
      set(v) { Object.defineProperty(bd.tablas, 'suscripcion', { configurable: true, writable: true, value: v }); },
    });
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    expect(r.cambio).toBe(false);
    expect(r.suscripcionId).toBe('s-9');
  });

  it('FALLA CERRADO sin price ligado, sin precio, en otra moneda o sin criterio de IVA — y no escribe nada', async () => {
    const casos: Array<[Record<string, unknown>, RegExp]> = [
      [{ stripe_price_id: null }, /price de Stripe ligado/],
      [{ precio_mensual: null }, /precio mensual mayor a cero/],
      [{ precio_mensual: 0 }, /precio mensual mayor a cero/],
      [{ moneda: 'USD' }, /solo en pesos/],
      [{ precio_iva_incluido: null }, /incluye IVA/],
      [{ activo: false }, /no existe o ya no está disponible/],
    ];
    for (const [cambio, patron] of casos) {
      bd.tablas.plan = [{ ...PLAN_OK, ...cambio }];
      await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR })).rejects.toThrow(patron);
    }
    expect(sus(T1)).toHaveLength(0);
    expect(tenant(T1).plan).toBe('demo');
    expect(bitacora.anotar).not.toHaveBeenCalled();
  });

  it('un plan inexistente o una flota inexistente se dicen', async () => {
    await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'nada', actor: ACTOR })).rejects.toThrow(/no existe/);
    await expect(gestionarSuscripcionDeFlota({ tenantId: '33333333-3333-4333-8333-333333333333', operacion: 'asignar', planClave: 'flota', actor: ACTOR })).rejects.toThrow(/flota ya no existe/);
    await expect(gestionarSuscripcionDeFlota({ tenantId: 'no-uuid', operacion: 'asignar', planClave: 'flota', actor: ACTOR })).rejects.toThrow(/Elige una flota/);
  });

  it('NO toca una suscripción que cobra por Stripe (ni cambia ni pausa ni cancela ni activa)', async () => {
    bd.tablas.suscripcion.push({ id: 's-1', tenant_id: T1, plan_clave: 'flota', estado: 'activa', stripe_subscription_id: 'sub_1234567890abcdef' });
    for (const operacion of ['asignar', 'activar', 'pausar', 'cancelar'] as const) {
      await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion, planClave: 'pro', actor: ACTOR })).rejects.toThrow(/cobra por Stripe/);
    }
    expect(sus(T1)[0]).toMatchObject({ plan_clave: 'flota', estado: 'activa' });
    expect(bitacora.anotar).not.toHaveBeenCalled();
  });

  it('fallar cerrado ante un error de la base: se lanza, no se lee como «no hay suscripción»', async () => {
    bd.errores['suscripcion.select'] = { message: 'conexión caída' };
    await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR })).rejects.toThrow(/conexión caída/);
    bd.errores = { 'tenant.select': { message: 'tenant caído' } };
    await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR })).rejects.toThrow(/tenant caído/);
    expect(sus(T1)).toHaveLength(0);
  });
});

describe('activar / pausar / cancelar', () => {
  beforeEach(() => { bd.tablas.suscripcion.push({ id: 's-1', tenant_id: T1, plan_clave: 'flota', estado: 'prueba' }); });

  it('activar: prueba → activa (la flota ya se cobra) con asiento', async () => {
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'activar', actor: ACTOR });
    expect(r).toMatchObject({ cambio: true, estadoAntes: 'prueba', estadoDespues: 'activa' });
    expect(bitacora.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'suscripcion.activada', detalle: { plan: 'flota', de: 'prueba', a: 'activa' } }));
  });

  it('activar es idempotente', async () => {
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'activar', actor: ACTOR });
    bitacora.anotar.mockClear();
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'activar', actor: ACTOR });
    expect(r.cambio).toBe(false);
    expect(bitacora.anotar).not.toHaveBeenCalled();
  });

  it('pausar y reactivar: activa → pausada → activa, conservando la misma fila', async () => {
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'activar', actor: ACTOR });
    expect((await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'pausar', actor: ACTOR })).estadoDespues).toBe('pausada');
    expect(sus(T1)[0].estado).toBe('pausada');
    expect((await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'activar', actor: ACTOR })).estadoDespues).toBe('activa');
    expect(sus(T1)).toHaveLength(1);
  });

  it('cancelar: sella cancelada_en (lo exige el CHECK de la 0052), devuelve tenant.plan a demo y asienta', async () => {
    tenant(T1).plan = 'flota';
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'cancelar', actor: ACTOR });
    expect(r).toMatchObject({ cambio: true, estadoDespues: 'cancelada' });
    expect(sus(T1)[0].estado).toBe('cancelada');
    expect(typeof sus(T1)[0].cancelada_en).toBe('string');
    expect(tenant(T1).plan).toBe('demo');
    expect(bitacora.anotar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'suscripcion.cancelada' }));
  });

  it('tras cancelar ya no hay suscripción viva: activar/pausar/cancelar lo dicen, y asignar crea una NUEVA', async () => {
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'cancelar', actor: ACTOR });
    for (const operacion of ['activar', 'pausar', 'cancelar'] as const) {
      await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion, actor: ACTOR })).rejects.toThrow(/no tiene una suscripción viva/);
    }
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'asignar', planClave: 'flota', actor: ACTOR });
    expect(sus(T1)).toHaveLength(2);
    expect(sus(T1).filter((s) => s.estado !== 'cancelada')).toHaveLength(1);
  });

  it('compare-and-set: si el estado cambió entre la lectura y la escritura, NO se pisa', async () => {
    // Otra petición la pasó a `activa` justo después de que esta la leyó como `prueba`.
    const fila = bd.tablas.suscripcion[0];
    let lecturas = 0;
    const original = bd.tablas.suscripcion;
    Object.defineProperty(bd.tablas, 'suscripcion', {
      configurable: true,
      get() { lecturas += 1; if (lecturas === 2) fila.estado = 'activa'; return original; },
    });
    await expect(gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'pausar', actor: ACTOR })).rejects.toThrow(/cambió mientras tanto/);
    expect(fila.estado).toBe('activa');
    expect(bitacora.anotar).not.toHaveBeenCalled();
  });

  it('solo toca la flota pedida', async () => {
    bd.tablas.suscripcion.push({ id: 's-2', tenant_id: T2, plan_clave: 'flota', estado: 'activa' });
    await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'pausar', actor: ACTOR });
    expect(sus(T2)[0].estado).toBe('activa');
  });

  it('si la bitácora no pudo escribir, el acto queda hecho y el resultado lo declara', async () => {
    bitacora.anotar.mockResolvedValue(false);
    const r = await gestionarSuscripcionDeFlota({ tenantId: T1, operacion: 'activar', actor: ACTOR });
    expect(r).toMatchObject({ cambio: true, bitacora: false });
    expect(sus(T1)[0].estado).toBe('activa');
  });
});
