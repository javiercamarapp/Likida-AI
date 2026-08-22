import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA 360 — lo que se fija:
//  · Tenant inexistente = null (404); base caída en el tenant = LANZA.
//  · Resiliencia POR SECCIÓN: una lectura caída deja null en SU sección.
//  · "No vino del pipeline" ≠ "no se pudo leer" (banderas *Legible).
//  · Los tickets llegan FILTRADOS al tenant de la ficha.
// ═══════════════════════════════════════════════════════════════════════════

const respuestas = new Map<string, Array<{ data: unknown; error: { message: string } | null }>>();
function builder(tabla: string) {
  const responder = () => {
    const cola = respuestas.get(tabla);
    return cola && cola.length > 0 ? cola.shift()! : { data: [], error: null };
  };
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, order: () => b, limit: () => b, maybeSingle: () => b,
    then: (res: (x: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve().then(responder).then(res, rej),
  });
  return b;
}
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: (t: string) => builder(t) }) }));

let kpis: (() => Promise<unknown>) = async () => ({ viajesLiquidados: 4, montoComprobado: 37800, diferenciaDetectada: 0, conDiferencias: 0, porRevisar: 1, tasaCuadre: 100 });
vi.mock('@/lib/likida/analytics', () => ({ getKpis: () => kpis() }));
vi.mock('@/lib/likida/pmf', () => ({ getSenalesPmf: async () => ({ descargas: { medida: false }, comprobacionSola: { medida: false }, tickets: { medida: false } }) }));
let suscripcion: unknown = null;
vi.mock('@/lib/saas/suscripcion', () => ({
  getSuscripcion: async () => suscripcion,
  getFacturasSaas: async () => [],
}));
// FE-11: el filtro por tenant vive en la CONSULTA (`{ tenantId }` → `.eq()`),
// no en un `.filter()` posterior — la ficha pedía TODOS los tickets de TODAS
// las flotas para quedarse con los de una. El mock respeta la opción: si el
// código volviera a pedir sin filtro, la ficha traería el ticket ajeno y esta
// prueba lo atrapa.
const ticketsPedidos: Array<string | undefined> = [];
vi.mock('./soporte', () => ({
  getTicketsCruzados: async (_ahora: number, o: { tenantId?: string } = {}) => {
    ticketsPedidos.push(o.tenantId);
    return [
      { id: 'tk-1', tenantId: 't-1', asunto: 'mío', estado: 'abierto', horasRestantes: null },
      { id: 'tk-2', tenantId: 't-OTRO', asunto: 'ajeno', estado: 'abierto', horasRestantes: null },
    ].filter((t) => !o.tenantId || t.tenantId === o.tenantId);
  },
}));
vi.mock('./negocio', () => ({ costoIaDeTenant: async () => ({ historicoUsd: 0.04, d30Usd: 0.04 }) }));

const { getFichaCliente } = await import('./ficha-cliente');

const TENANT = { id: 't-1', nombre: 'Flota X', plan: 'demo', created_at: '2026-08-05T00:00:00Z' };

beforeEach(() => {
  respuestas.clear();
  suscripcion = null;
  kpis = async () => ({ viajesLiquidados: 4, montoComprobado: 37800, diferenciaDetectada: 0, conDiferencias: 0, porRevisar: 1, tasaCuadre: 100 });
});

describe('getFichaCliente', () => {
  it('tenant inexistente = null (la página decide 404); base caída = LANZA', async () => {
    respuestas.set('tenant', [{ data: null, error: null }]);
    expect(await getFichaCliente('t-nada')).toBeNull();
    respuestas.set('tenant', [{ data: null, error: { message: 'db down' } }]);
    await expect(getFichaCliente('t-1')).rejects.toThrow();
  });

  it('arma la ficha con los tickets FILTRADOS al tenant EN LA CONSULTA y el origen legible', async () => {
    respuestas.set('tenant', [{ data: TENANT, error: null }]);
    respuestas.set('prospecto', [{ data: null, error: null }]);
    respuestas.set('agente_corrida', [{ data: [], error: null }]);
    ticketsPedidos.length = 0;
    const f = (await getFichaCliente('t-1'))!;
    expect(f.tenant.nombre).toBe('Flota X');
    expect(f.tickets?.map((t) => t.id)).toEqual(['tk-1']);
    expect(ticketsPedidos).toEqual(['t-1']);
    // maybeSingle sin fila = NO vino del pipeline, y es afirmable (legible).
    expect(f.origen).toBeNull();
    expect(f.origenLegible).toBe(true);
    // Sin suscripción legítimo ≠ ilegible.
    expect(f.suscripcion).toBeNull();
    expect(f.suscripcionLegible).toBe(true);
  });

  it('una sección caída deja null EN SU sección sin tirar la ficha', async () => {
    respuestas.set('tenant', [{ data: TENANT, error: null }]);
    respuestas.set('prospecto', [{ data: null, error: { message: 'db down' } }]);
    respuestas.set('agente_corrida', [{ data: [], error: null }]);
    kpis = async () => { throw new Error('analytics caída'); };
    const f = (await getFichaCliente('t-1'))!;
    expect(f.operacion).toBeNull();
    // La lectura del origen cayó: NO es afirmable que "no vino del pipeline".
    expect(f.origenLegible).toBe(false);
    // Las demás secciones siguen vivas.
    expect(f.consumoIa).toEqual({ historicoUsd: 0.04, d30Usd: 0.04 });
  });
});
