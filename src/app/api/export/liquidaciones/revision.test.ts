import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24, BLOQUEANTE 6 — el CSV de liquidaciones respeta la firma (0299).
//
// Con este archivo tesorería arma la dispersión al chofer. Una liquidación
// RECHAZADA tiene un total que el motor va a recalcular en cuanto llegue el
// comprobante bueno: pagarla es pagar sobre una cifra que ya se sabe mala.
// Por omisión no entra, y el corte se DECLARA (nombre del archivo + encabezado)
// — un export que esconde filas sin decirlo es un dato corto con cara de
// completo.
// ═══════════════════════════════════════════════════════════════════════════

vi.mock('@/lib/ratelimit', () => ({ rateLimit: async () => true, clientIp: () => '1.2.3.4' }));
vi.mock('@/lib/auth/tenant-api', () => ({ resolverTenantApi: async () => ({ ok: true, tenantId: 't-1', rol: 'dueno' }) }));
vi.mock('@/lib/auth/permisos', () => ({ puedeExportar: () => true }));
vi.mock('@/lib/auth/visibilidad', () => ({ puedeVerArea: () => true }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/likida/presupuesto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/likida/presupuesto')>()),
  acotada: (q: unknown) => q,
}));

interface Consulta { eq: Array<[string, unknown]>; neq: Array<[string, unknown]>; in: Array<[string, unknown]> }
let consultas: Consulta[] = [];

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const c: Consulta = { eq: [], neq: [], in: [] };
      consultas.push(c);
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b, eq: (k: string, v: unknown) => { c.eq.push([k, v]); return b; },
        neq: (k: string, v: unknown) => { c.neq.push([k, v]); return b; },
        in: (k: string, v: unknown) => { c.in.push([k, v]); return b; },
        gte: () => b, lt: () => b, or: () => b, order: () => b, range: () => b,
        then: (res: (x: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res),
      });
      return b;
    },
  }),
}));

const { GET } = await import('./route');
const { leerFiltroRevision, FILTRO_REVISION_DEFECTO, LEYENDA_REVISION, FILTROS_REVISION } = await import('./periodo');

const PERIODO = 'desde=2026-08-01&hasta=2026-08-31';
const pedir = (qs = '') => GET(new Request(`https://app.likida.ai/api/export/liquidaciones?${PERIODO}${qs}`));

beforeEach(() => { consultas = []; });

describe('leerFiltroRevision', () => {
  it('sin parámetro, el corte por omisión deja fuera las rechazadas', () => {
    const r = leerFiltroRevision(new URLSearchParams());
    expect(r).toEqual({ ok: true, filtro: FILTRO_REVISION_DEFECTO });
    expect(FILTRO_REVISION_DEFECTO).toBe('sin_rechazadas');
  });

  it('un valor desconocido se rechaza con el catálogo, no se cae al default', () => {
    const r = leerFiltroRevision(new URLSearchParams('revision=aprobadas'));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('sin_rechazadas');
  });

  it('cada filtro tiene su leyenda escrita — el archivo dice qué trae', () => {
    for (const f of FILTROS_REVISION) expect(LEYENDA_REVISION[f].length).toBeGreaterThan(4);
  });
});

describe('GET /api/export/liquidaciones', () => {
  it('por omisión pide TODO menos lo rechazado, y lo declara en el nombre y el encabezado', async () => {
    const r = await pedir();
    expect(r.status).toBe(200);
    expect(consultas[0].neq).toEqual([['revision', 'rechazada']]);
    // El nombre por omisión NO cambia (el contador ya tiene su macro apuntando
    // ahí); lo que siempre declara el corte es el encabezado.
    expect(r.headers.get('Content-Disposition')).toContain('liquidaciones_likida.csv');
    expect(r.headers.get('X-Likida-Revision')).toContain('todas menos las rechazadas');
  });

  it('`?revision=firmadas` deja solo lo que una persona aprobó o ajustó, y el archivo lo lleva en el nombre', async () => {
    const r = await pedir('&revision=firmadas');
    expect(consultas[0].in).toEqual([['revision', ['aprobada', 'ajustada']]]);
    expect(consultas[0].neq).toEqual([]);
    expect(r.headers.get('Content-Disposition')).toContain('liquidaciones_likida_firmadas.csv');
  });

  it('`?revision=todas` no filtra nada; `?revision=rechazada` filtra por igualdad', async () => {
    await pedir('&revision=todas');
    expect(consultas[0].neq).toEqual([]);
    expect(consultas[0].in).toEqual([]);
    consultas = [];
    await pedir('&revision=rechazada');
    expect(consultas[0].eq).toContainEqual(['revision', 'rechazada']);
  });

  it('un `?revision=` inventado es 400 y no toca la base', async () => {
    const r = await pedir('&revision=x');
    expect(r.status).toBe(400);
    expect(consultas).toHaveLength(0);
  });
});
