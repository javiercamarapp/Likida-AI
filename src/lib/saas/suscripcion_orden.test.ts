import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA PROD (22-ago-2026) · RES-11 — STRIPE NO PROMETE ORDEN.
//
// El caso que rompía dinero: la flota cancela, llega `customer.subscription.
// deleted` y se aplica bien. Después Stripe reintenta un `.updated` de hace
// dos días (backoff largo) y `aplicarSuscripcion` —que FIJA estado, no
// acumula— la deja otra vez 'activa'. Una flota cancelada volvía a verse
// como cliente que paga, y `tenant.plan` con ella.
//
// El orden se guarda por suscripción en `evento_stripe`, en una fila con un
// id que ningún evento de Stripe puede tener (`orden:sub_…`; los suyos
// empiezan por `evt_`) y con `aplicado_en` SIEMPRE puesto, para no mover el
// SLO de "eventos sin aplicar" de /admin.
// ═══════════════════════════════════════════════════════════════════════════

type Fila = Record<string, unknown>;
const filas: Record<string, Fila[]> = {};
const ops: Array<{ tabla: string; op: string; valores: Fila; id?: string }> = [];
let errorLectura: { message: string } | null = null;

function tabla(nombre: string) {
  let idFiltrado: string | undefined;
  const api: Record<string, unknown> = {
    select: () => api,
    eq: (col: string, val: string) => { if (col === 'id') idFiltrado = val; return api; },
    is: () => api,
    in: () => api,
    order: () => api,
    limit: () => api,
    maybeSingle: () => {
      // El error se inyecta SOLO en la lectura de la marca de orden: si
      // rompiera también la de `suscripcion`, la prueba mediría el fallo de
      // otra consulta y no el de ésta.
      const esMarca = nombre === 'evento_stripe' && String(idFiltrado ?? '').startsWith('orden:');
      if (esMarca && errorLectura) return Promise.resolve({ data: null, error: errorLectura });
      return Promise.resolve({
        data: (filas[nombre] ?? []).find((f) => idFiltrado === undefined || f.id === idFiltrado) ?? null,
        error: null,
      });
    },
    insert: (v: Fila) => { ops.push({ tabla: nombre, op: 'insert', valores: v }); return { error: null }; },
    upsert: (v: Fila) => {
      ops.push({ tabla: nombre, op: 'upsert', valores: v });
      filas[nombre] = [...(filas[nombre] ?? []).filter((f) => f.id !== v.id), v];
      return Promise.resolve({ error: null });
    },
    update: (v: Fila) => { ops.push({ tabla: nombre, op: 'update', valores: v, id: idFiltrado }); return api; },
    then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return api;
}

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => tabla(t) }) }));
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
vi.mock('@/lib/logger', () => ({ logger }));

const { aplicarSuscripcion } = await import('./suscripcion');

const ANTEAYER = 1_755_000_000;
const HOY = 1_755_800_000;

const evento = (estado: 'activa' | 'cancelada', creado: number) => ({
  tenantId: 't1',
  stripeSubscriptionId: 'sub_123',
  stripeCustomerId: 'cus_1',
  planClave: 'pro',
  estado,
  periodoFin: '2026-09-30',
  eventoCreadoUnix: creado,
});

beforeEach(() => {
  ops.length = 0;
  errorLectura = null;
  for (const k of Object.keys(filas)) delete filas[k];
  logger.warn.mockClear();
});

describe('aplicarSuscripcion — el evento que llega tarde no revive una cancelación', () => {
  it('cancela hoy y el .updated de anteayer NO se aplica', async () => {
    await aplicarSuscripcion(evento('cancelada', HOY));
    const trasCancelar = ops.filter((o) => o.tabla === 'suscripcion').length;
    expect(trasCancelar).toBeGreaterThan(0);

    ops.length = 0;
    await aplicarSuscripcion(evento('activa', ANTEAYER));

    expect(ops.filter((o) => o.tabla === 'suscripcion')).toHaveLength(0);
    expect(ops.filter((o) => o.tabla === 'tenant')).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalledWith('stripe.evento_fuera_de_orden', expect.objectContaining({
      sub: 'sub_123', creado: ANTEAYER, ultimoAplicado: HOY,
    }));
  });

  it('un evento MÁS NUEVO sí se aplica (la protección no congela la suscripción)', async () => {
    await aplicarSuscripcion(evento('activa', ANTEAYER));
    ops.length = 0;
    await aplicarSuscripcion(evento('cancelada', HOY));
    expect(ops.filter((o) => o.tabla === 'suscripcion').length).toBeGreaterThan(0);
  });

  it('la marca de orden no ensucia el SLO: id que Stripe no puede emitir y aplicado_en puesto', async () => {
    await aplicarSuscripcion(evento('activa', HOY));
    const marca = ops.find((o) => o.op === 'upsert' && o.tabla === 'evento_stripe');
    expect(marca).toBeDefined();
    expect(marca!.valores.id).toBe('orden:sub_123');
    expect(String(marca!.valores.id).startsWith('evt_')).toBe(false);
    // `admin/slo.ts` cuenta las filas con `aplicado_en is null`.
    expect(marca!.valores.aplicado_en).toEqual(expect.any(String));
  });

  it('sin `eventoCreadoUnix` se aplica como siempre y NO se sella nada', async () => {
    const { eventoCreadoUnix: _fuera, ...sinOrden } = evento('activa', HOY);
    void _fuera;
    await aplicarSuscripcion(sinOrden);
    expect(ops.filter((o) => o.tabla === 'suscripcion').length).toBeGreaterThan(0);
    expect(ops.find((o) => o.op === 'upsert')).toBeUndefined();
  });

  it('si la marca no se puede LEER, en la duda se aplica: dejar fuera un cobro real es peor', async () => {
    errorLectura = { message: 'fetch failed' };
    await aplicarSuscripcion(evento('activa', ANTEAYER));
    expect(ops.filter((o) => o.tabla === 'suscripcion').length).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledWith('stripe.orden_ilegible', expect.objectContaining({ sub: 'sub_123' }));
  });
});
