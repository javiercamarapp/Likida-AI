import { beforeEach, describe, expect, it, vi } from 'vitest';

// ═══ La API del bus para workers (0135) ════════════════════════════════════

let resolucion: { ok: true; workerId: string; nombre: string } | { ok: false; error: string } =
  { ok: true, workerId: 'w1', nombre: 'mac-javier' };
vi.mock('@/lib/worker/llaves', () => ({
  resolverLlaveWorker: async () => resolucion,
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const escrituras: Array<{ tabla: string; op: string; valores?: unknown; filtros: Array<[string, unknown]> }> = [];
let filasSelect: unknown[] = [];
let filasUpdate: unknown[] = [{ id: 'x' }];
let errorDb: { message: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const ll = { tabla, op: '', valores: undefined as unknown, filtros: [] as Array<[string, unknown]> };
      const fin = (data: unknown) => Promise.resolve({ data, error: errorDb });
      const api: Record<string, unknown> = {
        insert: (v: unknown) => { ll.op = 'insert'; ll.valores = v; escrituras.push(ll); return api; },
        update: (v: unknown) => { ll.op = 'update'; ll.valores = v; escrituras.push(ll); return api; },
        upsert: (v: unknown) => { ll.op = 'upsert'; ll.valores = v; escrituras.push(ll); return { then: (r: (x: unknown) => unknown) => fin(null).then(r) }; },
        select: () => api,
        eq: (c: string, v: unknown) => { ll.filtros.push([c, v]); return api; },
        order: () => api,
        limit: () => fin(filasSelect),
        single: () => fin({ id: 'corrida-1' }),
        then: (r: (x: unknown) => unknown) => fin(ll.op === 'update' ? filasUpdate : filasSelect).then(r),
      };
      return api;
    },
    storage: { from: () => ({ upload: async () => ({ error: null }) }) },
  }),
}));

const { POST } = await import('./route');

const UUID = '11111111-2222-3333-4444-555555555555';
function pedir(accion: string, cuerpo: unknown) {
  return POST(
    new Request(`https://x/api/worker/bus/${accion}`, {
      method: 'POST', headers: { 'x-worker-key': 'lkw_x', 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ accion }) },
  );
}

beforeEach(() => {
  resolucion = { ok: true, workerId: 'w1', nombre: 'mac-javier' };
  escrituras.length = 0; filasSelect = []; filasUpdate = [{ id: 'x' }]; errorDb = null;
});

describe('POST /api/worker/bus/[accion]', () => {
  it('sin alcance: 403 con el mensaje del resolver, sin tocar la base', async () => {
    resolucion = { ok: false, error: 'Llave de worker inválida o sin alcance para esta operación.' };
    const r = await pedir('ordenes', {});
    expect(r.status).toBe(403);
    expect(escrituras).toHaveLength(0);
  });

  it('acción desconocida: 404 (ni siquiera resuelve la llave para inventar alcances)', async () => {
    expect((await pedir('borrar-todo', {})).status).toBe(404);
  });

  it('corrida-inicio devuelve el id; sin rutina es 400', async () => {
    const r = await pedir('corrida-inicio', { rutina: 'cazador' });
    expect(await r.json()).toEqual({ id: 'corrida-1' });
    expect((await pedir('corrida-inicio', {})).status).toBe(400);
  });

  it('ordenes-claim: el WHERE ancla a pendiente y 0 filas = tomada:false', async () => {
    filasUpdate = [];
    const r = await pedir('ordenes-claim', { id: UUID });
    expect(await r.json()).toEqual({ tomada: false });
    const up = escrituras.find((e) => e.op === 'update');
    expect(up?.filtros).toEqual(expect.arrayContaining([['id', UUID], ['estado', 'pendiente']]));
  });

  it('pieza: sanea el nombre de la media (un ../ no sale de piezas/)', async () => {
    const r = await pedir('pieza', {
      rutina: 'marketing', carpeta: 'reel-1', titulo: 'Reel', tipo: 'video',
      mediaBase64: Buffer.from('x').toString('base64'), mediaNombre: '../../etc/passwd',
    });
    const j = await r.json() as { mediaPath: string };
    expect(j.mediaPath).toBe('piezas/reel-1/.._.._etc_passwd');
  });

  it('un error de la base es 500 con mensaje neutro (nada de Postgres al worker)', async () => {
    errorDb = { message: 'duplicate key value violates unique constraint' };
    const r = await pedir('corrida-fin', { id: UUID, exitCode: 0 });
    expect(r.status).toBe(500);
    expect(((await r.json()) as { error: string }).error).not.toContain('duplicate');
  });
});
