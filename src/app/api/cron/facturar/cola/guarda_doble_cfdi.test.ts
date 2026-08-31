import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 22 · PRU-A2 (ALTO) — la cola de autofacturación tenía 0% de líneas
// ejecutadas, y su única «prueba» era un grep del fuente comparando dos
// `maxDuration`.
//
// O sea: el guarda contra el DOBLE CFDI (`route.ts:89`) no estaba probado. Ese
// guarda es lo único que impide que un ticket ya facturado se vuelva a facturar
// cuando QStash reintenta el lote (`retries: 2`) — y un CFDI duplicado no se
// arregla borrándolo: se cancela con acuse del receptor, y mientras tanto la
// flota tiene dos comprobantes por el mismo gasto ante el SAT.
//
// Lo que esta suite ejecuta de verdad:
//   1. El ticket que YA tiene `cfdi_uuid` se cae del lote antes de facturarse.
//   2. El kill switch corta con 200 —no 5xx—, porque un 5xx haría que QStash
//      reintentara justo lo que se acaba de apagar.
//   3. Una firma inválida no llega a tocar la base.
// ═══════════════════════════════════════════════════════════════════════════

let firmaValida = true;
vi.mock('@upstash/qstash', () => ({
  Receiver: class { verify = async () => firmaValida; },
}));

let apagado: string | null = null;
vi.mock('@/lib/likida/interruptores', () => ({
  estaApagado: async (k: string) => apagado === k,
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/formato', async (o) => ({
  ...(await o<typeof import('@/lib/formato')>()),
  hoyMx: () => '2026-08-30',
}));

/** Los gastos que la base dice que SIGUEN sin CFDI. */
let vigentes: Array<{ id: string }> = [];
let errorBase: { message: string } | null = null;
const baseConsultada = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        in: (_c: string, ids: string[]) => ({
          is: async () => { baseConsultada(ids); return { data: vigentes, error: errorBase }; },
        }),
      }),
    }),
  }),
}));

/** El procesador compartido: se captura QUÉ lote le llega. */
const procesarLoteEnCola = vi.fn(async (lote: Array<{ id: string }>) =>
  new Response(JSON.stringify({ corrio: true, facturados: lote.map((g) => g.id) }), { status: 200 }));
vi.mock('../route', async (o) => ({
  ...(await o<typeof import('../route')>()),
  procesarLoteEnCola: (...a: unknown[]) => procesarLoteEnCola(...(a as [never])),
}));

const { POST } = await import('./route');

const pedir = (lote: Array<{ id: string }>) =>
  POST(new Request('https://app.likida.ai/api/cron/facturar/cola', {
    method: 'POST',
    headers: { 'upstash-signature': 'firma', 'content-type': 'application/json' },
    body: JSON.stringify({ lote, quedaron: 0 }),
  }) as never);

beforeEach(() => {
  firmaValida = true;
  apagado = null;
  errorBase = null;
  vigentes = [];
  procesarLoteEnCola.mockClear();
  baseConsultada.mockClear();
  process.env.UPSTASH_QSTASH_TOKEN = 'tok';
  process.env.QSTASH_CURRENT_SIGNING_KEY = 'cur';
  process.env.QSTASH_NEXT_SIGNING_KEY = 'next';
});

describe('PRU-A2: el guarda contra el doble CFDI, ejecutado', () => {
  it('el ticket que YA tiene cfdi_uuid se cae del lote antes de facturarse', async () => {
    // La base dice que solo `g-2` sigue sin CFDI: `g-1` se facturó en el
    // intento anterior, el que QStash está reintentando.
    vigentes = [{ id: 'g-2' }];
    const r = await pedir([{ id: 'g-1' }, { id: 'g-2' }]);

    expect(r.status).toBe(200);
    expect(baseConsultada).toHaveBeenCalledWith(['g-1', 'g-2']);
    // Lo que este guarda impide: un segundo CFDI por el mismo gasto, que no se
    // borra —se cancela con acuse del receptor.
    expect(procesarLoteEnCola).toHaveBeenCalledTimes(1);
    expect(procesarLoteEnCola.mock.calls[0][0]).toEqual([{ id: 'g-2' }]);
  });

  it('si TODOS ya tienen CFDI, el procesador recibe un lote vacío — no los dos', async () => {
    vigentes = [];
    await pedir([{ id: 'g-1' }, { id: 'g-2' }]);
    expect(procesarLoteEnCola.mock.calls[0][0]).toEqual([]);
  });

  it('si la revalidación falla, 500 y NO se factura: fallar cerrado', async () => {
    errorBase = { message: 'PostgREST 500' };
    const r = await pedir([{ id: 'g-1' }]);
    expect(r.status).toBe(500);
    expect(procesarLoteEnCola).not.toHaveBeenCalled();
  });

  it('el kill switch corta con 200, no con 5xx — un 5xx reintentaría lo apagado', async () => {
    apagado = 'agente:facturas';
    const r = await pedir([{ id: 'g-1' }]);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ corrio: false });
    expect(procesarLoteEnCola).not.toHaveBeenCalled();
    // Y no se marcan los tickets: el cron los recoge enteros al volver.
    expect(baseConsultada).not.toHaveBeenCalled();
  });

  it('una firma inválida no llega a tocar la base', async () => {
    firmaValida = false;
    const r = await pedir([{ id: 'g-1' }]);
    expect(r.status).toBe(401);
    expect(baseConsultada).not.toHaveBeenCalled();
    expect(procesarLoteEnCola).not.toHaveBeenCalled();
  });

  it('un lote vacío no consulta ni procesa', async () => {
    const r = await pedir([]);
    expect(await r.json()).toMatchObject({ vacio: true });
    expect(procesarLoteEnCola).not.toHaveBeenCalled();
  });
});
