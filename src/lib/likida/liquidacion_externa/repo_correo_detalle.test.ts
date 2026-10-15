import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// repo_correo.ts — el acceso a datos de la liquidación por correo (T-A1-13).
//
// Misma técnica que `repo.test.ts`: la base es un registrador de cadenas. Cada `.from()` anota los verbos aplicados y
// contesta lo que el caso programó (cola `respuestas`, o la función `comportamiento` cuando el caso necesita estado,
// como el índice único de las entregas). Todo es sintético: ningún nombre, correo ni importe reales.
// ═══════════════════════════════════════════════════════════════════════════

type Op = [string, ...unknown[]];
interface Llamada { tabla: string; ops: Op[] }
type Resp = { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
const llamadas: Llamada[] = [];
const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
let respuestas: Resp[] = [];
let comportamiento: ((l: Llamada) => Resp) | null = null;

function constructor(tabla: string) {
  const ll: Llamada = { tabla, ops: [] };
  llamadas.push(ll);
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'in', 'gte', 'lt', 'or', 'is', 'not', 'order', 'range', 'limit', 'neq']) {
    b[m] = (...a: unknown[]) => { ll.ops.push([m, ...a]); return b; };
  }
  const resolver = (): Resp => (comportamiento ? comportamiento(ll) : (respuestas.shift() ?? { data: [], error: null, count: 0 }));
  b.maybeSingle = async () => { ll.ops.push(['maybeSingle']); return resolver(); };
  b.single = async () => { ll.ops.push(['single']); return resolver(); };
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(resolver()).then(res, rej);
  return b;
}
const upload = vi.fn(async (..._a: unknown[]): Promise<{ error: { message: string } | null }> => ({ error: null }));
const createSignedUrl = vi.fn(async (..._a: unknown[]): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }> => ({ data: { signedUrl: 'https://firmada' }, error: null }));
const bucketsUsados: string[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: constructor,
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcs.push({ fn, args }); return respuestas.shift() ?? { data: [], error: null }; },
    storage: { from: (b: string) => { bucketsUsados.push(b); return { upload, createSignedUrl }; } },
  }),
}));
vi.mock('../presupuesto', async (orig) => ({ ...(await orig<typeof import('../presupuesto')>()), acotada: (q: unknown) => q }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const r = await import('./repo_correo');

const T = 'tenant-sintetico-1';
const LIQ = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const tieneEq = (l: Llamada, col: string, v: unknown) => l.ops.some((o) => o[0] === 'eq' && o[1] === col && o[2] === v);

beforeEach(() => { llamadas.length = 0; rpcs.length = 0; respuestas = []; comportamiento = null; bucketsUsados.length = 0; });

// T-A1-29: lo que el detalle y «Liberar envío» le piden a la base.
describe('leerDesglose', () => {
  it('lee UN encabezado anclado a la flota y a la liquidación', async () => {
    respuestas = [{ data: { liquidacion_externa_id: LIQ, bitacora: 'B-1', terminal: null, poliza: 'P', unidad: null, tipo_operador: 'foraneo', dias: 3, total_origen: 'tms', enviado_origen_en: null, retenida_motivo: 'neto negativo', created_at: '2026-10-01T00:00:00Z' }, error: null }];
    const l = await r.leerDesglose(T, LIQ);
    expect(l).toEqual({ ok: true, valor: expect.objectContaining({ bitacora: 'B-1', retenidaMotivo: 'neto negativo' }) });
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
    expect(tieneEq(llamadas[0], 'liquidacion_externa_id', LIQ)).toBe(true);
  });

  it('sin fila ⇒ null (no existe); tabla ausente ⇒ no_disponible (nunca «no existe»)', async () => {
    respuestas = [{ data: null, error: null }];
    expect(await r.leerDesglose(T, LIQ)).toEqual({ ok: true, valor: null });
    respuestas = [{ data: null, error: { message: 'relation "x" does not exist', code: '42P01' } }];
    expect(await r.leerDesglose(T, LIQ)).toEqual({ ok: false, motivo: 'no_disponible' });
  });
});

describe('liberarRetencionDesglose', () => {
  it('quita la retención SOLO si sigue retenido, anclado a la flota (el candado es el UPDATE)', async () => {
    respuestas = [{ data: [{ liquidacion_externa_id: LIQ }], error: null }];
    expect(await r.liberarRetencionDesglose(T, LIQ)).toBe(true);
    const l = llamadas[0];
    expect(l.ops.find((o) => o[0] === 'update')![1]).toEqual({ retenida_motivo: null });
    expect(l.ops.some((o) => o[0] === 'not' && o[1] === 'retenida_motivo' && o[2] === 'is' && o[3] === null)).toBe(true);
    expect(tieneEq(l, 'tenant_id', T)).toBe(true);
  });

  it('la segunda llamada (ya no retenido) devuelve false', async () => {
    respuestas = [{ data: [], error: null }];
    expect(await r.liberarRetencionDesglose(T, LIQ)).toBe(false);
  });

  it('un error de la base se lanza: jamás finge haber liberado', async () => {
    respuestas = [{ data: null, error: { message: 'boom', code: 'XX000' } }];
    await expect(r.liberarRetencionDesglose(T, LIQ)).rejects.toThrow();
  });
});

describe('listarExcepciones por clave', () => {
  it('filtra por la clave de la bitácora además de la flota', async () => {
    respuestas = [{ data: [], error: null }];
    await r.listarExcepciones(T, { clave: 'T1-B-1' });
    expect(tieneEq(llamadas[0], 'clave_externa', 'T1-B-1')).toBe(true);
    expect(tieneEq(llamadas[0], 'tenant_id', T)).toBe(true);
  });
});
