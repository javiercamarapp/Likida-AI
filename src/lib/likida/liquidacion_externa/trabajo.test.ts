import { describe, it, expect, vi, beforeEach } from 'vitest';

// La lista de trabajo del cron es la ÚNICA consulta de este módulo que cruza
// flotas (a propósito: barre la cola de todas). Lo que se fija es lo que la
// acota: solo lo que de verdad tiene trabajo pendiente, en orden y con tope — y
// que un error de base LANZA en vez de leerse como «no hay trabajo».

const ops: Array<[string, ...unknown[]]> = [];
let respuesta: { data: unknown; error: { message: string } | null } = { data: [], error: null };
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (t: string) => {
      ops.length = 0; ops.push(['from', t]);
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'or', 'order', 'limit']) b[m] = (...a: unknown[]) => { ops.push([m, ...a]); return b; };
      b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(respuesta).then(res, rej);
      return b;
    },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));

const { trabajoPendiente } = await import('./trabajo');

beforeEach(() => { respuesta = { data: [], error: null }; ops.length = 0; });

describe('trabajoPendiente', () => {
  it('pide las en_cola y las pendientes cuyo reintento ya toca, con tope y orden', async () => {
    await trabajoPendiente(50, '2026-09-08T12:00:00.000Z');
    expect(ops[0]).toEqual(['from', 'liquidacion_externa']);
    expect(ops).toContainEqual(['or', 'estado.eq.en_cola,and(estado.eq.pendiente,proximo_intento_en.lte.2026-09-08T12:00:00.000Z)']);
    expect(ops).toContainEqual(['limit', 50]);
    expect(ops.find((o) => o[0] === 'order')).toEqual(['order', 'proximo_intento_en', { ascending: true }]);
  });

  it('una acusada, enviada o fallida NO entra a la lista (no hay nada que empujar)', async () => {
    await trabajoPendiente(10, '2026-09-08T12:00:00.000Z');
    const filtro = String(ops.find((o) => o[0] === 'or')![1]);
    for (const e of ['acusada', 'enviada', 'fallida']) expect(filtro).not.toContain(e);
  });

  it('mapea las filas a liquidaciones con su tenant', async () => {
    respuesta = { data: [{
      id: 'l-1', tenant_id: 't-9', clave_externa: 'K', huella: 'h'.repeat(64), sistema_origen: null, operador_id: 'o', folios_viaje: [], viaje_ids: [],
      periodo_desde: '2026-09-01', periodo_hasta: '2026-09-02', conceptos: [], total: '5.00', moneda: 'MXN', pdf_ruta: 'p', pdf_origen: 'generado',
      estado: 'pendiente', via: null, generacion: 1, intentos: 0, proximo_intento_en: 'x', ultimo_error: null, wamid: null, enviada_en: null,
      acuse_tipo: null, acuse_en: null, created_at: 'c', operador: { nombre: 'N', telefono: '525500000000' },
    }], error: null };
    const r = await trabajoPendiente(10, 'ahora');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 'l-1', tenantId: 't-9', total: 5, operadorTelefono: '525500000000' });
  });

  it('un error de base LANZA: «no pude leer» no es «no hay trabajo» (el cron se pondría verde sin entregar nada)', async () => {
    respuesta = { data: null, error: { message: 'conexión rota' } };
    await expect(trabajoPendiente(10, 'ahora')).rejects.toThrow(/conexión rota/);
  });
});
